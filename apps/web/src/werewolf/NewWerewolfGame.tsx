// 狼人杀新引擎对局组件：开局发身份 → 夜晚行动 → 白天动作牌 → 投票 → 结算。
// 叠加在 WerewolfView（3D）之上，所有可交互按钮带 data-testid 供 CDP 真实点击。
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Moon, Sun, X, Lightbulb, Skull, Ghost, Crown } from 'lucide-react'
import type { WerewolfDayAction, WerewolfRole } from '@balabala/shared'
import DayActionBar from './DayActionBar'
import SpectatorMode from './SpectatorMode'
import WerewolfRecap from './WerewolfRecap'
import { wwClient, type WwSnapshot } from './engine-client'

const WerewolfView = lazy(() => import('../WerewolfView'))

const WOLF_RED = '#ff2a3a'
const GOOD_GOLD = '#4fb3a5'
const BRAND_YELLOW = '#FFD600'

const ROLE_INFO: Record<WerewolfRole, { label: string; emoji: string; desc: string }> = {
  werewolf: { label: '狼人', emoji: '🐺', desc: '夜晚与队友刀人，白天伪装好人。' },
  seer: { label: '预言家', emoji: '🔮', desc: '每晚查验一人阵营。' },
  witch: { label: '女巫', emoji: '🧪', desc: '一瓶解药一瓶毒药。' },
  hunter: { label: '猎人', emoji: '🏹', desc: '出局时可开枪带人。' },
  villager: { label: '村民', emoji: '👤', desc: '靠发言投票找狼。' },
}

type Stage = 'loading' | 'playing' | 'ended'

