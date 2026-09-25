// 主编排:5 个 screen 状态机,接入 HttpCourtEngine(真实后端)。
// 不再引用任何 mock:AI 不可用时由各 screen 显式报错。
import { useCallback, useMemo, useState } from 'react'
import './court.css'
import type { Celebrity } from '@balabala/shared'
import { useIdentity } from '../identity'
import { HttpCourtEngine } from './http-engine'
import { EMPTY_ASSIGNMENTS, type DefenderAssignments } from './DefenderPicker'
import type {
  AnalyzeCaseInput, CourtCase, CourtVerdict, EvidenceItem, Perspective,
} from './types'
import CreateCase, { type RawEvidence, type PlayerSide } from './screens/CreateCase'
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
  const [playerSide, setPlayerSide] = useState<PlayerSide | null>(null)
  const [defenderAssignments, setDefenderAssignments] = useState<DefenderAssignments>(EMPTY_ASSIGNMENTS)
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [error, setError] = useState('')

  const goCreate = useCallback(() => {
    setFlowState('create')
    setInput(null); setCourtCase(null); setVerdict(null); setBackendCaseId(undefined)
    setPerspective('audience'); setPlayerSide(null); setError('')
  }, [])

  const handleCreate = useCallback((payload: { description: string; stance?: string; evidence: RawEvidence[]; playerSide: PlayerSide }) => {
    engine.configure({ userId })
    setPlayerSide(payload.playerSide)
    // 玩家默认坐在自己这一方视角，不再是观众席。
    setPerspective(payload.playerSide)
    setInput({
      description: payload.description,
      stance: payload.stance,
      evidence: toEvidence(payload.evidence),
    })
    setFlowState('analyzing')
  }, [engine, userId])

  // 快速开庭：预置故事 + 玩家身份，跳过 analyze 直接进 review。
  const handleQuickStart = useCallback(async (storyIndex: number, side: PlayerSide) => {
    engine.configure({ userId })
    setPlayerSide(side)
    setPerspective(side)
    try {
      const c = await engine.quickStart(storyIndex, side)
      setCourtCase(c)
      setFlowState('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : '快速开庭失败')
      setFlowState('create')
    }
  }, [engine, userId])

  const handleAnalyzed = useCallback((c: CourtCase) => {
    setCourtCase(c)
    setFlowState('review')
  }, [])

  const handleConfirm = useCallback(async (docs: { plaintiffComplaint: string; defendantAnswer: string }) => {
    setConfirming(true)
    setError('')
    try {
      engine.configure({ userId, perspective, defenderAssignments })
      await engine.confirmCase({
        plaintiffComplaint: docs.plaintiffComplaint || undefined,
        defendantAnswer: docs.defendantAnswer || undefined,
        playerSide: playerSide ?? undefined,
      })
      setFlowState('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认开庭失败')
    } finally {
      setConfirming(false)
    }
  }, [engine, userId, perspective, defenderAssignments, playerSide])

  const handleVerdict = useCallback((v: CourtVerdict, caseId?: string) => {
    setVerdict(v)
    setBackendCaseId(caseId)
    // 把最终局势优势条挂到案件上，供判决页展示「你的表现」。
    const m = engine.getMomentum()
    setCourtCase((prev) => prev ? { ...prev, momentum: m } : prev)
    setFlowState('verdict')
  }, [engine])

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
          onQuickStart={handleQuickStart}
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
            defenderAssignments={defenderAssignments}
            onDefendersChange={setDefenderAssignments}
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
          defenderAssignments={defenderAssignments}
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
