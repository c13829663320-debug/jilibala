import { useRef, useState, type ChangeEvent } from 'react'
import { ChevronRight, FileText, Mic2, Scale, Send, Upload } from 'lucide-react'
import type { BenchInteractionKind, BenchMember, Perspective } from '@balabala/shared'

export interface TrialInteractPayload {
  kind: BenchInteractionKind
  text?: string
  targetCelebrityId?: string
  evidenceName?: string
  vote?: 'plaintiff' | 'defendant'
}

export interface TrialInteractionProps {
  perspective: Perspective
  members: BenchMember[]
  disabled: boolean
  votes: { plaintiff: number; defendant: number }
  onInteract: (i: TrialInteractPayload) => void
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

const PLACEHOLDER: Record<Perspective, string> = {
  plaintiff: '补充陈述…',
  defendant: '答辩回应…',
  audience: '发表意见…',
}

/**
 * Compact toolbar for live courtroom participation: chat input + voice,
 * call a member, upload evidence, and vote for either side.
 */
export function TrialInteraction({ perspective, members, disabled, votes, onInteract }: TrialInteractionProps) {
  const [draft, setDraft] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [callId, setCallId] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const submitText = () => {
    const text = draft.trim()
    if (!text || disabled) return
    onInteract({ kind: perspective === 'audience' ? 'question' : 'interrupt', text })
    setDraft('')
  }

  const toggleVoice = () => {
    if (disabled) return
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const browserWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ''
      setDraft((prev) => `${prev}${transcript}`)
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  const pickMember = (id: string) => {
    setCallId(id)
    if (id && !disabled) onInteract({ kind: 'call', targetCelebrityId: id })
  }

  const addEvidence = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && !disabled) onInteract({ kind: 'evidence', evidenceName: file.name })
    event.currentTarget.value = ''
  }

  const vote = (side: 'plaintiff' | 'defendant') => {
    if (disabled) return
    onInteract({ kind: 'vote', vote: side })
  }

  return (
    <div className="trial-interaction">
      <div className="trial-interaction__compose">
        <input
          className="trial-interaction__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitText() }}
          placeholder={PLACEHOLDER[perspective]}
          disabled={disabled}
          maxLength={240}
        />
        <button
          type="button"
          className={`trial-interaction__voice ${isListening ? 'is-listening' : ''}`}
          onClick={toggleVoice}
          disabled={disabled}
          title="语音输入"
        >
          <Mic2 size={15} /> {isListening ? '聆听中' : '语音'}
        </button>
        <button
          type="button"
          className="trial-interaction__send"
          onClick={submitText}
          disabled={disabled || !draft.trim()}
        >
          <Send size={14} /> 发言
        </button>
      </div>

      <div className="trial-interaction__tools">
        <label className="trial-interaction__call">
          <span className="trial-interaction__call-label">点名发言</span>
          <select value={callId} onChange={(e) => pickMember(e.target.value)} disabled={disabled}>
            <option value="">选择名人…</option>
            {members.map((m) => (
              <option key={m.celebrityId} value={m.celebrityId}>{m.name} · {m.title}</option>
            ))}
          </select>
        </label>

        <label className="trial-interaction__evidence">
          <Upload size={14} /> 举证
          <input type="file" accept="image/*,.pdf,.txt" onChange={addEvidence} disabled={disabled} />
        </label>

        <div className="trial-interaction__votes">
          <button
            type="button"
            className="trial-interaction__vote"
            onClick={() => vote('plaintiff')}
            disabled={disabled}
          >
            <Scale size={13} /> 支持原告 <b>{votes.plaintiff}</b>
          </button>
          <button
            type="button"
            className="trial-interaction__vote"
            onClick={() => vote('defendant')}
            disabled={disabled}
          >
            <Scale size={13} /> 支持被告 <b>{votes.defendant}</b>
          </button>
        </div>
      </div>

      {callId && !disabled && (
        <div className="trial-interaction__called">
          <ChevronRight size={12} /> 已点名 {members.find((m) => m.celebrityId === callId)?.name ?? ''}
          <FileText size={12} />
        </div>
      )}
    </div>
  )
}

export default TrialInteraction
