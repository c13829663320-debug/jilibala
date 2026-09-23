import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Send, Eye, Scale, Bot } from 'lucide-react'
import type { CourtRecord, CourtTurn, Perspective } from '@balabala/shared'

const ROLE_META: Record<CourtTurn['speaker'], { label: string; cls: string; initial: string }> = {
  judge: { label: '法官', cls: 'judge', initial: '法' },
  plaintiff: { label: '原告', cls: 'plaintiff', initial: '原' },
  defendant: { label: '被告', cls: 'defendant', initial: '被' },
  defender: { label: '辩护人', cls: 'defender', initial: '辩' },
}

export type TrialSubmitInput = {
  content: string
  type: 'argument' | 'evidence' | 'question'
  evidenceName?: string
}

export default function CourtTrialPanel({
  turns,
  record,
  perspective,
  onPerspectiveChange,
  canInput,
  onSubmitInput,
  submittedMsg,
}: {
  turns: CourtTurn[]
  record: CourtRecord | null
  perspective: Perspective
  onPerspectiveChange: (p: Perspective) => void
  canInput: boolean
  onSubmitInput: (input: TrialSubmitInput) => void
  submittedMsg: string | null
}) {
  const latest = turns[turns.length - 1] ?? null
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [input, setInput] = useState('')
  const [evidenceName, setEvidenceName] = useState('')
  const [recordOpen, setRecordOpen] = useState(false)

  // 最新发言自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length])

  const submit = () => {
    const content = input.trim()
    if (!content || !canInput) return
    onSubmitInput({ content, type: evidenceName.trim() ? 'evidence' : 'argument', evidenceName: evidenceName.trim() || undefined })
    setInput('')
    setEvidenceName('')
  }

  const role = latest ? ROLE_META[latest.speaker] : null
  const showInput = canInput && perspective !== 'audience'

  return (
    <div className="cr-ui cr-bottom">
      {latest && role ? (
        <div className="cr-speaker">
          <div className={`cr-avatar cr-avatar--${role.cls}`}>{role.initial}</div>
          <div className="cr-speaker__meta">
            <b>{latest.speakerName}</b>
            <span className={`cr-role-tag cr-role-tag--${role.cls}`}>{role.label}</span>
          </div>
        </div>
      ) : (
        <div className="cr-speaker">
          <div className="cr-avatar cr-avatar--judge">法</div>
          <div className="cr-speaker__meta"><b>庭审即将开始</b><span className="cr-role-tag cr-role-tag--judge">法官</span></div>
        </div>
      )}

      <div className="cr-transcript" ref={scrollRef}>
        {turns.length === 0 && <div className="cr-turn">等待法官宣布开庭…</div>}
        {turns.map((t, i) => {
          const m = ROLE_META[t.speaker]
          const isLast = i === turns.length - 1
          return (
            <div key={t.id} className={`cr-turn ${isLast ? 'cr-turn--latest' : ''}`}>
              <b>{t.speakerName}</b>（{m.label}）：{t.content}
            </div>
          )
        })}
      </div>

      {record && (record.unresolved.length > 0 || record.resolved.length > 0) && (
        <div className="cr-record">
          <div className="cr-record__head" onClick={() => setRecordOpen((v) => !v)}>
            <span>法官记录 · 未决 {record.unresolved.length} / 已决 {record.resolved.length}</span>
            {recordOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
          {recordOpen && (
            <div className="cr-record__body">
              {record.unresolved.length > 0 && (
                <div><b className="cr-record__unresolved">待厘清：</b><ul>{record.unresolved.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
              )}
              {record.resolved.length > 0 && (
                <div><b className="cr-record__resolved">已确认：</b><ul>{record.resolved.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="cr-persp" role="radiogroup" aria-label="视角">
        {([
          { id: 'plaintiff' as const, label: '原告', icon: <Scale size={14} /> },
          { id: 'audience' as const, label: '观众', icon: <Eye size={14} /> },
          { id: 'defendant' as const, label: '被告', icon: <Bot size={14} /> },
        ]).map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={perspective === opt.id}
            className={perspective === opt.id ? 'is-active' : ''}
            onClick={() => onPerspectiveChange(opt.id)}
          >
            {opt.icon} {opt.label}
          </button>
        ))}
      </div>

      {showInput ? (
        <div className="cr-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={perspective === 'plaintiff' ? '向法官陈述你的主张或反驳…' : '回应对方主张或为自己辩护…'}
            maxLength={500}
          />
          <div className="cr-input__row">
            <input
              value={evidenceName}
              onChange={(e) => setEvidenceName(e.target.value)}
              placeholder="证据名称（可选，如：聊天截图）"
              style={{ flex: 1, minHeight: 38, borderRadius: 9, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.45)', color: 'inherit', padding: '0 10px' }}
            />
            <button type="button" className="cr-btn cr-btn--primary" onClick={submit} disabled={!input.trim()}>
              <Send size={14} /> 补充给{perspective === 'plaintiff' ? '原告' : '被告'}
            </button>
          </div>
          {submittedMsg && <div className="cr-toast-msg">{submittedMsg}</div>}
        </div>
      ) : (
        <div className="cr-audience-note">观众模式——旁观庭审，可在上方切换视角参与</div>
      )}
    </div>
  )
}
