/**
 * 化身 LOD 距离裁剪纯逻辑（与 three.js 解耦，可在无 WebGL 环境单测）。
 *
 * 四级：
 *   LOD0 近   —— 高模 GLB、每帧动画、开阴影
 *   LOD1 中   —— 简化程序化体、每 2 帧动画、开阴影
 *   LOD2 远   —— 最简胶囊体、每 4 帧动画、关阴影
 *   Culled 极远 —— 超过 maxRenderDistance，完全跳过渲染
 *
 * 边界（相机水平距离，米）：
 *   d < nearDistance                     → LOD0
 *   nearDistance <= d < midDistance      → LOD1
 *   midDistance <= d < maxRenderDistance → LOD2
 *   d >= maxRenderDistance               → Culled
 */

export type LodLevel = 'LOD0' | 'LOD1' | 'LOD2' | 'Culled'

export interface LodConfig {
  /** 近边界：小于此距离为 LOD0。 */
  nearDistance: number
  /** 中边界：达到此距离降为 LOD1。 */
  midDistance: number
  /** 最远渲染距离：达到此距离完全剔除（Culled）。 */
  maxRenderDistance: number
}

export const DEFAULT_LOD_CONFIG: LodConfig = {
  nearDistance: 8,
  midDistance: 20,
  maxRenderDistance: 80,
}

export interface LodDecision {
  level: LodLevel
  /** 是否实际渲染（Culled 为 false）。 */
  visible: boolean
  /** 使用高模 GLB（LOD0 true，其余用程序化简化体）。 */
  useHighPoly: boolean
  /** 动画更新抽帧：每 N 帧更新一次姿势/口型（1=每帧）。 */
  animationEveryNFrames: number
  /** 是否投射阴影。 */
  castShadow: boolean
}

const TABLE: Record<Exclude<LodLevel, 'Culled'>, Omit<LodDecision, 'level' | 'visible'>> = {
  LOD0: { useHighPoly: true, animationEveryNFrames: 1, castShadow: true },
  LOD1: { useHighPoly: false, animationEveryNFrames: 2, castShadow: true },
  LOD2: { useHighPoly: false, animationEveryNFrames: 4, castShadow: false },
}

/** 两点（XZ 平面）水平距离。纯函数。 */
export function horizontalDistance(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return Math.sqrt(dx * dx + dz * dz)
}

/** 由相机距离决定 LOD 决策。distance 为非负数（负值按 0 处理）。 */
export function pickLod(distance: number, config: LodConfig = DEFAULT_LOD_CONFIG): LodDecision {
  const d = Math.max(0, distance)
  if (d >= config.maxRenderDistance) {
    return { level: 'Culled', visible: false, useHighPoly: false, animationEveryNFrames: Infinity, castShadow: false }
  }
  const level: Exclude<LodLevel, 'Culled'> =
    d < config.nearDistance ? 'LOD0' : d < config.midDistance ? 'LOD1' : 'LOD2'
  return { level, visible: true, ...TABLE[level] }
}

/** 超过最大渲染距离 → 完全跳过渲染（distance cull）。 */
export function shouldCull(distance: number, config: LodConfig = DEFAULT_LOD_CONFIG): boolean {
  return distance >= config.maxRenderDistance
}

/**
 * 当前帧是否应更新动画（结合抽帧策略）。
 * frameCount 为自增帧号（任意整数域均可）。Culled 恒为 false。
 */
export function shouldUpdateAnimation(decision: LodDecision, frameCount: number): boolean {
  if (!decision.visible || decision.level === 'Culled') return false
  if (!Number.isFinite(decision.animationEveryNFrames)) return false
  return frameCount % decision.animationEveryNFrames === 0
}
