import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowLeft, Archive, Mic, Paperclip, Plus, Send, SkipForward, X } from 'lucide-react'
import { CourtroomBackdrop, type ActiveSpeaker } from '../CourtroomBackdrop'
import { resolveCharacterVoice } from '@balabala/shared'
import { playTts, stopTts } from '../../tts'
import { getVoiceEnabled } from '../../voice-settings'
import { useReconnectingWebSocket } from '../../useReconnectingWebSocket'
import type { WSMessage } from '@balabala/shared'
import type {
  CourtCase, CourtRecordSummary, CourtRoleType, CourtTurn, CourtVerdict,
  EvidenceItem, Perspective, PlayerInput,
} from '../types'
import type { HttpCourtEngine } from '../http-engine'

const TURN_DELAY = 2400
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

type Phase = 'idle' | 'playing' | 'waiting' | 'judging' | 'error'

type Props = {
  courtCase: CourtCase
  engine: HttpCourtEngine
  initialPerspective: Perspective
  character?: unknown
  onVerdict: (verdict: CourtVerdict, backendCaseId?: string) => void
  onExit: () => void
  onOpenArchive: () => void
}

const ROLE_LABEL: Record<string, string> = { judge: '法官', plaintiff: '原告', defendant: '被告', defender: '辩护人', witness: '证人' }

