import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Link2, Users } from 'lucide-react'
import type { CourtCase, CourtRecord, CourtTrialEvent, CourtTurn, CourtVerdict, Perspective, WSMessage } from '@balabala/shared'
import { resolveCharacterVoice } from '@balabala/shared'
import { useIdentity } from './identity'
import { useReconnectingWebSocket, wsStatusLabel } from './useReconnectingWebSocket'
import CourtCreationWizard, { type DefenderInfo, type WizardStartPayload } from './CourtCreationWizard'
import CourtTrialPanel, { type TrialSubmitInput } from './CourtTrialPanel'
import CourtVerdictPanel from './CourtVerdictPanel'
import type { CourtSeat } from './CourtroomView'
import { playTts, stopTts } from './tts'
import { getVoiceEnabled, VoiceToggleButton } from './voice-settings'
import './courtroom-fullscreen.css'

const CourtroomView = lazy(() => import('./CourtroomView'))

type Phase = 'wizard' | 'trial' | 'verdict'

const STATUS_LABEL: Record<CourtCase['status'], string> = {
  DRAFT: '待分析', ANALYZING: '分析中', GENERATED: '待开庭', CONFIRMED: '待开庭',
  IN_PROGRESS: '庭审中', JUDGING: '判决中', COMPLETED: '已结束',
}

