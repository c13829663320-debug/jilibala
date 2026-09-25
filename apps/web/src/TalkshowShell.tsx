// ===== 脱口秀剧场：开放麦之星 R2（三维度评分 + callback + 话题选择 + 限时）=====
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Mic, Send, RefreshCw, Crown, Users } from 'lucide-react'
import { getCelebrity, type Celebrity } from '@balabala/shared'
import { useIdentity } from './identity'
import TopicPicker from './talkshow/TopicPicker'
import JokeScoreRadar from './talkshow/JokeScoreRadar'
import AudienceWave from './talkshow/AudienceWave'
import CallbackChooser, { type NextMove } from './talkshow/CallbackChooser'
import JokeTimer from './talkshow/JokeTimer'
import {
  REACTION_META, TIER_STYLE,
  type PerformedJoke, type TopicOption, type Tier,
} from './talkshow/types'

const TalkshowView = lazy(() => import('./TalkshowView'))

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

type Stage = 'warmup' | 'picking_topic' | 'performing' | 'results'

export default function TalkshowShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  const [stage, setStage] = useState<Stage>('warmup')
  const [topics, setTopics] = useState<TopicOption[]>([])
  const [topic, setTopic] = useState<TopicOption | null>(null)
  const [warmupJokes, setWarmupJokes] = useState<string[]>([])
  const [warmupIdx, setWarmupIdx] = useState(0)

  const [jokes, setJokes] = useState<PerformedJoke[]>([])
  const [currentResult, setCurrentResult] = useState<PerformedJoke | null>(null)
  const [callbackOptions, setCallbackOptions] = useState<Array<{ index: number; preview: string }>>([])
  const [nextMove, setNextMove] = useState<NextMove | null>(null)
  const [pickSwitchTopic, setPickSwitchTopic] = useState(false)

  const [myJoke, setMyJoke] = useState('')
  const [busy, setBusy] = useState(false)

  const [average, setAverage] = useState<number | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [verdict, setVerdict] = useState('')
  const [goldJoke, setGoldJoke] = useState<PerformedJoke | null>(null)

  const totalJokes = 3
  const jokeIndex = jokes.length

  // 开局：拉热身段子 + 话题票。
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      setBusy(true)
      try {
        const res = await fetch('/api/talkshow/openmic/start', { method: 'POST' })
        const data = await res.json() as {
          state?: { warmupJokes: string[] };
          topics?: TopicOption[];
          message?: string;
        }
        if (!res.ok || !data.state) throw new Error(data.message ?? '开场失败')
        if (cancelled) return
        setWarmupJokes(data.state.warmupJokes)
        setWarmupIdx(0)
        if (data.topics?.length) setTopics(data.topics)
      } catch {
        if (!cancelled) {
          setWarmupJokes(['大家晚上好！先说好，我讲的段子不包笑。'])
          setTopics([
            { id: 'workplace', label: '职场吐槽', icon: '💼', subtopics: ['周一早会'] },
            { id: 'dating', label: '恋爱翻车', icon: '💘', subtopics: ['相亲现场'] },
            { id: 'family', label: '我妈/我爸', icon: '🏠', subtopics: ['催婚催生'] },
            { id: 'life', label: '当代生活', icon: '🛋️', subtopics: ['月底看余额'] },
          ])
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void start()
    return () => { cancelled = true }
  }, [])

  // 热身每 ~5 秒切一个段子，10 秒左右播完自动进入选话题。
  useEffect(() => {
    if (stage !== 'warmup' || warmupJokes.length === 0) return
    if (warmupIdx >= warmupJokes.length - 1) {
      const t = window.setTimeout(() => setStage('picking_topic'), 2500)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => setWarmupIdx((i) => i + 1), 5000)
    return () => window.clearTimeout(t)
  }, [stage, warmupIdx, warmupJokes.length])

  const pickTopic = async (t: TopicOption) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/talkshow/openmic/topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: t.id }),
      })
      const data = await res.json() as { state?: { topic?: TopicOption }; message?: string }
      if (!res.ok) throw new Error(data.message ?? '选话题失败')
      setTopic(data.state?.topic ?? t)
      setPickSwitchTopic(false)
      setStage('performing')
    } catch (e) {
      // 离线兜底：本地直接选。
      setTopic(t)
      setPickSwitchTopic(false)
      setStage('performing')
      void e
    } finally {
      setBusy(false)
    }
  }

  const tellJoke = async () => {
    const text = myJoke.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const body: { text: string; callbackTo?: number; switchTopic?: string } = { text }
      if (nextMove?.kind === 'callback') body.callbackTo = nextMove.index
      if (nextMove?.kind === 'switch_topic' && 'topicId' in nextMove) body.switchTopic = nextMove.topicId
      const res = await fetch('/api/talkshow/openmic/joke', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as {
        result?: PerformedJoke;
        state?: { callbackOptions?: Array<{ index: number; preview: string }>; topic?: TopicOption };
        message?: string;
      }
      if (!res.ok || !data.result) throw new Error(data.message ?? '评分失败')
      setJokes((prev) => [...prev, data.result!])
      setCurrentResult(data.result)
      setCallbackOptions(data.state?.callbackOptions ?? [])
      if (data.state?.topic) setTopic(data.state.topic)
      setMyJoke('')
      setNextMove(null)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '评分失败')
    } finally {
      setBusy(false)
    }
  }

  // 60s 到时自动提交（若有文本）。
  const timerTimeoutRef = useRef<() => void>(() => {})
  timerTimeoutRef.current = () => { if (myJoke.trim()) void tellJoke() }

  const handleNextMove = (move: NextMove) => {
    if (move.kind === 'switch_topic') {
      setPickSwitchTopic(true)
      return
    }
    setNextMove(move)
    setCurrentResult(null)
  }

  const finishShow = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/talkshow/openmic/finish', { method: 'POST' })
      const data = await res.json() as {
        average?: number; tier?: Tier; verdict?: string; goldJoke?: PerformedJoke; message?: string
      }
      if (!res.ok) throw new Error(data.message ?? '结算失败')
      setAverage(data.average ?? 0)
      setTier(data.tier ?? '冷场')
      setVerdict(data.verdict ?? '')
      setGoldJoke(data.goldJoke ?? null)
      setStage('results')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '结算失败')
    } finally {
      setBusy(false)
    }
  }

  const reset = useCallback(() => {
    setJokes([]); setCurrentResult(null); setCallbackOptions([]); setNextMove(null); setPickSwitchTopic(false)
    setMyJoke(''); setTopic(null); setAverage(null); setTier(null); setVerdict(''); setGoldJoke(null)
    setStage('warmup')
    void (async () => {
      try {
        const res = await fetch('/api/talkshow/openmic/start', { method: 'POST' })
        const data = await res.json() as { state?: { warmupJokes: string[] }; topics?: TopicOption[] }
        if (data.state) { setWarmupJokes(data.state.warmupJokes); setWarmupIdx(0) }
        if (data.topics?.length) setTopics(data.topics)
      } catch { /* ignore */ }
    })()
  }, [])

  const viewCelebs: Celebrity[] = [getCelebrity('libai')].filter((c): c is Celebrity => Boolean(c))
  const playerOnStage = stage === 'performing'
  const audienceExcitement = currentResult?.total ?? (stage === 'results' ? average ?? 0 : 0)

  // 下一段输入框上方的灰色提示。
  const nextHint = (() => {
    if (nextMove?.kind === 'callback') {
      return `🔁 回扣第 ${nextMove.index + 1} 段：“${nextMove.preview}”（真引用关键词 resonance +15）`
    }
    if (nextMove?.kind === 'switch_topic') {
      return '🎭 换个话题开讲'
    }
    return null
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000', color: '#EDEDF0' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#0A0A0A', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={onBack} style={headerBtn}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 18, fontWeight: 800, color: YELLOW }}>🎤 脱口秀剧场 · 开放麦之星</span>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>三维度评分 · callback 回扣 · 60 秒限时</span>
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
        <div style={{ width: 420, background: '#0A0A0A', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 阶段一：热身 */}
          {stage === 'warmup' && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
              <div style={{ fontSize: 13, color: TEAL, marginBottom: 10, letterSpacing: 1 }}>AI 主持热身中…（约 10 秒）</div>
              {warmupJokes.map((j, i) => (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: 8, marginBottom: 10,
                  background: i === warmupIdx ? 'rgba(255,214,0,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${i === warmupIdx ? YELLOW : 'rgba(255,255,255,0.06)'}`,
                  fontSize: 14, lineHeight: 1.6, opacity: i <= warmupIdx ? 1 : 0.35,
                }}>
                  🎙️ {j}
                </div>
              ))}
            </div>
          )}

          {/* 阶段二：选话题 */}
          {stage === 'picking_topic' && (
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: YELLOW }}>今晚聊点啥？</div>
                <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginTop: 4 }}>选一张话题票，连讲 3 个段子。</div>
              </div>
              <TopicPicker topics={topics} onPick={(t) => void pickTopic(t)} disabled={busy} />
            </div>
          )}

          {/* 阶段三：玩家表演 */}
          {stage === 'performing' && (
            <>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.6)' }}>{topic?.icon} {topic?.label} · 第 {Math.min(jokeIndex + 1, totalJokes)}/{totalJokes} 段</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: YELLOW }}>开放麦表演中</div>
                </div>
                {!currentResult && <JokeTimer resetKey={jokeIndex} onTimeout={() => timerTimeoutRef.current()} />}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', minHeight: 0 }}>
                {/* 已讲过的段子小条 */}
                {jokes.map((j, i) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: 11, color: 'rgba(237,237,240,0.55)' }}>
                    段{i + 1} {REACTION_META[j.reaction].emoji} <span style={{ color: YELLOW, fontWeight: 700 }}>{j.total}</span>
                    {j.callbackHit ? <span style={{ color: TEAL, marginLeft: 6 }}>callback✓</span> : null}
                  </div>
                ))}

                {/* 当前段子评分：三维度 + 音浪 + 吐槽 */}
                {currentResult && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <JokeScoreRadar scores={currentResult.scores} total={currentResult.total} />
                    <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: REACTION_META[currentResult.reaction].color, marginBottom: 4 }}>
                        {REACTION_META[currentResult.reaction].emoji} {REACTION_META[currentResult.reaction].label}
                      </div>
                      <AudienceWave reaction={currentResult.reaction} active />
                      <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.85)', marginTop: 4 }}>“{currentResult.note}”</div>
                    </div>

                    {jokeIndex < totalJokes ? (
                      pickSwitchTopic ? (
                        <TopicPicker topics={topics} onPick={(t) => { setNextMove({ kind: 'switch_topic', topicId: t.id }); setPickSwitchTopic(false); setCurrentResult(null) }} disabled={busy} />
                      ) : (
                        <CallbackChooser
                          callbackOptions={callbackOptions}
                          onPick={handleNextMove}
                          disabled={busy}
                        />
                      )
                    ) : (
                      <button onClick={() => void finishShow()} disabled={busy} style={{ ...primaryBtn, width: '100%' }}>
                        <Crown size={14} /> {busy ? '统计中…' : '看看我是什么段位！'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 输入区 */}
              {!currentResult && (
                <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {nextHint && (
                    <div style={{ fontSize: 11, color: TEAL, marginBottom: 6, padding: '4px 8px', background: 'rgba(79,179,165,0.1)', borderRadius: 6 }}>
                      {nextHint}
                    </div>
                  )}
                  <textarea
                    value={myJoke}
                    onChange={(e) => setMyJoke(e.target.value)}
                    placeholder={`讲你的第 ${Math.min(jokeIndex + 1, totalJokes)}/3 段段子…`}
                    rows={3}
                    style={textareaStyle}
                  />
                  <button onClick={() => void tellJoke()} disabled={!myJoke.trim() || busy} style={{ ...primaryBtn, width: '100%', opacity: !myJoke.trim() || busy ? 0.5 : 1 }}>
                    <Send size={14} /> {busy ? '观众反应中…' : '讲出去！'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* 阶段四：结果 */}
          {stage === 'results' && tier && (
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <div style={{ fontSize: 56 }}>{TIER_STYLE[tier].emoji}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: TIER_STYLE[tier].color }}>{tier}</div>
                <div style={{ fontSize: 14, color: 'rgba(237,237,240,0.6)' }}>平均分 {average} / 100</div>
              </div>

              {/* 金句卡 */}
              {goldJoke && (
                <div style={{ padding: 14, background: 'linear-gradient(160deg, rgba(255,214,0,0.18), rgba(255,214,0,0.04))', border: `1px solid ${YELLOW}`, borderRadius: 10 }}>
                  <div style={{ fontSize: 12, color: YELLOW, marginBottom: 6 }}>🏆 今日金句卡（最高分那段）</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: '#fff' }}>“{goldJoke.text}”</div>
                  <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.6)', marginTop: 6 }}>{goldJoke.topic} · {goldJoke.total} 分 · {REACTION_META[goldJoke.reaction].emoji}</div>
                </div>
              )}

              {/* 三段三维度 */}
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.55)', marginBottom: 10 }}>三段段子的三维度</div>
                {jokes.map((j, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span>段{i + 1} {REACTION_META[j.reaction].emoji}{j.callbackHit ? ' 🔁' : ''}</span>
                      <span style={{ color: YELLOW, fontWeight: 700 }}>{j.total}</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${j.scores.punchline / 40 * 100}%`, background: YELLOW }} />
                      <div style={{ width: `${j.scores.pacing / 30 * 100}%`, background: TEAL }} />
                      <div style={{ width: `${j.scores.resonance / 30 * 100}%`, background: '#ff9d5c' }} />
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
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#FFD600', fontSize: 14 }}>布置剧场中…</div>
}

const headerBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const textareaStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(255,214,0,0.3)', background: '#050505', color: '#EDEDF0',
  fontSize: 14, outline: 'none', resize: 'none', marginBottom: 8, fontFamily: 'inherit',
}
const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: YELLOW, border: 'none', borderRadius: 8,
  color: '#0A0A0A', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginTop: 4,
}
