// 主编排:5 个 screen 状态机,接入 HttpCourtEngine(真实后端)。
// 不再引用任何 mock:AI 不可用时由各 screen 显式报错。
import { useCallback, useMemo, useState } from 'react'
import './court.css'
import type { Celebrity } from '@balabala/shared'
import { useIdentity } from '../identity'
import { HttpCourtEngine } from './http-engine'
import type {
  AnalyzeCaseInput, CourtCase, CourtVerdict, EvidenceItem, Perspective,
} from './types'
import CreateCase, { type RawEvidence } from './screens/CreateCase'
import Analyzing from './screens/Analyzing'
import PartiesReview from './screens/PartiesReview'
import CourtroomLive from './screens/CourtroomLive'
import VerdictScreen from './screens/VerdictScreen'

type FlowState = 'create' | 'analyzing' | 'review' | 'live' | 'verdict'

export type CourtFlowProps = {
  /** 返回大厅/入口页。 */
  onExit: () => void
  /** 打开案卷库视图。 */
  onOpenArchive: () => void
  /** 切换到旧的名人合议庭模式(bench)。 */
  onSwitchToBench?: () => void
  character?: Celebrity | null
}

const toEvidence = (list: RawEvidence[]): EvidenceItem[] =>
  list.map((f) => ({
    id: Math.random().toString(36).slice(2),
    type: f.type.startsWith('image/') ? 'image' : 'document',
    name: f.name,
    size: f.size,
    mime: f.type,
  }))

export default function CourtFlow({
  onExit, onOpenArchive, onSwitchToBench, character,
}: CourtFlowProps) {
  const { user } = useIdentity()
  const userId = user?.userId ?? ''
  const engine = useMemo(() => new HttpCourtEngine(), [])
  const [flowState, setFlowState] = useState<FlowState>('create')
  const [input, setInput] = useState<AnalyzeCaseInput | null>(null)
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null)
  const [verdict, setVerdict] = useState<CourtVerdict | null>(null)
  const [backendCaseId, setBackendCaseId] = useState<string | undefined>()
  const [perspective, setPerspective] = useState<Perspective>('audience')
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [error, setError] = useState('')

  const goCreate = useCallback(() => {
    setFlowState('create')
    setInput(null); setCourtCase(null); setVerdict(null); setBackendCaseId(undefined)
    setPerspective('audience'); setError('')
  }, [])

  const handleCreate = useCallback((payload: { description: string; stance?: string; evidence: RawEvidence[] }) => {
    engine.configure({ userId })
    setInput({
      description: payload.description,
      stance: payload.stance,
      evidence: toEvidence(payload.evidence),
    })
    setFlowState('analyzing')
  }, [engine, userId])

  const handleAnalyzed = useCallback((c: CourtCase) => {
    setCourtCase(c)
    setFlowState('review')
  }, [])

  const handleConfirm = useCallback(async () => {
    setConfirming(true)
    setError('')
    try {
      await engine.confirmCase()
      setFlowState('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认开庭失败')
    } finally {
      setConfirming(false)
    }
  }, [engine])

  const handleVerdict = useCallback((v: CourtVerdict, caseId?: string) => {
    setVerdict(v)
    setBackendCaseId(caseId)
    setFlowState('verdict')
  }, [])

  // 发布到广场:直连 POST /api/court/cases/:id/publish
  const handlePublish = useCallback(async () => {
    if (!backendCaseId) { setPublishError('判决未关联案件,无法发布'); return }
    setPublishing(true); setPublishError('')
    try {
      const res = await fetch(`/api/court/cases/${encodeURIComponent(backendCaseId)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) setPublishError(data.message ?? '发布失败')
    } catch {
      setPublishError('发布失败,请重试')
    } finally {
      setPublishing(false)
    }
  }, [backendCaseId, userId])

  return (
    <div className="court-root">
      {flowState === 'create' && (
        <CreateCase
          character={character}
          onSubmit={handleCreate}
          onExit={onExit}
          onOpenArchive={onOpenArchive}
          onSwitchToBench={onSwitchToBench}
        />
      )}

      {flowState === 'analyzing' && input && (
        <Analyzing
          character={character}
          input={input}
          engine={engine}
          onDone={handleAnalyzed}
          onRetry={goCreate}
          onExit={onExit}
          onOpenArchive={onOpenArchive}
        />
      )}

      {flowState === 'review' && courtCase && (
        <PartiesReview
          character={character}
          courtCase={courtCase}
          confirming={confirming}
          onBack={() => setFlowState('analyzing')}
          onConfirm={handleConfirm}
          onExit={onExit}
          onOpenArchive={onOpenArchive}
        />
      )}

      {flowState === 'live' && courtCase && (
        <CourtroomLive
          courtCase={courtCase}
          engine={engine}
          initialPerspective={perspective}
          character={character}
          onVerdict={handleVerdict}
          onExit={onExit}
          onOpenArchive={onOpenArchive}
        />
      )}

      {flowState === 'verdict' && courtCase && verdict && (
        <VerdictScreen
          character={character}
          courtCase={courtCase}
          verdict={verdict}
          publishing={publishing}
          publishError={publishError}
          onSaveArchive={onOpenArchive}
          onOpenArchive={onOpenArchive}
          onPublishToPlaza={handlePublish}
          onNewTrial={goCreate}
          onExit={onExit}
        />
      )}

      {error && flowState === 'review' && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
          <div className="court-error">{error} <button className="court-btn court-btn--sm" onClick={() => setError('')}>知道了</button></div>
        </div>
      )}
    </div>
  )
}