export default function CourtroomM13({
  caseText,
  roomId,
  onBack,
  onSwitchToBench,
  onPublishToPlaza,
}: {
  caseText: string
  roomId?: string
  onBack: () => void
  onSwitchToBench: () => void
  onPublishToPlaza: () => void
}) {
  const { user } = useIdentity()
  const isGuest = Boolean(roomId)

  const [phase, setPhase] = useState<Phase>(isGuest ? 'trial' : 'wizard')
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null)
  const [turns, setTurns] = useState<CourtTurn[]>([])
  const [record, setRecord] = useState<CourtRecord | null>(null)
  const [verdict, setVerdict] = useState<CourtVerdict | null>(null)
  const [perspective, setPerspective] = useState<Perspective>('audience')
  const [defenders, setDefenders] = useState<DefenderInfo[]>([])
  const [onlineCount, setOnlineCount] = useState(1)
  const [submittedMsg, setSubmittedMsg] = useState('')
  const [publishStatus, setPublishStatus] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const seenTurnIds = useRef<Set<string>>(new Set())

  const caseId = courtCase?.id ?? roomId ?? ''

  // ===== SSE / WS 事件统一处理（按 turn id 去重，避免 SSE 与 WS 重复） =====
  const handleTrialEvent = useCallback((event: CourtTrialEvent) => {
    switch (event.type) {
      case 'court_status':
        setCourtCase((prev) => prev ? { ...prev, status: event.status, current_round: event.round, current_turn: event.turn } : prev)
        break
      case 'court_turn': {
        if (seenTurnIds.current.has(event.turn.id)) break
        seenTurnIds.current.add(event.turn.id)
        setTurns((prev) => [...prev, event.turn])
        // M13 第五轮：新发言自动朗读（仅在全局语音开关开启时）。
        // turns 即当前视角可见发言，观众底牌隔离天然成立——不可见的发言不会到达这里。
        // playTts 为单例：新发言自动打断上一条。
        if (getVoiceEnabled()) {
          const voice = resolveCharacterVoice(event.turn.speaker)
          void playTts(event.turn.content, voice).catch(() => { /* 自动播放被拦截等，忽略 */ })
        }
        break
      }
      case 'court_record':
        setRecord(event.record)
        break
      case 'should_continue':
        break
      case 'court_verdict':
        setVerdict(event.verdict)
        setPhase('verdict')
        break
      case 'player_input_ack':
        setSubmittedMsg('已提交，将在后续发言中体现')
        window.setTimeout(() => setSubmittedMsg(''), 2600)
        break
      case 'error':
        setError(event.message)
        break
    }
  }, [])

  // ===== WS 多人 =====
  const wsUrl = useCallback(() => {
    if (!user?.userId || !caseId) return null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=court:${encodeURIComponent(caseId)}`
  }, [user?.userId, caseId])

  const { send: wsSend, status: wsStatus, retryCount: wsRetryCount } = useReconnectingWebSocket({
    url: wsUrl,
    enabled: Boolean(user?.userId && caseId && phase !== 'wizard'),
    onMessage: (raw) => {
      let msg: WSMessage
      try { msg = JSON.parse(raw) as WSMessage } catch { return }
      switch (msg.type) {
        case 'welcome':
          setOnlineCount(msg.users.length)
          break
        case 'user_joined':
          setOnlineCount((n) => n + 1)
          break
        case 'user_left':
          setOnlineCount((n) => Math.max(1, n - 1))
          break
        case 'court_event':
          handleTrialEvent(msg.event)
          break
        case 'court_snapshot_v2':
          setCourtCase(msg.case)
          if (msg.case.final_verdict) { setVerdict(msg.case.final_verdict); setPhase('verdict') }
          break
      }
    },
  })

  // ===== 客人加入：拉取案件 + 发言 + 判决 =====
  useEffect(() => {
    if (!isGuest || !roomId || !user?.userId) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/court/cases/${encodeURIComponent(roomId)}?userId=${encodeURIComponent(user.userId)}&perspective=audience`)
        const data = await res.json() as { case?: CourtCase; message?: string }
        if (!alive) return
        if (!res.ok || !data.case) { setError(data.message ?? '案件不存在'); return }
        setCourtCase(data.case)
        if (data.case.final_verdict) { setVerdict(data.case.final_verdict); setPhase('verdict') }
        const [turnsRes, verdictRes] = await Promise.all([
          fetch(`/api/court/cases/${encodeURIComponent(roomId)}/turns`),
          fetch(`/api/court/cases/${encodeURIComponent(roomId)}/verdict`),
        ])
        const turnsData = await turnsRes.json() as { turns: CourtTurn[] }
        const verdictData = await verdictRes.json() as { verdict: CourtVerdict | null }
        if (!alive) return
        turnsData.turns.forEach((t) => seenTurnIds.current.add(t.id))
        setTurns(turnsData.turns)
        if (verdictData.verdict) { setVerdict(verdictData.verdict); setPhase('verdict') }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '加载案件失败')
      }
    })()
    return () => { alive = false }
  }, [isGuest, roomId, user?.userId])

  useEffect(() => () => { abortRef.current?.abort(); stopTts() }, [])

  // ===== 开始庭审（SSE 流） =====
  const startTrial = useCallback(async (payload: WizardStartPayload) => {
    if (!user?.userId) return
    setDefenders(payload.defenders)
    setPerspective(payload.perspective)
    setPhase('trial')
    setError('')
    setTurns([]); setRecord(null); setVerdict(null)
    seenTurnIds.current = new Set()

    // 拉取视角过滤后的案件（含标题 / 原被告角色），用于顶部栏与 3D 席位
    try {
      const res = await fetch(`/api/court/cases/${encodeURIComponent(payload.caseId)}?userId=${encodeURIComponent(user.userId)}&perspective=${encodeURIComponent(payload.perspective)}`)
      const data = await res.json() as { case?: CourtCase }
      if (data.case) setCourtCase(data.case)
    } catch { /* 3D 席位可在 SSE 事件到达后逐步补全 */ }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(`/api/court/cases/${encodeURIComponent(payload.caseId)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.userId,
          perspective: payload.perspective,
          defenderAssignments: payload.defenderAssignments,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(e.message ?? '庭审启动失败')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          try { handleTrialEvent(JSON.parse(raw) as CourtTrialEvent) } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : '庭审服务暂时不可用')
    }
  }, [user?.userId, handleTrialEvent])

  // ===== 视角切换：通知 WS，服务端单发过滤快照 =====
  const changePerspective = useCallback((p: Perspective) => {
    setPerspective(p)
    wsSend(JSON.stringify({ type: 'court_perspective', perspective: p }))
  }, [wsSend])

  // ===== 玩家输入 =====
  const submitInput = useCallback(async (input: TrialSubmitInput) => {
    if (!user?.userId || !caseId) return
    const playerRole = perspective === 'plaintiff' ? 'plaintiff' : 'defendant'
    try {
      await fetch(`/api/court/cases/${encodeURIComponent(caseId)}/player-input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, playerRole, type: input.type, content: input.content, evidenceName: input.evidenceName }),
      })
    } catch { /* fire-and-forget */ }
  }, [user?.userId, caseId, perspective])

  // ===== 发布到广场 =====
  const publish = useCallback(async () => {
    if (!user?.userId || !caseId || publishing) return
    setPublishing(true); setPublishStatus('正在发布…')
    try {
      const res = await fetch(`/api/court/cases/${encodeURIComponent(caseId)}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      const data = await res.json().catch(() => ({})) as { content?: unknown; message?: string }
      if (!res.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setPublishStatus('已发布到广场')
      window.setTimeout(onPublishToPlaza, 1000)
    } catch (e) {
      setPublishStatus(e instanceof Error ? e.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }, [user?.userId, caseId, publishing, onPublishToPlaza])

  const copyRoomLink = useCallback(() => {
    if (!caseId) return
    const link = `${window.location.origin}/?room=court:${encodeURIComponent(caseId)}`
    const done = () => { setCopyStatus('链接已复制'); window.setTimeout(() => setCopyStatus(''), 2000) }
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done).catch(() => { window.prompt('复制房间链接', link); done() })
    else { window.prompt('复制房间链接', link); done() }
  }, [caseId])

  // ===== 3D 席位 =====
  const seats = useMemo<CourtSeat[]>(() => {
    if (!courtCase) return []
    const latestTurn = turns[turns.length - 1]
    const seatList: CourtSeat[] = [
      {
        id: 'judge', name: '法官', role: 'judge',
        position: [0, 1.0, -2.9],
        active: latestTurn?.speaker === 'judge',
      },
      {
        id: courtCase.plaintiff?.id ?? 'plaintiff',
        name: courtCase.plaintiff?.name ?? '原告',
        role: 'plaintiff',
        position: [-2.7, 0.62, -0.4],
        side: 'plaintiff',
        active: latestTurn?.speaker === 'plaintiff',
      },
      {
        id: courtCase.defendant?.id ?? 'defendant',
        name: courtCase.defendant?.name ?? '被告',
        role: 'defendant',
        position: [2.7, 0.62, -0.4],
        side: 'defendant',
        active: latestTurn?.speaker === 'defendant',
      },
    ]
    // 辩护人席位：原告方排左侧，被告方排右侧
    let pIdx = 0, dIdx = 0
    for (const d of defenders) {
      const isP = d.side === 'plaintiff'
      const x = isP ? -3.9 - pIdx * 0.9 : 3.9 + dIdx * 0.9
      if (isP) pIdx++; else dIdx++
      seatList.push({
        id: d.id, name: d.name, role: 'defender', model: d.model,
        position: [x, 0.62, 0.4],
        side: d.side,
        active: latestTurn?.speaker === 'defender' && latestTurn.speakerId === d.id,
      })
    }
    return seatList
  }, [courtCase, turns, defenders])

  const statusLabel = courtCase ? STATUS_LABEL[courtCase.status] : '待开庭'

  return (
    <div className="cr-root">
      <div className="cr-canvas-wrap">
        <Suspense fallback={null}>
          <CourtroomView seats={seats} cameraMode={phase === 'wizard' ? 'wizard' : 'trial'} />
        </Suspense>
        {phase !== 'wizard' && <div className="cr-hint">拖动旋转 · 滚轮缩放</div>}
      </div>

      {phase === 'wizard' && <div className="cr-vignette" />}

      {wsStatusLabel(wsStatus, wsRetryCount) && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 99998, background: '#FFD600', color: '#1a1a1a', padding: '6px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
          {wsStatusLabel(wsStatus, wsRetryCount)}
        </div>
      )}

      {(phase === 'trial' || phase === 'verdict') && courtCase && (
        <div className="cr-ui cr-topbar">
          <div className="cr-topbar__title">
            <b>{courtCase.title || '趣味法庭'}</b>
            <span>案号 {courtCase.id.slice(0, 8)}</span>
          </div>
          <div className="cr-topbar__center">
            {courtCase.status === 'IN_PROGRESS' && (
              <span className="cr-pill cr-pill--live"><span className="cr-dot" /> 第 {courtCase.current_round || 1} 轮</span>
            )}
            <span className={`cr-pill ${courtCase.status === 'IN_PROGRESS' || courtCase.status === 'JUDGING' ? 'cr-pill--live' : 'cr-pill--gray'}`}>
              {statusLabel}
            </span>
          </div>
          <div className="cr-topbar__right">
            <span className="cr-pill"><Users size={12} /> {onlineCount} 人在线</span>
            <VoiceToggleButton className="cr-btn cr-btn--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} />
            <button type="button" className="cr-btn cr-btn--sm" onClick={copyRoomLink}><Link2 size={12} /> {copyStatus || '邀请他人'}</button>
            <button type="button" className="cr-btn cr-btn--sm" onClick={onBack}><ArrowLeft size={12} /> 返回</button>
          </div>
        </div>
      )}

      {phase === 'wizard' && (
        <CourtCreationWizard
          initialInput={caseText}
          onStart={(p) => void startTrial(p)}
          onSwitchToBench={onSwitchToBench}
          onBack={onBack}
        />
      )}

      {phase === 'trial' && (
        <>
          {error && <div className="cr-toast-msg" style={{ position: 'absolute', bottom: 280, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>{error}</div>}
          <CourtTrialPanel
            turns={turns}
            record={record}
            perspective={perspective}
            onPerspectiveChange={changePerspective}
            canInput={Boolean(courtCase && courtCase.status === 'IN_PROGRESS' && !isGuest)}
            onSubmitInput={(input) => void submitInput(input)}
            submittedMsg={submittedMsg}
          />
        </>
      )}

      {phase === 'verdict' && verdict && (
        <CourtVerdictPanel
          verdict={verdict}
          publishing={publishing}
          publishStatus={publishStatus}
          onPublish={() => void publish()}
          onBackToHall={onBack}
          onAgain={() => { setPhase('wizard'); setCourtCase(null); setTurns([]); setRecord(null); setVerdict(null); setDefenders([]) }}
        />
      )}
    </div>
  )
}
