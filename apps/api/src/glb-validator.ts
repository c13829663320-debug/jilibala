/**
 * GLB 导入校验器（纯函数，无运行时依赖，可单测 / 可被 Windows CLI 复用逻辑）。
 *
 * 校验维度：
 *   1. 容器结构：magic='glTF'、version=2、JSON chunk + BIN chunk 齐全、长度自洽。
 *   2. glTF JSON 合法性：是对象、scene/nodes/meshes/materials 等字段类型正确。
 *   3. 骨骼层级：若存在 skin，则其 joints 节点名必须覆盖核心骨（Hips/Spine/Head，
 *      兼容 Mixamo / VRM 命名别名）。无 skin 视为静态网格（warning，不算 error）。
 *   4. 材质 / PBR 规范：pbrMetallicRoughness 的 factor 取值范围合法。
 *   5. 贴图引用完整性：texture.source → image → bufferView → buffer 链路全部在界内。
 *   6. 三角面数阈值：累计所有 primitive 三角形数，超过 maxTriangles 报 error。
 *
 * 设计原则：只读字节、不写盘、不发网络；所有检查产出结构化 issue，
 * valid = issues 中没有 severity=error。
 */

// ---- GLB 二进制常量 -------------------------------------------------------
const GLB_MAGIC = 0x46546c67 // "glTF" 小端
const GLB_VERSION = 2
const CHUNK_JSON = 0x4e4f534a // "JSON"
const CHUNK_BIN = 0x004e4942 // "BIN\0"

/** 单 GLB 三角面数硬上限（化身模型远低于此；超标说明未减面）。 */
export const DEFAULT_MAX_TRIANGLES = 500_000

/**
 * 核心骨别名表（小写匹配）。每组至少命中一个才算通过。
 * 兼容 Mixamo（Hips/Spine/Spine1/Neck/Head）与 VRM（hips/spine/head 等）。
 */
const CORE_BONE_GROUPS: ReadonlyArray<{ key: string; aliases: string[] }> = [
  { key: 'Hips', aliases: ['hips', 'hip', 'pelvis', 'hipspine', 'root'] },
  { key: 'Spine', aliases: ['spine', 'spine1', 'spine2', 'spine0', 'chest', 'upperchest', 'torso'] },
  { key: 'Head', aliases: ['head', 'neck', 'neck1'] },
]

export type IssueSeverity = 'error' | 'warning'

export interface GlbIssue {
  code: string
  severity: IssueSeverity
  message: string
}

export interface GlbValidatorOptions {
  /** 三角形数上限，默认 DEFAULT_MAX_TRIANGLES。 */
  maxTriangles?: number
  /** 必须命中的核心骨别名组（默认 CORE_BONE_GROUPS）。 */
  coreBoneGroups?: ReadonlyArray<{ key: string; aliases: string[] }>
}

export interface GlbValidationReport {
  /** 是否通过（无 error）。 */
  valid: boolean
  glbVersion?: number
  totalBytes: number
  jsonChunkLength: number
  binChunkLength: number
  meshCount: number
  primitiveCount: number
  triangleCount: number
  materialCount: number
  textureCount: number
  imageCount: number
  skinCount: number
  /** 所有骨骼节点名（skin.joints 指向的 node.name）。 */
  boneNames: string[]
  /** 缺失的核心骨组 key。 */
  missingCoreBones: string[]
  /** 是否包含骨骼蒙皮。 */
  hasSkeleton: boolean
  issues: GlbIssue[]
}

// ---- 最小 glTF JSON 类型（只取我们用到的字段） -----------------------------
interface GlTFAccessor { count?: number; type?: string; bufferView?: number; componentType?: number }
interface GlTFMeshPrimitive {
  attributes?: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}
interface GlTFMesh { primitives?: GlTFMeshPrimitive[]; name?: string }
interface GlTFNode { name?: string; mesh?: number; children?: number[]; skin?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }
interface GlTFSkin { joints?: number[]; name?: string }
interface GlTFMaterialPBR {
  baseColorFactor?: number[]
  metallicFactor?: number
  roughnessFactor?: number
  baseColorTexture?: { index?: number }
  metallicRoughnessTexture?: { index?: number }
}
interface GlTFMaterial { pbrMetallicRoughness?: GlTFMaterialPBR; name?: string }
interface GlTFTexture { source?: number; sampler?: number }
interface GlTFImage { bufferView?: number; mimeType?: string; uri?: string }
interface GlTFBufferView { buffer?: number; byteLength?: number; byteOffset?: number }
interface GlTFBuffer { byteLength?: number; uri?: string }
interface GlTF {
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
  nodes?: GlTFNode[]
  meshes?: GlTFMesh[]
  materials?: GlTFMaterial[]
  accessors?: GlTFAccessor[]
  skins?: GlTFSkin[]
  textures?: GlTFTexture[]
  images?: GlTFImage[]
  bufferViews?: GlTFBufferView[]
  buffers?: GlTFBuffer[]
  asset?: { version?: string; generator?: string }
}

