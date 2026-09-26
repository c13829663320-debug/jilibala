import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, Sparkles, WandSparkles, X } from 'lucide-react'
import { CELEBRITIES, type CourtCase, type EvidenceType, type Perspective } from '@balabala/shared'
import { useIdentity } from './identity'
import { celebrityToUi, fetchMyCharacters, fetchPublicCharacters, type UiCharacter } from './custom-characters'

export type DefenderInfo = { id: string; name: string; model?: string; side: 'plaintiff' | 'defendant' }

export type WizardStartPayload = {
  caseId: string
  perspective: Perspective
  defenders: DefenderInfo[]
  defenderAssignments: { plaintiff: string[]; defendant: string[] }
}

type Step = 'describe' | 'analyzing' | 'preview' | 'perspective'

type DraftEvidence = { name: string; type: EvidenceType; content: string }

export default function CourtCreationWizard({
  initialInput,
  onStart,
  onSwitchToBench,
  onBack,
}: {
  initialInput: string
  onStart: (p: WizardStartPayload) => void
  onSwitchToBench: () => void
  onBack: () => void
}) {
  const { user } = useIdentity()
  const [step, setStep] = useState<Step>('describe')
  const [input, setInput] = useState(initialInput)
  const [evidence, setEvidence] = useState<DraftEvidence[]>([])
  const [evName, setEvName] = useState('')
  const [evType, setEvType] = useState<EvidenceType>('TEXT')
  const [evContent, setEvContent] = useState('')
  const [caseId, setCaseId] = useState('')
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null)
  const [perspective, setPerspective] = useState<Perspective>('audience')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 候选人（名人 + 我的人物 + 广场人物），用于辩护人分配
  const [characters, setCharacters] = useState<UiCharacter[]>(() => CELEBRITIES.map(celebrityToUi))
  useEffect(() => {
    const userId = user?.userId ?? ''
    Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()])
      .then(([mine, pub]) => {
        const mineIds = new Set(mine.map((c) => c.id))
        const extra = [...mine, ...pub.filter((c) => !mineIds.has(c.id))]
        setCharacters([...CELEBRITIES.map(celebrityToUi), ...extra])
      })
      .catch(() => { /* 无自定义人物也可继续 */ })
  }, [user?.userId])

  const [assigned, setAssigned] = useState<Record<string, 'plaintiff' | 'defendant'>>({})

  const toggleAssign = (id: string) => {
    setAssigned((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = 'plaintiff'
      return next
    })
  }
  const setAssignSide = (id: string, side: 'plaintiff' | 'defendant') => {
    setAssigned((prev) => ({ ...prev, [id]: side }))
  }

  const addEvidence = () => {
    const name = evName.trim()
    const content = evContent.trim()
    if (!name) return
    setEvidence((prev) => [...prev, { name, type: evType, content }])
    setEvName(''); setEvContent('')
  }

  const handleAnalyze = async () => {
    const text = input.trim()
    if (!text || !user?.userId || busy) return
    setError(''); setBusy(true)
    setStep('analyzing')
    try {
      const created = await fetch('/api/court/cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, userInput: text, evidence }),
      })
      const createdData = await created.json().catch(() => ({})) as { case?: CourtCase; message?: string }
      if (!created.ok || !createdData.case) throw new Error(createdData.message ?? '建案失败')
      setCaseId(createdData.case.id)

      const res = await fetch(`/api/court/cases/${createdData.case.id}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      const data = await res.json().catch(() => ({})) as { case?: CourtCase; message?: string }
      if (!res.ok || !data.case) throw new Error(data.message ?? '分析失败')
      setCourtCase(data.case)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败')
      setStep('describe')
    } finally {
      setBusy(false)
    }
  }

  const handleRegenerate = async () => {
    if (!user?.userId || !caseId || busy) return
    setError(''); setBusy(true)
    setStep('analyzing')
    try {
      const res = await fetch(`/api/court/cases/${caseId}/regenerate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      const data = await res.json().catch(() => ({})) as { case?: CourtCase; message?: string }
      if (!res.ok || !data.case) throw new Error(data.message ?? '重新分析失败')
      setCourtCase(data.case)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '重新分析失败')
      setStep('preview')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (!user?.userId || !caseId || busy) return
    setError(''); setBusy(true)
    try {
      const res = await fetch(`/api/court/cases/${caseId}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      const data = await res.json().catch(() => ({})) as { case?: CourtCase; message?: string }
      if (!res.ok || !data.case) throw new Error(data.message ?? '确认失败')
      setCourtCase(data.case)
      setStep('perspective')
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认失败')
    } finally {
      setBusy(false)
    }
  }

  const handleStart = async () => {
    if (!user?.userId || !caseId || busy) return
    setBusy(true)
    try {
      const defenders: DefenderInfo[] = Object.entries(assigned).map(([id, side]) => {
        const ch = characters.find((c) => c.id === id)
        return { id, name: ch?.name ?? id, model: ch?.model, side }
      })
      const defenderAssignments = {
        plaintiff: defenders.filter((d) => d.side === 'plaintiff').map((d) => d.id),
        defendant: defenders.filter((d) => d.side === 'defendant').map((d) => d.id),
      }
      onStart({ caseId, perspective, defenders, defenderAssignments })
    } finally {
      setBusy(false)
    }
  }

  const facts = useMemo(() => courtCase?.facts ?? [], [courtCase])
  const plaintiff = courtCase?.plaintiff
  const defendant = courtCase?.defendant
  const plaintiffKb = courtCase?.plaintiff_kb
  const defendantKb = courtCase?.defendant_kb

  return (
    <div className="cr-ui cr-center cr-wiz">
      {step === 'describe' && (
        <>
          <span className="cr-step-tag"><Sparkles size={13} /> STEP 1 · 描述案件</span>
          <h2>把这件小事说清楚</h2>
          <p className="cr-sub">客观描述发生了什么，AI 会自动提取事实、生成双方立场与知识库。</p>

          <textarea
            className="cr-field"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            placeholder="例如：谁把最后一块小蛋糕吃掉了？事后却说是别人先动的手。"
            maxLength={500}
          />
          <div className="cr-field-count">{input.length}/500</div>

          <div className="cr-evidence-add">
            <input value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="证据名称"
              style={{ minHeight: 38, borderRadius: 9, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.45)', color: 'inherit', padding: '0 10px' }} />
            <select value={evType} onChange={(e) => setEvType(e.target.value as EvidenceType)}
              style={{ minHeight: 38, borderRadius: 9, border: '1px solid rgba(255,255,255,0.16)', background: '#1a1612', color: 'inherit', padding: '0 8px' }}>
              <option value="TEXT">文字</option><option value="IMAGE">图片</option><option value="DOCUMENT">文件</option>
            </select>
            <input value={evContent} onChange={(e) => setEvContent(e.target.value)} placeholder="证据内容/描述"
              style={{ flex: 1, minHeight: 38, borderRadius: 9, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.45)', color: 'inherit', padding: '0 10px' }} />
            <button type="button" className="cr-btn cr-btn--sm" onClick={addEvidence}><Plus size={14} /> 添加</button>
          </div>
          {evidence.length > 0 && (
            <div className="cr-evidence-add">
              {evidence.map((e, i) => (
                <span className="cr-ev-chip" key={i}>{e.name}<button type="button" onClick={() => setEvidence(evidence.filter((_, idx) => idx !== i))}>×</button></span>
              ))}
            </div>
          )}

          {error && <div className="cr-toast-msg">{error}</div>}

          <div className="cr-wiz-actions">
            <button type="button" className="cr-btn cr-btn--ghost" onClick={onBack}><ArrowLeft size={14} /> 返回</button>
            <button type="button" className="cr-btn" onClick={onSwitchToBench}><WandSparkles size={14} /> 名人合议庭模式</button>
            <button type="button" className="cr-btn cr-btn--primary" onClick={() => void handleAnalyze()} disabled={!input.trim() || busy}>
              AI 分析
            </button>
          </div>
        </>
      )}

      {step === 'analyzing' && (
        <div className="cr-loading">
          <div className="cr-spinner" />
          <h2>正在分析案件…</h2>
          <p className="cr-sub">提取事实、生成双方立场与知识库，请稍候。</p>
        </div>
      )}

      {step === 'preview' && courtCase && (
        <>
          <span className="cr-step-tag">STEP 3 · 预览确认</span>
          <h2>{courtCase.title}</h2>
          <p className="cr-sub">AI 已完成分析。确认无误后进入庭审；不满意可重新生成。</p>
          <div className="cr-preview-grid">
            <div className="cr-preview-col">
              <h4>事实</h4>
              <ul>{facts.map((f) => <li key={f.id}>{f.content}</li>)}</ul>
              {courtCase.dispute_points.length > 0 && (
                <>
                  <h4 style={{ marginTop: 10 }}>争议点</h4>
                  <ul>{courtCase.dispute_points.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </>
              )}
            </div>
            <div className="cr-preview-col">
              <h4>原告</h4>
              {plaintiff && <><div className="cr-party-name">{plaintiff.name}</div><div className="cr-party-stance">{plaintiff.stance}</div></>}
              <ul>{(plaintiffKb?.claims ?? []).slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div className="cr-preview-col">
              <h4>被告</h4>
              {defendant && <><div className="cr-party-name">{defendant.name}</div><div className="cr-party-stance">{defendant.stance}</div></>}
              <ul>{(defendantKb?.claims ?? []).slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          </div>
          {error && <div className="cr-toast-msg">{error}</div>}
          <div className="cr-wiz-actions">
            <button type="button" className="cr-btn" onClick={() => void handleRegenerate()} disabled={busy}>重新生成</button>
            <button type="button" className="cr-btn cr-btn--primary" onClick={() => void handleConfirm()} disabled={busy}>确认并继续</button>
          </div>
        </>
      )}

      {step === 'perspective' && (
        <>
          <span className="cr-step-tag">STEP 4 · 选择视角</span>
          <h2>你想以什么身份参与？</h2>
          <p className="cr-sub">观众可旁观庭审；原告/被告视角可在庭审中发言。</p>
          <div className="cr-pick-row">
            {([
              { id: 'plaintiff' as const, label: '原告', sub: '提出主张、举证' },
              { id: 'audience' as const, label: '观众', sub: '旁观、站队' },
              { id: 'defendant' as const, label: '被告', sub: '回应质疑、辩护' },
            ]).map((opt) => (
              <button key={opt.id} type="button" className={perspective === opt.id ? 'is-active' : ''} onClick={() => setPerspective(opt.id)}>
                <b>{opt.label}</b><small>{opt.sub}</small>
              </button>
            ))}
          </div>

          <div className="cr-defender-box">
            <h4>邀请名人 / 自定义人物担任辩护人（可选）</h4>
            <div className="cr-defender-cols">
              <div className="cr-defender-col">
                <h5>原告方辩护人</h5>
                {characters.slice(0, 12).map((c) => {
                  const side = assigned[c.id]
                  const on = side === 'plaintiff'
                  return (
                    <div key={c.id} className={`cr-defender-item ${on ? 'is-on' : ''}`} onClick={() => (side === 'plaintiff' ? toggleAssign(c.id) : setAssignSide(c.id, 'plaintiff'))}>
                      {c.portrait ? <img src={c.portrait} alt="" /> : <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#3a2f5a', display: 'grid', placeItems: 'center', fontSize: 12 }}>{c.name[0]}</span>}
                      <span>{c.name}</span>
                      {side === 'defendant' && <small style={{ marginLeft: 'auto', color: '#ff8a8a' }}>在被告方</small>}
                    </div>
                  )
                })}
              </div>
              <div className="cr-defender-col">
                <h5>被告方辩护人</h5>
                {characters.slice(0, 12).map((c) => {
                  const side = assigned[c.id]
                  const on = side === 'defendant'
                  return (
                    <div key={c.id} className={`cr-defender-item ${on ? 'is-on' : ''}`} onClick={() => (side === 'defendant' ? toggleAssign(c.id) : setAssignSide(c.id, 'defendant'))}>
                      {c.portrait ? <img src={c.portrait} alt="" /> : <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#3a2f5a', display: 'grid', placeItems: 'center', fontSize: 12 }}>{c.name[0]}</span>}
                      <span>{c.name}</span>
                      {side === 'plaintiff' && <small style={{ marginLeft: 'auto', color: '#8ab4ff' }}>在原告方</small>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {error && <div className="cr-toast-msg">{error}</div>}
          <div className="cr-wiz-actions">
            <button type="button" className="cr-btn" onClick={() => setStep('preview')} disabled={busy}>上一步</button>
            <button type="button" className="cr-btn cr-btn--primary" onClick={() => void handleStart()} disabled={busy}>
              {busy ? '开庭准备中…' : '开始庭审'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
