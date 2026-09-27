// ============================================================================
// 脱口秀 · 新引擎玩法面板（玩法深化专项）
// 服务端权威 TalkshowOrchestrator（/api/engine/talkshow/*）驱动 UI：
// 选话题 → 3 段段子（60s 限时 + callback 回扣）→ 三维度评分 → 段位结算。
// 绝对定位覆盖在 3D 剧场场景上：右侧交互面板，左侧透出演播厅。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Crown, RefreshCw, Send, Sparkles, Users } from 'lucide-react'
import {
  createTalkshowGame, getTalkshowDailyChallenge, pickTalkshowTopic, submitJoke,
  type DailyChallengeInfo, type PerformedJoke, type TalkshowSnapshot,
} from './engine-client'
import {
  REACTION_META, TIER_STYLE, type TopicOption,
} from './types'
import TopicPicker from './TopicPicker'
import JokeScoreRadar from './JokeScoreRadar'
import AudienceWave from './AudienceWave'
import JokeTimer from './JokeTimer'
import R5SettlementPanel, { type R5Bundle } from '../lib/r5'
import { submitGameResult } from '../profile'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

interface GameResultLike {
  winner: string | null
  scores: Record<string, number>
  tier: { level: string; label: string; score: number; percentile: number }
  highlights: string[]
}

const TUTORIAL = [
  { title: '选个话题', desc: '左侧 4 张话题票选一个作为今晚主题，连讲 3 段。' },
  { title: '60 秒限时', desc: '每段段子 60 秒，最后 10 秒计时变红。到点自动讲出去。' },
  { title: '看三维度', desc: '不再是黑盒单分：包袱/节奏/共鸣三条，哪条短就补哪条。' },
  { title: '用 callback', desc: '第 2/3 段可选回扣前段梗，真引用关键词 → 共鸣 +15、反应升一档。' },
]
const LS_TUTORIAL_DONE = 'talkshow-engine-tutorial-done'

export type NewTalkshowGameProps = {
  onBack: () => void
  /** 切换回旧 TalkshowShell 经典流程。 */
  onSwitchClassic?: () => void
}

