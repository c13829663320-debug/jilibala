/**
 * glb-validator 单测（Vitest）：
 * 手工拼装 GLB 容器字节（header + JSON chunk + BIN chunk），
 * 覆盖：合法结构 / 坏 magic / 过短 / 骨骼缺失 / 核心骨缺失 /
 * 三角形超限 / PBR 越界 / 贴图引用越界 / 索引与非索引三角形计数。
 *
 * 注意：校验器只读 accessor.count 与 JSON 结构，不真正解码顶点数据，
 * 因此 BIN chunk 可以只放占位字节。
 */
import { describe, expect, it } from 'vitest'
import { validateGlb, missingCoreBoneGroups, type GlbValidationReport } from './glb-validator.js'

/** 把 glTF JSON + 占位 BIN 字节打包成合法 GLB 容器。 */
function buildGlb(json: Record<string, unknown>, binBytes = new Uint8Array(64)): Uint8Array {
  const encoder = new TextEncoder()
  let jsonText = JSON.stringify(json)
  // JSON chunk 对齐到 4 字节，尾部补 0x20 空格
  while (jsonText.length % 4 !== 0) jsonText += ' '
  const jsonData = encoder.encode(jsonText)
  // BIN chunk 对齐到 4 字节，尾部补 0x00
  const binPadded = new Uint8Array(Math.ceil(binBytes.byteLength / 4) * 4)
  binPadded.set(binBytes)

  const totalLength = 12 + 8 + jsonData.byteLength + 8 + binPadded.byteLength
  const out = new Uint8Array(totalLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true) // magic glTF
  view.setUint32(4, 2, true) // version
  view.setUint32(8, totalLength, true)
  let off = 12
  view.setUint32(off, jsonData.byteLength, true); view.setUint32(off + 4, 0x4e4f534a, true); off += 8
  out.set(jsonData, off); off += jsonData.byteLength
  view.setUint32(off, binPadded.byteLength, true); view.setUint32(off + 4, 0x004e4942, true); off += 8
  out.set(binPadded, off)
  return out
}

/** 一个最小合法的单 mesh（6 顶点非索引 → 2 三角形）glTF JSON。 */
function minimalGlTfJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'root' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ count: 6, type: 'VEC3' }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    ...overrides,
  }
}

function codes(r: GlbValidationReport): string[] {
  return r.issues.map((i) => i.code)
}
function errors(r: GlbValidationReport): GlbValidationReport['issues'] {
  return r.issues.filter((i) => i.severity === 'error')
}

describe('glb-validator：容器结构', () => {
  it('最小合法 GLB：valid=true，三角形数=2', () => {
    const glb = buildGlb(minimalGlTfJson())
    const r = validateGlb(glb)
    expect(r.valid).toBe(true)
    expect(r.glbVersion).toBe(2)
    expect(r.triangleCount).toBe(2)
    expect(r.primitiveCount).toBe(1)
    expect(codes(r)).toContain('NO_SKELETON') // 静态网格，仅 warning
  })

  it('空文件：FILE_TOO_SMALL 错误', () => {
    const r = validateGlb(new Uint8Array(4))
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('FILE_TOO_SMALL')
  })

  it('坏 magic：BAD_MAGIC 错误', () => {
    const bad = new Uint8Array(12)
    new DataView(bad.buffer).setUint32(0, 0xdeadbeef, true)
    const r = validateGlb(bad)
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('BAD_MAGIC')
  })

  it('声明长度与实际不符：warning 但不影响 valid', () => {
    const glb = buildGlb(minimalGlTfJson())
    // 篡改 totalLength 字段
    const view = new DataView(glb.buffer, glb.byteOffset)
    view.setUint32(8, glb.byteLength + 999, true)
    const r = validateGlb(glb)
    expect(codes(r)).toContain('LENGTH_MISMATCH')
  })
})