export default function CourtroomLive({ courtCase, engine, initialPerspective, onVerdict, onExit, onOpenArchive }: Props) {
  const [perspective, setPerspective] = useState<Perspective>(initialPerspective)
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentRound, setCurrentRound] = useState(0)
  const [roundTurns, setRoundTurns] = useState<CourtTurn[]>([])
  const [turnIdx, setTurnIdx] = useState(0)
  const [allTurns, setAllTurns] = useState<CourtTurn[]>([])
  const [records, setRecords] = useState<CourtRecordSummary[]>([])
  const [playerInputs, setPlayerInputs] = useState<PlayerInput[]>([])
  const [draft, setDraft] = useState('')
  const [trialEvidence, setTrialEvidence] = useState<EvidenceItem[]>([])
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [verdictLoading, setVerdictLoading] = useState(false)
  const [submitFlash, setSubmitFlash] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [error, setError] = useState('')
  const [errorWhere, setErrorWhere] = useState<'trial' | 'verdict'>('trial')
  const [canContinueNext, setCanContinueNext] = useState(false)
  const [onlineCount, setOnlineCount] = useState(1)

  const appendedRef = useRef<Set<string>>(new Set())
  const busyRef = useRef(false)
  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- WS 多人同步 ----
  const caseId = engine.getCaseId()
  const wsUrl = () => {
    if (!caseId) return null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/api/ws?userId=live-host&room=court:${encodeURIComponent(caseId)}`
  }
  const { send: wsSend } = useReconnectingWebSocket({
    url: wsUrl,
    enabled: Boolean(caseId),
    onMessage: (raw: string) => {
      let msg: WSMessage
      try { msg = JSON.parse(raw) as WSMessage } catch { return }
      if (msg.type === 'welcome') setOnlineCount(msg.users.length)
      else if (msg.type === 'user_joined') setOnlineCount((n) => n + 1)
      else if (msg.type === 'user_left') setOnlineCount((n) => Math.max(1, n - 1))
    },
  })

  // ---- 回合循环 ----
  const startRound = async (round: number) => {
    setError('')
    try {
      const script = await engine.buildRound(courtCase, round, playerInputs)
      setRoundTurns(script.turns)
      setRecords((r) => [...r, script.record])
      setTurnIdx(0)
      setCurrentRound(round)
      setPhase('playing')
      // 查「是否继续」
      const cont = await engine.waitForContinue()
      setCanContinueNext(cont.shouldContinue)
    } catch (e) {
      setErrorWhere('trial')
      setError(e instanceof Error ? e.message : '庭审中断,请重试')
      setPhase('error')
    }
  }

  // 首次挂载:启动第 1 轮(buildRound 内部会 startTrial)。
  // 不在这里 dispose 引擎:引擎随 CourtFlow 存活;StrictMode 双挂载下 startTrial 幂等复用同一条 SSE。
  useEffect(() => {
    void startRound(1)
    return () => { stopTts() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动推进:每句停留 TURN_DELAY;玩家点画面可提前跳过
  useEffect(() => {
    if (phase !== 'playing' || roundTurns.length === 0) return
    const turn = roundTurns[turnIdx]
    if (turn && !appendedRef.current.has(turn.id)) {
      appendedRef.current.add(turn.id)
      setAllTurns((prev) => [...prev, turn])
      // TTS 朗读当前视角可见发言
      if (getVoiceEnabled()) {
        const voiceRef = turn.speaker === 'defender' ? (turn.speakerId ?? 'defender') : turn.speaker
        void playTts(turn.content, resolveCharacterVoice(voiceRef)).catch(() => {})
      }
    }
    const timer = window.setTimeout(() => {
      if (turnIdx < roundTurns.length - 1) setTurnIdx((i) => i + 1)
      else setPhase('waiting')
    }, TURN_DELAY)
    return () => window.clearTimeout(timer)
  }, [phase, turnIdx, roundTurns])

  // ---- 判决过场:真实 AI 判决,不可用则显式报错,绝不 mock 兜底 ----
  const startJudging = async () => {
    setPhase('judging')
    setVerdictLoading(true)
    setError('')
    try {
      const real = await engine.requestRealVerdict()
      setVerdictLoading(false)
      if (!real) throw new Error('未收到判决结果')
      onVerdict(real.verdict, real.backendCaseId)
    } catch (e) {
      setVerdictLoading(false)
      setErrorWhere('verdict')
      setError(e instanceof Error ? e.message : '真实 AI 判决不可用,请点击重试')
      setPhase('error')
    }
  }

  const retryJudging = () => void startJudging()

  // 点击画面 / 继续按钮:看完了就推进
  const advance = () => {
    if (phase === 'judging' || phase === 'idle' || phase === 'error' || busyRef.current) return
    if (phase === 'waiting') {
      busyRef.current = true
      const next = canContinueNext ? startRound(currentRound + 1) : startJudging()
      void next.finally(() => { busyRef.current = false })
      return
    }
    if (roundTurns.length === 0) return
    if (turnIdx < roundTurns.length - 1) setTurnIdx((i) => i + 1)
    else setPhase('waiting')
  }

  // ---- 补充观点/证据:真实 POST player-input ----
  const submitInput = () => {
    if (!draft.trim() && trialEvidence.length === 0) return
    const playerRole = perspective === 'defendant' ? 'defendant' : 'plaintiff'
    const type = trialEvidence.length > 0 ? 'evidence' : 'opinion'
    void engine.submitPlayerInput({
      playerRole,
      type: trialEvidence.length > 0 ? 'evidence' : 'argument',
      content: draft.trim() || '补充证据',
      evidenceName: trialEvidence[0]?.name,
    })
    setPlayerInputs((prev) => [...prev, {
      id: uid(), playerRole: perspective, type: type as 'opinion' | 'evidence',
      content: draft.trim() || '补充证据', evidence: trialEvidence.length > 0 ? trialEvidence : undefined,
      createdAt: new Date().toISOString(),
    }])
    setDraft('')
    setTrialEvidence([])
    setSubmitFlash(true)
    window.setTimeout(() => setSubmitFlash(false), 1600)
  }

  // ---- 语音输入 ----
  const toggleListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const rec = new SR()
    rec.lang = 'zh-CN'; rec.continuous = false; rec.interimResults = false
    rec.onresult = (e: any) => { const text = e.results[0][0].transcript; setDraft((d) => (d ? d + ' ' : '') + text) }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start(); recognitionRef.current = rec; setListening(true)
  }

  // ---- 证据上传 ----
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isImage = file.type.startsWith('image/')
    setTrialEvidence((prev) => [...prev, {
      id: uid(), type: isImage ? 'image' : 'document', name: file.name, size: file.size, mime: file.type,
    }])
    e.target.value = ''
  }

  // ---- 当前展示的发言 ----
  const rawSpeaker = phase === 'playing' && turnIdx < roundTurns.length ? roundTurns[turnIdx].speaker : undefined
  const currentSpeaker: ActiveSpeaker | null = rawSpeaker
    ? { speaker: rawSpeaker, speakerId: (roundTurns[turnIdx]?.speakerId) }
    : null
  const currentTurn = phase === 'playing' && turnIdx < roundTurns.length
    ? roundTurns[turnIdx]
    : allTurns[allTurns.length - 1]

  const changePerspective = (p: Perspective) => {
    setPerspective(p)
    wsSend(JSON.stringify({ type: 'court_perspective', perspective: p }))
  }

  const isAudience = perspective === 'audience'
  const continueLabel = phase === 'waiting'
    ? (canContinueNext ? `继续 · 第${currentRound + 1}轮` : '进入判决')
    : '继续'

  return (
    <div className="live-screen">
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

      {/* 3D 法庭全屏(当前工程 CourtroomView + 13 角色 + TRIAL_CAMERA) */}
      <CourtroomBackdrop courtCase={courtCase} activeSpeaker={currentSpeaker} />

      {/* 磨砂层:盖在 3D 上,点击即继续 */}
      {phase !== 'error' && <div className="live-frost" onClick={advance} aria-hidden="true" />}

      {/* 浮层顶条 */}
      <div className="live-topbar live-topbar--bare">
        <button className="live-topbar__back" onClick={onExit} aria-label="退出法庭">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/balabala-mark-dark.jpg" alt="叽里呱啦" className="court-brand-mark" />
        <span className="live-topbar__case">⚖ {courtCase.title}</span>
        <span className="live-topbar__spacer" />
        <span className="live-topbar__meta">
          第{Math.max(currentRound, 1)}轮
          {phase === 'playing' && <><span className="live-topbar__dot" />进行中</>}
          {phase === 'judging' && ' · 判决中'}
          {onlineCount > 1 && ` · ${onlineCount} 人在线`}
        </span>
        <button className="live-topbar__archive" onClick={onOpenArchive} aria-label="案卷库">
          <Archive size={15} /> 案卷
        </button>
      </div>

      {/* 判决过场遮罩 */}
      {phase === 'judging' && (
        <div className="live-judging">
          <div className="live-judging__icon">⚖️</div>
          <div className="live-judging__text">{verdictLoading ? '正在综合全部记录…' : '即将宣判…'}</div>
          <div className="live-hint">法官正在敲槌</div>
        </div>
      )}

      {/* 错误遮罩:显式报错,不 mock */}
      {phase === 'error' && (
        <div className="live-judging">
          <div className="court-error" style={{ maxWidth: 420 }}>{error || '庭审服务不可用'}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="court-btn court-btn--secondary" onClick={onExit}>退出法庭</button>
            <button className="court-btn court-btn--primary" onClick={() => { void (errorWhere === 'verdict' ? retryJudging() : startRound(currentRound)) }}>重试</button>
          </div>
        </div>
      )}

      {/* 底部坞 */}
      {phase !== 'judging' && phase !== 'error' && (
        <div className="live-dock">
          <div className="live-bubble">
            {currentTurn ? (
              <>
                <div className="live-bubble__head">
                  <span className={`live-bubble__role live-bubble__role--${currentTurn.speaker}`}>
                    {ROLE_LABEL[currentTurn.speaker] ?? currentTurn.speaker}
                  </span>
                  <span className="live-bubble__speaker">{currentTurn.speakerName}</span>
                </div>
                <p>{currentTurn.content}</p>
              </>
            ) : (
              <p style={{ color: 'var(--court-text-4)', margin: 0 }}>法庭准备中…</p>
            )}
          </div>

          <button className="live-transcript-toggle" onClick={() => setTranscriptOpen((v) => !v)}>
            {transcriptOpen ? '▴ 收起回合记录' : '▾ 展开完整回合记录'}（{allTurns.length}）
          </button>

          {transcriptOpen && (
            <div className="live-transcript">
              {allTurns.map((t) => (
                <div key={t.id} className="live-transcript__item">
                  <span className={t.speaker}>{ROLE_LABEL[t.speaker] ?? t.speaker}</span>
                  <span>{t.content}</span>
                </div>
              ))}
            </div>
          )}

          <div className="live-continue-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {submitFlash && <span className="live-hint">已提交,将在下一轮体现 ✓</span>}
            <span style={{ flex: 1 }} />
            <button
              className={`court-btn court-btn--sm live-continue-btn${phase === 'waiting' ? ' live-continue--active' : ''}`}
              onClick={advance}
            >
              <SkipForward size={14} /> {continueLabel}
            </button>
          </div>
        </div>
      )}

      {/* 补充输入:观众视角无输入框 */}
      {phase !== 'judging' && phase !== 'error' && !isAudience && !inputOpen && (
        <button className="live-input-fab" onClick={() => setInputOpen(true)} aria-label="补充观点或证据">
          <Plus size={22} />
        </button>
      )}
      {phase !== 'judging' && phase !== 'error' && inputOpen && !isAudience && (
        <div className="live-input-panel">
          <div className="live-input-panel__head">
            <span className="live-input-panel__label">补充观点 / 证据</span>
            <button className="live-input-panel__close" onClick={() => setInputOpen(false)} aria-label="收起">×</button>
          </div>
          <textarea
            className="live-input-panel__textarea"
            placeholder={perspective === 'defendant' ? '为被告方补充辩护观点或证据说明…' : '为原告方补充主张或证据说明…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          {trialEvidence.length > 0 && (
            <div className="live-input-panel__chips">
              {trialEvidence.map((ev) => (
                <span key={ev.id} className="court-chip">
                  <span>{ev.name}</span>
                  <button onClick={() => setTrialEvidence((prev) => prev.filter((e) => e.id !== ev.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="live-input-panel__actions">
            <button className="court-btn court-btn--ghost court-btn--sm" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={14} /> 证据
            </button>
            <button className="court-btn court-btn--ghost court-btn--sm" onClick={toggleListening}>
              <Mic size={14} /> {listening ? '停止' : '语音'}
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="court-btn court-btn--primary court-btn--sm"
              onClick={submitInput}
              disabled={!draft.trim() && trialEvidence.length === 0}
            >
              <Send size={14} /> 提交
            </button>
          </div>
          {submitFlash && <div className="live-hint" style={{ marginTop: 8 }}>已提交 ✓</div>}
        </div>
      )}

      {/* 视角 = 机位切换 */}
      <div className="live-perspective-switch">
        {(['plaintiff', 'audience', 'defendant'] as Perspective[]).map((p) => (
          <button key={p} className={perspective === p ? 'is-active' : ''} onClick={() => changePerspective(p)}>
            {p === 'plaintiff' ? '原告席' : p === 'audience' ? '观众席' : '被告席'}
          </button>
        ))}
      </div>
    </div>
  )
}
