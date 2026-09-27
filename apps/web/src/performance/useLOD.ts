// ===== R5: LOD Hook（三档 full/medium/low）=====
//
// 对已有 avatar-lod.ts 的三档语义封装（近距离 full / 中距离 medium / 远距离 low）。
// low 档用占位几何体（胶囊/公告板），不再驱动骨骼/口型。
//
// 纯映射在 lodLevelForDistance，hook 仅方便 React 组件调用。
// 实际视觉切换需真机 WebGL 确认。

import { useMemo } from 'react'
import type { LODLevel } from '@balabala/shared'

/** 距离阈值（米）。 */
export const LOD_FULL_DISTANCE = 15
export const LOD_MEDIUM_DISTANCE = 40

/**
 * 按距离计算三档 LOD：
 *   d < 15        → full
 *   15 <= d < 40  → medium
 *   d >= 40       → low（占位几何体/公告板）
 */
export function lodLevelForDistance(distance: number): LODLevel {
  if (Number.isNaN(distance)) return 'full'
  if (!Number.isFinite(distance)) return 'low'
  const d = Math.max(0, distance)
  if (d < LOD_FULL_DISTANCE) return 'full'
  if (d < LOD_MEDIUM_DISTANCE) return 'medium'
  return 'low'
}

/** 两点水平距离（米）。 */
export function horizontalDistance(ax: number, az: number, bx: number, bz: number): number {
  const d = Math.hypot(ax - bx, az - bz)
  return Number.isFinite(d) ? d : 0
}

/** React hook：传入本地与远端坐标，返回当前应使用的 LOD 档位。 */
export function useLODLevel(local: { x: number; z: number }, remote: { x: number; z: number }): LODLevel {
  return useMemo(
    () => lodLevelForDistance(horizontalDistance(local.x, local.z, remote.x, remote.z)),
    [local.x, local.z, remote.x, remote.z],
  )
}
