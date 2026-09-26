/**
 * normalize-character-model 单测（Vitest）：
 * 程序化构造 GLB（高瘦盒=全身、矮宽盒=半身），验证脚落地 y=0、x/z 居中、
 * 身高=targetHeight、全身判定正确。
 */
import { describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import {
  normalizeCharacterModel,
  assessBodyProportions,
  NORMALIZE_TARGET_HEIGHT,
  type BBox,
} from './normalize-character-model.js'

/** 用 gltf-transform 程序化构造一个轴对齐盒状 GLB（用于模拟全身/半身比例）。 */
async function buildBoxGLB(width: number, height: number, depth: number, centerY = height / 2): Promise<Uint8Array> {
  const doc = new Document()
  const buffer = doc.createBuffer()

  const positions = new Float32Array([
    -width / 2, centerY - height / 2, -depth / 2,
     width / 2, centerY - height / 2, -depth / 2,
     width / 2, centerY - height / 2,  depth / 2,
    -width / 2, centerY - height / 2,  depth / 2,
    -width / 2, centerY + height / 2, -depth / 2,
     width / 2, centerY + height / 2, -depth / 2,
     width / 2, centerY + height / 2,  depth / 2,
    -width / 2, centerY + height / 2,  depth / 2,
  ])
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ])

  const positionAcc = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer)
  const indexAcc = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer)

  const prim = doc.createPrimitive().setAttribute('POSITION', positionAcc).setIndices(indexAcc)
  const mesh = doc.createMesh('box').addPrimitive(prim)
  const node = doc.createNode('box-node').setMesh(mesh)
  const scene = doc.createScene().addChild(node)
  doc.getRoot().setDefaultScene(scene)

  const io = new NodeIO()
  io.registerExtensions(ALL_EXTENSIONS)
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  return await io.writeBinary(doc)
}

/** 读取归一化后的 GLB，计算其世界 bbox（验证脚落地/居中/身高）。 */
async function readNormalizedBBox(glb: Uint8Array): Promise<BBox> {
  const io = new NodeIO()
  io.registerExtensions(ALL_EXTENSIONS)
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.readBinary(glb)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const wm = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray()
      if (!arr) continue
      for (let i = 0; i < pos.getCount(); i++) {
        const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2]
        const w = wm[3] * x + wm[7] * y + wm[11] * z + wm[15]
        const invW = w !== 0 ? 1 / w : 1
        const wx = (wm[0] * x + wm[4] * y + wm[8] * z + wm[12]) * invW
        const wy = (wm[1] * x + wm[5] * y + wm[9] * z + wm[13]) * invW
        const wz = (wm[2] * x + wm[6] * y + wm[10] * z + wm[14]) * invW
        if (wx < minX) minX = wx; if (wy < minY) minY = wy; if (wz < minZ) minZ = wz
        if (wx > maxX) maxX = wx; if (wy > maxY) maxY = wy; if (wz > maxZ) maxZ = wz
      }
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

describe('normalize-character-model', () => {
  it('全身高瘦盒：归一化后脚落地 y=0、x/z 居中、身高=targetHeight', async () => {
    const glb = await buildBoxGLB(0.5, 2.0, 0.4)
    const result = await normalizeCharacterModel(glb)
    expect(result.assessment.fullBody).toBe(true)
    expect(result.assessment.notFullBody).toBe(false)

    const bbox = await readNormalizedBBox(result.glb)
    const H = bbox.maxY - bbox.minY
    const centerX = (bbox.minX + bbox.maxX) / 2
    const centerZ = (bbox.minZ + bbox.maxZ) / 2

    expect(Math.abs(bbox.minY)).toBeLessThan(0.01)
    expect(Math.abs(H - NORMALIZE_TARGET_HEIGHT)).toBeLessThan(0.01)
    expect(Math.abs(centerX)).toBeLessThan(0.01)
    expect(Math.abs(centerZ)).toBeLessThan(0.01)
  })

  it('半身矮宽盒：被拦截 notFullBody=true', async () => {
    const glb = await buildBoxGLB(1.5, 1.0, 1.2)
    const result = await normalizeCharacterModel(glb)
    expect(result.assessment.fullBody).toBe(false)
    expect(result.assessment.notFullBody).toBe(true)
    expect(result.assessment.warning.length).toBeGreaterThan(0)
  })

  it('灰区比例：放行但带 warning（纯函数 + 低脚底比）', () => {
    const gray: BBox = { minX: -0.4, minY: 0, minZ: -0.35, maxX: 0.4, maxY: 1.3, maxZ: 0.35 }
    const r = assessBodyProportions(gray, 0.5)
    expect(r.fullBody).toBe(true)
    expect(r.notFullBody).toBe(false)
    expect(r.warning.length).toBeGreaterThan(0)
  })

  it('assessBodyProportions 纯函数：边界阈值正确', () => {
    // 明确全身
    const full: BBox = { minX: -0.25, minY: 0, minZ: -0.16, maxX: 0.25, maxY: 1.0, maxZ: 0.16 }
    const r1 = assessBodyProportions(full, 0.5)
    expect(r1.fullBody).toBe(true)
    expect(r1.notFullBody).toBe(false)
    expect(r1.warning).toBe('')

    // 明确拦截
    const half: BBox = { minX: -0.5, minY: 0, minZ: -0.5, maxX: 0.5, maxY: 1.0, maxZ: 0.5 }
    const r2 = assessBodyProportions(half, 0.5)
    expect(r2.fullBody).toBe(false)
    expect(r2.notFullBody).toBe(true)

    // 脚底宽截断拦截（灰区 + footW/W=0.9）
    const footCut: BBox = { minX: -0.3, minY: 0, minZ: -0.2, maxX: 0.3, maxY: 1.0, maxZ: 0.2 }
    const r3 = assessBodyProportions(footCut, 0.9)
    expect(r3.fullBody).toBe(false)
    expect(r3.notFullBody).toBe(true)
    expect(r3.warning).toMatch(/裁切|底部/)
  })

  it('偏移模型：归一化后仍正确居中落地（验证世界矩阵变换）', async () => {
    const glb = await buildBoxGLB(0.5, 2.0, 0.4, 5.0)
    const io = new NodeIO()
    io.registerExtensions(ALL_EXTENSIONS)
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    const doc = await io.readBinary(glb)
    const node = doc.getRoot().listNodes()[0]
    node.setTranslation([2.0, 0, 3.0])
    const shiftedGlb = await io.writeBinary(doc)

    const result = await normalizeCharacterModel(shiftedGlb)
    const bbox = await readNormalizedBBox(result.glb)
    const H = bbox.maxY - bbox.minY
    const centerX = (bbox.minX + bbox.maxX) / 2
    const centerZ = (bbox.minZ + bbox.maxZ) / 2

    expect(Math.abs(bbox.minY)).toBeLessThan(0.01)
    expect(Math.abs(H - NORMALIZE_TARGET_HEIGHT)).toBeLessThan(0.01)
    expect(Math.abs(centerX)).toBeLessThan(0.01)
    expect(Math.abs(centerZ)).toBeLessThan(0.01)
  })
})
