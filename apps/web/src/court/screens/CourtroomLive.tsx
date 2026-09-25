import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowLeft, Archive, Mic, Paperclip, Plus, Send, SkipForward, X } from 'lucide-react'
import { CourtroomBackdrop, type ActiveSpeaker } from '../CourtroomBackdrop'
import { resolveCharacterVoice } from '@balabala/shared'
import { playTts, stopTts } from '../../tts'
import { getVoiceEnabled } from '../../voice-settings'
import { useReconnectingWebSocket } from '../../useReconnectingWebSocket'
import { useIdentity } from '../../identity'
import {
  celebrityListToUi, fetchMyCharacters, fetchPublicCharacters, type UiCharacter,
} from '../../custom-characters'
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
  defenderAssignments?: { plaintiff: string[]; defendant: string[] }
  onVerdict: (verdict: CourtVerdict, backendCaseId?: string) => void
  onExit: () => void
  onOpenArchive: () => void
}

const ROLE_LABEL: Record<string, string> = { judge: '法官', plaintiff: '原告', defendant: '被告', defender: '辩护人', witness: '证人', player: '你' }

export default function CourtroomLive({ courtCase, engine, initialPerspective, defenderAssignments, onVerdict, onExit, onOpenArchive }: Props) {
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
  // 玩家驱动庭审：轮到玩家发言 / 局势优势条
  const [waitingForPlayer, setWaitingForPlayer] = useState(false)
  const [momentum, setMomentum] = useState<{ plaintiff: number; defendant: number }>({ plaintiff: 50, defendant: 50 })

  // 被指派辅助人 → 3D 模型字典（名人 + 我的人物 + 广场人物）
  const { user } = useIdentity()
  const userId = user?.userId ?? ''
  const [characterMap, setCharacterMap] = useState<Map<string, UiCharacter>>(new Map())
  useEffect(() => {
    let alive = true
    Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()]).then(([mine, pub]) => {
      if (!alive) return
      const map = new Map<string, UiCharacter>()
      for (const c of celebrityListToUi()) map.set(c.id, c)
      for (const c of mine) map.set(c.id, c)
      for (const c of pub) if (!map.has(c.id)) map.set(c.id, c)
      setCharacterMap(map)
    })
    return () => { alive = false }
  }, [userId])

  const appendedRef = useRef<Set<string>>(new Set())
  const busyRef = useRef(false)
  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputTextareaRef = useRef<HTMLTextAreaElement>(null)
  const optimisticRef = useRef<string | null>(null)

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

  // ---- 实时订阅：玩家驱动庭审（player_turn_request / momentum_update / player_turn）----
  useEffect(() => {
    const unsub = engine.subscribe((ev) => {
      switch (ev.type) {
        case 'momentum_update':
          setMomentum({ ...ev.momentum })
          break
        case 'player_turn_request':
          // 轮到玩家发言：自动展开输入面板、聚焦、高亮提示。
          setWaitingForPlayer(true)
          setInputOpen(true)
          window.setTimeout(() => inputTextareaRef.current?.focus(), 60)
          break
        case 'player_turn': {
          // 玩家发言已上屏：用真实 turn 替换乐观气泡。
          setWaitingForPlayer(false)
          setInputOpen(false)
          const real: CourtTurn = {
            id: ev.turn.id, round: ev.turn.round, speaker: ev.turn.speaker,
            speakerId: ev.turn.speakerId, speakerName: ev.turn.speakerName,
            content: ev.turn.content, referencedEvidence: ev.turn.referenced_evidence,
            responseTo: ev.turn.response_to_turn_id, isRecord: false, createdAt: ev.turn.createdAt,
          }
          setAllTurns((prev) => {
            // 去掉同内容的乐观气泡，换成真实 turn（带真 id）
            const filtered = optimisticRef.current
              ? prev.filter((t) => !(t.speaker === 'player' && t.id === optimisticRef.current))
              : prev
            if (appendedRef.current.has(real.id)) return filtered
            appendedRef.current.add(real.id)
            return [...filtered, real]
          })
          break
        }
        default:
          break
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

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
      if (busyRef.current) return
      busyRef.current = true
      const next = canContinueNext ? startRound(currentRound + 1) : startJudging()
      void next.finally(() => { busyRef.current = false })
      return
    }
    if (roundTurns.length === 0) return
    if (turnIdx < roundTurns.length - 1) setTurnIdx((i) => i + 1)
    else setPhase('waiting')
  }
  // 轮间自动推进已移除：AI 轮播完后停在 waiting，玩家点「继续」才进下一轮/判决。
  // （玩家驱动庭审节奏由玩家掌控，不再 1600ms 自动跳走。）

  // ---- 玩家当庭发言：POST player-input + 乐观气泡立即上屏 ----
  const submitInput = () => {
    if (!draft.trim() && trialEvidence.length === 0) return
    // 玩家本人的席位：默认跟随 perspective（CourtFlow 已按 player_side 初始化）。
    const playerRole: 'plaintiff' | 'defendant' = perspective === 'defendant' ? 'defendant' : 'plaintiff'
    const content = draft.trim() || '补充证据'
    void engine.submitPlayerInput({
      playerRole,
      type: trialEvidence.length > 0 ? 'evidence' : 'argument',
      content,
      evidenceName: trialEvidence[0]?.name,
    })
    // 乐观 turn：立即在 transcript 插入「你」的气泡，等 player_turn 事件替换成真实 turn。
    const optId = uid()
    optimisticRef.current = optId
    const optTurn: CourtTurn = {
      id: optId, round: currentRound, speaker: 'player', speakerId: 'player',
      speakerName: '你', content, isRecord: false, createdAt: new Date().toISOString(),
    }
    setAllTurns((prev) => [...prev, optTurn])
    setPlayerInputs((prev) => [...prev, {
      id: uid(), playerRole: perspective, type: (trialEvidence.length > 0 ? 'evidence' : 'opinion') as 'opinion' | 'evidence',
      content, evidence: trialEvidence.length > 0 ? trialEvidence : undefined,
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
      <CourtroomBackdrop
        courtCase={courtCase}
        activeSpeaker={currentSpeaker}
        perspective={perspective}
        defenderAssignments={defenderAssignments}
        characterMap={characterMap}
      />

      {/* 磨砂层:盖在 3D 上,点击即继续 */}
      {phase !== 'error' && <div className="live-frost" onClick={advance} aria-hidden="true" />}

      {/* 浮层顶条 */}
      <div className="live-topbar live-topbar--bare">
        <button className="live-topbar__back" onClick={onExit} aria-label="退出法庭">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" className="court-brand-mark" />
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

      {/* 局势优势条：左=原告(明黄) 右=被告(青绿)，宽度随 momentum 平滑动画 */}
      {phase !== 'judging' && phase !== 'error' && (
        <div className="momentum-bar" aria-label="局势优势条">
          <span className="momentum-bar__side momentum-bar__side--plaintiff">原告 {momentum.plaintiff}</span>
          <div className="momentum-bar__track">
            <div
              className="momentum-bar__fill"
              style={{ width: `${momentum.plaintiff}%`, background: '#FFD60A', transition: 'width 0.6s ease' }}
            />
          </div>
          <span className="momentum-bar__side momentum-bar__side--defendant">{momentum.defendant} 被告</span>
        </div>
      )}

      {/* 轮到你发言：高亮提示条 */}
      {waitingForPlayer && (
        <div className="your-turn-banner">🔔 轮到你发言了！在下方输入框陈述你的主张</div>
      )}

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
          <div className="live-perspective-switch">
            {(['plaintiff', 'audience', 'defendant'] as Perspective[]).map((p) => (
              <button key={p} className={perspective === p ? 'is-active' : ''} onClick={() => changePerspective(p)}>
                {p === 'plaintiff' ? '原告席' : p === 'audience' ? '观众席' : '被告席'}
              </button>
            ))}
          </div>
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
            {submitFlash && <span className="live-hint">已提交 ✓</span>}
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

      {/* 玩家发言输入面板：玩家是当事人，始终可发言（不再因观众席隐藏） */}
      {phase !== 'judging' && phase !== 'error' && !inputOpen && (
        <button className="live-input-fab" onClick={() => setInputOpen(true)} aria-label="当庭发言">
          <Plus size={22} />
        </button>
      )}
      {phase !== 'judging' && phase !== 'error' && inputOpen && (
        <div className={`live-input-panel${waitingForPlayer ? ' live-input-panel--urgent' : ''}`}>
          <div className="live-input-panel__head">
            <span className="live-input-panel__label">{waitingForPlayer ? '🔔 轮到你发言' : '当庭发言 / 证据'}</span>
            <button className="live-input-panel__close" onClick={() => setInputOpen(false)} aria-label="收起">×</button>
          </div>
          <textarea
            ref={inputTextareaRef}
            className="live-input-panel__textarea"
            placeholder={perspective === 'defendant' ? '以你（被告）的口吻陈述辩护观点或证据…' : '以你（原告）的口吻陈述主张或证据…'}
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

    </div>
  )
}
