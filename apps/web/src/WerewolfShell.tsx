import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Users, Moon, Sun, Vote, Skull, Crown, Send, Upload, Timer } from 'lucide-react'
import { useIdentity } from './identity'
import { useReconnectingWebSocket, wsStatusLabel } from './useReconnectingWebSocket'
import type {
  WerewolfPlayerSnapshot, WerewolfBroadcastEvent, WerewolfClientAction,
  WerewolfPublicPlayer, WerewolfReportData, WerewolfRole, WSMessage,
} from '@balabala/shared'

const WerewolfView = lazy(() => import('./WerewolfView'))

const WOLF_RED = '#ff2a3a'
const GOOD_GOLD = '#4fb3a5'

const ROLE_INFO: Record<WerewolfRole, { label: string; emoji: string; desc: string }> = {
  werewolf: { label: '狼人', emoji: '🐺', desc: '夜晚与队友商议刀人目标，白天伪装成好人搅浑局势。' },
  seer: { label: '预言家', emoji: '🔮', desc: '每晚可查验一名玩家的阵营（好人/狼人）。' },
  witch: { label: '女巫', emoji: '🧪', desc: '拥有一瓶解药（救人）和一瓶毒药（毒人），每晚二选一。' },
  hunter: { label: '猎人', emoji: '🏹', desc: '被刀或被票出局时，可开枪带走任意一名玩家。' },
  villager: { label: '村民', emoji: '👤', desc: '无特殊技能，依靠发言与投票找出隐藏的狼人。' },
}

const PHASE_LABEL: Record<string, { emoji: string; text: string }> = {
  lobby: { emoji: '🚪', text: '大厅等待' },
  night: { emoji: '🌙', text: '夜晚' },
  day_announce: { emoji: '☀️', text: '白天公布' },
  speech: { emoji: '🗣️', text: '白天发言' },
  vote: { emoji: '🗳️', text: '投票' },
  ended: { emoji: '🏁', text: '游戏结束' },
}

