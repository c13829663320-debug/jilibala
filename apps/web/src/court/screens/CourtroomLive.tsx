// CourtroomLive：趣味法庭「实时庭审」屏。
// 后端 start SSE 边跑边推：court_turn 逐条实时上屏 + TTS，玩家可随时插话
// （player-input + 乐观气泡），判决由 court_verdict 事件自动到来。
// 全程不做 mock 兜底：SSE 中断 / AI 不可用一律显式报错并允许重启。
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowLeft, Archive, Mic, Paperclip, Plus, Send } from 'lucide-react'
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
  CourtCase, CourtTurn, CourtVerdict, EvidenceItem, Perspective,
} from '../types'
import { backendVerdictToUi, type HttpCourtEngine } from '../http-engine'
import BalanceScale, { type Balance } from '../BalanceScale'
import PlayerHandCards from '../PlayerHandCards'
import EvidencePicker from '../EvidencePicker'

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

type Phase = 'live' | 'judging' | 'error'

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
  const [phase, setPhase] = useState<Phase>('live')
  const [currentRound, setCurrentRound] = useState(1)
  const [allTurns, setAllTurns] = useState<CourtTurn[]>([])
  const [draft, setDraft] = useState('')
  const [trialEvidence, setTrialEvidence] = useState<EvidenceItem[]>([])
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [submitFlash, setSubmitFlash] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [error, setError] = useState('')
  const [onlineCount, setOnlineCount] = useState(1)
  // 玩家驱动庭审：轮到玩家发言 / 局势优势条
  const [waitingForPlayer, setWaitingForPlayer] = useState(false)
  const [momentum, setMomentum] = useState<Balance>({ plaintiff: 50, defendant: 50 })
  const [lastDelta, setLastDelta] = useState(0)
  const [balanceReason, setBalanceReason] = useState('')
  const [cardTurn, setCardTurn] = useState<{ round: number; ammo: number } | null>(null)
  const [evPickerOpen, setEvPickerOpen] = useState(false)
  const [cardFlash, setCardFlash] = useState('')

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

  // ---- 实时上屏一条 AI turn（court_turn）+ TTS ----
  const appendLiveTurn = (t: CourtTurn) => {
    if (appendedRef.current.has(t.id)) return
    appendedRef.current.add(t.id)
    setAllTurns((prev) => [...prev, t])
    if (getVoiceEnabled()) {
      const voiceRef = t.speaker === 'defender' ? (t.speakerId ?? 'defender') : t.speaker
      void playTts(t.content, resolveCharacterVoice(voiceRef)).catch(() => {})
    }
  }

  // ---- 订阅 + 启动：严格「先注册监听并补齐已缓冲事件，再发起 SSE」----
  // 本地后端首批事件在 start 后约 0.01s 即返回；若「先启动后订阅」，StrictMode
  // remount 的空窗会让法官开场等首批事件无人接收而永久丢失（表现为一直「法庭准备中」）。
  useEffect(() => {
    setPhase('live')
    const unsub = engine.subscribe((ev) => {
      switch (ev.type) {
        case 'momentum_update':
          setMomentum({ ...ev.momentum })
          break
        case 'court_balance_update':
          setMomentum({ ...ev.balance }); setLastDelta(ev.lastDelta); setBalanceReason(ev.reason)
          break
        case 'court_player_turn':
          setCardTurn({ round: ev.round, ammo: ev.ammo }); setWaitingForPlayer(true)
          break
        case 'court_card_resolved':
          setCardFlash(`${ev.hit ? '命中' : '未命中'} · ${ev.judgeComment}`)
          window.setTimeout(() => setCardFlash(''), 1800)
          break
        case 'court_round_recap':
          setCardTurn(null); setWaitingForPlayer(false)
          break
        case 'court_status':
          if (ev.status === 'JUDGING') setPhase('judging')
          else if (typeof ev.round === 'number' && ev.round >= 1) setCurrentRound(ev.round)
          break
        case 'court_turn':
          appendLiveTurn(ev.turn)
          break
        case 'player_turn_request':
          // 非阻塞提示：展开输入面板、聚焦；AI 同时会继续自动推进。
          setWaitingForPlayer(true)
          setInputOpen(true)
          window.setTimeout(() => inputTextareaRef.current?.focus(), 60)
          break
        case 'player_turn': {
          // 玩家发言已上屏：用真实 turn 替换乐观气泡。
          setWaitingForPlayer(false)
          setInputOpen(false)
          const real = ev.turn
          setAllTurns((prev) => {
            const filtered = optimisticRef.current
              ? prev.filter((t) => !(t.speaker === 'player' && t.id === optimisticRef.current))
              : prev
            optimisticRef.current = null
            if (appendedRef.current.has(real.id)) return filtered
            appendedRef.current.add(real.id)
            return [...filtered, real]
          })
          break
        }
        case 'court_verdict':
          // 判决自动到来：转 UI 判决并切到判决页。
          stopTts()
          onVerdict(backendVerdictToUi(ev.verdict), engine.getCaseId())
          break
        case 'error':
          stopTts()
          setError(ev.message || '庭审服务中断')
          setPhase('error')
          break
        default:
          break
      }
    })
    // 补齐订阅前已到达、engine 已缓冲的 turns / 优势条（StrictMode remount 空窗兜底）。
    const snap = engine.getBufferedState()
    snap.turns.forEach((t) => appendLiveTurn(t))
    if (snap.momentum) setMomentum({ ...snap.momentum })
    // 监听已就位，再启动 SSE（幂等，StrictMode 双挂载安全）。
    engine.startTrial().catch((e) => {
      setError(e instanceof Error ? e.message : '庭审启动失败')
      setPhase('error')
    })
    return () => { unsub(); stopTts() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // ---- 出错后强制重启 SSE ----
  const restart = () => {
    setError('')
    setPhase('live')
    appendedRef.current = new Set()
    setAllTurns([])
    engine.restartTrial().catch((e) => {
      setError(e instanceof Error ? e.message : '庭审重启失败')
      setPhase('error')
    })
  }

  // ---- 玩家当庭发言：POST player-input + 乐观气泡立即上屏 ----
  const submitInput = () => {
    if (!draft.trim() && trialEvidence.length === 0) return
    // 玩家本人的席位：默认跟随当前视角（可随时切换原告/被告）。
    const playerRole: 'plaintiff' | 'defendant' = perspective === 'defendant' ? 'defendant' : 'plaintiff'
    const content = draft.trim() || '补充证据'
    void engine.submitPlayerInput({
      playerRole,
      type: trialEvidence.length > 0 ? 'evidence' : 'argument',
      content,
      evidenceName: trialEvidence[0]?.name,
    })
    // 乐观 turn：立即插入「你」的气泡，等 player_turn 事件替换成真实 turn。
    const optId = uid()
    optimisticRef.current = optId
    const optTurn: CourtTurn = {
      id: optId, round: currentRound, speaker: 'player', speakerId: 'player',
      speakerName: '你', content, isRecord: false, createdAt: new Date().toISOString(),
    }
    setAllTurns((prev) => [...prev, optTurn])
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

  // ---- 玩家出预制牌（Round2）----
  const playCard = (card: 'attack' | 'evidence' | 'mock' | 'request_record', freeText?: string) => {
    void engine.submitCard(card, { freeText })
  }
  const pickEvidence = (ev: EvidenceItem) => {
    setEvPickerOpen(false)
    void engine.submitCard('evidence', { targetEvidenceId: ev.id, freeText: ev.name })
  }

  // ---- 当前发言（实时 = 最新一条），驱动 3D 角色 ----
  const currentTurn = allTurns[allTurns.length - 1]
  const currentSpeaker: ActiveSpeaker | null = currentTurn
    ? { speaker: currentTurn.speaker, speakerId: currentTurn.speakerId }
    : null

  const changePerspective = (p: Perspective) => {
    setPerspective(p)
    wsSend(JSON.stringify({ type: 'court_perspective', perspective: p }))
  }

  return (
    <div className="live-screen">
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

      {/* 3D 法庭全屏（当前工程 CourtroomView + 角色 + TRIAL_CAMERA） */}
      <CourtroomBackdrop
        courtCase={courtCase}
        activeSpeaker={currentSpeaker}
        perspective={perspective}
        defenderAssignments={defenderAssignments}
        characterMap={characterMap}
      />

      {/* 磨砂层：纯视觉（实时模式无需点击推进） */}
      {phase !== 'error' && <div className="live-frost" aria-hidden="true" />}

      {/* 浮层顶条 */}
      <div className="live-topbar live-topbar--bare">
        <button className="live-topbar__back" onClick={onExit} aria-label="退出法庭">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" className="court-brand-mark" />
        <span className="live-topbar__case">⚖ {courtCase.title}</span>
        <span className="live-topbar__spacer" />
        <span className="live-topbar__meta">
          第{currentRound}轮
          {phase === 'live' && <><span className="live-topbar__dot" />进行中</>}
          {phase === 'judging' && ' · 判决中'}
          {onlineCount > 1 && ` · ${onlineCount} 人在线`}
        </span>
        <button className="live-topbar__archive" onClick={onOpenArchive} aria-label="案卷库">
          <Archive size={15} /> 案卷
        </button>
      </div>

      {/* 天平：左=原告(明黄) 右=被告(青绿)，滑动动画 + delta 飘字 */}
      {phase === 'live' && (
        <BalanceScale balance={momentum} lastDelta={lastDelta} reason={balanceReason} playerSide={courtCase.player_side} />
      )}

      {/* 轮到你出牌 */}
      {cardFlash && <div className="your-turn-banner">🃏 {cardFlash}</div>}
      {waitingForPlayer && !cardFlash && phase === 'live' && (
        <div className="your-turn-banner">🔔 轮到你出牌！选一张牌把天平推向你方</div>
      )}

      {/* 判决过场遮罩 */}
      {phase === 'judging' && (
        <div className="live-judging">
          <div className="live-judging__icon">⚖️</div>
          <div className="live-judging__text">正在综合全部记录…</div>
          <div className="live-hint">法官正在敲槌</div>
        </div>
      )}

      {/* 错误遮罩：显式报错，不 mock */}
      {phase === 'error' && (
        <div className="live-judging">
          <div className="court-error" style={{ maxWidth: 420 }}>{error || '庭审服务不可用'}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="court-btn court-btn--secondary" onClick={onExit}>退出法庭</button>
            <button className="court-btn court-btn--primary" onClick={restart}>重试</button>
          </div>
        </div>
      )}

      {/* 底部坞 */}
      {phase === 'live' && (
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

          {submitFlash && (
            <div className="live-continue-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="live-hint">已提交 ✓</span>
            </div>
          )}
        </div>
      )}

      {/* 预制牌手牌坞：轮到玩家出牌时展示，弹药不足的牌置灰 */}
      {phase === 'live' && courtCase.player_side && (
        <PlayerHandCards
          visible={Boolean(cardTurn)}
          ammo={cardTurn?.ammo ?? 0}
          onPlay={playCard}
          onPickEvidence={() => setEvPickerOpen(true)}
        />
      )}
      <EvidencePicker
        open={evPickerOpen}
        evidence={courtCase.evidence}
        onSelect={pickEvidence}
        onClose={() => setEvPickerOpen(false)}
      />

    </div>
  )
}
