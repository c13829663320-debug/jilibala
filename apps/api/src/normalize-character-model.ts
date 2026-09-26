/**
 * M12 自定义人物模型归一化 + 全身判定。
 *
 * 归一化：用一个 wrapper node 包裹所有 root nodes，做无损变换——
 *   均匀缩放 k = targetHeight / H（targetHeight ≈ 1.75）
 *   平移 T.y = -k * min.y（脚落地 y=0）
 *   T.x = -k * (min.x + max.x) / 2、T.z = -k * (min.z + max.z) / 2（x/z 居中）
 *   不旋转模型（Tripo 约定 +z = 正面），朝向由席位 facing 控制。
 *
 * 全身判定：用归一化前 bbox 比例。
 *   fullBody  = H/W >= 1.7  且 H/D >= 2.0
 *   notFullBody（拦截）= H/W < 1.4 或 H/D < 1.5
 *   灰区放行带 warning；footW/W >= 0.85 的宽截断判半身。
 */
import { NodeIO, type Document, type Node, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import draco3d from 'draco3d'

/** 归一化目标身高（米）。法庭席位站姿人台头高 ≈1.7，取 1.75 略有余量。 */
export const NORMALIZE_TARGET_HEIGHT = 1.75

export type BodyAssessment = {
  /** 是否判定为全身（可通过） */
  fullBody: boolean
  /** 是否明确拦截（半身/头像） */
  notFullBody: boolean
  /** 灰区提示（非空时表示通过但有疑虑） */
  warning: string
  /** 原始 bbox 尺寸（宽/高/深） */
  size: { w: number; h: number; d: number }
  /** 脚底 4%H 切片宽度 / 总宽 */
  footWidthRatio: number
}

type BBox = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

const EMPTY_BBOX: BBox = {
  minX: Infinity, minY: Infinity, minZ: Infinity,
  maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
}

/**
 * 列主序 mat4 × 点（含透视除 w）。
 * gltf-transform v4.5 node.getWorldMatrix() 返回 16 元素列主序数组。
 */
function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  const invW = w !== 0 ? 1 / w : 1
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW,
  ]
}

function expandBBox(bbox: BBox, x: number, y: number, z: number): void {
  if (x < bbox.minX) bbox.minX = x
  if (y < bbox.minY) bbox.minY = y
  if (z < bbox.minZ) bbox.minZ = z
  if (x > bbox.maxX) bbox.maxX = x
  if (y > bbox.maxY) bbox.maxY = y
  if (z > bbox.maxZ) bbox.maxZ = z
}

/** 遍历文档所有 node，用世界矩阵变换每个 primitive 的 POSITION 顶点，求世界 bbox。 */
function computeWorldBBox(doc: Document): BBox {
  const bbox: BBox = { ...EMPTY_BBOX }
  const root = doc.getRoot()
  const nodes = root.listNodes()
  if (nodes.length === 0) return bbox

  // 预计算每个 node 的世界矩阵（getWorldMatrix 内部会遍历父链，这里直接调用即可）
  for (const node of nodes) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const worldMatrix = node.getWorldMatrix()
    if (!worldMatrix || worldMatrix.length < 16) continue

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const arr = position.getArray()
      if (!arr) continue
      const count = position.getCount()
      for (let i = 0; i < count; i++) {
        const x = arr[i * 3]
        const y = arr[i * 3 + 1]
        const z = arr[i * 3 + 2]
        const [wx, wy, wz] = transformPoint(worldMatrix, x, y, z)
        expandBBox(bbox, wx, wy, wz)
      }
    }
  }
  return bbox
}

/**
 * 计算脚底 4%H 切片的宽度比。
 * 在 y ∈ [minY, minY + 0.04*H] 范围内的顶点，求其 x 方向跨度 / 总宽。
 */
function computeFootWidthRatio(doc: Document, bbox: BBox): number {
  const H = bbox.maxY - bbox.minY
  if (H <= 0) return 0
  const footTop = bbox.minY + 0.04 * H
  let footMinX = Infinity
  let footMaxX = -Infinity
  let found = false

  const root = doc.getRoot()
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const worldMatrix = node.getWorldMatrix()
    if (!worldMatrix || worldMatrix.length < 16) continue
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const arr = position.getArray()
      if (!arr) continue
      const count = position.getCount()
      for (let i = 0; i < count; i++) {
        const [wx, wy] = transformPoint(worldMatrix, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
        if (wy >= bbox.minY && wy <= footTop) {
          found = true
          if (wx < footMinX) footMinX = wx
          if (wx > footMaxX) footMaxX = wx
        }
      }
    }
  }
  if (!found) return 0
  const W = bbox.maxX - bbox.minX
  return W > 0 ? (footMaxX - footMinX) / W : 0
}

