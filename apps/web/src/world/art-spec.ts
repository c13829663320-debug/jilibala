/**
 * 开放世界 · 统一美术规范
 * ------------------------------------------------------------------
 * 所有场景（广场 / 六座建筑室内 / UGC 场景）必须引用本模块的配色、光照、
 * 雾效、天空盒参数，保证视觉统一。低耗材质优先：meshStandardMaterial
 * 配合 baked 风格的低分辨率贴图，避免实时阴影计算开销。
 *
 * 设计基调：「霓虹夜市」——深色基底 + 暖黄品牌色点缀 + 各建筑主题色。
 */

// ---------- 品牌与主题色 ----------
export const BRAND = {
  /** 叽里呱啦品牌黄 */
  yellow: '#FFD600',
  /** 深底色（背景 / 地面） */
  bgDark: '#0a0a0a',
  /** 次级深色（墙体 / 远景） */
  bgMid: '#14161a',
  /** 高亮面板色 */
  panel: '#1e2126',
  /** 道路 / 环道 */
  road: '#23262c',
  /** 文字 / 名牌 */
  text: '#f0ece0',
} as const

/** 六座建筑的主题色（与 world/config.ts 的 color 字段对齐，室内主色调） */
export const BUILDING_THEME: Record<string, { primary: string; secondary: string; accent: string }> = {
  court:    { primary: '#c9a227', secondary: '#8b2500', accent: '#f5e6c8' }, // 法庭：金 + 深木
  talkshow: { primary: '#e07a5f', secondary: '#2d1b2e', accent: '#ffb4a2' }, // 脱口秀：珊瑚 + 深紫
  werewolf: { primary: '#7d5ba6', secondary: '#1a1025', accent: '#c9b8e8' }, // 狼人杀：紫 + 暗夜
  bar:      { primary: '#a34a4a', secondary: '#1c1210', accent: '#e8a0a0' }, // 酒吧：酒红 + 暗棕
  gym:      { primary: '#4fb3a5', secondary: '#0f1f1d', accent: '#a8e6de' }, // 健身房：青 + 深墨
  library:  { primary: '#5b8db8', secondary: '#0e1820', accent: '#b8d4e8' }, // 图书馆：蓝 + 深夜
}

// ---------- 光照规范 ----------
/** 广场室外光照（烘焙风格：低强度环境光 + 主平行光，阴影贴图 1024 降低开销） */
export const PLAZA_LIGHTING = {
  ambientIntensity: 0.45,
  hemisphereSky: '#3a3f4a',
  hemisphereGround: '#0a0a0a',
  hemisphereIntensity: 0.45,
  directionalPosition: [40, 60, 30] as [number, number, number],
  directionalIntensity: 1.4,
  shadowMapSize: 1024, // 从 2048 降到 1024，省显存
  shadowCameraBounds: 80,
} as const

/** 室内通用光照参数（每座建筑可微调 intensity，但色温统一） */
export const INTERIOR_LIGHTING = {
  ambientIntensity: 0.35,
  hemisphereSky: '#4a4035',
  hemisphereGround: '#1a1612',
  hemisphereIntensity: 0.3,
  /** 主顶灯（暖白） */
  ceilingColor: '#fff4e0',
  ceilingIntensity: 0.8,
  /** 氛围灯（品牌黄） */
  accentColor: BRAND.yellow,
  accentIntensity: 0.5,
} as const

// ---------- 雾效规范 ----------
export const FOG = {
  color: BRAND.bgDark,
  /** 广场：近 40 远 180，让边界山自然融入 */
  plazaNear: 40,
  plazaFar: 180,
  /** 室内：近 8 远 40，小空间不需要远雾 */
  interiorNear: 8,
  interiorFar: 40,
} as const

// ---------- 天空盒规范 ----------
/**
 * 程序化渐变天空（不用 cube texture，零贴图开销）。
 * 顶部深蓝紫 → 地平线暖橙 → 底部深色，模拟黄昏/夜景。
 */
export const SKY_GRADIENT = {
  top: '#0d1117',
  mid: '#1a1f2e',
  horizon: '#2d2438',
  bottom: BRAND.bgDark,
} as const

// ---------- 材质规范 ----------
export const MATERIAL = {
  /** 地面 / 墙面默认 roughness，避免高光计算 */
  defaultRoughness: 0.85,
  defaultMetalness: 0.05,
  /** 发光材质（门 / 招牌 / 收集品） */
  emissiveIntensity: 0.3,
  /** 贴图最大尺寸（超过则在加载时降级） */
  maxTextureSize: 1024,
  /**  instancedMesh 实例数上限（防止 draw call 爆炸） */
  maxInstances: 200,
} as const

// ---------- 性能预算 ----------
export const PERF_BUDGET = {
  /** 广场目标 draw call ≤ 60（含 instanced 合并） */
  plazaMaxDrawCalls: 60,
  /** 单座建筑室内目标 draw call ≤ 30 */
  interiorMaxDrawCalls: 30,
  /** 单张贴图 ≤ 256KB（压缩后） */
  maxTextureBytes: 256 * 1024,
  /** 同屏光源 ≤ 4（每盏 pointLight 都有开销） */
  maxLights: 4,
  /** dpr 上限（高 DPI 屏幕限制到 1.5） */
  maxDpr: 1.5,
} as const