export default function WerewolfShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  // ===== 游戏状态 =====
  const [gameId, setGameId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('werewolf')
  })
  const [snapshot, setSnapshot] = useState<WerewolfPlayerSnapshot | null>(null)
  const [onlineCount, setOnlineCount] = useState(1)
  const [report, setReport] = useState<WerewolfReportData | null>(null)
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState('')

  // ===== 本地 UI 状态 =====
  const [speechText, setSpeechText] = useState('')
  const [selKillTarget, setSelKillTarget] = useState<number | null>(null)
  const [selCheckTarget, setSelCheckTarget] = useState<number | null>(null)
  const [witchHeal, setWitchHeal] = useState(false)
  const [selPoisonTarget, setSelPoisonTarget] = useState<number | null>(null)
  const [selVoteTarget, setSelVoteTarget] = useState<number | null>(null)
  const [selHunterTarget, setSelHunterTarget] = useState<number | null>(null)

  // ===== 发送 WS 行动 =====
  const { wsRef, send: wsSend, status: wsStatus, retryCount: wsRetryCount } = useReconnectingWebSocket({
    url: () => {
      if (!gameId || !user?.userId) return null
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=werewolf:${encodeURIComponent(gameId)}`
    },
    enabled: Boolean(gameId && user?.userId),
    onOpen: () => {
      // 重连成功后拉一次最新快照，恢复房间状态
      if (gameId && user?.userId) void fetchSnapshot(gameId, user.userId)
    },
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
        case 'werewolf_snapshot':
          setSnapshot(msg.snapshot)
          break
        case 'werewolf_event':
          handleEvent(msg.event)
          break
      }
    },
  })

  const sendAction = useCallback((action: WerewolfClientAction) => {
    wsSend(JSON.stringify({ type: 'werewolf_action', action }))
  }, [wsSend])

  // ===== 获取最新快照 =====
  const fetchSnapshot = useCallback(async (gid: string, uid: string) => {
    try {
      const res = await fetch(`/api/werewolf/${encodeURIComponent(gid)}/state?userId=${encodeURIComponent(uid)}`)
      if (!res.ok) return
      const data = await res.json() as WerewolfPlayerSnapshot
      setSnapshot(data)
    } catch { /* ignore */ }
  }, [])

  // ===== 创建 + 加入房间 =====
  const createAndJoin = useCallback(async () => {
    if (!user?.userId || creating) return
    setCreating(true)
    setErrorMsg('')
    try {
      const createRes = await fetch('/api/werewolf/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      const createData = await createRes.json() as { gameId?: string; message?: string }
      if (!createRes.ok || !createData.gameId) throw new Error(createData.message ?? '创建房间失败')
      const gid = createData.gameId

      const joinRes = await fetch(`/api/werewolf/${encodeURIComponent(gid)}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      if (!joinRes.ok) {
        const jd = await joinRes.json().catch(() => ({})) as { message?: string }
        throw new Error(jd.message ?? '加入房间失败')
      }
      setGameId(gid)
      await fetchSnapshot(gid, user.userId)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '创建房间失败')
    } finally {
      setCreating(false)
    }
  }, [user?.userId, creating, fetchSnapshot])

  // ===== 加入已有房间（从 URL） =====
  useEffect(() => {
    if (!gameId || !user?.userId) return
    let cancelled = false
    ;(async () => {
      try {
        const joinRes = await fetch(`/api/werewolf/${encodeURIComponent(gameId)}/join`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.userId }),
        })
        if (!cancelled && joinRes.ok) await fetchSnapshot(gameId, user.userId)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [gameId, user?.userId, fetchSnapshot])

  // ===== 处理广播事件 =====
  const handleEvent = useCallback((event: WerewolfBroadcastEvent) => {
    switch (event.type) {
      case 'game_end':
        if (event.report) setReport(event.report)
        break
      default:
        // 其他事件由 snapshot 自动推送更新，这里无需额外处理
        break
    }
  }, [])

  // ===== 开始游戏（房主） =====
  const startGame = async () => {
    if (!gameId || !user?.userId) return
    try {
      const res = await fetch(`/api/werewolf/${encodeURIComponent(gameId)}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string }
        setErrorMsg(d.message ?? '开始失败')
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '开始失败')
    }
  }

  // ===== 夜晚行动 =====
  const doNightKill = () => {
    if (selKillTarget == null) return
    sendAction({ type: 'night_kill', targetSeat: selKillTarget })
    setSelKillTarget(null)
  }
  const doNightCheck = () => {
    if (selCheckTarget == null) return
    sendAction({ type: 'night_check', targetSeat: selCheckTarget })
    setSelCheckTarget(null)
  }
  const doWitch = () => {
    sendAction({ type: 'night_witch', heal: witchHeal, poisonTargetSeat: selPoisonTarget })
    setWitchHeal(false)
    setSelPoisonTarget(null)
  }
  const doSpeech = () => {
    const text = speechText.trim()
    if (!text) return
    sendAction({ type: 'day_speech', text })
    setSpeechText('')
  }
  const doVote = (target: number | null) => {
    sendAction({ type: 'day_vote', targetSeat: target })
    setSelVoteTarget(null)
  }
  const doHunterShot = (target: number | null) => {
    sendAction({ type: 'hunter_shot', targetSeat: target })
    setSelHunterTarget(null)
  }

  // ===== 发布战报到广场 =====
  const publishToPlaza = async () => {
    if (!gameId || !user?.userId || publishing) return
    setPublishing(true)
    setPublishMsg('发布中…')
    try {
      const res = await fetch(`/api/werewolf/${encodeURIComponent(gameId)}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, title: '狼人杀战报', topics: ['狼人杀', '推理'] }),
      })
      const data = await res.json() as { content?: unknown; message?: string }
      if (!res.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setPublishMsg('已发布到广场')
      window.setTimeout(() => onPlaza?.(), 900)
    } catch (e) {
      setPublishMsg(e instanceof Error ? e.message : '发布失败')
    }
    window.setTimeout(() => setPublishing(false), 2000)
  }

  // ===== 再来一局 =====
  const restart = () => {
    setSnapshot(null)
    setReport(null)
    setGameId(null)
    setSelKillTarget(null)
    setSelCheckTarget(null)
    setSelVoteTarget(null)
    setSelHunterTarget(null)
    setWitchHeal(false)
    setSelPoisonTarget(null)
    setSpeechText('')
    setErrorMsg('')
  }

  // ===== 派生数据 =====
  const players = snapshot?.players ?? []
  const mySeat = snapshot?.mySeat
  const myRole = snapshot?.myRole
  const phase = snapshot?.phase ?? 'lobby'
  const day = snapshot?.day ?? 1
  const isHost = mySeat === 0
  const alivePlayers = players.filter((p) => p.alive)
  const myPlayer = players.find((p) => p.seat === mySeat)
  const isMyTurnSpeak = phase === 'speech' && snapshot?.currentSpeakerSeat === mySeat && myPlayer?.alive
  const hunterPending = myRole === 'hunter' && snapshot?.pendingAction === 'hunter_shot'

  const panel: React.CSSProperties = {
    background: '#141414', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14, padding: 14, backdropFilter: 'blur(8px)',
  }

  // ===== 大厅：未创建房间 =====
  if (!gameId) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0A0A0A', color: '#EDEDF0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🐺</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, color: WOLF_RED }}>狼人杀馆</h1>
          <p style={{ color: 'rgba(237,237,240,0.48)', fontSize: 14, marginBottom: 20 }}>9 人局 · 3 狼 + 预言家 + 女巫 + 猎人 + 3 村民</p>
          <p style={{ color: 'rgba(237,237,240,0.3)', fontSize: 13, marginBottom: 24 }}>夜晚圆桌，身份迷局，AI 名人陪玩</p>
          <button
            onClick={() => void createAndJoin()}
            disabled={creating}
            style={{ ...btn, background: '#EDEDF0', color: '#0A0A0A', fontWeight: 700, fontSize: 15, padding: '12px 32px', borderRadius: 10 }}
          >
            {creating ? '创建中…' : '创建房间'}
          </button>
          {errorMsg && <p style={{ color: WOLF_RED, fontSize: 13, marginTop: 12 }}>{errorMsg}</p>}
          <button onClick={onBack} style={{ ...btn, marginTop: 16, background: 'transparent', color: 'rgba(237,237,240,0.48)' }}>
            <ArrowLeft size={14} /> 返回入口
          </button>
        </div>
      </div>
    )
  }

  // ===== 游戏结束 =====
  if (phase === 'ended') {
    const winner = snapshot?.winner
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0A0A0A', color: '#EDEDF0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>
        <div style={{ width: 520, maxHeight: '90vh', overflowY: 'auto', ...panel }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 52 }}>{winner === 'wolf' ? '🐺' : '☀️'}</div>
            <h2 style={{ margin: '8px 0', fontSize: 26, color: winner === 'wolf' ? WOLF_RED : GOOD_GOLD }}>
              {winner === 'wolf' ? '狼人胜利' : '好人胜利'}
            </h2>
            <p style={{ color: 'rgba(237,237,240,0.48)', fontSize: 13 }}>共进行了 {report?.totalDays ?? day} 天</p>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '12px 0' }} />

          <h3 style={{ fontSize: 14, color: WOLF_RED, margin: '0 0 8px' }}>全员身份揭示</h3>
          <div>
            {report?.players ? report.players.map((rp) => {
              const info = ROLE_INFO[rp.role]
              return (
                <div key={rp.seat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: '#0F0F0F', borderRadius: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, width: 24, color: 'rgba(237,237,240,0.48)' }}>{rp.seat + 1}号</span>
                  <span style={{ fontSize: 14, flex: 1 }}>{rp.nickname}</span>
                  {info && <span style={{ fontSize: 13 }}>{info.emoji} {info.label}</span>}
                  {!rp.survived && <Skull size={14} color="rgba(237,237,240,0.3)" />}
                </div>
              )
            }) : players.map((p) => (
              <div key={p.seat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: '#0F0F0F', borderRadius: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, width: 24, color: 'rgba(237,237,240,0.48)' }}>{p.seat + 1}号</span>
                <span style={{ fontSize: 14, flex: 1 }}>{p.nickname}</span>
                {!p.alive && <Skull size={14} color="rgba(237,237,240,0.3)" />}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '12px 0' }} />
          <button onClick={() => void publishToPlaza()} disabled={publishing} style={{ ...btn, width: '100%', justifyContent: 'center', background: '#EDEDF0', color: '#0A0A0A', fontWeight: 700 }}>
            <Upload size={15} /> {publishMsg || '发布战报到广场'}
          </button>
          <button onClick={restart} style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 8, background: '#1A1A1A' }}>
            再来一局
          </button>
          {onPlaza && <button onClick={onPlaza} style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)' }}>
            去广场
          </button>}
        </div>
      </div>
    )
  }

  // ===== 游戏进行中 =====
  const phaseInfo = PHASE_LABEL[phase] ?? { emoji: '🎮', text: phase }
  const myInfo = myRole ? ROLE_INFO[myRole] : null
  const isNight = phase === 'night'

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0A0A0A', color: '#EDEDF0', fontFamily: 'inherit' }}>
      <img src="/scenes/werewolf.png" alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.2, zIndex: 0, pointerEvents: 'none' }} />
      {wsStatusLabel(wsStatus, wsRetryCount) && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99998, background: '#4fb3a5', color: '#1a1a1a', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {wsStatusLabel(wsStatus, wsRetryCount)}
        </div>
      )}
      {/* 3D 背景 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <Suspense fallback={null}>
          <WerewolfView snapshot={snapshot} />
        </Suspense>
      </div>

      {/* 顶栏 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', zIndex: 10 }}>
        <button onClick={onBack} style={{ ...btn, background: '#141414', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(237,237,240,0.7)' }}>
          <ArrowLeft size={15} /> 退出
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...pill, color: isNight ? '#7788cc' : GOOD_GOLD }}>
            {isNight ? <Moon size={13} /> : <Sun size={13} />} 第 {day} 天 · {phaseInfo.emoji} {phaseInfo.text}
          </span>
          <span style={{ ...pill }}><Users size={13} /> {onlineCount} 人在线</span>
          {onPlaza && <button onClick={onPlaza} style={{ ...btn, background: '#EDEDF0', color: '#0A0A0A', fontWeight: 700 }}>去广场</button>}
        </div>
      </div>

      {/* 大厅等待面板 */}
      {phase === 'lobby' && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 440, ...panel, zIndex: 20 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, color: WOLF_RED }}>🐺 等待玩家加入</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>9 人局 · 3 狼 + 预言家 + 女巫 + 猎人 + 3 村民</p>
          <div style={{ marginBottom: 12 }}>
            {players.map((p) => (
              <div key={p.seat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#0F0F0F', borderRadius: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, width: 28, color: 'rgba(237,237,240,0.48)' }}>{p.seat + 1}号</span>
                <span style={{ fontSize: 14, flex: 1 }}>{p.nickname}</span>
                {p.isAI && <span style={{ fontSize: 11, color: 'rgba(237,237,240,0.3)' }}>AI</span>}
              </div>
            ))}
          </div>
          {isHost ? (
            <button onClick={() => void startGame()} style={{ ...btn, width: '100%', justifyContent: 'center', background: '#EDEDF0', color: '#0A0A0A', fontWeight: 700, padding: '12px 0' }}>
              <Crown size={15} /> 开始游戏
            </button>
          ) : (
            <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(237,237,240,0.48)' }}>等待房主开始…</p>
          )}
          {errorMsg && <p style={{ color: WOLF_RED, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{errorMsg}</p>}
        </div>
      )}

      {/* 左侧面板：身份 + 行动 */}
      {phase !== 'lobby' && (
        <div style={{ position: 'absolute', left: 16, top: 64, bottom: 16, width: 320, overflowY: 'auto', zIndex: 10, ...panel }}>
          {/* 身份牌 */}
          {myInfo && myRole && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,42,58,0.06)', borderRadius: 10, border: '1px solid rgba(255,42,58,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 28 }}>{myInfo.emoji}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: WOLF_RED }}>{myInfo.label}</div>
                  <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.48)' }}>{myPlayer?.nickname} · {mySeat != null ? `${mySeat + 1}号` : ''}</div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(237,237,240,0.7)' }}>{myInfo.desc}</p>
              {/* 狼人队友 */}
              {myRole === 'werewolf' && snapshot?.wolfTeammates && snapshot.wolfTeammates.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: WOLF_RED }}>
                  🐺 狼队友：{snapshot.wolfTeammates.map((s) => `${s + 1}号`).join('、')}
                </div>
              )}
              {/* 预言家查验历史 */}
              {myRole === 'seer' && snapshot?.seerResults && snapshot.seerResults.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  <div style={{ color: 'rgba(237,237,240,0.48)', marginBottom: 2 }}>查验记录：</div>
                  {snapshot.seerResults.map((r, i) => (
                    <div key={i} style={{ color: r.isWolf ? WOLF_RED : GOOD_GOLD }}>
                      {r.day}天 · {r.seat + 1}号 → {r.isWolf ? '🐺狼人' : '☀️好人'}
                    </div>
                  ))}
                </div>
              )}
              {/* 女巫药水 */}
              {myRole === 'witch' && snapshot?.witchPotions && (
                <div style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 10 }}>
                  <span style={{ color: snapshot.witchPotions.heal ? '#4ecdc4' : '#555' }}>💊 解药{snapshot.witchPotions.heal ? '✓' : '✗'}</span>
                  <span style={{ color: snapshot.witchPotions.poison ? '#ff6b6b' : '#555' }}>☠️ 毒药{snapshot.witchPotions.poison ? '✓' : '✗'}</span>
                </div>
              )}
            </div>
          )}

          {/* 行动倒计时 */}
          {snapshot?.actionDeadlineMs && (
            <div style={{ marginBottom: 10, fontSize: 12, color: 'rgba(237,237,240,0.48)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Timer size={13} /> 行动截止：{new Date(snapshot.actionDeadlineMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}

          {/* 夜晚行动：狼人刀人 */}
          {isNight && myRole === 'werewolf' && (
            <ActionBlock title="🐺 选择刀人目标" hint="排除狼队友，点击一名存活玩家">
              {alivePlayers.filter((p) => !snapshot?.wolfTeammates?.includes(p.seat)).map((p) => (
                <TargetButton key={p.seat} seat={p.seat} nickname={p.nickname} selected={selKillTarget === p.seat} onClick={() => setSelKillTarget(selKillTarget === p.seat ? null : p.seat)} />
              ))}
              <button onClick={doNightKill} disabled={selKillTarget == null} style={{ ...btn, marginTop: 8, width: '100%', justifyContent: 'center', background: '#EDEDF0', color: '#0A0A0A' }}>
                确认刀人
              </button>
            </ActionBlock>
          )}

          {/* 夜晚行动：预言家查验 */}
          {isNight && myRole === 'seer' && (
            <ActionBlock title="🔮 查验身份" hint="选择一名存活玩家查验">
              {alivePlayers.map((p) => (
                <TargetButton key={p.seat} seat={p.seat} nickname={p.nickname} selected={selCheckTarget === p.seat} onClick={() => setSelCheckTarget(selCheckTarget === p.seat ? null : p.seat)} />
              ))}
              <button onClick={doNightCheck} disabled={selCheckTarget == null} style={{ ...btn, marginTop: 8, width: '100%', justifyContent: 'center', background: '#7e52c7', color: '#fff' }}>
                查验
              </button>
            </ActionBlock>
          )}

          {/* 夜晚行动：女巫 */}
          {isNight && myRole === 'witch' && (
            <ActionBlock title="🧪 女巫的夜晚" hint="每晚只能使用一瓶药水">
              {snapshot?.witchTonightKill != null && (
                <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,42,58,0.08)', borderRadius: 8, fontSize: 13 }}>
                  今晚 <b style={{ color: WOLF_RED }}>{snapshot.witchTonightKill + 1}号</b> 被袭击了
                </div>
              )}
              <button
                onClick={() => setWitchHeal(!witchHeal)}
                disabled={!snapshot?.witchPotions?.heal || snapshot?.witchTonightKill == null}
                style={{ ...btn, width: '100%', justifyContent: 'center', marginBottom: 6, background: witchHeal ? '#4ecdc4' : '#222', color: witchHeal ? '#000' : '#fff' }}
              >
                💊 使用解药救人
              </button>
              <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)', margin: '6px 0 4px' }}>☠️ 选择毒药目标：</div>
              {alivePlayers.map((p) => (
                <TargetButton key={p.seat} seat={p.seat} nickname={p.nickname} selected={selPoisonTarget === p.seat} onClick={() => setSelPoisonTarget(selPoisonTarget === p.seat ? null : p.seat)} />
              ))}
              <button onClick={doWitch} disabled={!witchHeal && selPoisonTarget == null} style={{ ...btn, marginTop: 8, width: '100%', justifyContent: 'center', background: '#ff6b6b', color: '#fff' }}>
                确认行动
              </button>
            </ActionBlock>
          )}

          {/* 白天发言 */}
          {phase === 'speech' && (
            isMyTurnSpeak ? (
              <ActionBlock title="🗣️ 你的发言" hint="陈述你的推理，然后提交">
                <textarea
                  value={speechText}
                  onChange={(e) => setSpeechText(e.target.value)}
                  placeholder="说说你的判断…"
                  maxLength={500}
                  rows={4}
                  style={textarea}
                />
                <button onClick={doSpeech} disabled={!speechText.trim()} style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center', background: '#EDEDF0', color: '#0A0A0A', fontWeight: 700 }}>
                  <Send size={14} /> 提交发言
                </button>
              </ActionBlock>
            ) : (
              <ActionBlock title="🗣️ 正在发言" hint="">
                <p style={{ fontSize: 13, color: 'rgba(237,237,240,0.48)', margin: 0 }}>
                  {snapshot?.currentSpeakerSeat != null ? `${snapshot.currentSpeakerSeat + 1}号 正在发言…` : '等待发言…'}
                </p>
              </ActionBlock>
            )
          )}

          {/* 投票 */}
          {phase === 'vote' && myPlayer?.alive && (
            <ActionBlock title="🗳️ 投票" hint="选择一名玩家放逐，或弃权">
              {alivePlayers.filter((p) => p.seat !== mySeat).map((p) => (
                <TargetButton key={p.seat} seat={p.seat} nickname={p.nickname} selected={selVoteTarget === p.seat} onClick={() => { setSelVoteTarget(p.seat); doVote(p.seat) }} />
              ))}
              <button onClick={() => doVote(null)} style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center', background: '#1A1A1A' }}>
                弃权
              </button>
            </ActionBlock>
          )}

          {/* 猎人开枪 */}
          {hunterPending && (
            <ActionBlock title="🏹 猎人开枪" hint="你即将出局，选择带走一人">
              {alivePlayers.map((p) => (
                <TargetButton key={p.seat} seat={p.seat} nickname={p.nickname} selected={selHunterTarget === p.seat} onClick={() => { setSelHunterTarget(p.seat); doHunterShot(p.seat) }} />
              ))}
              <button onClick={() => doHunterShot(null)} style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center', background: '#1A1A1A' }}>
                不开枪
              </button>
            </ActionBlock>
          )}
        </div>
      )}

      {/* 右侧面板：日志 + 玩家状态 */}
      {phase !== 'lobby' && (
        <div style={{ position: 'absolute', right: 16, top: 64, bottom: 16, width: 340, display: 'flex', flexDirection: 'column', zIndex: 10, ...panel }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: WOLF_RED, marginBottom: 8 }}>📜 游戏日志</div>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
            {(!snapshot?.log || snapshot.log.length === 0) && <p style={{ fontSize: 12, color: 'rgba(237,237,240,0.3)' }}>游戏即将开始…</p>}
            {snapshot?.log?.slice().reverse().map((entry) => (
              <div key={entry.id} style={{ marginBottom: 8, padding: 8, background: '#0F0F0F', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.3)', marginBottom: 2 }}>
                  第{entry.day}天 · {PHASE_LABEL[entry.phase]?.text ?? entry.phase}
                  {entry.speakerSeat != null && ` · ${entry.speakerSeat + 1}号`}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.7)' }}>{entry.text}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(237,237,240,0.48)', marginBottom: 6 }}>玩家状态</div>
            {players.map((p) => (
              <div key={p.seat} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 12 }}>
                <span style={{ width: 24, color: p.alive ? '#9a9c92' : '#555' }}>{p.seat + 1}号</span>
                <span style={{ flex: 1, color: p.alive ? '#e0e0e0' : '#555', textDecoration: p.alive ? 'none' : 'line-through' }}>{p.nickname}</span>
                {!p.alive && <Skull size={12} color="rgba(237,237,240,0.3)" />}
                {p.isAI && <span style={{ fontSize: 10, color: 'rgba(237,237,240,0.3)' }}>AI</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, fontSize: 12, color: 'rgba(237,237,240,0.3)', background: '#141414', padding: '4px 14px', borderRadius: 20 }}>
        拖动旋转 · 滚轮缩放 · 夜晚悄声，白天发言
      </div>
    </div>
  )
}

/** 行动面板包装。 */
function ActionBlock({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, padding: 10, background: '#0F0F0F', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#EDEDF0', marginBottom: 2 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.3)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  )
}

/** 目标选择按钮。 */
function TargetButton({ seat, nickname, selected, onClick }: { seat: number; nickname: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px',
        marginBottom: 4, borderRadius: 6, cursor: 'pointer', fontSize: 13, textAlign: 'left',
        border: selected ? '1px solid rgba(79,179,165,0.42)' : '1px solid rgba(255,255,255,0.08)',
        background: selected ? 'rgba(79,179,165,0.13)' : '#0F0F0F',
        color: '#EDEDF0',
      }}
    >
      <span style={{ width: 22, color: 'rgba(237,237,240,0.48)' }}>{seat + 1}号</span>
      <span style={{ flex: 1 }}>{nickname}</span>
    </button>
  )
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
  background: '#1A1A1A', color: '#EDEDF0',
}
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: '#141414', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 20, padding: '4px 12px', fontSize: 12, color: 'rgba(237,237,240,0.7)',
}
const textarea: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.08)', background: '#0F0F0F', color: '#EDEDF0', fontSize: 13, outline: 'none', resize: 'vertical',
}
