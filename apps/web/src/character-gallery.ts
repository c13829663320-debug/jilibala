// ===== M13 第五轮：3D 人物长廊纯逻辑（无 React / three 依赖，仅数值元组） =====
// 布局、吸附、领域色、问候语全部抽成纯函数，便于单测与 3D/平面两种视图共用。
import type { UiCharacter } from './custom-characters'

export type HallTab = 'all' | 'mine' | 'plaza'

/** 单个展台在长廊世界坐标中的位置。角色面向 +Z（相机在 +Z 一侧）。 */
export type BoothPosition = {
  /** 横向偏移（世界单位），长廊水平铺开。 */
  x: number
  /** 纵深：中间展台靠前，两端展台向后弯，形成轻微弧度 + 透视近大远小。 */
  z: number
  /** 角色面向相机的偏转角：两端角色略转向中央镜头。 */
  rotationY: number
}

/** 相邻展台横向间距（世界单位）。人物归一化高 1.7，间距 2.6 保证不挤。 */
export const BOOTH_SPACING = 2.6

/** 弧度曲率：两端展台向后退的距离 = ARC * d^2。 */
export const ARC_CURVE = 0.32

/**
 * 把 count 个角色沿横向等距、略带弧度地排成一列。
 * 以中点为世界原点（x=0 居中），相机默认正对中央角色。
 */
export function galleryLayout(count: number): BoothPosition[] {
  const n = Math.max(0, Math.floor(count))
  const center = (n - 1) / 2
  const out: BoothPosition[] = []
  for (let i = 0; i < n; i++) {
    const d = i - center
    const x = d * BOOTH_SPACING
    const z = -ARC_CURVE * d * d
    // 两端角色面向镜头一侧轻微偏转，避免完全侧对。
    const rotationY = Math.atan2(d * BOOTH_SPACING, 4.2) * 0.35
    out.push({ x, z, rotationY })
  }
  return out
}

/** 把索引夹在 [0, count-1]；count<=0 时返回 0。 */
export function clampGalleryIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.round(index)))
}

/**
 * 拖拽松手后吸附到最近人物。
 *
 * dragUnits：拖拽位移换算成「几个展台宽」。向右拖（手指向右滑）看到右侧人物，
 * 即 continuousIndex 减小——故 snapped = round(currentIndex - dragUnits)。
 * 越界时夹到首尾。
 */
export function snapToNearestIndex(currentIndex: number, dragUnits: number, count: number): number {
  const continuous = currentIndex - dragUnits
  return clampGalleryIndex(continuous, count)
}

/** 领域色点：与 2D 卡片渐变同色系，克制不喧宾夺主。 */
export const FIELD_COLORS: Record<string, string> = {
  科技: '#5b8cff',
  商业: '#ffb347',
  科学: '#3ddc97',
  文学: '#e06ab8',
  艺术: '#ff7a59',
  哲学: '#9b7bff',
}

/** 自定义人物的领域色（品牌明黄）。 */
export const CUSTOM_FIELD_COLOR = '#FFD60A'

/** 取角色的领域色点：自定义人物用品牌黄，预置名人按 field 查表，未知名给中性灰。 */
export function fieldColorFor(c: Pick<UiCharacter, 'isCustom' | 'field'>): string {
  if (c.isCustom) return CUSTOM_FIELD_COLOR
  return (c.field && FIELD_COLORS[c.field]) || '#8a8a8a'
}

/** 走近/点击时朗读的问候语。自定义人物缺省给一句友好兜底。 */
export function greetingFor(c: Pick<UiCharacter, 'isCustom' | 'greeting'>): string {
  const g = (c.greeting ?? '').trim()
  if (g) return g
  return c.isCustom ? '你好，很高兴见到你，想聊点什么？' : '你好，很高兴见到你。'
}

/**
 * 长廊可展示的角色集合（带模型的优先；无模型的在 3D 视图用占位人形兜底）。
 * 这里只做映射，不做过滤——过滤由 tab/搜索在调用处完成。
 */
export type GalleryEntry = {
  character: UiCharacter
  /** 世界坐标位置（由 galleryLayout 给出）。 */
  booth: BoothPosition
  /** 领域色点。 */
  color: string
  /** 问候语（已兜底）。 */
  greeting: string
}

/** 把角色列表映射成长廊条目（含展台位置与展示元数据）。 */
export function buildGalleryEntries(characters: UiCharacter[]): GalleryEntry[] {
  const layout = galleryLayout(characters.length)
  return characters.map((character, i) => ({
    character,
    booth: layout[i],
    color: fieldColorFor(character),
    greeting: greetingFor(character),
  }))
}
