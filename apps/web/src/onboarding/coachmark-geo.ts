/**
 * R5 分片B：CoachMark 定位几何（纯函数，可单测）
 *
 * 根据目标元素矩形与视口尺寸，计算气泡位置与箭头朝向，
 * 保证气泡不超出视口。组件层只负责把结果 style 应用上去。
 */

export interface TargetRect {
  /** 相对视口的目标元素矩形。 */
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export type CoachPlacement = 'top' | 'bottom'

export interface CoachPosition {
  /** 气泡左上角（fixed 定位）。 */
  left: number
  top: number
  /** 箭头中心相对气泡左边缘的偏移（px），用于 --arrow-x。 */
  arrowX: number
  placement: CoachPlacement
}

const GAP = 12 // 气泡与目标元素间距
const MIN_MARGIN = 12 // 气泡距视口边缘最小留白

/**
 * 计算气泡位置：优先放在目标下方；下方放不下则放上方；
 * 水平方向以目标中心对齐气泡，并夹在视口内。
 */
export function computeCoachPosition(
  target: TargetRect,
  viewport: ViewportSize,
  bubbleWidth: number,
  bubbleHeight: number,
): CoachPosition {
  const centerX = target.x + target.width / 2
  let left = centerX - bubbleWidth / 2
  left = Math.max(MIN_MARGIN, Math.min(left, viewport.width - bubbleWidth - MIN_MARGIN))

  // 箭头应指向目标中心；气泡被夹边后箭头要相应偏移。
  const arrowX = Math.max(16, Math.min(centerX - left, bubbleWidth - 16))

  const belowTop = target.y + target.height + GAP
  const belowFits = belowTop + bubbleHeight <= viewport.height - MIN_MARGIN
  const aboveTop = target.y - GAP - bubbleHeight
  const aboveFits = aboveTop >= MIN_MARGIN

  if (belowFits) {
    return { left, top: belowTop, arrowX, placement: 'bottom' }
  }
  if (aboveFits) {
    return { left, top: aboveTop, arrowX, placement: 'top' }
  }
  // 上下都放不下（极小屏）：居中悬浮，不画箭头。
  return {
    left: Math.max(MIN_MARGIN, (viewport.width - bubbleWidth) / 2),
    top: Math.max(MIN_MARGIN, (viewport.height - bubbleHeight) / 2),
    arrowX: bubbleWidth / 2,
    placement: 'bottom',
  }
}
