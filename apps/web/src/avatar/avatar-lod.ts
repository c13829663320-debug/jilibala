// ===== Round4 R4-03：化身 LOD 距离裁剪 =====
// 纯逻辑层，不依赖 three.js / DOM，可在 Node 环境直接单测。
//
// 按本地玩家与远端化身的水平距离（XZ 平面米数）分四级：
//   high     < 15m   完整模型 + 骨骼/程序化动画 + 表情 + 口型
//   medium   15~40m  简化几何体（面数约减 50%）+ 无表情/口型
//   billboard 40~80m 公告板精灵（名字 + 代表色），不再渲染 3D 身体
//   hidden   >= 80m  完全隐藏（不绘制）
//
// 注意：LOD 只切换"渲染层级/可见性"，不卸载原始模型数据，
// 拉近时可直接切回 high，避免重新加载 GLB。

/** LOD 分级 */
export type LodTier = 'high' | 'medium' | 'billboard' | 'hidden'

/** 距离阈值（米）。high < NEAR <= medium < MID <= billboard < FAR <= hidden */
export const LOD_NEAR = 15
export const LOD_MID = 40
export const LOD_FAR = 80

/** 二维点（XZ 平面） */
export interface Vec2 {
  x: number
  z: number
}

/** 计算两点水平距离（米）。非法输入钳到 0。 */
export function distance2d(a: Vec2, b: Vec2): number {
  const dx = (a.x ?? 0) - (b.x ?? 0)
  const dz = (a.z ?? 0) - (b.z ?? 0)
  const d = Math.hypot(dx, dz)
  return Number.isFinite(d) ? d : 0
}

/**
 * 按距离计算 LOD 分级。
 * 边界约定：
 *   d < 15            → high
 *   15 <= d < 40      → medium
 *   40 <= d < 80      → billboard
 *   d >= 80           → hidden
 */
export function computeLodTier(distance: number): LodTier {
  // NaN（未知距离）保守按最近 high；Infinity（无穷远）按极远 hidden。
  if (Number.isNaN(distance)) return 'high'
  if (!Number.isFinite(distance)) return 'hidden'
  const d = Math.max(0, distance)
  if (d < LOD_NEAR) return 'high'
  if (d < LOD_MID) return 'medium'
  if (d < LOD_FAR) return 'billboard'
  return 'hidden'
}

/**
 * LOD 渲染策略描述：由渲染层（RemoteAvatar）读取后决定画什么。
 * - fullModel: 是否渲染完整 3D 身体
 * - simplified: 是否使用简化几何体（面数约减 50%）
 * - skeletalAnim: 是否驱动骨骼/程序化姿势动画
 * - expressions: 是否渲染表情/口型
 * - billboard: 是否用公告板精灵（名字+色）替代身体
 * - visible: 是否在场景中出现（hidden=false 时完全不画）
 */
export interface LodProfile {
  tier: LodTier
  visible: boolean
  fullModel: boolean
  simplified: boolean
  skeletalAnim: boolean
  expressions: boolean
  billboard: boolean
  /** 几何体细分系数（1=原始，0.5=面数约减一半，0=不画几何体） */
  tessellation: number
}

/** 每个 tier 的渲染策略（常量表，避免每帧对象分配） */
const LOD_PROFILES: Record<LodTier, LodProfile> = {
  high: {
    tier: 'high',
    visible: true,
    fullModel: true,
    simplified: false,
    skeletalAnim: true,
    expressions: true,
    billboard: false,
    tessellation: 1.0,
  },
  medium: {
    tier: 'medium',
    visible: true,
    fullModel: true,
    simplified: true, // 面数减少 ~50%
    skeletalAnim: true,
    expressions: false, // 中距离无表情/口型
    billboard: false,
    tessellation: 0.5,
  },
  billboard: {
    tier: 'billboard',
    visible: true,
    fullModel: false,
    simplified: false,
    skeletalAnim: false,
    expressions: false,
    billboard: true,
    tessellation: 0,
  },
  hidden: {
    tier: 'hidden',
    visible: false,
    fullModel: false,
    simplified: false,
    skeletalAnim: false,
    expressions: false,
    billboard: false,
    tessellation: 0,
  },
}

/** 取某 tier 的完整渲染策略 */
export function lodProfile(tier: LodTier): LodProfile {
  return LOD_PROFILES[tier]
}

/** 组合：由本地玩家与远端玩家位置一步算出 LOD 策略 */
export function lodProfileForPositions(local: Vec2, remote: Vec2): LodProfile {
  return lodProfile(computeLodTier(distance2d(local, remote)))
}
