#!/usr/bin/env node
/**
 * validate-glb.mjs — Windows 端本地 GLB 导入校验 CLI（零依赖，纯 Node）。
 *
 * 与服务端 apps/api/src/glb-validator.ts 校验维度一致：
 *   容器结构(magic/version/JSON/BIN chunk)、骨骼层级(Hips/Spine/Head)、
 *   材质 PBR 规范、贴图引用完整性、三角面数阈值。
 *
 * 运行环境：Node.js >= 18（Windows 自带或安装 https://nodejs.org/ 即可，无需 npm install）。
 *
 * 用法：
 *   node scripts/windows/validate-glb.mjs <model.glb> [--max-tris=500000] [--pretty]
 *
 * 退出码：
 *   0 = 通过（可能含 warning）
 *   1 = 存在 error（结构损坏 / 缺核心骨 / 三角面超限 / 贴图断链等）
 *   2 = 用法错误 / 文件不存在 / 读取失败
 *
 * stdout 默认输出 JSON 报告；加 --pretty 输出人类可读摘要。
 */
import { readFileSync } from 'node:fs'
import { statSync } from 'node:fs'
import { argv, exit } from 'node:process'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const DEFAULT_MAX_TRIANGLES = 500_000

const CORE_BONE_GROUPS = [
  { key: 'Hips', aliases: ['hips', 'hip', 'pelvis', 'hipspine', 'root'] },
  { key: 'Spine', aliases: ['spine', 'spine1', 'spine2', 'spine0', 'chest', 'upperchest', 'torso'] },
  { key: 'Head', aliases: ['head', 'neck', 'neck1'] },
]

function parseArgs(args) {
  const opts = { path: '', maxTriangles: DEFAULT_MAX_TRIANGLES, pretty: false }
  for (const a of args) {
    if (a === '--pretty') opts.pretty = true
    else if (a.startsWith('--max-tris=')) opts.maxTriangles = Number(a.split('=')[1]) || DEFAULT_MAX_TRIANGLES
    else if (!a.startsWith('-')) opts.path = a
  }
  return opts
}

function parseContainer(bytes) {
  const issues = []
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
  if (version !== 2) issues.push({ code: 'BAD_VERSION', severity: 'error', message: `glTF version=${version}，仅支持 2。` })
  if (totalLength !== totalBytes) issues.push({ code: 'LENGTH_MISMATCH', severity: 'warning', message: `GLB 声明总长 ${totalLength} 与实际 ${totalBytes} 不一致。` })

  let offset = 12
  let json = null
  let jsonLength = 0
  let binLength = 0
  let chunkIndex = 0
  while (offset + 8 <= totalBytes) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8
    if (offset + chunkLength > totalBytes) {
      issues.push({ code: 'CHUNK_OVERFLOW', severity: 'error', message: `第 ${chunkIndex} 个 chunk 越界。` })
      break
    }
    if (chunkType === CHUNK_JSON) {
      jsonLength = chunkLength
      const slice = bytes.subarray(offset, offset + chunkLength)
      let end = chunkLength
      while (end > 0 && slice[end - 1] === 0x20) end--
      try {
        json = JSON.parse(new TextDecoder().decode(slice.subarray(0, end)))
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
          issues.push({ code: 'JSON_NOT_OBJECT', severity: 'error', message: 'glTF JSON 根节点不是对象。' })
          json = null
        }
      } catch (err) {
        issues.push({ code: 'JSON_PARSE_FAILED', severity: 'error', message: `glTF JSON 解析失败：${err.message}` })
      }
    } else if (chunkType === CHUNK_BIN) {
      binLength = chunkLength
    } else if (chunkIndex === 0) {
      issues.push({ code: 'FIRST_CHUNK_NOT_JSON', severity: 'error', message: '第一个 chunk 不是 JSON。' })
    }
    offset += chunkLength
    chunkIndex++
  }
  if (json === null) issues.push({ code: 'MISSING_JSON_CHUNK', severity: 'error', message: '未找到 JSON chunk。' })
  if (binLength === 0) issues.push({ code: 'MISSING_BIN_CHUNK', severity: 'warning', message: '未找到 BIN chunk。' })
  return { json, binLength, jsonLength, version, issues }
}

function missingCoreBones(boneNames) {
  const normalized = boneNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const missing = []
  for (const g of CORE_BONE_GROUPS) {
    const hit = g.aliases.some((alias) => {
      const a = alias.replace(/[^a-z0-9]/g, '')
      return normalized.some((n) => n === a || n.includes(a))
    })
    if (!hit) missing.push(g.key)
  }
  return missing
}

