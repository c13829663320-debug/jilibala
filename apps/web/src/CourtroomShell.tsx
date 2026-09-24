import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback, type ChangeEvent } from 'react'
import { ArrowLeft, ChevronRight, Eye, Bot, Sparkles, Play, Scale, Upload, FileText, Gavel, WandSparkles, Users, Clock3, Check, Download, Link2 } from 'lucide-react'
import {
  CELEBRITIES, getCelebrity,
  type BenchEvent, type BenchMember, type BenchSpeech, type BenchStage,
  type Celebrity, type Perspective, type Verdict,
  type WSMessage, resolveCharacterVoice,
} from '@balabala/shared'
import { useIdentity } from './identity'
import { useReconnectingWebSocket, wsStatusLabel } from './useReconnectingWebSocket'
import BenchSelection from './BenchSelection'
import LiveTranscript from './LiveTranscript'
import TrialInteraction, { type TrialInteractPayload } from './TrialInteraction'
import VerdictCard from './VerdictCard'
import CourtroomM13 from './CourtroomM13'
import CourtFlow from './court/CourtFlow'
import { playTts, stopTts } from './tts'
import { getVoiceEnabled, VoiceToggleButton } from './voice-settings'

const CourtroomView = lazy(() => import('./CourtroomView'))

type HearingMode = 'quick' | 'evidence'
export type EvidenceMeta = { name: string; size: number; type: string }
type BenchPhase = 'config' | 'streaming' | 'verdict'

const STAGE_ORDER: BenchStage[] = ['forming', 'opening', 'debate', 'summary', 'verdict']
const STAGE_LABEL: Record<BenchStage, string> = {
  forming: '组建合议庭', opening: '开庭陈述', debate: '自由辩论', summary: '总结陈词', verdict: '宣判',
}

type UserSpeechEntry = { id: string; nickname: string; text: string; time: string }

export type CourtroomShellProps = {
  caseText: string
  onCaseTextChange: (v: string) => void
  hearingMode: HearingMode
  onHearingModeChange: (m: HearingMode) => void
  perspective: Perspective
  onPerspectiveChange: (p: Perspective) => void
  evidenceFiles: EvidenceMeta[]
  onEvidenceFilesChange: (f: EvidenceMeta[]) => void
  onOpenAvatarStudio: () => void
  onPublishToPlaza: () => void
  /** When set, the shell joins an existing court room as a guest via WS. */
  roomId?: string
  /** M13: 返回大厅（入口页）。缺省时回到入口页。 */
  onExitToEntry?: () => void
  /** M13 上传流程:打开案卷库视图。 */
  onOpenArchive?: () => void
}