export default function NewWerewolfGame({ onBack }: { onBack?: () => void }) {
  const [gameId, setGameId] = useState<string | null>(null)
  const [snap, setSnap] = useState<WwSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [daily, setDaily] = useState<{ title: string; description: string; reward: number } | null>(null)
  const [showTutorial, setShowTutorial] = useState(() => !window.location.search.includes('__e2e=1'))
  const [nightTarget, setNightTarget] = useState<number | null>(null)

  useEffect(() => {
    wwClient.daily().then((d) => setDaily(d)).catch(() => {})
    // 自动开局（?e2e=1 时用固定角色加速走查）
    const params = new URLSearchParams(window.location.search)
    const forceRole = params.get('ww-role') as WerewolfRole | null
    void startGame(forceRole ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startGame = useCallback(async (forceRole?: WerewolfRole) => {
    setBusy(true)
    try {
      const { id, snapshot } = await wwClient.newGame({ forceHumanRole: forceRole ?? undefined, humanThinkMs: 90_000 })
      setGameId(id)
      setSnap(snapshot)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '开局失败')
    } finally {
      setBusy(false)
    }
  }, [])

  const act = useCallback(async (body: Parameters<typeof wwClient.act>[1]) => {
    if (!gameId || busy) return
    setBusy(true)
    try {
      const { snapshot } = await wwClient.act(gameId, body)
      setSnap(snapshot)
      setNightTarget(null)
      if (snapshot.phase === 'results') setStageEnded()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }, [gameId, busy])

  const setStageEnded = () => { /* phase 驱动，无需额外状态 */ }

  if (busy && !snap) {
    return <div style={{ height: '100vh', background: '#0A0A0A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>发身份中…</div>
  }
  if (!snap) {
    return <div style={{ height: '100vh', background: '#0A0A0A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <button onClick={() => void startGame()} style={primaryBtn} data-testid="ww-start">开始游戏</button>
    </div>
  }

  const me = snap.players.find((p) => p.seat === snap.mySeat)
  const myRole = snap.myRole
  const roleInfo = myRole ? ROLE_INFO[myRole] : null
  const isNight = snap.sub?.startsWith('night')
  const isSpeech = snap.sub === 'speech'
  const isVote = snap.sub === 'vote'
  const isEnded = snap.phase === 'results' || snap.sub === 'ended'
  const aliveOthers = snap.players.filter((p) => p.alive && p.seat !== snap.mySeat)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0A', color: '#EDEDF0' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {onBack && <button onClick={onBack} style={headerBtn} data-testid="ww-back"><ArrowLeft size={16} /></button>}
        <span style={{ fontSize: 18, fontWeight: 700, color: BRAND_YELLOW }}>🐺 狼人杀</span>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>第 {snap.day} 天 · {isNight ? '🌙 夜晚' : isSpeech ? '🗣️ 发言' : isVote ? '🗳️ 投票' : isEnded ? '🏁 结束' : '☀️ 白天'}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowTutorial(true)} style={{ ...headerBtn, color: GOOD_GOLD }} data-testid="ww-help">
          <Lightbulb size={14} /> 玩法
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：3D 圆桌 */}
        <div style={{ flex: 1.4, position: 'relative', minWidth: 0, background: '#0a0a14' }}>
          <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: GOOD_GOLD }}>布置圆桌中…</div>}>
            <WerewolfView snapshot={null} />
          </Suspense>
          {snap.spectator && <SpectatorMode day={snap.day} />}
        </div>

        {/* 右：控制面板 */}
        <div style={{ width: 400, background: '#141414', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 身份牌 */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }} data-testid="ww-identity">
            <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)', letterSpacing: 1 }}>你的身份（私密）</div>
            {roleInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 28 }}>{roleInfo.emoji}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: myRole === 'werewolf' ? WOLF_RED : BRAND_YELLOW }}>{roleInfo.label}</div>
                  <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.55)' }}>{roleInfo.desc}</div>
                </div>
              </div>
            )}
            {snap.wolfTeammates && snap.wolfTeammates.length > 0 && (
              <div style={{ fontSize: 12, color: WOLF_RED, marginTop: 4 }}>狼队友：座位 {snap.wolfTeammates.map((s) => s + 1).join('、')}</div>
            )}
            {snap.seerResults && snap.seerResults.length > 0 && (
              <div style={{ fontSize: 12, color: GOOD_GOLD, marginTop: 4 }}>
                查验记录：{snap.seerResults.map((r) => `座位${r.seat + 1}=${r.isWolf ? '狼🐺' : '好人✅'}`).join('、')}
              </div>
            )}
          </div>

          {/* 每日挑战 */}
          {daily && (
            <div style={{ margin: '10px 16px', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.3)' }} data-testid="ww-daily">
              <span style={{ fontSize: 11, fontWeight: 700, color: BRAND_YELLOW }}>🎯 今日 · {daily.title}</span>
              <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.6)' }}>{daily.description}</div>
            </div>
          )}

          {/* 行动区 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', minHeight: 0 }} data-testid="ww-arena">
            {/* 夜晚行动 */}
            {isNight && !snap.spectator && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🌙 夜晚 —— {snap.pendingAction === 'night_kill' ? '选择你要刀的目标' : snap.pendingAction === 'night_check' ? '选择你要查验的目标' : '夜晚行动'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {aliveOthers.map((p) => (
                    <button key={p.seat} onClick={() => setNightTarget(p.seat)}
                      data-testid={`ww-night-target-${p.seat}`}
                      style={{
                        ...seatBtn,
                        borderColor: nightTarget === p.seat ? BRAND_YELLOW : 'rgba(255,255,255,0.12)',
                        background: nightTarget === p.seat ? 'rgba(255,214,10,0.15)' : 'rgba(255,255,255,0.03)',
                      }}>
                      {p.seat + 1}号
                    </button>
                  ))}
                </div>
                {snap.pendingAction === 'night_witch' && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(237,237,240,0.6)' }}>
                    昨晚倒牌：{snap.lastNightDeaths.length ? `座位 ${snap.lastNightDeaths.map((s) => s + 1).join('、')}` : '无人'}
                  </div>
                )}
                <button
                  onClick={() => {
                    if (snap.pendingAction === 'night_kill') void act({ kind: 'night_kill', target: nightTarget ?? 1 })
                    else if (snap.pendingAction === 'night_check') void act({ kind: 'night_check', target: nightTarget ?? 1 })
                    else if (snap.pendingAction === 'night_witch') void act({ kind: 'night_witch', heal: false, poison: nightTarget })
                    else void act({ kind: 'pass' })
                  }}
                  disabled={busy}
                  data-testid="ww-night-confirm"
                  style={{ ...primaryBtn, width: '100%', marginTop: 10, opacity: busy ? 0.5 : 1 }}>
                  确认夜晚行动
                </button>
              </div>
            )}

            {/* 白天动作牌 */}
            {isSpeech && !snap.spectator && (
              <DayActionBar
                players={snap.players as unknown as import('@balabala/shared').WerewolfPublicPlayer[]}
                mySeat={snap.mySeat ?? 0}
                myRole={snap.myRole}
                seerResults={snap.seerResults}
                secondsLeft={90}
                onAction={(action: WerewolfDayAction) => void act({ kind: 'day_action', action })}
              />
            )}
            {isSpeech && (
              <button onClick={() => void act({ kind: 'pass' })} disabled={busy}
                data-testid="ww-end-speech"
                style={{ ...primaryBtn, width: '100%', marginTop: 8, opacity: busy ? 0.5 : 1 }}>
                结束发言 → 投票
              </button>
            )}

            {/* 投票 */}
            {isVote && !snap.spectator && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🗳️ 投票放逐</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {aliveOthers.map((p) => (
                    <button key={p.seat} onClick={() => void act({ kind: 'day_vote', target: p.seat })}
                      data-testid={`ww-vote-${p.seat}`}
                      style={{ ...seatBtn }}>
                      投 {p.seat + 1}号
                    </button>
                  ))}
                </div>
                <button onClick={() => void act({ kind: 'day_vote', target: null })} disabled={busy}
                  data-testid="ww-vote-skip"
                  style={{ ...secondaryBtn, width: '100%', marginTop: 8 }}>
                  弃票
                </button>
              </div>
            )}

            {/* 日志 */}
            <div style={{ marginTop: 12, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.45)', marginBottom: 4 }}>对局记录</div>
              {snap.log.slice(-8).map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: 'rgba(237,237,240,0.7)', lineHeight: 1.5 }}>· {line}</div>
              ))}
            </div>
          </div>

          {/* 结算 */}
          {isEnded && snap.result && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,214,10,0.3)', background: 'rgba(255,214,10,0.06)' }} data-testid="ww-results">
              <div style={{ fontSize: 16, fontWeight: 800, color: snap.winner === 'good' ? GOOD_GOLD : WOLF_RED }}>
                {snap.winner === 'wolf' ? '🐺 狼人胜！' : '☀️ 好人胜！'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.7)', marginTop: 4 }}>
                段位：{snap.result.tier && typeof snap.result.tier === 'object' ? snap.result.tier.label : snap.result.tier} · 积分 {snap.result.rankPoints > 0 ? `+${snap.result.rankPoints}` : snap.result.rankPoints}
              </div>
              <button onClick={() => window.location.reload()} data-testid="ww-again" style={{ ...primaryBtn, width: '100%', marginTop: 10 }}>
                再来一局
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 新手引导 */}
      {showTutorial && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="ww-tutorial">
          <div style={{ width: 380, background: '#1a1a1a', border: `1px solid ${BRAND_YELLOW}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: BRAND_YELLOW }}>🐺 狼人杀 · 30 秒上手</span>
              <button onClick={() => setShowTutorial(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(237,237,240,0.85)' }}>
              <div>1️⃣ 看清你的身份（左侧私密牌）</div>
              <div>2️⃣ 夜晚：狼人刀人 / 预言家查验 / 女巫用药</div>
              <div>3️⃣ 白天：用动作牌起跳、报查验、怀疑某人</div>
              <div>4️⃣ 投票放逐你认为是狼的人</div>
              <div>5️⃣ 狼全死=好人胜；狼≥好人=狼胜</div>
            </div>
            <button onClick={() => setShowTutorial(false)} data-testid="ww-tutorial-skip" style={{ ...primaryBtn, width: '100%', marginTop: 16 }}>
              知道了，开局！
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const headerBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const seatBtn: React.CSSProperties = {
  padding: '8px 4px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
  color: '#EDEDF0', cursor: 'pointer', fontSize: 13, fontWeight: 600,
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: BRAND_YELLOW, border: 'none', borderRadius: 6,
  color: '#0A0A0A', fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
const secondaryBtn: React.CSSProperties = {
  padding: '8px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
  color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