// ---- 容器解析 -------------------------------------------------------------
interface ParsedContainer {
  json: GlTF | null
  binLength: number
  jsonLength: number
  version: number
  issues: GlbIssue[]
}

/**
 * 解析 GLB 容器（header + chunks）。纯函数：只读字节，不抛异常——
 * 任何结构错误都收敛为 issues 返回，方便上层统一处理。
 */
export function parseGlbContainer(bytes: Uint8Array): ParsedContainer {
  const issues: GlbIssue[] = []
  const totalBytes = bytes.byteLength

  if (totalBytes < 12) {
    issues.push({ code: 'FILE_TOO_SMALL', severity: 'error', message: `文件仅 ${totalBytes} 字节，不足 GLB 头部(12)。` })
    return { json: null, binLength: 0, jsonLength: 0, version: 0, issues }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const totalLength = view.getUint32(8, true)

  if (magic !== GLB_MAGIC) {
    issues.push({ code: 'BAD_MAGIC', severity: 'error', message: `magic=0x${magic.toString(16)}，不是 0x46546c67（glTF）。` })
    return { json: null, binLength: 0, jsonLength: 0, version, issues }
  }
  if (version !== GLB_VERSION) {
    issues.push({ code: 'BAD_VERSION', severity: 'error', message: `glTF version=${version}，仅支持 2。` })
  }
  if (totalLength !== totalBytes) {
    issues.push({ code: 'LENGTH_MISMATCH', severity: 'warning', message: `GLB 声明总长 ${totalLength} 与实际 ${totalBytes} 不一致。` })
  }

  let offset = 12
  let json: GlTF | null = null
  let jsonLength = 0
  let binLength = 0
  let chunkIndex = 0

  while (offset + 8 <= totalBytes) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8
    if (offset + chunkLength > totalBytes) {
      issues.push({ code: 'CHUNK_OVERFLOW', severity: 'error', message: `第 ${chunkIndex} 个 chunk 越界（offset=${offset}, len=${chunkLength}）。` })
      break
    }
    if (chunkType === CHUNK_JSON) {
      jsonLength = chunkLength
      const slice = bytes.subarray(offset, offset + chunkLength)
      // JSON chunk 允许尾部空格(0x20)填充
      let end = chunkLength
      while (end > 0 && slice[end - 1] === 0x20) end--
      try {
        const text = new TextDecoder().decode(slice.subarray(0, end))
        const parsed = JSON.parse(text) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          json = parsed as GlTF
        } else {
          issues.push({ code: 'JSON_NOT_OBJECT', severity: 'error', message: 'glTF JSON 根节点不是对象。' })
        }
      } catch (err) {
        issues.push({ code: 'JSON_PARSE_FAILED', severity: 'error', message: `glTF JSON 解析失败：${err instanceof Error ? err.message : String(err)}` })
      }
    } else if (chunkType === CHUNK_BIN) {
      binLength = chunkLength
    } else if (chunkIndex === 0) {
      issues.push({ code: 'FIRST_CHUNK_NOT_JSON', severity: 'error', message: '第一个 chunk 不是 JSON。' })
    }
    offset += chunkLength
    chunkIndex++
  }

  if (json === null && !issues.some((i) => i.code === 'JSON_PARSE_FAILED' || i.code === 'JSON_NOT_OBJECT')) {
    issues.push({ code: 'MISSING_JSON_CHUNK', severity: 'error', message: '未找到 JSON chunk。' })
  }
  if (binLength === 0) {
    // 纯节点/无几何的 GLB 允许无 BIN chunk（但化身模型基本都有几何）。
    issues.push({ code: 'MISSING_BIN_CHUNK', severity: 'warning', message: '未找到 BIN chunk（可能无顶点数据）。' })
  }

  return { json, binLength, jsonLength, version, issues }
}

