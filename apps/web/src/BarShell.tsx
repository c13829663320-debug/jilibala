// ===== 酒吧辩论：玩家正式辩手 + 裁判裁决（P0 重构）=====
// 核心循环：选辩题选边（可押注虚拟金币）→ 3 回合（玩家立论 → 对方 AI 针对性反驳
// → 双向论据强度条更新）→ 苏格拉底裁判裁决胜负。
import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ArrowLeft, Beer, Users, Send, Scale, RotateCcw, Gavel, Coins, Vote } from 'lucide-react'
import { getCelebrity, type Celebrity } from '@balabala/shared'
import { useIdentity } from './identity'
import { submitGameResult } from './profile'
import AngleChooser from './bar/AngleChooser'
import TendencyMeter from './bar/TendencyMeter'
import CounterPopup, { type PopupData } from './bar/CounterPopup'
import type { ArgumentAngle, StanceTendency, AngleEffectiveness, ArgumentScore } from './bar/types'
import { ANGLE_META } from './bar/types'

const BarView = lazy(() => import('./BarView'))

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

type Side = 'pro' | 'con'
type Stage = 'prepare' | 'debating' | 'verdict'

interface Turn { round: number; speaker: string; side: Side | 'player'; text: string; angle?: ArgumentAngle }

const SIDE_LABEL: Record<Side, string> = { pro: '正方', con: '反方' }