export default function NewTalkshowGame({ onBack, onSwitchClassic }: NewTalkshowGameProps) {
  const [id, setId] = useState<string | null>(null)
  const [snap, setSnap] = useState<TalkshowSnapshot | null>(null)
  const [topics, setTopics] = useState<TopicOption[]>([])
  const [daily, setDaily] = useState<DailyChallengeInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [myJoke, setMyJoke] = useState('')
  const [currentResult, setCurrentResult] = useState<PerformedJoke | null>(null)
  const [pendingCallback, setPendingCallback] = useState<number | null>(null)
  const [result, setResult] = useState<GameResultLike | null>(null)
  const [r5, setR5] = useState<R5Bundle | null>(null)
  const [shareText, setShareText] = useState('')
  const [tutorialStep, setTutorialStep] = useState<number>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem(LS_TUTORIAL_DONE) === '1' ? -1 : 0,
  )
  const seenEventsRef = useRef(0)

  // 开局
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setBusy(true)
      try {
        const [game, d] = await Promise.all([createTalkshowGame(), getTalkshowDailyChallenge()])
        if (cancelled) return
        setId(game.id)
        seenEventsRef.current = game.events.length
        setSnap(game.snapshot)
        setDaily(d)
        // 从开局事件里取话题票
        const topicEv = game.events.find((e) => e.type === 'talkshow_topic_options')
        const list = (topicEv?.payload?.topics ?? []) as Array<{ id: string; label: string; icon: string }>
        if (list.length) {
          setTopics(list.map((t) => ({ ...t, subtopics: [] })))
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '开场失败')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const state = snap?.state ?? null
  const stage = state?.stage ?? 'warmup'
  const totalJokes = state?.totalJokes ?? 3
  const jokeIndex = state?.currentJokeIndex ?? 0
  const jokes = state?.jokes ?? []
  const isDone = Boolean(snap && snap.phase === 'results')

  const pickTopic = useCallback(async (t: TopicOption) => {
    if (!id || busy) return
    setBusy(true)
    setError('')
    const prevSeen = seenEventsRef.current
    try {
      const resp = await pickTalkshowTopic(id, t.id)
      setSnap(resp.snapshot)
      seenEventsRef.current = Math.max(seenEventsRef.current, resp.events.length)
      void prevSeen
    } catch (e) {
      setError(e instanceof Error ? e.message : '选话题失败')
    } finally {
      setBusy(false)
    }
  }, [id, busy])

  const tellJoke = useCallback(async (text: string) => {
    if (!id || busy) return
    setBusy(true)
    setError('')
    try {
      const resp = await submitJoke(id, text, pendingCallback !== null ? { callbackTo: pendingCallback } : {})
      setSnap(resp.snapshot)
      seenEventsRef.current = resp.events.length
      setCurrentResult(resp.joke)
      setMyJoke('')
      setPendingCallback(null)
      setR5((resp as { r5?: R5Bundle | null }).r5 ?? null)
      setShareText((resp as { shareText?: string }).shareText ?? '')
      if (resp.snapshot.phase === 'results') {
        const ev = resp.events.find((e) => e.type === 'game_result')
        if (ev?.payload) setResult((ev.payload as { result: GameResultLike }).result)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '评分失败')
    } finally {
      setBusy(false)
    }
  }, [id, busy, pendingCallback])

  const timerTimeoutRef = useRef<() => void>(() => {})
  timerTimeoutRef.current = () => { void tellJoke(myJoke.trim()) }

  // 档案上报
  useEffect(() => {
    if (result) {
      const label = result.tier.label
      const jokesNow = snap?.state.jokes ?? []
      const hasGold = jokesNow.some((j) => j.total >= 66)
      try {
        submitGameResult('talkshow', {
          won: label === '炸场' || label === '今日之星',
          score: result.scores['slot-0'] ?? 0,
          detail: { tier: label, goldJoke: hasGold },
        })
      } catch { /* 档案上报失败不阻断 */ }
    }
  }, [result, snap])

  const tutorialDone = useCallback(() => {
    try { window.localStorage.setItem(LS_TUTORIAL_DONE, '1') } catch { /* noop */ }
    setTutorialStep(-1)
  }, [])

  const goldJoke = jokes.reduce<PerformedJoke | null>(
    (best, j) => (best === null || j.total > best.total ? j : best), null,
  )
  const average = jokes.length
    ? Math.round(jokes.reduce((s, j) => s + j.total, 0) / jokes.length)
    : 0

  return (
    <div data-testid="new-talkshow-game" style={{
      position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none', fontFamily: 'inherit',
    }}>
      {/* 顶栏 */}
      <div style={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        background: 'rgba(10,10,10,0.9)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button onClick={onBack} style={headerBtn} data-testid="talkshow-exit"><ArrowLeft size={15} /></button>
        <span style={{ fontSize: 17, fontWeight: 900, color: YELLOW }}>🎤 开放麦 · 新引擎</span>
        <span style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)' }}>三维度评分 · callback · 60s 限时</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(237,237,240,0.6)' }}>
          <Users size={13} /> 现场观众
        </span>
        {onSwitchClassic && (
          <button onClick={onSwitchClassic} style={{ ...headerBtn, color: TEAL }} data-testid="talkshow-classic-btn">经典模式</button>
        )}
      </div>

      {/* 每日挑战横幅 */}
      {daily && (
        <div data-testid="talkshow-daily-banner" style={{
          pointerEvents: 'auto', margin: '8px 16px 0', padding: '6px 12px', borderRadius: 8,
          background: 'rgba(255,214,0,0.1)', border: '1px solid rgba(255,214,0,0.35)',
          fontSize: 12, color: YELLOW, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <Sparkles size={13} />
          <b>每日挑战：{daily.title}</b>
          <span style={{ color: 'rgba(255,214,0,0.65)' }}>{daily.modifier} · {daily.description}</span>
        </div>
      )}

      {/* 右侧交互面板 */}
      <div style={{
        pointerEvents: 'auto', position: 'absolute', top: 56, right: 0, bottom: 0, width: 420,
        maxWidth: '92vw', background: 'rgba(10,10,10,0.94)', borderLeft: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column',
      }}>
        {error && <div data-testid="talkshow-error" style={{ color: '#ff8a8a', fontSize: 12, padding: '8px 16px' }}>{error}</div>}

        {/* 选话题 */}
        {stage === 'picking_topic' && (
          <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 900, color: YELLOW }}>今晚聊点啥？</div>
              <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginTop: 4 }}>选一张话题票，连讲 3 段段子。</div>
            </div>
            <TopicPicker topics={topics} onPick={(t) => void pickTopic(t)} disabled={busy} />
          </div>
        )}

        {/* 表演中 */}
        {stage === 'performing' && !isDone && (
          <>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.6)' }}>
                  {state?.topic?.icon} {state?.topic?.label} · 第 {Math.min(jokeIndex + 1, totalJokes)}/{totalJokes} 段
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, color: YELLOW }}>开放麦表演中</div>
              </div>
              {!currentResult && <JokeTimer resetKey={jokeIndex} onTimeout={() => timerTimeoutRef.current()} />}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', minHeight: 0 }}>
              {jokes.map((j, i) => (
                <div key={i} style={{ marginBottom: 8, fontSize: 11, color: 'rgba(237,237,240,0.55)' }} data-testid={`talkshow-history-${i}`}>
                  段{i + 1} {REACTION_META[j.reaction].emoji} <span style={{ color: YELLOW, fontWeight: 700 }}>{j.total}</span>
                  {j.callbackHit ? <span style={{ color: TEAL, marginLeft: 6 }}>callback✓</span> : null}
                </div>
              ))}

              {currentResult && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <JokeScoreRadar scores={currentResult.scores} total={currentResult.total} />
                  <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: REACTION_META[currentResult.reaction].color, marginBottom: 4 }} data-testid="talkshow-reaction">
                      {REACTION_META[currentResult.reaction].emoji} {REACTION_META[currentResult.reaction].label}
                    </div>
                    <AudienceWave reaction={currentResult.reaction} active />
                    <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.85)', marginTop: 4 }}>“{currentResult.note}”</div>
                  </div>

                  {jokeIndex < totalJokes ? (
                    <div>
                      <div style={{ fontSize: 12, color: YELLOW, marginBottom: 6 }}>下一段要 callback 吗？</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button style={rowBtn} disabled={busy} onClick={() => { setPendingCallback(null); setCurrentResult(null) }} data-testid="talkshow-callback-none">
                          ✍️ 顺着话题继续（不回扣）
                        </button>
                        {(state?.callbackOptions ?? []).map((c) => (
                          <button
                            key={c.index}
                            style={{ ...rowBtn, borderColor: 'rgba(79,179,165,0.5)' }}
                            disabled={busy}
                            onClick={() => { setPendingCallback(c.index); setCurrentResult(null) }}
                            data-testid={`talkshow-callback-${c.index}`}
                          >
                            🔁 Call back 第 {c.index + 1} 段
                            <span style={{ fontSize: 10, color: 'rgba(237,237,240,0.5)' }}>“{c.preview}”</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: TEAL }}>三段讲完，等主持人总评…</div>
                  )}
                </div>
              )}
            </div>

            {!currentResult && (
              <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                {pendingCallback !== null && (
                  <div style={{ fontSize: 11, color: TEAL, marginBottom: 6, padding: '4px 8px', background: 'rgba(79,179,165,0.1)', borderRadius: 6 }} data-testid="talkshow-callback-hint">
                    🔁 本段将回扣第 {pendingCallback + 1} 段：真引用关键词 resonance +15
                  </div>
                )}
                <textarea
                  value={myJoke}
                  onChange={(e) => setMyJoke(e.target.value)}
                  placeholder={`讲你的第 ${Math.min(jokeIndex + 1, totalJokes)}/3 段段子…`}
                  rows={3}
                  data-testid="talkshow-joke-input"
                  style={textareaStyle}
                />
                <button
                  onClick={() => void tellJoke(myJoke.trim())}
                  disabled={!myJoke.trim() || busy}
                  data-testid="talkshow-submit-joke"
                  style={{ ...primaryBtn, width: '100%', opacity: !myJoke.trim() || busy ? 0.5 : 1 }}
                >
                  <Send size={14} /> {busy ? '观众反应中…' : '讲出去！'}
                </button>
              </div>
            )}
          </>
        )}

        {/* 结算 */}
        {isDone && result && (
          <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="talkshow-results">
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <div style={{ fontSize: 52 }}>
                {(TIER_STYLE as Record<string, { emoji: string }>)[result.tier.label]?.emoji ?? '🎤'}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: (TIER_STYLE as Record<string, { color: string }>)[result.tier.label]?.color ?? YELLOW }} data-testid="talkshow-tier">
                {result.tier.label}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.6)' }}>平均分 {average} / 100</div>
            </div>

            {goldJoke && (
              <div style={{ padding: 14, background: 'linear-gradient(160deg, rgba(255,214,0,0.18), rgba(255,214,0,0.04))', border: `1px solid ${YELLOW}`, borderRadius: 10 }} data-testid="talkshow-gold">
                <div style={{ fontSize: 12, color: YELLOW, marginBottom: 6 }}>🏆 金句卡</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: '#fff' }}>“{goldJoke.text}”</div>
                <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.6)', marginTop: 6 }}>{goldJoke.topic} · {goldJoke.total} 分</div>
              </div>
            )}

            <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.55)', marginBottom: 10 }}>主持人总评</div>
              {result.highlights.map((h, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.7, color: 'rgba(237,237,240,0.88)', marginBottom: 6 }}>· {h}</div>
              ))}
            </div>

            {/* R5：高光回放 / 关系变化 / 连胜 / 战果卡 / 再来一局钩子 */}
            {r5 && (
              <R5SettlementPanel bundle={r5} shareText={shareText} onAgain={() => window.location.reload()} />
            )}
          </div>
        )}
      </div>

      {/* 新手引导浮层 */}
      {tutorialStep >= 0 && tutorialStep < TUTORIAL.length && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
        }} data-testid="talkshow-tutorial" onClick={tutorialDone}>
          <div onClick={(e) => e.stopPropagation()} style={{
            maxWidth: 380, padding: 22, borderRadius: 14, background: '#111',
            border: `1px solid ${YELLOW}55`, color: '#EDEDF0',
          }}>
            <div style={{ fontSize: 12, color: YELLOW, letterSpacing: 2 }}>新手引导 {tutorialStep + 1}/{TUTORIAL.length}</div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: '8px 0' }}>{TUTORIAL[tutorialStep].title}</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>{TUTORIAL[tutorialStep].desc}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={tutorialDone} style={headerBtn} data-testid="talkshow-tutorial-skip">跳过</button>
              <button onClick={() => setTutorialStep((s) => s + 1)} style={primaryBtn} data-testid="talkshow-tutorial-next">
                {tutorialStep === TUTORIAL.length - 1 ? '上台！' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!snap && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: YELLOW }}>
          <Crown size={26} /> 剧场布置中…
        </div>
      )}
    </div>
  )
}

const headerBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(237,237,240,0.7)', cursor: 'pointer', fontSize: 13,
}
const textareaStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(255,214,0,0.3)', background: '#050505', color: '#EDEDF0',
  fontSize: 14, outline: 'none', resize: 'none', marginBottom: 8, fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: YELLOW, border: 'none', borderRadius: 8,
  color: '#0A0A0A', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginTop: 4,
}
const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '9px 12px', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#EDEDF0',
  fontSize: 13, cursor: 'pointer', textAlign: 'left',
}
