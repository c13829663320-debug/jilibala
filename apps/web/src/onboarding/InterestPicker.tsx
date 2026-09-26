import type { InterestId } from './onboardingProgress'
import { INTERESTS } from './onboardingProgress'

export type InterestPickerProps = {
  /** 用户点了某个兴趣按钮。 */
  onPick: (interest: InterestId) => void
  /** 用户选择跳过兴趣选择，先去广场逛逛。 */
  onSkip: () => void
}

/**
 * 开屏后第一步：4 个大按钮选兴趣。
 * 每个兴趣直接推荐对应场景，不做任何额外表单。
 */
export default function InterestPicker({ onPick, onSkip }: InterestPickerProps) {
  return (
    <section className="ob-overlay" aria-label="选一个你想玩的">
      <div className="ob-kicker">WELCOME TO BALA BALA</div>
      <h1 className="ob-title">只想先玩点爽的？<em>选一个就够。</em></h1>
      <p className="ob-sub">4 个口味，点一下，马上开玩——不用建档案、不用逛广场。</p>

      <div className="ob-picker-grid" role="group" aria-label="兴趣选择">
        {INTERESTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ob-interest-btn"
            onClick={() => onPick(item.id)}
          >
            <span className="emoji" aria-hidden="true">{item.emoji}</span>
            <b>{item.label}</b>
            <small>{item.tagline}</small>
          </button>
        ))}
      </div>

      <button type="button" className="ob-skip" onClick={onSkip}>
        都不想选，先随便逛逛 →
      </button>
    </section>
  )
}