function validate(bytes, maxTriangles) {
  const report = {
    valid: false, totalBytes: bytes.byteLength, jsonChunkLength: 0, binChunkLength: 0,
    meshCount: 0, primitiveCount: 0, triangleCount: 0, materialCount: 0, textureCount: 0,
    imageCount: 0, skinCount: 0, boneNames: [], missingCoreBones: [], hasSkeleton: false, issues: [],
  }
  const c = parseContainer(bytes)
  report.issues.push(...c.issues)
  report.glbVersion = c.version
  report.jsonChunkLength = c.jsonLength
  report.binChunkLength = c.binLength
  const gltf = c.json
  if (!gltf) { report.valid = false; return report }

  const accessors = gltf.accessors ?? []
  const meshes = gltf.meshes ?? []
  report.meshCount = meshes.length
  report.materialCount = (gltf.materials ?? []).length
  report.textureCount = (gltf.textures ?? []).length
  report.imageCount = (gltf.images ?? []).length
  report.skinCount = (gltf.skins ?? []).length

  let triangles = 0
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      report.primitiveCount++
      if ((prim.mode ?? 4) !== 4) continue
      if (typeof prim.indices === 'number' && accessors[prim.indices]) {
        triangles += Math.floor((accessors[prim.indices].count ?? 0) / 3)
      } else if (typeof prim.attributes?.POSITION === 'number' && accessors[prim.attributes.POSITION]) {
        triangles += Math.floor((accessors[prim.attributes.POSITION].count ?? 0) / 3)
      }
    }
  }
  report.triangleCount = triangles
  if (triangles > maxTriangles) {
    report.issues.push({ code: 'TOO_MANY_TRIANGLES', severity: 'error', message: `三角形数 ${triangles} 超过上限 ${maxTriangles}。` })
  }
  if (report.primitiveCount === 0) report.issues.push({ code: 'NO_GEOMETRY', severity: 'error', message: '未找到任何 mesh primitive。' })

  // 骨骼
  const nodes = gltf.nodes ?? []
  const boneNames = []
  let hasSkeleton = false
  for (const skin of gltf.skins ?? []) {
    hasSkeleton = true
    for (const j of skin.joints ?? []) if (nodes[j]?.name) boneNames.push(nodes[j].name)
  }
  report.boneNames = boneNames
  report.hasSkeleton = hasSkeleton
  if (hasSkeleton) {
    report.missingCoreBones = missingCoreBones(boneNames)
    if (report.missingCoreBones.length) {
      report.issues.push({ code: 'MISSING_CORE_BONES', severity: 'error', message: `骨骼缺少核心骨：${report.missingCoreBones.join('/')}。` })
    }
  } else {
    report.issues.push({ code: 'NO_SKELETON', severity: 'warning', message: '无骨骼蒙皮（静态网格）。' })
  }

  // 材质 PBR
  const materials = gltf.materials ?? []
  if (materials.length === 0) {
    report.issues.push({ code: 'NO_MATERIAL', severity: 'warning', message: '未定义任何材质。' })
  }
  materials.forEach((mat, i) => {
    const pbr = mat.pbrMetallicRoughness
    if (!pbr) { report.issues.push({ code: 'NON_PBR_MATERIAL', severity: 'warning', message: `material[${i}] 缺少 pbrMetallicRoughness。` }); return }
    if (pbr.baseColorFactor && (!Array.isArray(pbr.baseColorFactor) || pbr.baseColorFactor.length !== 4 || pbr.baseColorFactor.some((v) => v < 0 || v > 1))) {
      report.issues.push({ code: 'BAD_BASECOLOR_FACTOR', severity: 'error', message: `material[${i}].baseColorFactor 非法。` })
    }
    if (typeof pbr.metallicFactor === 'number' && (pbr.metallicFactor < 0 || pbr.metallicFactor > 1)) {
      report.issues.push({ code: 'METALLIC_OUT_OF_RANGE', severity: 'error', message: `material[${i}].metallicFactor 越界。` })
    }
    if (typeof pbr.roughnessFactor === 'number' && (pbr.roughnessFactor < 0 || pbr.roughnessFactor > 1)) {
      report.issues.push({ code: 'ROUGHNESS_OUT_OF_RANGE', severity: 'error', message: `material[${i}].roughnessFactor 越界。` })
    }
  })

  // 贴图引用
  const textures = gltf.textures ?? []
  const images = gltf.images ?? []
  const bufferViews = gltf.bufferViews ?? []
  const buffers = gltf.buffers ?? []
  textures.forEach((tex, i) => {
    if (tex.source === undefined) return
    const img = images[tex.source]
    if (!img) { report.issues.push({ code: 'TEXTURE_MISSING_IMAGE', severity: 'error', message: `texture[${i}].source=${tex.source} 越界。` }); return }
    if (img.bufferView === undefined && !img.uri) { report.issues.push({ code: 'IMAGE_NO_SOURCE', severity: 'error', message: `image[${tex.source}] 无数据来源。` }); return }
    if (img.bufferView !== undefined) {
      const bv = bufferViews[img.bufferView]
      if (!bv) { report.issues.push({ code: 'IMAGE_BUFFERVIEW_MISSING', severity: 'error', message: `image[${tex.source}].bufferView 越界。` }); return }
      if (!buffers[bv.buffer ?? 0]) report.issues.push({ code: 'IMAGE_BUFFER_MISSING', severity: 'error', message: `image[${tex.source}] buffer 越界。` })
    }
  })

  report.valid = !report.issues.some((i) => i.severity === 'error')
  return report
}

function main() {
  const opts = parseArgs(argv.slice(2))
  if (!opts.path) {
    console.error('用法: node validate-glb.mjs <model.glb> [--max-tris=500000] [--pretty]')
    exit(2)
  }
  let bytes
  try {
    bytes = readFileSync(opts.path)
    statSync(opts.path)
  } catch (err) {
    console.error(`无法读取文件: ${err.message}`)
    exit(2)
  }
  const report = validate(new Uint8Array(bytes), opts.maxTriangles)

  if (opts.pretty) {
    console.log(`\n=== GLB 校验报告: ${opts.path} ===`)
    console.log(`结果: ${report.valid ? 'PASS ✓' : 'FAIL ✗'}`)
    console.log(`大小: ${report.totalBytes} bytes | 三角形: ${report.triangleCount.toLocaleString()} | mesh: ${report.meshCount} | 材质: ${report.materialCount} | 骨骼: ${report.hasSkeleton ? '有' : '无'}`)
    if (report.missingCoreBones.length) console.log(`缺失核心骨: ${report.missingCoreBones.join(', ')}`)
    for (const i of report.issues) console.log(`  [${i.severity.toUpperCase()}] ${i.code}: ${i.message}`)
    console.log('')
  } else {
    console.log(JSON.stringify({ file: opts.path, ...report }, null, 2))
  }
  exit(report.valid ? 0 : 1)
}

main()