// ---- 三角面计数 -----------------------------------------------------------
/** 统计单个 mesh primitive 的三角形数。mode=4(TRIANGLES) 为默认。 */
function primitiveTriangleCount(prim: GlTFMeshPrimitive, accessors: GlTFAccessor[]): number {
  // mode: 0 POINTS,1 LINES,2 LINE_LOOP,3 LINE_STRIP,4 TRIANGLES,5 TRIANGLE_STRIP,6 TRIANGLE_FAN
  const mode = prim.mode ?? 4
  if (mode !== 4) return 0 // 非三角列表一律不计入（保守）
  const idx = prim.indices
  if (typeof idx === 'number' && accessors[idx]) {
    const count = accessors[idx].count ?? 0
    return Math.floor(count / 3)
  }
  const pos = prim.attributes?.POSITION
  if (typeof pos === 'number' && accessors[pos]) {
    const count = accessors[pos].count ?? 0
    return Math.floor(count / 3)
  }
  return 0
}

// ---- 骨骼收集 -------------------------------------------------------------
/** 从 skin.joints 收集骨骼节点名；同时遍历所有 node 名作为兜底。 */
function collectBoneNames(gltf: GlTF): { boneNames: string[]; hasSkeleton: boolean } {
  const names = new Set<string>()
  let hasSkeleton = false
  const nodes = gltf.nodes ?? []
  const skins = gltf.skins ?? []

  for (const skin of skins) {
    hasSkeleton = true
    for (const jointIndex of skin.joints ?? []) {
      const node = nodes[jointIndex]
      if (node?.name) names.add(node.name)
    }
  }
  return { boneNames: [...names], hasSkeleton }
}

/** 判断核心骨组是否命中（小写、去除非字母数字后匹配别名）。 */
export function missingCoreBoneGroups(
  boneNames: string[],
  groups: ReadonlyArray<{ key: string; aliases: string[] }> = CORE_BONE_GROUPS,
): string[] {
  const normalized = boneNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const missing: string[] = []
  for (const group of groups) {
    const hit = group.aliases.some((alias) => {
      const a = alias.replace(/[^a-z0-9]/g, '')
      return normalized.some((n) => n === a || n.includes(a))
    })
    if (!hit) missing.push(group.key)
  }
  return missing
}

// ---- 贴图引用完整性 --------------------------------------------------------
function checkTextureReferences(gltf: GlTF, issues: GlbIssue[]): void {
  const textures = gltf.textures ?? []
  const images = gltf.images ?? []
  const bufferViews = gltf.bufferViews ?? []
  const buffers = gltf.buffers ?? []

  textures.forEach((tex, i) => {
    if (tex.source === undefined) return // 允许无图（纯 factor 材质）
    const img = images[tex.source]
    if (!img) {
      issues.push({ code: 'TEXTURE_MISSING_IMAGE', severity: 'error', message: `texture[${i}].source=${tex.source} 越界（images 共 ${images.length}）。` })
      return
    }
    // 贴图要么内嵌 bufferView，要么有外部 uri；两者都缺 = 引用不完整
    if (img.bufferView === undefined && !img.uri) {
      issues.push({ code: 'IMAGE_NO_SOURCE', severity: 'error', message: `image[${tex.source}] 既无 bufferView 也无 uri，贴图数据缺失。` })
      return
    }
    if (img.bufferView !== undefined) {
      const bv = bufferViews[img.bufferView]
      if (!bv) {
        issues.push({ code: 'IMAGE_BUFFERVIEW_MISSING', severity: 'error', message: `image[${tex.source}].bufferView=${img.bufferView} 越界。` })
        return
      }
      const buf = buffers[bv.buffer ?? 0]
      if (!buf) {
        issues.push({ code: 'IMAGE_BUFFER_MISSING', severity: 'error', message: `image[${tex.source}] 引用的 buffer 越界。` })
      }
    }
  })
}

