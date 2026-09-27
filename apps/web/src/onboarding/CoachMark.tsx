/**
 * R5 分片B：CoachMark —— 情境化轻量高亮气泡
 *
 * 用途：首次进广场时指向推荐建筑、首次多人时指向「创建房间」按钮等。
 * - 半透明遮罩不拦截底层操作（pointer-events 只在气泡上）；
 * - target 支持 CSS 选择器（自动 getBoundingClientRect）或固定坐标；
 * - 提供「下一步 / 跳过」，看完/跳过由宿主调用 markFirstTime。
 */
import { useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { computeCoachPosition, type TargetRect } from './coachmark-geo'

export type CoachMarkTarget =
  | { kind: 'selector'; selector: string }
  | { kind: 'rect'; rect: TargetRect }
  | { kind: 'point'; x: number; y: number }

export type CoachMarkProps = {
  target: CoachMarkTarget
  title: string
  body: string
  nextLabel?: string
  skipLabel?: string
  /** 是否显示「跳过」。默认 true。 */
  showSkip?: boolean
  /** 点击下一步。 */
  onNext: () => void
  /** 点击跳过。 */
  onSkip: () => void
}

const BUBBLE_WIDTH = 300
const BUBBLE_HEIGHT_EST = 150

function resolveRect(target: CoachMarkTarget): TargetRect | null {
  if (target.kind === 'rect') return target.rect
  if (target.kind === 'point') {
    return { x: target.x - 20, y: target.y - 10, width: 40, height: 20 }
  }
  if (typeof document === 'undefined') return null
  const el = document.querySelector(target.selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

export default function CoachMark({
  target,
  title,
  body,
  nextLabel = '下一步',
  skipLabel = '跳过',
  showSkip = true,
  onNext,
  onSkip,
}: CoachMarkProps) {
  // 目标元素可能在挂载后才出现（异步渲染/tab 切换），监听一次重算。
  const [, tick] = useState(0)
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => tick((n) => n + 1))
    return () => cancelAnimationFrame(raf)
  }, [target])

  const rect = resolveRect(target)

  const position = useMemo(() => {
    if (typeof window === 'undefined') return null
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    if (!rect) {
      // 目标未找到：居中悬浮（无箭头）。
      return {
        left: Math.max(12, (viewport.width - BUBBLE_WIDTH) / 2),
        top: Math.max(12, (viewport.height - BUBBLE_HEIGHT_EST) / 2),
        arrowX: BUBBLE_WIDTH / 2,
        placement: 'bottom' as const,
      }
    }
    return computeCoachPosition(rect, viewport, BUBBLE_WIDTH, BUBBLE_HEIGHT_EST)
  }, [rect])

  if (!position) return null

  const style = {
    left: position.left,
    top: position.top,
    width: BUBBLE_WIDTH,
    '--arrow-x': `${position.arrowX}px`,
  } as CSSProperties

  return createPortal(
    <>
      <div className="ob-coach-backdrop" aria-hidden="true" />
      <div
        className="ob-coach-bubble"
        data-placement={position.placement}
        style={style}
        role="dialog"
        aria-label={title}
        data-testid="coachmark"
      >
        <h3 className="ob-coach-title">{title}</h3>
        <p className="ob-coach-body">{body}</p>
        <div className="ob-coach-actions">
          {showSkip && (
            <button type="button" className="skip" onClick={onSkip} data-testid="coachmark-skip">
              {skipLabel}
            </button>
          )}
          <button type="button" className="next" onClick={onNext} data-testid="coachmark-next">
            {nextLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
