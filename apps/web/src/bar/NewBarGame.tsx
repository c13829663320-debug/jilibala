// 酒吧新引擎对局组件：准备页 → 3 回合辩论 → 裁决。
// 叠加在 BarView（3D）之上，所有可交互按钮带 data-testid 供 CDP 真实点击。
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Beer, Send, Scale, RotateCcw, Gavel, X, Lightbulb } from 'lucide-react'
import AngleChooser from './AngleChooser'
import TendencyMeter from './TendencyMeter'
import CounterPopup, { type PopupData } from './CounterPopup'
import type { ArgumentAngle, AngleEffectiveness } from './types'
import { ANGLE_META } from './types'
import { barClient, type BarSnapshot } from './engine-client'
import R5SettlementPanel, { type R5Bundle } from '../lib/r5'

const BarView = lazy(() => import('../BarView'))

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

type Side = 'pro' | 'con'
type Stage = 'prepare' | 'debating' | 'verdict'

const TOPIC_SUGGESTIONS = [
  '外卖迟到，该不该给差评？',
  'AI 会不会取代人类的工作？',
  '恋爱里，该不该看对方手机？',
  '年轻人该先攒钱还是先享受？',
  '加班到底是奋斗还是摸鱼？',
]

export default function NewBarGame({ onBack }: { onBack?: () => void }) {
  const [stage, setStage] = useState<Stage>('prepare')
  const [gameId, setGameId] = useState<string | null>(null)
  const [snap, setSnap] = useState<BarSnapshot | null>(null)
  const [topic, setTopic] = useState(TOPIC_SUGGESTIONS[0])
  const [playerSide, setPlayerSide] = useState<Side>('pro')
  const [selectedAngle, setSelectedAngle] = useState<ArgumentAngle | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [popup, setPopup] = useState<PopupData | null>(null)
  const [daily, setDaily] = useState<{ title: string; description: string; reward: number } | null>(null)
  const [r5, setR5] = useState<R5Bundle | null>(null)
  const [shareText, setShareText] = useState('')
  const [showTutorial, setShowTutorial] = useState(() => !window.location.search.includes('__e2e=1'))

  useEffect(() => {
    barClient.daily().then((d) => setDaily(d)).catch(() => {})
  }, [])

  const startGame = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const { id, snapshot } = await barClient.newGame({ topic, playerSide })
      setGameId(id)
      setSnap(snapshot)
      setSelectedAngle(null)
      setText('')
      setStage('debating')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '开桌失败')
    } finally {
      setBusy(false)
    }
  }, [busy, topic, playerSide])

  const submitTurn = useCallback(async () => {
    if (!gameId || !snap || busy) return
    if (!selectedAngle) { window.alert('先选一个攻击角度'); return }
    if (!text.trim()) { window.alert('写一句发言'); return }
    setBusy(true)
    try {
      const { snapshot } = await barClient.act(gameId, { kind: 'pick_angle', angle: selectedAngle, text: text.trim() })
      setSnap(snapshot)
      setR5(snapshot.r5 ?? null)
      setShareText(snapshot.shareText ?? '')
      // 克制飘字
      if (snapshot.angleEffectiveness) {
        setPopup({ effectiveness: snapshot.angleEffectiveness, key: Date.now() })
      }
      setSelectedAngle(null)
      setText('')
      if (snapshot.finished) setStage('verdict')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '发言失败')
    } finally {
      setBusy(false)
    }
  }, [gameId, snap, busy, selectedAngle, text])

  const reset = useCallback(() => {
    setStage('prepare')
    setSnap(null)
    setGameId(null)
    setSelectedAngle(null)
    setText('')
    setPopup(null)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0A', color: '#EDEDF0' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {onBack && <button onClick={onBack} style={headerBtn} data-testid="bar-back"><ArrowLeft size={16} /></button>}
        <span style={{ fontSize: 18, fontWeight: 700, color: YELLOW }}>🍺 酒吧辩论</span>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>新引擎 · 角度克制三角</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowTutorial(true)} style={{ ...headerBtn, color: TEAL }} data-testid="bar-help">
          <Lightbulb size={14} /> 玩法
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：3D 场景 */}
        <div style={{ flex: 1.4, position: 'relative', minWidth: 0, background: '#1a0f08' }}>
          <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEAL }}>布置酒吧中…</div>}>
            <BarView celebrities={[]} activeSpeakerId={null} />
          </Suspense>
          {busy && (
            <div style={{ position: 'absolute', left: 16, bottom: 16, padding: '8px 14px', background: 'rgba(40,20,8,0.85)', border: `1px solid ${TEAL}`, borderRadius: 8, fontSize: 13, color: TEAL }}>
              正在交锋…
            </div>
          )}
        </div>

        {/* 右：控制面板 */}
        <div style={{ width: 420, background: '#141414', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 准备页 */}
          {stage === 'prepare' && (
            <div style={{ padding: 18, overflowY: 'auto' }} data-testid="bar-prepare">
              {daily && (
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.3)' }} data-testid="bar-daily">
                  <div style={{ fontSize: 12, fontWeight: 700, color: YELLOW }}>🎯 今日挑战 · {daily.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.7)', marginTop: 2 }}>{daily.description}（奖励 {daily.reward}）</div>
                </div>
              )}
              <div style={sectionTitle}>选个辩题</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {TOPIC_SUGGESTIONS.map((t) => (
                  <button key={t} onClick={() => setTopic(t)}
                    data-testid={`bar-topic-${TOPIC_SUGGESTIONS.indexOf(t)}`}
                    style={{ ...topicBtn, borderColor: topic === t ? YELLOW : 'rgba(255,255,255,0.08)', background: topic === t ? 'rgba(255,214,10,0.1)' : 'transparent' }}>
                    {t}
                  </button>
                ))}
              </div>

              <div style={sectionTitle}>你站哪边</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={() => setPlayerSide('pro')} data-testid="bar-side-pro"
                  style={{ ...sideBtn, borderColor: playerSide === 'pro' ? YELLOW : 'rgba(255,255,255,0.15)', color: playerSide === 'pro' ? YELLOW : 'rgba(237,237,240,0.6)' }}>
                  正方（赞成）
                </button>
                <button onClick={() => setPlayerSide('con')} data-testid="bar-side-con"
                  style={{ ...sideBtn, borderColor: playerSide === 'con' ? TEAL : 'rgba(255,255,255,0.15)', color: playerSide === 'con' ? TEAL : 'rgba(237,237,240,0.6)' }}>
                  反方（反对）
                </button>
              </div>

              <button onClick={() => void startGame()} disabled={busy} data-testid="bar-start"
                style={{ ...primaryBtn, width: '100%', opacity: busy ? 0.5 : 1 }}>
                <Scale size={15} /> {busy ? '召集对方辩手…' : '开战！'}
              </button>
            </div>
          )}

          {/* 对局内 */}
          {stage !== 'prepare' && snap && (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'relative' }} data-testid="bar-arena">
                <CounterPopup popup={popup} />
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.6)', marginBottom: 2 }}>辩题 · 第 {Math.min(snap.round, 3)}/3 回合</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{snap.topic}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: YELLOW, fontWeight: 700 }}>我方 {Math.round(snap.balance.player)}</span>
                  <TendencyMeter tendency={stage === 'debating' ? snap.aiTendency : null} />
                  <span style={{ color: TEAL, fontWeight: 700 }}>对方 {Math.round(snap.balance.ai)}</span>
                </div>
                <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <div style={{ width: `${snap.strength[snap.playerSide]}%`, background: YELLOW, transition: 'width 0.8s ease' }} />
                  <div style={{ width: `${100 - snap.strength[snap.playerSide]}%`, background: TEAL, transition: 'width 0.8s ease' }} />
                </div>
              </div>

              {/* 发言记录 */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px', minHeight: 0 }} data-testid="bar-transcript">
                {snap.transcript.length === 0 && (
                  <div style={{ color: 'rgba(237,237,240,0.35)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                    你先立论吧 —— 选一个角度，写一句话
                  </div>
                )}
                {snap.transcript.map((t, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, marginBottom: 3, color: t.side === 'player' ? YELLOW : TEAL }}>
                      {t.speaker}{t.angle && <span style={{ marginLeft: 6, color: 'rgba(237,237,240,0.4)' }}>[{ANGLE_META[t.angle].emoji}{ANGLE_META[t.angle].title}]</span>}
                      {t.effectiveness && <span style={{ marginLeft: 6, color: t.effectiveness === 'counter' ? YELLOW : 'rgba(255,255,255,0.4)' }}>· {t.effectiveness === 'counter' ? '克制!' : t.effectiveness === 'neutral' ? '中性' : '同属性'}</span>}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>{t.text}</div>
                  </div>
                ))}
              </div>

              {/* 裁决 */}
              {stage === 'verdict' && snap.result && (
                <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,214,10,0.3)', background: 'rgba(255,214,10,0.06)' }} data-testid="bar-results">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Gavel size={16} color={YELLOW} />
                    <span style={{ fontSize: 14, fontWeight: 800, color: YELLOW }}>辩论结束</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: snap.humanWon ? YELLOW : TEAL }}>
                    {snap.humanWon ? '你赢了！🎉' : '对方略胜一筹'}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.75)', marginBottom: 6 }}>
                    段位：{typeof snap.result.tier === 'object' ? snap.result.tier.label : snap.result.tier} · 积分 {snap.result.rankPoints > 0 ? `+${snap.result.rankPoints}` : snap.result.rankPoints}
                  </div>
                  {snap.result.highlights.slice(0, 3).map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'rgba(237,237,240,0.6)', marginBottom: 2 }}>· {h}</div>
                  ))}
                </div>
              )}

              {/* 底部输入 */}
              <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                {stage === 'debating' && (
                  <>
                    <AngleChooser selected={selectedAngle} onSelect={setSelectedAngle} disabled={busy} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && selectedAngle) void submitTurn() }}
                        placeholder={selectedAngle ? `第 ${snap.round} 回合发言…` : '先选上方攻击角度，再发言…'}
                        disabled={!selectedAngle}
                        data-testid="bar-text"
                        style={{
                          ...inputStyle, marginBottom: 0, flex: 1,
                          opacity: selectedAngle ? 1 : 0.45,
                          cursor: selectedAngle ? 'text' : 'not-allowed',
                        }}
                      />
                      <button onClick={() => void submitTurn()} disabled={!text.trim() || !selectedAngle || busy}
                        data-testid="bar-submit"
                        style={{ ...primaryBtn, padding: '8px 12px', marginTop: 0, opacity: !text.trim() || !selectedAngle || busy ? 0.5 : 1 }}>
                        <Send size={14} />
                      </button>
                    </div>
                  </>
                )}
                {stage === 'verdict' && r5 && (
                  <R5SettlementPanel bundle={r5} shareText={shareText} onAgain={reset} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 新手引导浮层 */}
      {showTutorial && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="bar-tutorial">
          <div style={{ width: 380, background: '#1a1a1a', border: `1px solid ${YELLOW}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: YELLOW }}>🍺 酒吧辩论 · 30 秒上手</span>
              <button onClick={() => setShowTutorial(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(237,237,240,0.85)' }}>
              <div>1️⃣ 选边：正方赞成 / 反方反对</div>
              <div>2️⃣ 每回合选一张角度卡：📊数据 / ❤️情感 / 🔍逻辑</div>
              <div>3️⃣ 写一句话发言，点提交</div>
              <div>4️⃣ 克制三角：数据克情感、情感克理性、逻辑克混合 → 金色飘字 = 大优势</div>
              <div>5️⃣ 3 回合后你方强度 ≥55 即胜</div>
            </div>
            <button onClick={() => setShowTutorial(false)} data-testid="bar-tutorial-skip"
              style={{ ...primaryBtn, width: '100%', marginTop: 16 }}>
              知道了，开喝！
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: 'rgba(237,237,240,0.7)', margin: '14px 0 8px', letterSpacing: 1,
}
const headerBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const topicBtn: React.CSSProperties = {
  padding: '8px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
  color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
}
const sideBtn: React.CSSProperties = {
  flex: 1, padding: '8px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
  cursor: 'pointer', fontSize: 13,
}
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)', background: '#0F0F0F', color: '#EDEDF0', fontSize: 13, outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: YELLOW, border: 'none', borderRadius: 6,
  color: '#0A0A0A', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8,
}