export default function CourtroomShell({
  caseText, onCaseTextChange, hearingMode, onHearingModeChange, perspective, onPerspectiveChange,
  evidenceFiles, onEvidenceFilesChange, onOpenAvatarStudio, onPublishToPlaza, roomId, onExitToEntry, onOpenArchive,
}: CourtroomShellProps) {
  const { user } = useIdentity()
  // M13 默认全屏 3D 模式；旧名人合议庭模式作为可选入口。
  const [m13Mode, setM13Mode] = useState(true)
  const isGuest = Boolean(roomId)
  const [benchPhase, setBenchPhase] = useState<BenchPhase>(isGuest ? 'streaming' : 'config')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [members, setMembers] = useState<BenchMember[]>([])
  const [speeches, setSpeeches] = useState<BenchSpeech[]>([])
  const [currentStage, setCurrentStage] = useState<BenchStage>('forming')
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [votes, setVotes] = useState({ plaintiff: 0, defendant: 0 })
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [caseId, setCaseId] = useState(isGuest ? roomId! : '')
  const [isStreaming, setIsStreaming] = useState(isGuest)
  const [errorMessage, setErrorMessage] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [polishingCase, setPolishingCase] = useState(false)
  const [polishError, setPolishError] = useState('')
  const [showToast, setShowToast] = useState(false)
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealNote, setAppealNote] = useState('')
  const [certOpen, setCertOpen] = useState(false)

  // Multiplayer / room state
  const [wsOnlineCount, setWsOnlineCount] = useState(1)
  const [userSpeeches, setUserSpeeches] = useState<UserSpeechEntry[]>([])
  const [roomCopyStatus, setRoomCopyStatus] = useState('')

  const [avatarPrompt, setAvatarPrompt] = useState('卡通风格、穿红色法官袍的猫咪')
  const [avatarStatus, setAvatarStatus] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  const generatedTitle = useMemo(() => {
    const clean = caseText.trim()
    if (!clean) return '等待一个新案件'
    const firstSentence = clean.split(/[。！？!?\n]/)[0].trim()
    return (firstSentence.slice(0, 18) || '生活小事案')
  }, [caseText])

  useEffect(() => () => { abortRef.current?.abort(); stopTts() }, [])

  // ===== WebSocket room connection（指数退避自动重连） =====
  // Guest mode: connect to ?room=court:<id> immediately.
  // Host mode: connect after caseId is set (hearing started).
  const activeRoomId = isGuest ? roomId! : caseId
  const wsUrl = () => {
    if (!user?.userId || !activeRoomId) return null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=court:${encodeURIComponent(activeRoomId)}`
  }

  const { wsRef, send: wsSend, status: wsStatus, retryCount: wsRetryCount } = useReconnectingWebSocket({
    url: wsUrl,
    enabled: Boolean(user?.userId && activeRoomId),
    onMessage: (raw) => {
      let msg: WSMessage
      try { msg = JSON.parse(raw) as WSMessage } catch { return }
      switch (msg.type) {
        case 'welcome':
          setWsOnlineCount(msg.users.length)
          if (msg.courtState) applyCourtSnapshot(msg.courtState)
          break
        case 'user_joined':
          setWsOnlineCount((n) => n + 1)
          break
        case 'user_left':
          setWsOnlineCount((n) => Math.max(1, n - 1))
          break
        case 'court_snapshot':
          applyCourtSnapshot(msg.state)
          break
        case 'bench_event':
          handleBenchEvent(msg.event)
          break
        case 'user_speech':
          setUserSpeeches((prev) => [...prev.slice(-30), { id: `${Date.now()}-${Math.random()}`, nickname: msg.nickname, text: msg.text, time: new Date().toISOString() }])
          break
        case 'user_vote':
          setVotes((prev) => ({ ...prev, [msg.vote]: prev[msg.vote] + 1 }))
          break
      }
    },
  })

  /** Apply a court room snapshot (for late-joining guests). */
  const applyCourtSnapshot = useCallback((state: {
    phase: BenchPhase; members: BenchMember[]; speeches: BenchSpeech[]
    currentStage: BenchStage; votes: { plaintiff: number; defendant: number }
    verdict?: Verdict
  }) => {
    setMembers(state.members)
    setSpeeches(state.speeches)
    setCurrentStage(state.currentStage)
    setVotes(state.votes)
    if (state.verdict) setVerdict(state.verdict)
    setBenchPhase(state.phase === 'config' ? 'streaming' : state.phase)
    setIsStreaming(state.phase !== 'verdict')
  }, [])

  const copyRoomLink = useCallback(() => {
    const link = `${window.location.origin}/?room=court:${encodeURIComponent(activeRoomId)}`
    const done = () => { setRoomCopyStatus('链接已复制'); window.setTimeout(() => setRoomCopyStatus(''), 2000) }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(done).catch(() => { window.prompt('复制房间链接', link); done() })
    } else {
      window.prompt('复制房间链接', link)
      done()
    }
  }, [activeRoomId])

  // ===== AI 帮写 =====
  const polishCase = async () => {
    const input = caseText.trim()
    if (!input || polishingCase) return
    setPolishingCase(true); setPolishError('')
    try {
      const res = await fetch('/api/ai/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input, context: 'case' }) })
      const data = await res.json() as { result?: string; message?: string }
      if (!res.ok || !data.result) throw new Error(data.message ?? '润色失败')
      onCaseTextChange(data.result.slice(0, 120))
    } catch (e) { setPolishError(e instanceof Error ? e.message : '润色失败') }
    finally { setPolishingCase(false) }
  }

  // ===== 3D 分身生成（保留原 Tripo 接线） =====
  const generateAvatar = async () => {
    if (!avatarPrompt.trim()) return
    setAvatarStatus('提交中…'); setAvatarUrl('')
    try {
      const response = await fetch('/api/avatars/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text_to_model', prompt: avatarPrompt.trim() }) })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建任务失败')
      const taskId = data.taskId
      setAvatarStatus('已提交，正在生成…')
      const poll = async () => {
        const statusResponse = await fetch(`/api/avatars/tasks/${taskId}`)
        const task = (await statusResponse.json()) as { data?: { status?: string; output?: Record<string, string> }; status?: string; output?: Record<string, string> }
        const t = task.data ?? task
        if (t.status === 'success') { const output = t.output ?? {}; setAvatarUrl(output.pbr_model ?? output.model ?? output.mesh ?? ''); setAvatarStatus('生成完成'); return }
        if (t.status === 'failed') { setAvatarStatus('生成失败'); return }
        setAvatarStatus(`生成中… ${t.status ?? 'queued'}`)
        window.setTimeout(poll, 2500)
      }
      window.setTimeout(poll, 1200)
    } catch (error) { setAvatarStatus(error instanceof Error ? error.message : '生成失败') }
  }

  // ===== 启动庭审：建案 + POST SSE =====
  const startHearing = async (overrideInput?: string) => {
    const input = (overrideInput ?? caseText).trim()
    if (!input) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // 重置合议庭状态
    setMembers([]); setSpeeches([]); setVerdict(null); setCurrentStage('forming')
    setActiveSpeakerId(null); setVotes({ plaintiff: 0, defendant: 0 }); setErrorMessage('')
    setBenchPhase('streaming'); setIsStreaming(true); setShowToast(true)
    window.setTimeout(() => setShowToast(false), 2200)
    try {
      const created = await fetch('/api/cases', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, mode: hearingMode, perspective, evidence: evidenceFiles }),
      })
      if (!created.ok) { const e = await created.json().catch(() => ({})) as { message?: string }; throw new Error(e.message ?? '案件创建失败') }
      const { id } = await created.json() as { id: string }
      setCaseId(id)

      const response = await fetch(`/api/cases/${id}/bench/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celebrityIds: selectedIds, perspective, benchSize: selectedIds.length || 3 }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('庭审流连接失败')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          let event: BenchEvent
          try { event = JSON.parse(raw) as BenchEvent } catch { continue }
          handleBenchEvent(event)
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setIsStreaming(false)
        setErrorMessage(error instanceof Error ? error.message : '庭审服务暂时不可用')
      }
    }
  }

  const handleBenchEvent = (event: BenchEvent) => {
    switch (event.type) {
      case 'stage':
        setCurrentStage(event.stage); break
      case 'bench_members':
        setMembers(event.members); break
      case 'speech_start':
        setActiveSpeakerId(event.speakerId); break
      case 'speech':
        setSpeeches((prev) => [...prev, event.speech]); setActiveSpeakerId(event.speech.speakerId);
        // M13 第五轮：合议庭新发言自动朗读（受全局语音开关控制）。
        // 旁听者/观众不发言，不会进入 speech 事件。
        if (getVoiceEnabled()) {
          void playTts(event.speech.text, resolveCharacterVoice(event.speech.speakerId)).catch(() => {})
        }
        break
      case 'vote_update':
        setVotes({ plaintiff: event.plaintiff, defendant: event.defendant }); break
      case 'verdict':
        setVerdict(event.verdict); setSpeeches(event.transcript); setIsStreaming(false); setBenchPhase('verdict'); break
      case 'error':
        setErrorMessage(event.message); setIsStreaming(false); break
      case 'user_ack':
        break
    }
  }

  // ===== 用户互动（fire-and-forget） =====
  const sendInteraction = (payload: TrialInteractPayload) => {
    if (!caseId) return
    // Guest mode: send speech/vote via WS instead of POST
    if (isGuest) {
      if (payload.kind === 'vote' && payload.vote) {
        setVotes((prev) => ({ ...prev, [payload.vote as 'plaintiff' | 'defendant']: prev[payload.vote as 'plaintiff' | 'defendant'] + 1 }))
        wsSend(JSON.stringify({ type: 'user_vote', vote: payload.vote }))
      } else if (payload.text) {
        wsSend(JSON.stringify({ type: 'user_speech', text: payload.text }))
      }
      return
    }
    // Host mode: existing POST flow (server also broadcasts to WS room)
    if (payload.kind === 'vote' && payload.vote) {
      setVotes((prev) => ({ ...prev, [payload.vote as 'plaintiff' | 'defendant']: prev[payload.vote as 'plaintiff' | 'defendant'] + 1 }))
    }
    void fetch(`/api/cases/${caseId}/bench/interact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: payload.kind, text: payload.text, targetCelebrityId: payload.targetCelebrityId, evidenceName: payload.evidenceName, vote: payload.vote }),
    }).catch(() => { /* fire-and-forget */ })
  }

  // ===== 结束流程 =====
  const shareVerdict = async () => {
    setShareStatus('准备分享…')
    try {
      const response = await fetch(`/api/cases/${caseId}/share`, { method: 'POST' })
      const data = await response.json() as { shareUrl?: string; title?: string; quote?: string; message?: string }
      if (!response.ok || !data.shareUrl) throw new Error(data.message ?? '分享链接生成失败')
      const shareUrl = new URL(data.shareUrl, window.location.origin).toString()
      if (navigator.share) await navigator.share({ title: data.title ?? '叽里呱啦趣味法庭判决', text: data.quote ?? '', url: shareUrl })
      else { await navigator.clipboard.writeText(`${data.title ?? ''}\n${data.quote ?? ''}\n${shareUrl}`); setShareStatus('分享链接已复制') }
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '分享失败') }
    window.setTimeout(() => setShareStatus(''), 2800)
  }

  const publishCourt = async () => {
    setShareStatus('正在发布到广场…')
    try {
      const response = await fetch(`/api/cases/${caseId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await response.json() as { content?: unknown; message?: string }
      if (!response.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setShareStatus('已发布到广场')
      window.setTimeout(onPublishToPlaza, 900)
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '发布失败') }
    window.setTimeout(() => setShareStatus(''), 1600)
  }

  const beginAppeal = () => {
    const suffix = appealNote.trim() ? ` 上诉补充：${appealNote.trim()}` : ' 我对上一份判决提出复议。'
    const nextInput = `${caseText.replace(/\s+$/u, '')}${suffix}`.slice(0, 120)
    onCaseTextChange(nextInput)
    setAppealOpen(false); setAppealNote('')
    setBenchPhase('config')
    void startHearing(nextInput)
  }

  const toggleCelebrity = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id])
  }
  const autoSelect = (count: number) => {
    const pool = CELEBRITIES.filter((c) => !selectedIds.includes(c.id)).map((c) => c.id)
    setSelectedIds([...selectedIds, ...pool.slice(0, Math.max(0, count - selectedIds.length))])
  }

  const addEvidence = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).map((f) => ({ name: f.name, size: f.size, type: f.type }))
    if (files.length) onEvidenceFilesChange([...evidenceFiles, ...files].slice(0, 8))
    event.currentTarget.value = ''
  }

  const celebrities: Celebrity[] = members
    .map((m) => getCelebrity(m.celebrityId))
    .filter((c): c is Celebrity => Boolean(c))
  const stageIndex = STAGE_ORDER.indexOf(currentStage)

  // ===== M13 全屏 3D 模式（默认） =====
  if (m13Mode) {
    // M13 大合并:上传版上传 UI(CourtFlow 5 屏)+ 当前工程真实后端(HttpCourtEngine)。
    // 保留旧 CourtroomM13 文件与下方 bench 模式入口(m13Mode=false)。
    return (
      <CourtFlow
        onExit={onExitToEntry ?? (() => window.location.assign('/'))}
        onOpenArchive={onOpenArchive ?? (() => window.location.assign('/'))}
        onSwitchToBench={() => setM13Mode(false)}
      />
    )
  }

  return (
    <div className="workspace">
      <img src="/scenes/court.png" alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.16, zIndex: 0, pointerEvents: 'none' }} />
      {wsStatusLabel(wsStatus, wsRetryCount) && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99998, background: '#4fb3a5', color: '#1a1a1a', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {wsStatusLabel(wsStatus, wsRetryCount)}
        </div>
      )}
      {/* ===== 左侧配置栏 ===== */}
      <aside className="sidebar">
        {isGuest ? (
          <>
            <div className="eyebrow"><Eye size={14} /> 正在观赛</div>
            <h1>房间直播中</h1>
            <p className="intro">你已通过链接加入这场庭审，可以发表意见或站队投票。</p>
            <div className="divider" />
            <div className="section-title"><span>房间信息</span></div>
            <div className="sidebar-footer">
              <div><Users size={15} /> {wsOnlineCount} 人在线</div>
              <div><Gavel size={15} /> {members.length || '—'} 位名人</div>
            </div>
            {benchPhase === 'verdict' && verdict && (
              <>
                <div className="divider" />
                <div className="section-title"><span>判决结果</span></div>
                <p style={{ fontSize: 14, color: '#c8c8c0' }}>“{verdict.quote}”</p>
                <p style={{ fontSize: 13, color: '#9a9c92' }}>罪名：{verdict.charge}</p>
              </>
            )}
          </>
        ) : (
        <>
        <div className="eyebrow"><Sparkles size={14} /> 今日趣味法庭</div>
        <h1>把小事说清楚，<br /><span>让快乐继续发生。</span></h1>
        <p className="intro">输入一件生活小事，挑几位名人当合议庭，让他们替你辩个明白。</p>

        <label className="field-label" htmlFor="case">案件描述 · 客观叙述</label>
        <div className="textarea-wrap">
          <textarea id="case" value={caseText} onChange={(e) => onCaseTextChange(e.target.value)} placeholder="例如：谁把最后一块小蛋糕吃掉了？" maxLength={120} />
          <span>{caseText.length}/120</span>
        </div>
        <div className="polish-row">
          <button type="button" className="polish-button" onClick={() => void polishCase()} disabled={!caseText.trim() || polishingCase}>
            <Sparkles size={13} /> {polishingCase ? 'AI 润色中…' : '✨ AI 帮写'}
          </button>
          {polishError && <span className="polish-error">{polishError}</span>}
        </div>

        <div className="hearing-prep">
          <div className="prep-heading"><span>开庭方式</span><small>{hearingMode === 'evidence' ? '已带证据' : '轻装上庭'}</small></div>
          <div className="prep-segmented" role="tablist" aria-label="开庭方式">
            <button type="button" role="tab" aria-selected={hearingMode === 'quick'} className={hearingMode === 'quick' ? 'is-active' : ''} onClick={() => onHearingModeChange('quick')}>快速开庭</button>
            <button type="button" role="tab" aria-selected={hearingMode === 'evidence'} className={hearingMode === 'evidence' ? 'is-active' : ''} onClick={() => onHearingModeChange('evidence')}>带着证据开庭</button>
          </div>
          <div className="prep-heading prep-role-heading"><span>我的视角</span><small>AI 自动生成对手</small></div>
          <div className="perspective-grid" role="radiogroup" aria-label="我的视角">
            <button type="button" role="radio" aria-checked={perspective === 'plaintiff'} className={perspective === 'plaintiff' ? 'is-active' : ''} onClick={() => onPerspectiveChange('plaintiff')}><Scale size={14} /><span>原告</span><small>提出主张</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'defendant'} className={perspective === 'defendant' ? 'is-active' : ''} onClick={() => onPerspectiveChange('defendant')}><Bot size={14} /><span>被告</span><small>回应质疑</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'audience'} className={perspective === 'audience' ? 'is-active' : ''} onClick={() => onPerspectiveChange('audience')}><Eye size={14} /><span>观众</span><small>旁观站队</small></button>
          </div>
          <label className="evidence-dropzone" htmlFor="evidence-upload">
            <Upload size={15} /><span>{evidenceFiles.length ? `已选择 ${evidenceFiles.length} 份证据` : '添加聊天记录、图片或文件'}</span>
            <input id="evidence-upload" type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.zip" onChange={addEvidence} />
          </label>
          {evidenceFiles.length > 0 && (
            <div className="evidence-list">{evidenceFiles.map((file, i) => (
              <div className="evidence-chip" key={`${file.name}-${i}`}><FileText size={12} /><span title={file.name}>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => onEvidenceFilesChange(evidenceFiles.filter((_, idx) => idx !== i))}>×</button></div>
            ))}</div>
          )}
        </div>

        {benchPhase === 'config' && (
          <button className="primary-button" onClick={() => void startHearing()} disabled={!caseText.trim() || selectedIds.length < 3}>
            <Play size={17} fill="currentColor" /> 开始合议庭 <ChevronRight size={17} />
          </button>
        )}
        {errorMessage && <div className="error-message">{errorMessage}</div>}
        <div className="hint-row"><WandSparkles size={14} /> AI 会把你的故事变成一场有趣的名人辩论</div>

        <div className="avatar-builder">
          <div className="section-title"><span>创建 3D 分身</span><span className="phase-count">Tripo3D</span></div>
          <input value={avatarPrompt} onChange={(e) => setAvatarPrompt(e.target.value)} placeholder="例如：穿西装的赛博朋克律师" maxLength={120} />
          <button className="secondary-button" onClick={() => void generateAvatar()} disabled={!avatarPrompt.trim() || avatarStatus.startsWith('生成中') || avatarStatus === '提交中…'}><Sparkles size={14} /> 生成模型</button>
          <button className="secondary-button" onClick={onOpenAvatarStudio}>打开 3D 分身工坊</button>
          {avatarStatus && <div className="avatar-status">{avatarStatus}</div>}
          {avatarUrl && <a className="model-link" href={avatarUrl} target="_blank" rel="noreferrer">打开 GLB 模型文件</a>}
        </div>

        <div className="divider" />
        <div className="section-title"><span>庭审进度</span><span className="phase-count">{benchPhase === 'config' ? '待开庭' : `${stageIndex + 1} / ${STAGE_ORDER.length}`}</span></div>
        <div className="phase-list">{STAGE_ORDER.map((stage, i) => (
          <button key={stage} className={`phase-item ${currentStage === stage && benchPhase !== 'config' ? 'active' : ''} ${benchPhase !== 'config' && i < stageIndex ? 'done' : ''}`}>
            <span className={`phase-icon teal`}>{benchPhase !== 'config' && i < stageIndex ? <Check size={13} /> : i + 1}</span>
            <span>{STAGE_LABEL[stage]}</span>
            {currentStage === stage && benchPhase !== 'config' && <span className="live-pill">LIVE</span>}
          </button>
        ))}</div>
        <div className="sidebar-footer">
          <div><Users size={15} /> {members.length || selectedIds.length || '—'} 位名人</div>
          <div><Clock3 size={15} /> 约 {8 + members.length * 2} 分钟</div>
        </div>
        </>
        )}
      </aside>

      {/* ===== 右侧主舞台 ===== */}
      <section className="main-stage">
        <div className="stage-header">
          <div>
            <div className="stage-kicker"><span className="tiny-dot" /> {benchPhase === 'streaming' ? `正在进行 · ${STAGE_LABEL[currentStage]}` : benchPhase === 'verdict' ? '宣判完成' : '开庭准备'}</div>
            <h2>{generatedTitle}</h2>
            <div className="case-meta">
              <span>{hearingMode === 'evidence' ? '带证据开庭' : '快速开庭'}</span><span>·</span>
              <span>{perspective === 'audience' ? '观众视角' : perspective === 'plaintiff' ? '原告视角' : '被告视角'}</span>
              {evidenceFiles.length > 0 && <><span>·</span><span>{evidenceFiles.length} 份证据</span></>}
            </div>
          </div>
          <div className="stage-tools">
            <span className="scene-tag">3D 场景 · 趣味法庭</span>
            <VoiceToggleButton className="secondary-button" style={{ fontSize: 12, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(79,179,165,0.12)', color: '#4fb3a5', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
              <Users size={12} /> {wsOnlineCount} 人在线
            </span>
            {isGuest && (
              <button type="button" className="secondary-button" onClick={copyRoomLink} style={{ fontSize: 12, padding: '4px 12px' }}>
                <Link2 size={12} /> {roomCopyStatus || '复制房间链接'}
              </button>
            )}
            {!isGuest && benchPhase !== 'config' && (
              <button type="button" className="secondary-button" onClick={copyRoomLink} style={{ fontSize: 12, padding: '4px 12px' }}>
                <Link2 size={12} /> {roomCopyStatus || '邀请他人'}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onExitToEntry ?? (() => window.location.assign('/'))} style={{ fontSize: 12, padding: '4px 12px' }}>
              <ArrowLeft size={12} /> 退出法庭
            </button>
          </div>
        </div>

        {/* config：选合议庭 */}
        {benchPhase === 'config' && (
          <BenchSelection selectedIds={selectedIds} onToggle={toggleCelebrity} onAutoSelect={autoSelect} onConfirm={() => void startHearing()} minCount={3} maxCount={5} />
        )}

        {/* streaming：3D 法庭 + 实时记录 + 互动 */}
        {benchPhase === 'streaming' && (
          <>
            <div className="scene-card">
              <Suspense fallback={null}>
                <CourtroomView celebrities={celebrities} activeSpeakerId={activeSpeakerId} cameraMode="bench" />
              </Suspense>
              <div className="scene-overlay">
                <div className="camera-hint">拖动旋转 · 滚轮缩放</div>
                <div className="scene-corner"><Gavel size={13} /> 合议庭直播中</div>
              </div>
            </div>
            <div className="bench-live-grid">
              <LiveTranscript speeches={speeches} members={members} currentStage={currentStage} activeSpeakerId={activeSpeakerId} />
              <TrialInteraction perspective={perspective} members={members} disabled={isStreaming === false} votes={votes} onInteract={sendInteraction} />
            </div>
            {userSpeeches.length > 0 && (
              <div className="user-speeches-panel" style={{ marginTop: 12, background: 'rgba(79,179,165,0.05)', border: '1px solid rgba(79,179,165,0.2)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#4fb3a5', fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>观众发言</div>
                {userSpeeches.map((us) => (
                  <div key={us.id} style={{ marginBottom: 6, fontSize: 13, color: '#c8c8c0' }}>
                    <b style={{ color: '#f4f2ec' }}>{us.nickname}</b>：{us.text}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* verdict：判决 + 结束操作 */}
        {benchPhase === 'verdict' && (
          <>
            <div className="scene-card">
              <Suspense fallback={null}>
                <CourtroomView celebrities={celebrities} activeSpeakerId={null} cameraMode="bench" />
              </Suspense>
              <div className="scene-overlay">
                <div className="camera-hint">庭审结束</div>
                <div className="scene-corner"><Gavel size={13} /> 已归档</div>
              </div>
            </div>
            <div className="bench-verdict-grid">
              <VerdictCard verdict={verdict} transcript={speeches} onShare={() => void shareVerdict()} onPublish={() => void publishCourt()} onAppeal={() => setAppealOpen(true)} shareStatus={shareStatus} />
              <div className="cert-card">
                <h3>留下一份纪念</h3>
                <p>生成一张趣味法庭参与证书，截图保存或分享给朋友。</p>
                <button type="button" className="secondary-button" onClick={() => setCertOpen(true)}><Download size={14} /> 生成证书</button>
              </div>
            </div>
          </>
        )}
      </section>

      {showToast && <div className="toast"><Sparkles size={15} /> 合议庭已就位，欢迎开庭！</div>}

      {/* 上诉模态框 */}
      {appealOpen && (
        <div className="appeal-backdrop" onClick={() => setAppealOpen(false)}>
          <section className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="appeal-modal-head"><div><span className="micro-label">APPEAL HEARING</span><h2>发起二次上诉</h2></div><button type="button" className="icon-button" onClick={() => setAppealOpen(false)}>×</button></div>
            <p>保留原案卷事实，在下一轮庭审中加入一条新的理由或证据。</p>
            <textarea value={appealNote} onChange={(e) => setAppealNote(e.target.value)} placeholder="例如：补充医院诊断书，说明泡面导致肚子不舒服。" maxLength={100} />
            <div className="appeal-modal-actions">
              <button type="button" className="listen-button" onClick={() => setAppealOpen(false)}>稍后再说</button>
              <button type="button" className="send-button" onClick={beginAppeal}>确认上诉 <ChevronRight size={14} /></button>
            </div>
          </section>
        </div>
      )}

      {/* 证书模态框 */}
      {certOpen && (
        <div className="cert-backdrop" onClick={() => setCertOpen(false)}>
          <section className="certificate" onClick={(e) => e.stopPropagation()}>
            <div className="certificate__seal">⚖</div>
            <span className="micro-label">BALABALA SOCIAL COURT · CERTIFICATE</span>
            <h2>趣味法庭参与证书</h2>
            <p className="certificate__case">案件：{verdict?.title ?? generatedTitle}</p>
            <div className="certificate__members">
              <b>合议庭</b>
              <span>{members.map((m) => m.name).join(' · ') || '名人合议庭'}</span>
            </div>
            <blockquote>“{verdict?.quote ?? '把小事说清楚，让快乐继续发生。'}”</blockquote>
            <div className="certificate__foot">
              <span>原告/被告：{perspective === 'audience' ? '观众' : perspective === 'plaintiff' ? '原告' : '被告'}</span>
              <span>{new Date().toLocaleDateString('zh-CN')}</span>
            </div>
            <p className="certificate__hint">按 Ctrl/⌘ + P 或直接截图，把这份证书保存下来。</p>
            <button type="button" className="secondary-button" onClick={() => setCertOpen(false)}>关闭</button>
          </section>
        </div>
      )}
    </div>
  )
}
