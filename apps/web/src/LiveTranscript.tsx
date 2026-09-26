import { useEffect, useMemo, useRef } from 'react'
import { Gavel } from 'lucide-react'
import type { BenchMember, BenchSpeech, BenchStage } from '@balabala/shared'

export interface LiveTranscriptProps {
  speeches: BenchSpeech[]
  members: BenchMember[]
  currentStage: BenchStage
  activeSpeakerId: string | null
}

const STAGES: Array<{ id: BenchStage; label: string }> = [
  { id: 'forming', label: '合议庭组建' },
  { id: 'opening', label: '开庭陈述' },
  { id: 'debate', label: '自由辩论' },
  { id: 'summary', label: '法官归纳' },
  { id: 'verdict', label: '宣判' },
]

/**
 * Live chat-style transcript of the bench, with a stage progress header and
 * auto-scroll to the newest speech. Judge entries are styled distinctly.
 */
export function LiveTranscript({ speeches, members, currentStage, activeSpeakerId }: LiveTranscriptProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const memberById = useMemo(() => {
    const map = new Map<string, BenchMember>()
    members.forEach((m) => map.set(m.celebrityId, m))
    return map
  }, [members])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [speeches.length])

  const stageIndex = STAGES.findIndex((s) => s.id === currentStage)

  return (
    <div className="live-transcript">
      <div className="live-transcript__stages" role="tablist" aria-label="庭审阶段">
        {STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`live-transcript__stage ${i === stageIndex ? 'is-current' : ''} ${i < stageIndex ? 'is-done' : ''}`}
          >
            <span className="live-transcript__stage-dot" />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="live-transcript__list" ref={listRef}>
        {speeches.length === 0 ? (
          <div className="live-transcript__empty">等待开庭…</div>
        ) : (
          speeches.map((sp) => {
            const isJudge = sp.speakerId === 'judge'
            const member = memberById.get(sp.speakerId)
            const isActive = sp.speakerId === activeSpeakerId
            const stageLabel = STAGES.find((s) => s.id === sp.stage)?.label ?? sp.stage
            return (
              <div
                key={sp.id}
                className={`live-transcript__item ${isJudge ? 'is-judge' : ''} ${isActive ? 'is-active' : ''}`}
              >
                <div className="live-transcript__avatar">
                  {isJudge ? (
                    <Gavel size={16} />
                  ) : member?.portrait ? (
                    <img src={member.portrait} alt={sp.speakerName} />
                  ) : (
                    <span>{sp.speakerName.slice(0, 1)}</span>
                  )}
                </div>
                <div className="live-transcript__body">
                  <div className="live-transcript__meta">
                    <b>{sp.speakerName}</b>
                    <span className="live-transcript__stage-tag">{stageLabel}</span>
                    <time>{sp.timestamp}</time>
                  </div>
                  <p>{sp.text}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default LiveTranscript
