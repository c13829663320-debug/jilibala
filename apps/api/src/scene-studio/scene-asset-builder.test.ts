/**
 * scene-asset-builder 单测（Vitest）：
 *  - 资产库非空、字段完整
 *  - resolveLibraryAsset 命中 / 未命中 / 模糊匹配
 *  - computeSceneScale / computeSceneTranslation 纯函数
 *  - normalizeSceneModel 端到端：程序化构造盒状 GLB，验证最大边归一化、落地、居中
 *  - buildSceneStructureAsset 库命中路径（不触网）
 */
import { describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import {
  getSceneAssetLibrary,
  resolveLibraryAsset,
  buildSceneStructureAsset,
  normalizeSceneModel,
  computeSceneScale,
  computeSceneTranslation,
  type SceneBBox,
} from './scene-asset-builder.js'

/** 程序化构造一个轴对齐盒状 GLB（width×height×depth，底边 centerY-height/2）。 */
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

/** 读取 GLB，计算世界 bbox。 */
async function readWorldBBox(glb: Uint8Array): Promise<SceneBBox> {
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

describe('getSceneAssetLibrary', () => {
  it('返回非空数组，且每项字段完整', () => {
    const lib = getSceneAssetLibrary()
    expect(lib.length).toBeGreaterThanOrEqual(8)
    for (const item of lib) {
      expect(typeof item.kind).toBe('string')
      expect(item.kind.length).toBeGreaterThan(0)
      expect(typeof item.label).toBe('string')
      expect(item.label.length).toBeGreaterThan(0)
      expect(typeof item.path).toBe('string')
      expect(item.path.endsWith('.glb')).toBe(true)
      // path 相对 /models/，不应以 / 开头
      expect(item.path.startsWith('/')).toBe(false)
      expect(item.defaultScale).toHaveLength(3)
      expect(item.defaultScale.every((n) => typeof n === 'number' && n > 0)).toBe(true)
      expect(typeof item.landmark).toBe('boolean')
    }
  })

  it('覆盖建筑类映射：bar/court/gym/library/talkshow/werewolf', () => {
    const lib = getSceneAssetLibrary()
    const paths = lib.map((i) => i.path)
    expect(paths).toContain('buildings/bar.glb')
    expect(paths).toContain('buildings/court.glb')
    expect(paths).toContain('buildings/gym.glb')
    expect(paths).toContain('buildings/library.glb')
    expect(paths).toContain('buildings/talkshow.glb')
    expect(paths).toContain('buildings/werewolf.glb')
  })

  it('返回防御性拷贝：修改返回值不影响内部', () => {
    const lib = getSceneAssetLibrary()
    lib[0].kind = 'hacked'
    lib[0].defaultScale[0] = 999
    const again = getSceneAssetLibrary()
    expect(again[0].kind).not.toBe('hacked')
    expect(again[0].defaultScale[0]).not.toBe(999)
  })
})

describe('resolveLibraryAsset', () => {
  it('精确命中', () => {
    expect(resolveLibraryAsset('tavern')?.path).toBe('buildings/bar.glb')
    expect(resolveLibraryAsset('gym')?.path).toBe('buildings/gym.glb')
    expect(resolveLibraryAsset('lodge')?.path).toBe('buildings/werewolf.glb')
  })

  it('别名命中：bar/theater/stage/house', () => {
    expect(resolveLibraryAsset('bar')?.path).toBe('buildings/bar.glb')
    expect(resolveLibraryAsset('theater')?.path).toBe('buildings/talkshow.glb')
    expect(resolveLibraryAsset('stage')?.path).toBe('buildings/talkshow.glb')
    expect(resolveLibraryAsset('house')?.path).toBe('buildings/court.glb')
  })

  it('模糊命中：大小写/下划线/包含', () => {
    expect(resolveLibraryAsset('Tavern')?.kind).toBe('tavern')
    expect(resolveLibraryAsset('old_tavern')?.path).toBe('buildings/bar.glb')
    expect(resolveLibraryAsset('home-library')?.path).toBe('buildings/library.glb')
  })

  it('未命中返回 null（tree/rock/bridge/well/tower/statue/fountain 等无 GLB）', () => {
    expect(resolveLibraryAsset('tree')).toBeNull()
    expect(resolveLibraryAsset('rock')).toBeNull()
    expect(resolveLibraryAsset('bridge')).toBeNull()
    expect(resolveLibraryAsset('well')).toBeNull()
    expect(resolveLibraryAsset('tower')).toBeNull()
    expect(resolveLibraryAsset('statue')).toBeNull()
    expect(resolveLibraryAsset('fountain')).toBeNull()
    expect(resolveLibraryAsset('')).toBeNull()
    expect(resolveLibraryAsset('   ')).toBeNull()
  })
})

describe('computeSceneScale / computeSceneTranslation 纯函数', () => {
  const box: SceneBBox = { minX: -1, minY: 0, minZ: -2, maxX: 1, maxY: 3, maxZ: 2 }
  // W=2, H=3, D=4 -> max=4 -> k=3/4=0.75

  it('按最大边缩放', () => {
    expect(computeSceneScale(box, 3)).toBeCloseTo(0.75)
  })

  it('更小目标尺寸时按比例放大', () => {
    expect(computeSceneScale(box, 1.5)).toBeCloseTo(0.375)
  })

  it('空/零尺寸保护返回 1', () => {
    const empty: SceneBBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    expect(computeSceneScale(empty, 3)).toBe(1)
  })

  it('translation：y 落地、x/z 居中', () => {
    const k = computeSceneScale(box, 3)
    const [tx, ty, tz] = computeSceneTranslation(box, k)
    // y = -k * minY = -0.75*0 = 0
    expect(ty).toBeCloseTo(0)
    // x center = -k*(minX+maxX)/2 = -0.75*(0)/2 = 0
    expect(tx).toBeCloseTo(0)
    expect(tz).toBeCloseTo(0)
  })

  it('translation：偏移模型正确落地居中', () => {
    // 盒子 minY=2 (悬空), x 从 1..3
    const off: SceneBBox = { minX: 1, minY: 2, minZ: 0, maxX: 3, maxY: 4, maxZ: 1 }
    const k = 1 // 不缩放
    const [tx, ty, tz] = computeSceneTranslation(off, k)
    // 落地：minY+ty = 0 -> ty = -2
    expect(off.minY + ty).toBeCloseTo(0)
    // x 居中：(minX+tx + maxX+tx)/2 = 0 -> tx = -(1+3)/2 = -2
    expect((off.minX + tx + off.maxX + tx) / 2).toBeCloseTo(0)
  })
})

describe('normalizeSceneModel（端到端 GLB）', () => {
  it('宽扁盒：最大边(W)归一到 3 米，落地、居中', async () => {
    // 6 x 2 x 4 盒子，最大边=6 -> k=0.5 -> 归一后 3 x 1 x 2
    const glb = await buildBoxGLB(6, 2, 4)
    const { glb: out, scale } = await normalizeSceneModel(glb, 3)
    expect(scale).toBeCloseTo(0.5)

    const bbox = await readWorldBBox(out)
    const W = bbox.maxX - bbox.minX
    const H = bbox.maxY - bbox.minY
    const D = bbox.maxZ - bbox.minZ
    expect(Math.max(W, H, D)).toBeCloseTo(3, 2)
    expect(W).toBeCloseTo(3, 2)
    expect(H).toBeCloseTo(1, 2)
    expect(D).toBeCloseTo(2, 2)
    // 落地
    expect(bbox.minY).toBeCloseTo(0, 2)
    // 居中
    expect((bbox.minX + bbox.maxX) / 2).toBeCloseTo(0, 2)
    expect((bbox.minZ + bbox.maxZ) / 2).toBeCloseTo(0, 2)
  })

  it('高瘦盒：最大边(H)归一到 3 米', async () => {
    // 1 x 9 x 1 -> 最大边=9 -> k=1/3 -> 归一后 ~0.33 x 3 x 0.33
    const glb = await buildBoxGLB(1, 9, 1)
    const { glb: out, scale } = await normalizeSceneModel(glb, 3)
    expect(scale).toBeCloseTo(1 / 3)
    const bbox = await readWorldBBox(out)
    expect(bbox.maxY - bbox.minY).toBeCloseTo(3, 2)
    expect(bbox.minY).toBeCloseTo(0, 2)
  })

  it('默认 targetMaxDim=3', async () => {
    const glb = await buildBoxGLB(5, 5, 5)
    const { glb: out } = await normalizeSceneModel(glb)
    const bbox = await readWorldBBox(out)
    expect(Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, bbox.maxZ - bbox.minZ)).toBeCloseTo(3, 2)
  })

  it('空几何抛错', async () => {
    // 无 POSITION 的空 doc
    const doc = new Document()
    doc.createScene()
    const io = new NodeIO()
    io.registerExtensions(ALL_EXTENSIONS)
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    const emptyGlb = await io.writeBinary(doc)
    await expect(normalizeSceneModel(emptyGlb, 3)).rejects.toThrow(/几何为空/)
  })
})

describe('buildSceneStructureAsset（库命中路径，不触网）', () => {
  it('命中库：返回 library 源、库路径、不归一化、空 taskId', async () => {
    const progress: string[] = []
    const result = await buildSceneStructureAsset({
      prompt: '一间酒馆',
      kind: 'tavern',
      sceneId: 'scene_test',
      onProgress: (m) => progress.push(m),
    })
    expect(result.source).toBe('library')
    expect(result.url).toBe('/models/buildings/bar.glb')
    expect(result.tripoTaskId).toBe('')
    expect(result.normalized).toBe(false)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('别名命中库：stage -> talkshow.glb', async () => {
    const result = await buildSceneStructureAsset({
      prompt: '舞台',
      kind: 'stage',
      sceneId: 'scene_test',
    })
    expect(result.source).toBe('library')
    expect(result.url).toBe('/models/buildings/talkshow.glb')
    expect(result.normalized).toBe(false)
  })
})