// ---- 材质 PBR 检查 ---------------------------------------------------------
function checkMaterials(gltf: GlTF, issues: GlbIssue[]): void {
  const materials = gltf.materials ?? []
  if (materials.length === 0) {
    issues.push({ code: 'NO_MATERIAL', severity: 'warning', message: '未定义任何材质（将使用默认材质）。' })
    return
  }
  materials.forEach((mat, i) => {
    const pbr = mat.pbrMetallicRoughness
    if (!pbr) {
      issues.push({ code: 'NON_PBR_MATERIAL', severity: 'warning', message: `material[${i}]「${mat.name ?? ''}」缺少 pbrMetallicRoughness。` })
      return
    }
    if (pbr.baseColorFactor) {
      if (!Array.isArray(pbr.baseColorFactor) || pbr.baseColorFactor.length !== 4) {
        issues.push({ code: 'BAD_BASECOLOR_FACTOR', severity: 'error', message: `material[${i}].baseColorFactor 必须是 4 分量 RGBA。` })
      } else if (pbr.baseColorFactor.some((v) => typeof v !== 'number' || v < 0 || v > 1)) {
        issues.push({ code: 'BASECOLOR_OUT_OF_RANGE', severity: 'error', message: `material[${i}].baseColorFactor 分量须在 [0,1]。` })
      }
    }
    if (typeof pbr.metallicFactor === 'number' && (pbr.metallicFactor < 0 || pbr.metallicFactor > 1)) {
      issues.push({ code: 'METALLIC_OUT_OF_RANGE', severity: 'error', message: `material[${i}].metallicFactor=${pbr.metallicFactor} 须在 [0,1]。` })
    }
    if (typeof pbr.roughnessFactor === 'number' && (pbr.roughnessFactor < 0 || pbr.roughnessFactor > 1)) {
      issues.push({ code: 'ROUGHNESS_OUT_OF_RANGE', severity: 'error', message: `material[${i}].roughnessFactor=${pbr.roughnessFactor} 须在 [0,1]。` })
    }
  })
}

// ---- 主入口 ---------------------------------------------------------------
/**
 * 校验 GLB 字节，返回结构化报告。永不抛异常——所有解析错误都进 issues。
 */
export function validateGlb(input: Uint8Array | ArrayBuffer, options: GlbValidatorOptions = {}): GlbValidationReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES
  const groups = options.coreBoneGroups ?? CORE_BONE_GROUPS

  const report: GlbValidationReport = {
    valid: false,
    totalBytes: bytes.byteLength,
    jsonChunkLength: 0,
    binChunkLength: 0,
    meshCount: 0,
    primitiveCount: 0,
    triangleCount: 0,
    materialCount: 0,
    textureCount: 0,
    imageCount: 0,
    skinCount: 0,
    boneNames: [],
    missingCoreBones: [],
    hasSkeleton: false,
    issues: [],
  }

  const container = parseGlbContainer(bytes)
  report.issues.push(...container.issues)
  report.glbVersion = container.version
  report.jsonChunkLength = container.jsonLength
  report.binChunkLength = container.binLength

  const gltf = container.json
  if (!gltf) {
    return finalize(report)
  }

  const accessors = gltf.accessors ?? []
  const meshes = gltf.meshes ?? []
  report.meshCount = meshes.length
  report.materialCount = (gltf.materials ?? []).length
  report.textureCount = (gltf.textures ?? []).length
  report.imageCount = (gltf.images ?? []).length
  report.skinCount = (gltf.skins ?? []).length

  // 三角面
  let triangles = 0
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      report.primitiveCount++
      triangles += primitiveTriangleCount(prim, accessors)
    }
  }
  report.triangleCount = triangles
  if (triangles > maxTriangles) {
    report.issues.push({
      code: 'TOO_MANY_TRIANGLES', severity: 'error',
      message: `三角形数 ${triangles.toLocaleString()} 超过上限 ${maxTriangles.toLocaleString()}，请减面。`,
    })
  }
  if (report.primitiveCount === 0) {
    report.issues.push({ code: 'NO_GEOMETRY', severity: 'error', message: '未找到任何 mesh primitive（无几何）。' })
  }

  // 骨骼
  const { boneNames, hasSkeleton } = collectBoneNames(gltf)
  report.boneNames = boneNames
  report.hasSkeleton = hasSkeleton
  if (hasSkeleton) {
    const missing = missingCoreBoneGroups(boneNames, groups)
    report.missingCoreBones = missing
    if (missing.length > 0) {
      report.issues.push({
        code: 'MISSING_CORE_BONES', severity: 'error',
        message: `骨骼缺少核心骨：${missing.join('/')}。需兼容 Mixamo/VRM 命名（Hips/Spine/Head）。`,
      })
    }
  } else {
    report.issues.push({
      code: 'NO_SKELETON', severity: 'warning',
      message: '无骨骼蒙皮（静态网格）。用于可动化身时应导入 Mixamo/VRM 骨架。',
    })
  }

  checkMaterials(gltf, report.issues)
  checkTextureReferences(gltf, report.issues)

  return finalize(report)
}

function finalize(report: GlbValidationReport): GlbValidationReport {
  report.valid = !report.issues.some((i) => i.severity === 'error')
  return report
}