/** 根据 bbox 判定全身/半身。纯函数，便于单测。 */
export function assessBodyProportions(bbox: BBox, footWidthRatio: number): BodyAssessment {
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  const d = bbox.maxZ - bbox.minZ
  const size = { w, h, d }

  if (h <= 0 || w <= 0 || d <= 0) {
    return { fullBody: false, notFullBody: true, warning: '模型几何为空或无效', size, footWidthRatio }
  }

  const hw = h / w
  const hd = h / d

  // 明确拦截：过矮过宽（头像/半身特写）
  if (hw < 1.4 || hd < 1.5) {
    return {
      fullBody: false, notFullBody: true,
      warning: `模型比例疑似半身/头像（H/W=${hw.toFixed(2)}, H/D=${hd.toFixed(2)}），请上传从头到脚的全身照或改用文字描述生成全身模型。`,
      size, footWidthRatio,
    }
  }

  // 明确全身：比例达标即通过，脚底宽截断仅用于灰区/疑似半身
  if (hw >= 1.7 && hd >= 2.0) {
    const warn = footWidthRatio >= 0.85
      ? `模型脚底较宽（脚底宽度比=${footWidthRatio.toFixed(2)}），比例已达标但建议确认双腿完整。`
      : ''
    return { fullBody: true, notFullBody: false, warning: warn, size, footWidthRatio }
  }

  // 灰区 + 脚底宽截断：footW/W >= 0.85 说明底部被平切（半身照常见）
  if (footWidthRatio >= 0.85) {
    return {
      fullBody: false, notFullBody: true,
      warning: `模型底部疑似被裁切（脚底宽度比=${footWidthRatio.toFixed(2)}），可能是半身照生成，请使用全身照。`,
      size, footWidthRatio,
    }
  }

  // 灰区：放行但带 warning
  return {
    fullBody: true, notFullBody: false,
    warning: `模型比例处于灰区（H/W=${hw.toFixed(2)}, H/D=${hd.toFixed(2)}），已通过但建议确认模型包含完整双腿。`,
    size, footWidthRatio,
  }
}

let dracoDecoder: unknown | null = null
async function getDracoDecoder(): Promise<unknown> {
  if (!dracoDecoder) {
    dracoDecoder = await (draco3d as { createDecoderModule: () => Promise<unknown> }).createDecoderModule()
  }
  return dracoDecoder
}

/** 创建配置好 ALL_EXTENSIONS + meshopt/draco decoder 的 NodeIO。 */
export async function createCharacterIO(): Promise<NodeIO> {
  const io = new NodeIO()
  io.registerExtensions(ALL_EXTENSIONS)
  const draco = await getDracoDecoder()
  io.registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': draco,
  })
  return io
}

export type NormalizeResult = {
  /** 归一化后的 GLB binary */
  glb: Uint8Array
  /** 全身判定结果 */
  assessment: BodyAssessment
  /** 应用的缩放系数 */
  scale: number
  /** 原始 bbox */
  originalBBox: BBox
}

/**
 * 读取 GLB binary，计算世界 bbox，做全身判定，用 wrapper node 归一化后输出。
 * 不修改原始 vertex 数据，仅通过 wrapper node 的 scale/translation 做无损变换。
 */
export async function normalizeCharacterModel(glbBytes: Uint8Array, targetHeight = NORMALIZE_TARGET_HEIGHT): Promise<NormalizeResult> {
  const io = await createCharacterIO()
  const doc = await io.readBinary(new Uint8Array(glbBytes))

  const bbox = computeWorldBBox(doc)
  if (!isFinite(bbox.minX) || !isFinite(bbox.maxX)) {
    throw new Error('模型几何为空：未找到任何 POSITION 顶点。')
  }

  const footWidthRatio = computeFootWidthRatio(doc, bbox)
  const assessment = assessBodyProportions(bbox, footWidthRatio)

  const H = bbox.maxY - bbox.minY
  const scale = targetHeight / Math.max(H, 0.001)

  // 用 wrapper node 包裹所有 root nodes，做无损变换
  const root = doc.getRoot()
  const scene = root.listScenes()[0] ?? root.getDefaultScene() ?? doc.createScene()
  const wrapper = doc.createNode('character-wrapper')
  wrapper.setScale([scale, scale, scale])
  wrapper.setTranslation([
    -scale * (bbox.minX + bbox.maxX) / 2,
    -scale * bbox.minY,
    -scale * (bbox.minZ + bbox.maxZ) / 2,
  ])

  // 把 scene 下原有的 root children 移到 wrapper 下
  const children = scene.listChildren()
  for (const child of children) {
    scene.removeChild(child)
    wrapper.addChild(child)
  }
  scene.addChild(wrapper)

  const outBytes = await io.writeBinary(doc)
  return { glb: outBytes, assessment, scale, originalBBox: bbox }
}

/** 仅做全身判定，不归一化（用于预检/调试）。 */
export async function assessCharacterModel(glbBytes: Uint8Array): Promise<BodyAssessment> {
  const io = await createCharacterIO()
  const doc = await io.readBinary(new Uint8Array(glbBytes))
  const bbox = computeWorldBBox(doc)
  if (!isFinite(bbox.minX) || !isFinite(bbox.maxX)) {
    return { fullBody: false, notFullBody: true, warning: '模型几何为空', size: { w: 0, h: 0, d: 0 }, footWidthRatio: 0 }
  }
  const footWidthRatio = computeFootWidthRatio(doc, bbox)
  return assessBodyProportions(bbox, footWidthRatio)
}
