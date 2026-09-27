// ===== R5: 资产加载优先级（纯函数，无 DOM / three 依赖，可在 Node 单测）=====
//
// 排序规则：
//   1. 优先级权重：名人模型(celebrity) > 场景模型(scene) > 装饰(decoration)
//   2. 同优先级内：距本地相机/玩家越近越先加载
//
// 该模块只做「先加载谁」的决策，真正的 GLTFLoader 解码由 three.js 运行时完成。

import { ASSET_PRIORITY_WEIGHT, type AssetPriority } from '@balabala/shared'

/** 一个待加载资产的描述。 */
export interface AssetLoadRequest {
  /** 资源 URL，如 /models/celebrities/luyuxun.glb */
  url: string
  /** 资产类别（决定优先级权重） */
  priority: AssetPriority
  /** 资产在世界中的 X 坐标（用于距离排序）；未知按 0 */
  x?: number
  /** 资产在世界中的 Z 坐标；未知按 0 */
  z?: number
}

/** 相机/本地玩家位置。 */
export interface Point2 {
  x: number
  z: number
}

/** 两点水平距离（米）；非法输入钳到 0。 */
export function distance2d(a: Point2, b: Point2): number {
  const dx = (a.x ?? 0) - (b.x ?? 0)
  const dz = (a.z ?? 0) - (b.z ?? 0)
  const d = Math.hypot(dx, dz)
  return Number.isFinite(d) ? d : 0
}

/**
 * 把待加载资产列表排成加载顺序：
 * - 高优先级（权重更大）排前面；
 * - 权重相同，距离相机近的排前面；
 * - 距离相同，保持原数组顺序（稳定）。
 *
 * @param items  待加载资产
 * @param camera 本地相机/玩家位置；缺省视为 (0,0)
 */
export function sortAssetsByPriority(
  items: readonly AssetLoadRequest[],
  camera: Point2 = { x: 0, z: 0 },
): AssetLoadRequest[] {
  return items
    .map((item, index) => ({
      item,
      index,
      weight: ASSET_PRIORITY_WEIGHT[item.priority] ?? 0,
      dist: distance2d(camera, { x: item.x ?? 0, z: item.z ?? 0 }),
    }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight
      if (a.dist !== b.dist) return a.dist - b.dist
      return a.index - b.index
    })
    .map((r) => r.item)
}

/**
 * 从队列头部取「下一个应该加载」的 url：最多返回 maxCount 个，
 * 供并发加载器按预算分批拉取。
 */
export function nextBatch(
  items: readonly AssetLoadRequest[],
  camera: Point2,
  maxCount: number,
): AssetLoadRequest[] {
  const n = Math.max(0, Math.floor(maxCount))
  return sortAssetsByPriority(items, camera).slice(0, n)
}

/** 是否为高优先级（名人）资产。 */
export function isCelebrityAsset(item: AssetLoadRequest): boolean {
  return item.priority === 'celebrity'
}

/**
 * 给定一组候选 url 与「已加载/加载中」集合，挑出应在本轮空闲时预取的
 * 高优先级资产（最多 limit 个）。用于进入广场后的 idle 预取。
 */
export function pickIdlePrefetch(
  items: readonly AssetLoadRequest[],
  camera: Point2,
  loadedOrLoading: ReadonlySet<string>,
  limit = 3,
): AssetLoadRequest[] {
  return sortAssetsByPriority(items, camera)
    .filter((it) => !loadedOrLoading.has(it.url))
    .slice(0, Math.max(0, limit))
}