describe('glb-validator：三角形计数与阈值', () => {
  it('索引化 primitive：triangleCount = indices.count/3', () => {
    const json = minimalGlTfJson({
      accessors: [
        { count: 8, type: 'VEC3' }, // POSITION
        { count: 36, type: 'SCALAR' }, // indices → 12 三角形
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    })
    const r = validateGlb(buildGlb(json))
    expect(r.triangleCount).toBe(12)
    expect(r.valid).toBe(true)
  })

  it('超过 maxTriangles：TOO_MANY_TRIANGLES 错误', () => {
    const json = minimalGlTfJson({
      accessors: [{ count: 300_003, type: 'VEC3' }], // 100001 三角形
    })
    const r = validateGlb(buildGlb(json), { maxTriangles: 100_000 })
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('TOO_MANY_TRIANGLES')
  })

  it('无任何 primitive：NO_GEOMETRY 错误', () => {
    const json = minimalGlTfJson({ meshes: [{ primitives: [] }] })
    const r = validateGlb(buildGlb(json))
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('NO_GEOMETRY')
  })
})

describe('glb-validator：骨骼层级', () => {
  const rigged = (jointNames: string[]) =>
    minimalGlTfJson({
      nodes: [
        { mesh: 0, name: 'root' },
        ...jointNames.map((name) => ({ name })),
      ],
      skins: [{ joints: jointNames.map((_, i) => i + 1) }],
    })

  it('含 Hips/Spine/Head：通过，无 MISSING_CORE_BONES', () => {
    const r = validateGlb(buildGlb(rigged(['Hips', 'Spine', 'Head'])))
    expect(r.hasSkeleton).toBe(true)
    expect(r.missingCoreBones).toEqual([])
    expect(r.valid).toBe(true)
    expect(r.boneNames).toEqual(expect.arrayContaining(['Hips', 'Spine', 'Head']))
  })

  it('VRM 小写命名（hips/spine/head）同样命中', () => {
    const r = validateGlb(buildGlb(rigged(['hips', 'spine', 'head'])))
    expect(r.missingCoreBones).toEqual([])
  })

  it('只有手臂骨：MISSING_CORE_BONES 错误', () => {
    const r = validateGlb(buildGlb(rigged(['LeftArm', 'RightArm', 'LeftHand'])))
    expect(r.valid).toBe(false)
    expect(r.missingCoreBones).toEqual(expect.arrayContaining(['Hips', 'Spine', 'Head']))
    expect(codes(r)).toContain('MISSING_CORE_BONES')
  })

  it('missingCoreBoneGroups 纯函数：别名匹配', () => {
    expect(missingCoreBoneGroups(['Hips', 'Spine1', 'Neck', 'Head'])).toEqual([])
    expect(missingCoreBoneGroups(['pelvis', 'chest', 'head'])).toEqual([])
    expect(missingCoreBoneGroups([])).toEqual(['Hips', 'Spine', 'Head'])
  })
})

describe('glb-validator：材质 / PBR', () => {
  it('baseColorFactor 超界：BASECOLOR_OUT_OF_RANGE 错误', () => {
    const json = minimalGlTfJson({
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [2, 0, 0, 1] } }],
    })
    const r = validateGlb(buildGlb(json))
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('BASECOLOR_OUT_OF_RANGE')
  })

  it('roughnessFactor 超界：ROUGHNESS_OUT_OF_RANGE 错误', () => {
    const json = minimalGlTfJson({
      materials: [{ pbrMetallicRoughness: { roughnessFactor: 1.5 } }],
    })
    const r = validateGlb(buildGlb(json))
    expect(codes(r)).toContain('ROUGHNESS_OUT_OF_RANGE')
    expect(r.valid).toBe(false)
  })

  it('非 PBR 材质：仅 warning', () => {
    const json = minimalGlTfJson({ materials: [{ name: 'unlit' }] })
    const r = validateGlb(buildGlb(json))
    expect(codes(r)).toContain('NON_PBR_MATERIAL')
    expect(r.valid).toBe(true)
  })
})

describe('glb-validator：贴图引用', () => {
  it('texture.source 越界：TEXTURE_MISSING_IMAGE 错误', () => {
    const json = minimalGlTfJson({
      textures: [{ source: 99 }],
      images: [],
    })
    const r = validateGlb(buildGlb(json))
    expect(r.valid).toBe(false)
    expect(codes(r)).toContain('TEXTURE_MISSING_IMAGE')
  })

  it('image 既无 bufferView 也无 uri：IMAGE_NO_SOURCE 错误', () => {
    const json = minimalGlTfJson({
      textures: [{ source: 0 }],
      images: [{}],
    })
    const r = validateGlb(buildGlb(json))
    expect(codes(r)).toContain('IMAGE_NO_SOURCE')
  })

  it('image.bufferView 指向合法 bufferView：通过', () => {
    const json = minimalGlTfJson({
      textures: [{ source: 0 }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
      bufferViews: [{ buffer: 0, byteLength: 16, byteOffset: 0 }],
      buffers: [{ byteLength: 64 }],
    })
    const r = validateGlb(buildGlb(json))
    expect(errors(r).map((e) => e.code)).not.toContain('TEXTURE_MISSING_IMAGE')
    expect(r.valid).toBe(true)
  })
})

describe('glb-validator：ArrayBuffer 入参', () => {
  it('接受 ArrayBuffer 并正确解析', () => {
    const glb = buildGlb(minimalGlTfJson())
    const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer
    const r = validateGlb(buf)
    expect(r.valid).toBe(true)
    expect(r.triangleCount).toBe(2)
  })
})
