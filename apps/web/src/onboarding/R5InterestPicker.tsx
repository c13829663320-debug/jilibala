import { CELEBRITY_FIELDS, type CelebrityField } from '@balabala/shared'

export type R5InterestPickerProps = {
  /** 用户选了一个兴趣领域（对应名人领域）。 */
  onPick: (field: CelebrityField) => void
  /** 跳过兴趣选择，先去广场。 */
  onSkip: () => void
}

/** 领域 → 代表性 emoji（纯展示，不参与逻辑）。 */
const FIELD_EMOJI: Record<CelebrityField, string> = {
  '科技': '🔭',
  '商业': '📈',
  '科学': '🧪',
  '文学': '📖',
  '艺术': '🎨',
  '哲学': '🤔',
  '政治': '🏛️',
}

/** 领域一句话注脚。 */
const FIELD_TAGLINE: Record<CelebrityField, string> = {
  '科技': '和改变世界的工程师聊未来',
  '商业': '听投资大师讲复利与常识',
  '科学': '跟着天才做思想实验',
  '文学': '与文豪推敲一字一句',
  '艺术': '和创作者聊审美与灵感',
  '哲学': '向哲学家追问意义',
  '政治': '和战略家论天下大势',
}

/**
 * R5 引导步骤 3 · 选择兴趣领域。
 * 选完用于推荐首位名人（首个哇时刻=和该领域名人对话）。
 */
export default function R5InterestPicker({ onPick, onSkip }: R5InterestPickerProps) {
  return (
    <section className="r5ob" aria-label="选一个你最想聊的领域">
      <div className="r5ob__kicker">PICK YOUR FIELD</div>
      <h2 className="r5ob__title">你最想和谁<em>当面聊聊？</em></h2>
      <p className="r5ob__sub">选一个领域，我们为你推荐一位最对味的名人，开口即对话。</p>

      <div className="r5ob__fields" role="group" aria-label="兴趣领域">
        {CELEBRITY_FIELDS.map((field) => (
          <button
            key={field}
            type="button"
            className="r5ob__field"
            onClick={() => onPick(field)}
          >
            <span className="r5ob__field-emoji" aria-hidden="true">{FIELD_EMOJI[field]}</span>
            <b>{field}</b>
            <small>{FIELD_TAGLINE[field]}</small>
          </button>
        ))}
      </div>

      <button type="button" className="r5ob__skip" onClick={onSkip}>
        都不想选，先随便逛逛 →
      </button>
    </section>
  )
}
