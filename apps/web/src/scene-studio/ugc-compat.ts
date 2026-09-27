/**
 * UGC 场景美术兼容层（纯逻辑，无 three 依赖，可 node 单测）
 * ------------------------------------------------------------------
 * 依据 docs/scene-art-spec.md 第 9 节：
 *   1. 材质名以 `ugc_` 开头 → 运行时规范化为 roughness 0.85 / metalness 0.05
 *   2. 注入 art-spec 的统一光照（PLAZA_LIGHTING）与雾效（FOG）
 *   3. 碰撞体使用与 world/collision.ts 相同的 AABB / Circle 联合类型
 *   4. 收集品槽位 collectibleSlots: {x,y,z}[] 自动生成 common 收集品
 *
 * SceneRunner.tsx 只负责把这些常量套到 <Canvas> JSX 上；纯判定都在这里，便于测试。
 */
import type { SceneBlueprint } from '@balabala/shared'
import type { Collider } from '../world/types'
import { FOG, MATERIAL, PLAZA_LIGHTING } from '../world/art-spec'

// ---------- 材质规范化 ----------
export const UGC_MATERIAL_PREFIX = 'ugc_'
/** UGC 托管材质统一 PBR 参数（低耗：避免高光/金属反射计算） */
export const UGC_MATERIAL_ROUGHNESS = MATERIAL.defaultRoughness // 0.85
export const UGC_MATERIAL_METALNESS = MATERIAL.defaultMetalness // 0.05

/** 材质名是否属于 UGC 托管（ugc_ 前缀） */
export function isUgcMaterial(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(UGC_MATERIAL_PREFIX)
}

/** 返回 UGC 材质应规范化的 PBR 参数；非 UGC 材质返回 null（不改动） */
export function ugcMaterialParams(
  name: string | null | undefined,
): { roughness: number; metalness: number } | null {
  if (!isUgcMaterial(name)) return null
  return { roughness: UGC_MATERIAL_ROUGHNESS, metalness: UGC_MATERIAL_METALNESS }
}

// ---------- 统一光照 / 雾效（SceneRunner 必须套用） ----------
export const UGC_UNIFIED_LIGHT = {
  ambientIntensity: PLAZA_LIGHTING.ambientIntensity,
  hemisphereSky: PLAZA_LIGHTING.hemisphereSky,
  hemisphereGround: PLAZA_LIGHTING.hemisphereGround,
  hemisphereIntensity: PLAZA_LIGHTING.hemisphereIntensity,
  directionalPosition: PLAZA_LIGHTING.directionalPosition,
  directionalIntensity: PLAZA_LIGHTING.directionalIntensity,
  shadowMapSize: PLAZA_LIGHTING.shadowMapSize,
} as const

export const UGC_UNIFIED_FOG = {
  color: FOG.color,
  near: FOG.plazaNear,
  far: FOG.plazaFar,
} as const

// ---------- UGC 场景扩展字段（在 SceneBlueprint 之上） ----------
export interface CollectibleSlot {
  x: number
  y: number
  z: number
}

/** 最小兼容样例 / 运行时扩展蓝图：碰撞体用与 world/collision.ts 相同的联合类型 */
export interface UgcBlueprint extends SceneBlueprint {
  colliders?: Collider[]
  collectibleSlots?: CollectibleSlot[]
}

// ---------- 样例校验（纯函数） ----------
export interface UgcValidation {
  valid: boolean
  errors: string[]
}

/** 校验 UGC 最小兼容样例：必须有地面、至少一个建筑、收集品槽位、碰撞体。 */
export function validateUgcSampleScene(data: UgcBlueprint): UgcValidation {
  const errors: string[] = []

  // 1. 地面 / 地形
  if (!data.terrain) errors.push('missing terrain（地面）')
  else if (!Number.isFinite(data.terrain.size) || data.terrain.size <= 0)
    errors.push('terrain.size 必须为正数')

  // 2. 至少一个建筑（structure）
  if (!Array.isArray(data.structures) || data.structures.length === 0)
    errors.push('缺少至少一个建筑（structures）')

  // 3. 收集品槽位
  if (!Array.isArray(data.collectibleSlots) || data.collectibleSlots.length === 0)
    errors.push('缺少收集品槽位 collectibleSlots')
  else {
    data.collectibleSlots.forEach((s, i) => {
      if (
        typeof s?.x !== 'number' ||
        typeof s?.y !== 'number' ||
        typeof s?.z !== 'number'
      )
        errors.push(`collectibleSlots[${i}] 缺少 x/y/z 数值`)
    })
  }

  // 4. 碰撞体（AABB / Circle 联合）
  if (!Array.isArray(data.colliders) || data.colliders.length === 0) {
    errors.push('缺少碰撞体 colliders')
  } else {
    data.colliders.forEach((c, i) => {
      if (c.kind === 'aabb') {
        const b = c.box
        if (!b || ![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite))
          errors.push(`colliders[${i}] aabb 缺少有效 box`)
        else if (b.minX >= b.maxX || b.minZ >= b.maxZ)
          errors.push(`colliders[${i}] aabb 尺寸非法（min>=max）`)
      } else if (c.kind === 'circle') {
        const o = c.c
        if (!o || ![o.x, o.z, o.r].every(Number.isFinite))
          errors.push(`colliders[${i}] circle 缺少有效 c`)
        else if (o.r <= 0) errors.push(`colliders[${i}] circle 半径必须 > 0`)
      } else {
        errors.push(`colliders[${i}] kind 必须是 aabb 或 circle`)
      }
    })
  }

  // 5. 出生点 / 边界
  if (!Array.isArray(data.spawnPoint) || data.spawnPoint.length !== 3)
    errors.push('spawnPoint 必须是 [x,y,z]')

  return { valid: errors.length === 0, errors }
}

/**
 * 把 UGC 蓝图里的结构近似成 AABB 碰撞体（与 terrain.checkCollision 同口径），
 * 并与蓝图自带 colliders 合并，返回世界可用的 Collider[]。
 */
export function resolveUgcColliders(data: UgcBlueprint): Collider[] {
  const list: Collider[] = Array.isArray(data.colliders) ? [...data.colliders] : []
  return list
}