export default function BarShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  const [stage, setStage] = useState<Stage>('prepare')
  const [topics, setTopics] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [customTopic, setCustomTopic] = useState('')

  const [playerSide, setPlayerSide] = useState<Side>('pro')
  const [betSide, setBetSide] = useState<Side | null>(null)
  const [coins, setCoins] = useState(100)

  const [round, setRound] = useState(1)
  const totalRounds = 3
  const [strength, setStrength] = useState({ pro: 50, con: 50 })
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [myText, setMyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiOpponent, setAiOpponent] = useState<{ id: string; name: string } | null>(null)
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)

  // 角度克制三角相关状态
  const [selectedAngle, setSelectedAngle] = useState<ArgumentAngle | null>(null)
  const [aiTendency, setAiTendency] = useState<StanceTendency | null>(null)
  const [popup, setPopup] = useState<PopupData | null>(null)
  const [lastScores, setLastScores] = useState<{ player: ArgumentScore; ai: ArgumentScore } | null>(null)

  const [verdict, setVerdict] = useState<{ winner: Side | 'tie'; reasoning: string; keyMoments: string[] } | null>(null)

  useEffect(() => {
    fetch('/api/bar/topics')
      .then(async (r) => (r.json() as Promise<{ topics: string[] }>))
      .then((d) => setTopics(d.topics))
      .catch(() => setTopics(['外卖迟到，该不该给差评？', 'AI 会不会取代人类的工作？', '恋爱里，该不该看对方手机？']))
  }, [])

  const activeTopic = customTopic.trim() || topic

  const startDebate = async () => {
    const t = activeTopic
    if (!t || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/bar/debate/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t, playerSide }),
      })
      const data = await res.json() as { state?: { topic: string; argumentStrength: { pro: number; con: number }; aiOpponent: { id: string; name: string }; aiTendency: StanceTendency }; message?: string }
      if (!res.ok || !data.state) throw new Error(data.message ?? '开桌失败')
      setStrength(data.state.argumentStrength)
      setAiOpponent(data.state.aiOpponent)
      setAiTendency(data.state.aiTendency)
      setTranscript([])
      setRound(1)
      setSelectedAngle(null)
      setPopup(null)
      setLastScores(null)
      setVerdict(null)
      setStage('debating')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '开桌失败')
    } finally {
      setBusy(false)
    }
  }

  const playerSpeak = async () => {
    const text = myText.trim()
    if (!text || busy || stage !== 'debating') return
    if (!selectedAngle) { window.alert('先选一个攻击角度（📊/❤️/🔍）再发言'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/bar/debate/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round, angle: selectedAngle, content: text }),
      })
      const data = await res.json() as {
        playerTurn?: Turn; aiTurn?: Turn;
        playerScore?: ArgumentScore; aiScore?: ArgumentScore;
        playerEffectiveness?: AngleEffectiveness;
        nextAiTendency?: StanceTendency;
        state?: { round: number; argumentStrength: { pro: number; con: number } }; message?: string
      }
      if (!res.ok || !data.playerTurn || !data.aiTurn || !data.state) throw new Error(data.message ?? '发言失败')

      setTranscript((prev) => [...prev, data.playerTurn!, data.aiTurn!])
      setStrength(data.state.argumentStrength)
      setMyText('')
      // 克制飘字 + 双维度评分反馈
      if (data.playerEffectiveness) {
        setPopup({ effectiveness: data.playerEffectiveness, key: Date.now() })
      }
      if (data.playerScore && data.aiScore) setLastScores({ player: data.playerScore, ai: data.aiScore })
      // 揭示下一回合 AI 倾向，清空本回合角度选择
      if (data.nextAiTendency) setAiTendency(data.nextAiTendency)
      setSelectedAngle(null)
      if (aiOpponent) {
        setActiveSpeakerId(aiOpponent.id)
        window.setTimeout(() => setActiveSpeakerId(null), 3000)
      }
      setRound(data.state.round)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '发言失败')
    } finally {
      setBusy(false)
    }
  }

  const askVerdict = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/bar/debate/verdict', { method: 'POST' })
      const data = await res.json() as { verdict?: { winner: Side | 'tie'; reasoning: string; keyMoments: string[] }; state?: { argumentStrength: { pro: number; con: number } }; message?: string }
      if (!res.ok || !data.verdict) throw new Error(data.message ?? '裁决失败')
      setVerdict(data.verdict)
      if (data.state) setStrength(data.state.argumentStrength)
      if (betSide && data.verdict.winner === betSide) setCoins((c) => c * 2)
      else if (betSide) setCoins(0)
      setStage('verdict')
      // 全局档案上报：押注命中即胜，双方强度差作为本局分数。
      const s = data.state?.argumentStrength ?? strength
      const won = data.verdict.winner !== 'tie' && betSide != null && data.verdict.winner === betSide
      submitGameResult('bar', { won, score: Math.round(Math.abs(s.pro - s.con)) })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '裁决失败')
    } finally {
      setBusy(false)
    }
  }

  const reset = useCallback(() => {
    setStage('prepare')
    setTranscript([])
    setVerdict(null)
    setStrength({ pro: 50, con: 50 })
    setRound(1)
    setAiOpponent(null)
    setBetSide(null)
    setSelectedAngle(null)
    setAiTendency(null)
    setPopup(null)
    setLastScores(null)
  }, [])

  // 3D 用的名人对象
  const viewCelebs: Celebrity[] = aiOpponent ? [getCelebrity(aiOpponent.id)].filter((c): c is Celebrity => Boolean(c)) : []
  const debateOver = round > totalRounds

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0A', color: '#EDEDF0' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={onBack} style={headerBtn}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 18, fontWeight: 700, color: YELLOW }}>🍺 酒吧辩论</span>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>你是正式辩手 · 苏格拉底当裁判</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEAL }}>
          <Coins size={14} /> {coins} 金币
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(237,237,240,0.7)' }}>
          <Users size={14} /> 现场客人
        </span>
        {onPlaza && <button onClick={onPlaza} style={{ ...headerBtn, color: TEAL }}>广场 →</button>}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：3D 场景 */}
        <div style={{ flex: 1.4, position: 'relative', minWidth: 0, background: '#1a0f08' }}>
          {viewCelebs.length > 0 ? (
            <Suspense fallback={<LoadingBar />}>
              <BarView celebrities={viewCelebs} activeSpeakerId={activeSpeakerId} />
            </Suspense>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(237,237,240,0.35)', gap: 12 }}>
              <Beer size={48} />
              <div style={{ fontSize: 15 }}>选个辩题、站好队，开一桌你亲自下场的辩论</div>
            </div>
          )}
          {busy && (
            <div style={{ position: 'absolute', left: 16, bottom: 16, padding: '8px 14px', background: 'rgba(40,20,8,0.85)', border: `1px solid ${TEAL}`, borderRadius: 8, fontSize: 13, color: TEAL }}>
              正在交锋…
            </div>
          )}
        </div>

        {/* 右：控制面板 */}
        <div style={{ width: 420, background: '#141414', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {stage === 'prepare' && (
            <div style={{ padding: 18, overflowY: 'auto' }}>
              <Title>选个辩题，站好队</Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {topics.slice(0, 8).map((t) => (
                  <button key={t} onClick={() => { setTopic(t); setCustomTopic('') }}
                    style={{ ...topicBtn, borderColor: topic === t && !customTopic ? YELLOW : 'rgba(255,255,255,0.08)', background: topic === t && !customTopic ? 'rgba(255,214,10,0.1)' : 'transparent' }}>
                    {t}
                  </button>
                ))}
              </div>
              <input value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} placeholder="或者自己想一个辩题…" style={inputStyle} />

              <Title>你站哪边</Title>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={() => setPlayerSide('pro')} style={{ ...sideBtn, borderColor: playerSide === 'pro' ? YELLOW : 'rgba(255,255,255,0.15)', color: playerSide === 'pro' ? YELLOW : 'rgba(237,237,240,0.6)' }}>
                  正方（赞成）
                </button>
                <button onClick={() => setPlayerSide('con')} style={{ ...sideBtn, borderColor: playerSide === 'con' ? TEAL : 'rgba(255,255,255,0.15)', color: playerSide === 'con' ? TEAL : 'rgba(237,237,240,0.6)' }}>
                  反方（反对）
                </button>
              </div>

              <Title>押注虚拟金币（可选）</Title>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Vote size={13} style={{ color: 'rgba(237,237,240,0.5)' }} />
                <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.5)' }}>押 100 金币，赢了翻倍：</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['pro', 'con'] as Side[]).map((s) => (
                  <button key={s} onClick={() => setBetSide(betSide === s ? null : s)}
                    style={{ ...sideBtn, borderColor: betSide === s ? YELLOW : 'rgba(255,255,255,0.15)', background: betSide === s ? 'rgba(255,214,10,0.12)' : 'transparent' }}>
                    {betSide === s ? '✓ ' : ''}押{SIDE_LABEL[s]}
                  </button>
                ))}
                {betSide === null && <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.35)', alignSelf: 'center' }}>不押</span>}
              </div>

              <button onClick={() => void startDebate()} disabled={!activeTopic || busy} style={{ ...primaryBtn, opacity: !activeTopic || busy ? 0.5 : 1 }}>
                <Scale size={15} /> {busy ? '召集对方辩手…' : '开战！'}
              </button>
            </div>
          )}

          {stage !== 'prepare' && (
            <>
              {/* 辩题 + 回合 + 强度条（含克制飘字） */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}>
                <CounterPopup popup={popup} />
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.6)', marginBottom: 2 }}>辩题</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{activeTopic}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: YELLOW, fontWeight: 700 }}>正方 {Math.round(strength.pro)}</span>
                  <TendencyMeter tendency={stage === 'debating' ? aiTendency : null} />
                  <span style={{ color: TEAL, fontWeight: 700 }}>反方 {Math.round(strength.con)}</span>
                </div>
                {/* 双向论据强度条：左正方明黄 / 右反方青绿 */}
                <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <div style={{ width: `${strength.pro}%`, background: YELLOW, transition: 'width 0.8s ease' }} />
                  <div style={{ width: `${strength.con}%`, background: TEAL, transition: 'width 0.8s ease' }} />
                </div>
                {/* 双维度评分反馈（不再是黑盒单值） */}
                {lastScores && stage === 'debating' && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: 'rgba(237,237,240,0.45)' }}>
                    <span>你：内容 {lastScores.player.content_quality} · 切题 {lastScores.player.relevance}</span>
                    <span style={{ color: TEAL }}>对方：内容 {lastScores.ai.content_quality} · 切题 {lastScores.ai.relevance}</span>
                  </div>
                )}
              </div>

              {/* 发言记录 */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px', minHeight: 0 }}>
                {transcript.length === 0 && (
                  <div style={{ color: 'rgba(237,237,240,0.35)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                    {user?.nickname ?? '你'}（{SIDE_LABEL[playerSide]}）先立论吧
                  </div>
                )}
                {transcript.map((t, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, marginBottom: 3, color: t.side === 'player' ? YELLOW : t.side === 'pro' ? YELLOW : TEAL }}>
                      {t.side === 'player' ? `👤 ${user?.nickname ?? '你'} · ` : `${t.speaker} · `}{t.side === 'player' ? SIDE_LABEL[playerSide] : SIDE_LABEL[t.side as Side]}
                      {t.angle && <span style={{ marginLeft: 6, color: 'rgba(237,237,240,0.4)' }}>[{ANGLE_META[t.angle].emoji}{ANGLE_META[t.angle].title}]</span>}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.5, color: '#EDEDF0' }}>{t.text}</div>
                  </div>
                ))}
              </div>

              {/* 裁决结果 */}
              {stage === 'verdict' && verdict && (
                <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,214,10,0.3)', background: 'rgba(255,214,10,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Gavel size={16} color={YELLOW} />
                    <span style={{ fontSize: 14, fontWeight: 800, color: YELLOW }}>苏格拉底裁决</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: verdict.winner === 'tie' ? '#EDEDF0' : YELLOW }}>
                    {verdict.winner === 'tie' ? '平局！' : `${SIDE_LABEL[verdict.winner]}胜`}
                    {betSide && (
                      <span style={{ fontSize: 12, marginLeft: 8, color: TEAL }}>
                        （押注{verdict.winner === betSide ? `翻倍 → ${coins} 金币 🎉` : '落空 😅'}）
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: 'rgba(237,237,240,0.8)' }}>{verdict.reasoning}</p>
                  {verdict.keyMoments.length > 0 && (
                    <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)' }}>
                      <div style={{ marginBottom: 4 }}>精彩瞬间：</div>
                      {verdict.keyMoments.map((m, i) => <div key={i}>· {m}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* 底部输入区 */}
              <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                {stage === 'debating' && !debateOver && (
                  <>
                    <AngleChooser selected={selectedAngle} onSelect={(a) => setSelectedAngle(a)} disabled={busy} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={myText}
                        onChange={(e) => setMyText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && selectedAngle) void playerSpeak() }}
                        placeholder={selectedAngle ? `第 ${round} 回合，${ANGLE_META[selectedAngle].title}角度陈述…` : '先选上方攻击角度，再发言…'}
                        disabled={!selectedAngle}
                        style={{
                          ...inputStyle, marginBottom: 0, flex: 1,
                          opacity: selectedAngle ? 1 : 0.45,
                          cursor: selectedAngle ? 'text' : 'not-allowed',
                        }}
                      />
                      <button onClick={() => void playerSpeak()} disabled={!myText.trim() || !selectedAngle || busy} style={{ ...primaryBtn, padding: '8px 12px', marginTop: 0, opacity: !myText.trim() || !selectedAngle || busy ? 0.5 : 1 }}>
                        <Send size={14} />
                      </button>
                    </div>
                  </>
                )}
                {stage === 'debating' && debateOver && (
                  <button onClick={() => void askVerdict()} disabled={busy} style={{ ...primaryBtn, width: '100%', opacity: busy ? 0.5 : 1 }}>
                    <Gavel size={14} /> {busy ? '苏格拉底思考中…' : '请裁判裁决'}
                  </button>
                )}
                {stage === 'verdict' && (
                  <button onClick={reset} style={{ ...primaryBtn, width: '100%' }}>
                    <RotateCcw size={14} /> 换个辩题再来一局
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(237,237,240,0.7)', margin: '14px 0 8px', letterSpacing: 1 }}>{children}</div>
}

function LoadingBar() {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a0f08', color: '#4fb3a5', fontSize: 14 }}>布置酒吧中…</div>
}

const headerBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const topicBtn: CSSProperties = {
  padding: '8px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
  color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
}
const sideBtn: CSSProperties = {
  flex: 1, padding: '8px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
  cursor: 'pointer', fontSize: 13,
}
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)', background: '#0F0F0F', color: '#EDEDF0', fontSize: 13, outline: 'none', marginBottom: 8,
}
const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: YELLOW, border: 'none', borderRadius: 6,
  color: '#0A0A0A', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8,
}
