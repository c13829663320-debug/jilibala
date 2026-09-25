// ===== 脱口秀剧场：开放麦之星主循环（P0 重构）=====
// 从「看演出」变成「开放麦之星」：AI 主持热身 → 玩家上台连讲 3 个笑话 →
// AI 观众实时笑声分贝评分 → 平均分定段位（冷场/尚可/炸场/今日之星）。
import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ArrowLeft, Mic, Send, RefreshCw, Crown, Users } from 'lucide-react'
import { getCelebrity, type Celebrity } from '@balabala/shared'
import { useIdentity } from './identity'

const TalkshowView = lazy(() => import('./TalkshowView'))

const YELLOW = '#FFD60A'
const TEAL = '#4fb3a5'

type Stage = 'warmup' | 'performance' | 'results'
type Reaction = 'roast' | 'applaud' | 'mixed' | 'silence'
type Tier = '冷场' | '尚可' | '炸场' | '今日之星'

interface JokeScore { score: number; reaction: Reaction; comment: string }

const REACTION_EMOJI: Record<Reaction, string> = {
  roast: '🥀', applaud: '👏', mixed: '🤔', silence: '😶',
}
const TIER_STYLE: Record<Tier, { emoji: string; color: string }> = {
  '冷场': { emoji: '🥶', color: '#8a8a95' },
  '尚可': { emoji: '🙂', color: TEAL },
  '炸场': { emoji: '🔥', color: YELLOW },
  '今日之星': { emoji: '🌟', color: YELLOW },
}

