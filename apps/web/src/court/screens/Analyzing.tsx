import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { CourtroomShell } from '../shared'
import type { AnalyzeCaseInput, CourtCase } from '../types'
import type { CourtEngineClient } from '../engine'

type Props = {
  character?: unknown
  input: AnalyzeCaseInput
  engine: CourtEngineClient
  onDone: (courtCase: CourtCase) => void
  onRetry: () => void
  onExit: () => void
  onOpenArchive: () => void
}

const STEPS = [
  { label: '事实提取', desc: '从你的叙述中提取结构化事实' },
  { label: '争议点提取', desc: '找出双方意见不一致的核心分歧' },
  { label: '双方立场生成', desc: '构建原告与被告的完整证据书' },
] as const

export default function Analyzing({ input, engine, onDone, onRetry, onExit, onOpenArchive }: Props) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CourtCase | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setError('')
      setStep(0)
      try {
        const courtCase = await engine.analyzeCase(input)
        if (cancelled) return
        setResult(courtCase)
        setStep(1)
        await new Promise((r) => setTimeout(r, 650))
        if (cancelled) return
        setStep(2)
        await new Promise((r) => setTimeout(r, 550))
        if (cancelled) return
        setStep(3)
        await new Promise((r) => setTimeout(r, 500))
        if (cancelled) return
        onDone(courtCase)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'AI 分析失败,请重试')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [input, engine, onDone])

  return (
    <CourtroomShell onExit={onExit} onOpenArchive={onOpenArchive} frostStrong>
      <div className="live-analyze">
        <div className="live-analyze__head">
          <span className="live-create__eyebrow">ANALYZING</span>
          <h1>AI 正在阅读你的案件…</h1>
        </div>

        <div className="live-analyze__card">
          {STEPS.map((s, i) => {
            const state = step > i ? 'done' : step === i ? 'active' : 'pending'
            return (
              <div key={s.label} className={`analyzing-step analyzing-step--${state}`}>
                <span className="analyzing-step__num">
                  {state === 'done' ? <Check size={14} /> : state === 'active' ? <span className="analyzing-spin" /> : i + 1}
                </span>
                <div className="analyzing-step__body">
                  <div className="analyzing-step__title">{s.label}</div>
                  {(state === 'done' || state === 'active') && (
                    <div className="analyzing-step__preview">
                      {i === 0 && result && (result.facts.slice(0, 2).map((f) => f.content).join(' / ') || '…')}
                      {i === 1 && result && (result.disputePoints[0] ?? '…')}
                      {i === 2 && result && `原告「${result.plaintiff.name}」 vs 被告「${result.defendant.name}」`}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="live-analyze__error">
            <div className="court-error">{error}</div>
            <button className="court-btn court-btn--secondary" style={{ marginTop: 10 }} onClick={onRetry}>返回修改</button>
          </div>
        )}
      </div>
    </CourtroomShell>
  )
}
