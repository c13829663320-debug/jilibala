/**
 * UGC 兼容层单测（纯逻辑，无 WebGL）：
 *  - 样例 ugc-sample-scene.json 能被正确加载并通过校验
 *  - ugc_ 前缀材质被规范化为 roughness 0.85 / metalness 0.05
 *  - 统一光照 / 雾效与 art-spec 一致
 *  - 样例碰撞体（建筑 AABB + 喷泉 circle）能正确阻挡玩家
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  UGC_MATERIAL_METALNESS,
  UGC_MATERIAL_ROUGHNESS,
  UGC_UNIFIED_FOG,
  UGC_UNIFIED_LIGHT,
  isUgcMaterial,
  resolveUgcColliders,
  ugcMaterialParams,
  validateUgcSampleScene,
  type UgcBlueprint,
} from './ugc-compat'
import { collidesAt } from '../world/collision'
import { FOG, MATERIAL, PLAZA_LIGHTING } from '../world/art-spec'

// 读取 public/models/ugc-sample-scene.json（test 文件在 src/scene-studio/，上两级到 apps/web）
const samplePath = fileURLToPath(
  new URL('../../public/models/ugc-sample-scene.json', import.meta.url),
)

function loadSample(): UgcBlueprint {
  return JSON.parse(readFileSync(samplePath, 'utf8')) as UgcBlueprint
}

describe('UGC 材质规范化', () => {
  it('ugc_ 前缀被识别', () => {
    expect(isUgcMaterial('ugc_wall')).toBe(true)
    expect(isUgcMaterial('ugc_floor_01')).toBe(true)
    expect(isUgcMaterial('Mesh.001')).toBe(false)
    expect(isUgcMaterial(undefined)).toBe(false)
  })
  it('ugc 材质 → roughness 0.85 / metalness 0.05', () => {
    const p = ugcMaterialParams('ugc_plaza_ground')
    expect(p).not.toBeNull()
    expect(p!.roughness).toBe(MATERIAL.defaultRoughness)
    expect(p!.metalness).toBe(MATERIAL.defaultMetalness)
    expect(UGC_MATERIAL_ROUGHNESS).toBe(0.85)
    expect(UGC_MATERIAL_METALNESS).toBe(0.05)
  })
  it('非 ugc 材质不改动（返回 null）', () => {
    expect(ugcMaterialParams('Concrete')).toBeNull()
  })
})

describe('统一光照 / 雾效与 art-spec 对齐', () => {
  it('光照常量来自 PLAZA_LIGHTING', () => {
    expect(UGC_UNIFIED_LIGHT.ambientIntensity).toBe(PLAZA_LIGHTING.ambientIntensity)
    expect(UGC_UNIFIED_LIGHT.directionalIntensity).toBe(PLAZA_LIGHTING.directionalIntensity)
    expect(UGC_UNIFIED_LIGHT.shadowMapSize).toBe(PLAZA_LIGHTING.shadowMapSize)
  })
  it('雾效常量来自 FOG 规范', () => {
    expect(UGC_UNIFIED_FOG.color).toBe(FOG.color)
    expect(UGC_UNIFIED_FOG.near).toBe(FOG.plazaNear)
    expect(UGC_UNIFIED_FOG.far).toBe(FOG.plazaFar)
  })
})

describe('最小兼容样例 ugc-sample-scene.json', () => {
  const sample = loadSample()

  it('能被 JSON 解析且结构完整', () => {
    expect(sample.terrain).toBeTruthy()
    expect(sample.structures.length).toBeGreaterThan(0)
    expect(sample.collectibleSlots!.length).toBeGreaterThan(0)
    expect(sample.colliders!.length).toBeGreaterThan(0)
  })

  it('validateUgcSampleScene 校验通过', () => {
    const v = validateUgcSampleScene(sample)
    expect(v.valid, v.errors.join('; ')).toBe(true)
  })

  it('缺少建筑 / 收集槽 / 碰撞体时校验失败', () => {
    expect(validateUgcSampleScene({ ...sample, structures: [] }).valid).toBe(false)
    expect(validateUgcSampleScene({ ...sample, collectibleSlots: [] }).valid).toBe(false)
    expect(validateUgcSampleScene({ ...sample, colliders: [] }).valid).toBe(false)
  })

  it('建筑 AABB 碰撞体生效：玩家不能走进建筑', () => {
    const colliders = resolveUgcColliders(sample)
    // 建筑在 z=-12，AABB 覆盖 x[-3,3] z[-15,-9]
    expect(collidesAt(0, -12, 0.5, colliders)).toBe(true)   // 在建筑里
    expect(collidesAt(0, 8, 0.5, colliders)).toBe(false)    // 在出生点空地
  })

  it('样例圆碰撞体（装饰柱）生效', () => {
    const colliders = resolveUgcColliders(sample)
    // circle 在 (6,4) r=1.2
    expect(collidesAt(6, 4, 0.5, colliders)).toBe(true)
    expect(collidesAt(0, 8, 0.5, colliders)).toBe(false)
  })

  it('收集品槽位坐标为数值', () => {
    const slot = sample.collectibleSlots![0]
    expect([slot.x, slot.y, slot.z].every(Number.isFinite)).toBe(true)
  })
})