export default function TalkshowShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  const [stage, setStage] = useState<Stage>('warmup')
  const [warmupJokes, setWarmupJokes] = useState<string[]>([])
  const [warmupIdx, setWarmupIdx] = useState(0)

  const [jokeIndex, setJokeIndex] = useState(0)
  const totalJokes = 3
  const [scores, setScores] = useState<JokeScore[]>([])
  const [currentScore, setCurrentScore] = useState<JokeScore | null>(null)
  const [myJoke, setMyJoke] = useState('')
  const [busy, setBusy] = useState(false)

  const [average, setAverage] = useState<number | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [verdict, setVerdict] = useState('')

  // 热身阶段：自动逐条播放主持段子，约 15 秒后进入玩家上台。
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      setBusy(true)
      try {
        const res = await fetch('/api/talkshow/openmic/start', { method: 'POST' })
        const data = await res.json() as { state?: { warmupJokes: string[] }; message?: string }
        if (!res.ok || !data.state) throw new Error(data.message ?? '开场失败')
        if (cancelled) return
        setWarmupJokes(data.state.warmupJokes)
        setWarmupIdx(0)
      } catch {
        if (!cancelled) setWarmupJokes(['大家晚上好！先说好，我讲的段子不包笑。'])
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void start()
    return () => { cancelled = true }
  }, [])

  // 热身段子每 ~6 秒切一个，播完（约 15s）停在最后一句，等玩家点「我准备好了」。
  useEffect(() => {
    if (stage !== 'warmup' || warmupJokes.length === 0) return
    if (warmupIdx >= warmupJokes.length - 1) return
    const t = window.setTimeout(() => setWarmupIdx((i) => i + 1), 6000)
    return () => window.clearTimeout(t)
  }, [stage, warmupIdx, warmupJokes.length])

  const goOnStage = () => setStage('performance')

  const tellJoke = async () => {
    const text = myJoke.trim()
    if (!text || busy) return
    setBusy(true)
    setCurrentScore(null)
    try {
      const res = await fetch('/api/talkshow/openmic/joke', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json() as { result?: JokeScore; state?: { currentJokeIndex: number }; message?: string }
      if (!res.ok || !data.result) throw new Error(data.message ?? '评分失败')
      setScores((prev) => [...prev, data.result!])
      setJokeIndex(data.state?.currentJokeIndex ?? scores.length + 1)
      setCurrentScore(data.result)
      setMyJoke('')
      // 每个笑话间隔 2 秒，给观众反应一点时间
      await new Promise((r) => window.setTimeout(r, 2000))
      setCurrentScore(null)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '评分失败')
    } finally {
      setBusy(false)
    }
  }

  const finishShow = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/talkshow/openmic/finish', { method: 'POST' })
      const data = await res.json() as { average?: number; tier?: Tier; verdict?: string; message?: string }
      if (!res.ok) throw new Error(data.message ?? '结算失败')
      setAverage(data.average ?? 0)
      setTier(data.tier ?? '冷场')
      setVerdict(data.verdict ?? '')
      setStage('results')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '结算失败')
    } finally {
      setBusy(false)
    }
  }

  const reset = useCallback(() => {
    setScores([]); setCurrentScore(null); setJokeIndex(0); setMyJoke('')
    setAverage(null); setTier(null); setVerdict('')
    setStage('warmup')
    // 重新触发 start：清空后重新拉热身段子
    void (async () => {
      try {
        const res = await fetch('/api/talkshow/openmic/start', { method: 'POST' })
        const data = await res.json() as { state?: { warmupJokes: string[] } }
        if (data.state) { setWarmupJokes(data.state.warmupJokes); setWarmupIdx(0) }
      } catch { /* ignore */ }
    })()
  }, [])

  const viewCelebs: Celebrity[] = [getCelebrity('libai')].filter((c): c is Celebrity => Boolean(c))
  const playerOnStage = stage === 'performance'
  const audienceExcitement = currentScore?.score ?? (stage === 'results' ? average ?? 0 : 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0A', color: '#EDEDF0' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={onBack} style={headerBtn}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 18, fontWeight: 800, color: YELLOW }}>🎤 脱口秀剧场 · 开放麦之星</span>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>连讲 3 个笑话，看你能不能炸场</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(237,237,240,0.7)' }}>
          <Users size={14} /> 现场观众
        </span>
        {onPlaza && <button onClick={onPlaza} style={{ ...headerBtn, color: TEAL }}>广场 →</button>}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：3D 舞台 */}
        <div style={{ flex: 1.5, position: 'relative', minWidth: 0 }}>
          <Suspense fallback={<LoadingBar />}>
            <TalkshowView celebrities={viewCelebs} activeSpeakerId={null} playerOnStage={playerOnStage} audienceExcitement={audienceExcitement} />
          </Suspense>
        </div>

        {/* 右：交互面板 */}
        <div style={{ width: 420, background: '#141414', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 阶段一：热身 */}
          {stage === 'warmup' && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
              <div style={{ fontSize: 13, color: TEAL, marginBottom: 10, letterSpacing: 1 }}>AI 主持热身中…</div>
              {warmupJokes.map((j, i) => (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: 8, marginBottom: 10,
                  background: i === warmupIdx ? 'rgba(255,214,10,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${i === warmupIdx ? YELLOW : 'rgba(255,255,255,0.06)'}`,
                  fontSize: 14, lineHeight: 1.6, opacity: i <= warmupIdx ? 1 : 0.35,
                }}>
                  🎙️ {j}
                </div>
              ))}
              <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.55)', margin: '14px 0' }}>准备上台…</div>
              <button onClick={goOnStage} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
                <Mic size={15} /> 我准备好了，上台！
              </button>
            </div>
          )}

          {/* 阶段二：玩家表演 */}
          {stage === 'performance' && (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.6)' }}>你的开放麦表演</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: YELLOW }}>第 {Math.min(jokeIndex + 1, totalJokes)}/{totalJokes} 个笑话</div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', minHeight: 0 }}>
                {/* 已讲过的分数小条 */}
                {scores.map((s, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'rgba(237,237,240,0.6)' }}>笑话 {i + 1}</span>
                      <span style={{ color: YELLOW, fontWeight: 700 }}>{s.score} 分贝</span>
                    </div>
                    <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${s.score}%`, background: YELLOW, height: '100%' }} />
                    </div>
                  </div>
                ))}

                {/* 当前笑话的实时笑声分贝条 */}
                {currentScore && (
                  <div style={{ marginTop: 14, padding: 14, background: 'rgba(255,214,10,0.06)', border: `1px solid ${YELLOW}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 30 }}>{REACTION_EMOJI[currentScore.reaction]}</span>
                      <div>
                        <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)' }}>现场笑声分贝</div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: YELLOW }}>{currentScore.score}</div>
                      </div>
                    </div>
                    {/* 横向分贝条：明黄填充，从 0 动画到目标值 */}
                    <div style={{ height: 14, background: 'rgba(255,255,255,0.08)', borderRadius: 7, overflow: 'hidden' }}>
                      <div style={{
                        width: `${currentScore.score}%`, height: '100%', background: YELLOW,
                        transition: 'width 1.2s cubic-bezier(0.22, 1, 0.36, 1)',
                      }} />
                    </div>
                    <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.8)', marginTop: 8 }}>“{currentScore.comment}”</div>
                  </div>
                )}
              </div>

              {/* 输入区 */}
              <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <textarea
                  value={myJoke}
                  onChange={(e) => setMyJoke(e.target.value)}
                  placeholder={`讲你的第 ${Math.min(jokeIndex + 1, totalJokes)}/3 个笑话…`}
                  rows={3}
                  style={textareaStyle}
                />
                {jokeIndex < totalJokes ? (
                  <button onClick={() => void tellJoke()} disabled={!myJoke.trim() || busy} style={{ ...primaryBtn, width: '100%', opacity: !myJoke.trim() || busy ? 0.5 : 1 }}>
                    <Send size={14} /> {busy ? '观众反应中…' : '讲出去！'}
                  </button>
                ) : (
                  <button onClick={() => void finishShow()} disabled={busy} style={{ ...primaryBtn, width: '100%', opacity: busy ? 0.5 : 1 }}>
                    <Crown size={14} /> {busy ? '统计中…' : '看看我是什么段位！'}
                  </button>
                )}
              </div>
            </>
          )}

          {/* 阶段三：结果 */}
          {stage === 'results' && tier && (
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <div style={{ fontSize: 56 }}>{TIER_STYLE[tier].emoji}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: TIER_STYLE[tier].color }}>{tier}</div>
                <div style={{ fontSize: 14, color: 'rgba(237,237,240,0.6)' }}>平均分 {average} / 100</div>
              </div>

              {/* 三个笑话的分数柱状图 */}
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.55)', marginBottom: 10 }}>三个笑话的笑声分贝</div>
                {scores.map((s, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span>笑话 {i + 1} {REACTION_EMOJI[s.reaction]}</span>
                      <span style={{ color: YELLOW, fontWeight: 700 }}>{s.score}</span>
                    </div>
                    <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${s.score}%`, background: YELLOW, height: '100%' }} />
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(237,237,240,0.85)', margin: 0 }}>{verdict}</p>

              <button onClick={reset} style={{ ...primaryBtn, width: '100%' }}>
                <RefreshCw size={14} /> 再来一轮
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LoadingBar() {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a12', color: '#FFD60A', fontSize: 14 }}>布置剧场中…</div>
}

const headerBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const textareaStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(255,214,10,0.3)', background: '#0F0F0F', color: '#EDEDF0',
  fontSize: 14, outline: 'none', resize: 'none', marginBottom: 8, fontFamily: 'inherit',
}
const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: YELLOW, border: 'none', borderRadius: 8,
  color: '#0A0A0A', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginTop: 4,
}
