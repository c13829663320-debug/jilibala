/**
 * R5 视觉品牌域 · 统一 3D 光照配置（纯数据 / 纯函数，不直接操作 three 场景）。
 *
 * 目的：六个场景 Shell / Plaza3D / WorldScene 过去各自写死光照参数，
 * 导致同一座建筑在广场和法庭里冷暖不一致。这里把光照收敛为一份配置，
 * 场景侧只负责"消费"这份数据（r3f 的 <ambientLight intensity={...} />）。
 *
 * 品牌对齐：
 *  - 底色保持近黑（#0a0a0a），不打亮成灰；
 *  - 主平行光带极淡明黄暖色（brand yellow 的高光端），作为品牌色点缀；
 *  - 半球光填充用青绿（brand teal）的暗部色，避免死黑。
 *
 * 云端无 WebGL：实际打光效果需真机确认，见交付清单"需真机确认项"。
 */

export interface UnifiedLightingConfig {
  /** 场景背景色（与 --bg 对齐） */
  background: string
  /** 雾 */
  fog: { color: string; near: number; far: number }
  /** 环境光 */
  ambient: { intensity: number }
  /** 半球光：天空色 / 地面色 / 强度 */
  hemisphere: { skyColor: string; groundColor: string; intensity: number }
  /** 主平行光（带阴影） */
  directional: {
    position: [number, number, number]
    intensity: number
    /** 品牌暖色点缀（key light 的 color） */
    color: string
    shadowMapSize: [number, number]
  }
}

/** 全局唯一光照配置。调整这里即同步所有场景。 */
export const UNIFIED_LIGHTING: UnifiedLightingConfig = {
  background: '#0a0a0a',
  fog: { color: '#0a0a0a', near: 40, far: 180 },
  ambient: { intensity: 0.5 },
  hemisphere: { skyColor: '#3a3f4a', groundColor: '#0a0a0a', intensity: 0.5 },
  directional: {
    position: [40, 60, 30],
    intensity: 1.6,
    // 极淡的明黄暖色 key，把品牌色带进 3D 而不破坏暗调
    color: '#FFE97A',
    shadowMapSize: [2048, 2048],
  },
}

/** 获取统一光照配置（函数形式便于未来按场景 mood 覆写/扩展）。 */
export function getUnifiedLighting(overrides?: Partial<UnifiedLightingConfig>): UnifiedLightingConfig {
  if (!overrides) return UNIFIED_LIGHTING
  return {
    ...UNIFIED_LIGHTING,
    ...overrides,
    fog: { ...UNIFIED_LIGHTING.fog, ...overrides.fog },
    ambient: { ...UNIFIED_LIGHTING.ambient, ...overrides.ambient },
    hemisphere: { ...UNIFIED_LIGHTING.hemisphere, ...overrides.hemisphere },
    directional: { ...UNIFIED_LIGHTING.directional, ...overrides.directional },
  }
}
