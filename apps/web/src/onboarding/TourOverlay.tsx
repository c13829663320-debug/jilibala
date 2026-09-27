import type { CSSProperties } from 'react'

export type TourRect = { x: number; y: number; width: number; height: number }

export type TourOverlayProps = {
  title: string
  body: string
  /** 当前步（0-based）；不传则不显示步骤指示。 */
  step?: number
  total?: number
  canPrev?: boolean
  onPrev?: () => void
  onNext: () => void
  onSkip: () => void
  /** 下一步按钮文案（末步可为「完成」）。 */
  nextLabel?: string
  /**
   * 目标元素屏幕矩形：给出时在其上渲染一圈高亮 ring。
   * 不传则气泡居中。3D 场景内的 DOM 高亮需真机测量后传入。
   */
  anchorRect?: TourRect
  /** 气泡位置。 */
  position?: 'center' | 'bottom'
}

/**
 * TourOverlay：纯 CSS 引导浮层（不依赖第三方 tour 库）。
 * - 半透明遮罩（pointer-events:none，不挡住底层操作）；
 * - 可选高亮目标 ring（由 anchorRect 定位）；
 * - 气泡卡片带 上一步 / 下一步 / 跳过。
 */
export default function TourOverlay({
  title, body, step, total, canPrev, onPrev, onNext, onSkip,
  nextLabel = '下一步', anchorRect, position = 'center',
}: TourOverlayProps) {
  const ringStyle: CSSProperties | undefined = anchorRect
    ? {
        position: 'fixed',
        left: anchorRect.x,
        top: anchorRect.y,
        width: anchorRect.width,
        height: anchorRect.height,
        boxShadow: '0 0 0 9999px rgba(0,0,0,.55)',
        borderRadius: 'var(--r-sm)',
        zIndex: 95001,
        pointerEvents: 'none',
      }
    : undefined

  return (
    <>
      {!anchorRect && <div className="r5tour__backdrop" aria-hidden="true" />}
      {anchorRect && <div style={ringStyle} aria-hidden="true" />}

      <div
        className={`r5tour__bubble ${position === 'bottom' ? 'is-bottom' : ''}`}
        role="dialog"
        aria-label={title}
      >
        <div className="r5tour__head">
          <b>{title}</b>
          {typeof step === 'number' && typeof total === 'number' && (
            <span className="r5tour__stepno">{Math.min(step + 1, total)} / {total}</span>
          )}
        </div>
        <p className="r5tour__body">{body}</p>
        <div className="r5tour__actions">
          <button type="button" className="r5tour__ghost" onClick={onSkip}>跳过</button>
          <div className="r5tour__spacer" />
          {canPrev && (
            <button type="button" className="r5tour__ghost" onClick={onPrev}>上一步</button>
          )}
          <button type="button" className="r5tour__primary" onClick={onNext}>{nextLabel}</button>
        </div>
      </div>
    </>
  )
}
