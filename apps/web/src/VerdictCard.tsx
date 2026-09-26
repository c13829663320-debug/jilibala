import { useState } from 'react'
import { ChevronDown, Gavel, RotateCcw, Share2, Send } from 'lucide-react'
import type { BenchSpeech, Verdict } from '@balabala/shared'

export interface VerdictCardProps {
  verdict: Verdict | null
  transcript: BenchSpeech[]
  onShare: () => void
  onPublish: () => void
  onAppeal: () => void
  shareStatus: string
}

/**
 * Gold-on-dark verdict card shown after the bench reaches a decision.
 * Collapsible full transcript + share / publish / appeal actions.
 */
export function VerdictCard({ verdict, transcript, onShare, onPublish, onAppeal, shareStatus }: VerdictCardProps) {
  const [expanded, setExpanded] = useState(false)

  if (!verdict) {
    return (
      <div className="verdict-card verdict-card--empty">
        <div className="verdict-card__icon"><Gavel size={20} /></div>
        <h3>等待判决…</h3>
        <p>合议庭正在合议中，判决结果即将公布。</p>
      </div>
    )
  }

  return (
    <div className="verdict-card">
      <div className="verdict-card__head">
        <div className="verdict-card__icon"><Gavel size={20} /></div>
        <div>
          <span className="micro-label">AI 判决书</span>
          <h3>{verdict.title}</h3>
        </div>
      </div>

      <div className="verdict-card__quote">“{verdict.quote}”</div>

      <div className="verdict-card__fields">
        <div className="verdict-card__field">
          <b>趣味罪名</b>
          <span>{verdict.charge}</span>
        </div>
        <div className="verdict-card__field">
          <b>判决主文</b>
          <span>{verdict.sentence}</span>
        </div>
        <div className="verdict-card__field">
          <b>法官寄语</b>
          <span>{verdict.judgeNote}</span>
        </div>
      </div>

      {transcript.length > 0 && (
        <div className="verdict-card__transcript">
          <button
            type="button"
            className="verdict-card__toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            完整合议庭发言记录（{transcript.length}）
            <ChevronDown size={14} className={expanded ? 'is-open' : ''} />
          </button>
          {expanded && (
            <ol className="verdict-card__transcript-list">
              {transcript.map((sp) => (
                <li key={sp.id}>
                  <b>{sp.speakerName}</b>
                  <p>{sp.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="verdict-card__actions">
        <button type="button" className="verdict-card__btn" onClick={onShare}>
          <Share2 size={14} /> 分享判决
        </button>
        <button type="button" className="verdict-card__btn verdict-card__btn--gold" onClick={onPublish}>
          <Send size={14} /> 发布到广场
        </button>
        <button type="button" className="verdict-card__btn verdict-card__btn--ghost" onClick={onAppeal}>
          <RotateCcw size={14} /> 发起上诉
        </button>
      </div>
      {shareStatus && <div className="verdict-card__status">{shareStatus}</div>}
    </div>
  )
}

export default VerdictCard
