// ============================================================================
// 趣味法庭 · 新引擎玩法面板（玩法深化专项）
// 服务端权威 CourtOrchestrator（/api/engine/court/*）驱动 UI：
// 开局 → 天平 50:50 → 4 张牌出牌 → 法官口播/天平滑动 → 3 轮结算。
// 绝对定位覆盖在 3D 法庭场景上，z-index 高于 canvas。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Gavel, Scale, Sparkles, Trophy, Zap } from 'lucide-react'
import {
  createCourtGame, getCourtDailyChallenge, passCourtTurn, playCourtCard,
  type CourtCardKind, type CourtEvidence, type CourtSnapshot, type DailyChallengeInfo,
  type EngineEvent, type GameResultLike,
} from './engine-client'
import { resultCardToText } from '@balabala/shared'
import { submitGameResult } from '../profile'

const CARD_META: Record<CourtCardKind, { title: string; desc: string; cost: number; icon: string }> = {
  attack: { title: '攻击论点', desc: '陈述一个直击争议焦点的论点', cost: 1, icon: '⚔️' },
  evidence: { title: '出示证据', desc: '提交一份我方证据，命中争议点', cost: 1, icon: '📄' },
  mock: { title: '幽默嘲讽', desc: '得体幽默拉气氛；越界会被法官警告', cost: 1, icon: '🎭' },
  request_record: { title: '要求记录', desc: '请法官把某节事实记入庭审记录（不花弹药）', cost: 0, icon: '📝' },
}

interface JudgeLine {
  id: number
  text: string
  tone: 'judge' | 'hit' | 'miss' | 'rebuttal'
}

const TUTORIAL = [
  { title: '欢迎来到趣味法庭', desc: '你是决定胜负的律师。顶部天平 0-100 互补，3 轮结束时你方 ≥55 即胜诉。' },
  { title: '看懂天平与弹药', desc: '每回合 2 点弹药。攻击/证据/嘲讽各花 1 点，要求记录不花弹药。' },
  { title: '出牌命中争议点', desc: '牌面内容命中上方未决争议点 → 天平大涨；没命中 → 小涨甚至反向。' },
  { title: '对手会反驳', desc: '每轮结束对方律师会反驳拉走 4 点（你 attack 命中则减免）。打完 3 轮见分晓！' },
]

const LS_TUTORIAL_DONE = 'court-engine-tutorial-done'

export type NewCourtGameProps = {
  onExit: () => void
  /** 切换回旧的 CourtFlow 经典模式。 */
  onSwitchClassic?: () => void
  /** R5：切换到名人法庭招牌模式。 */
  onSwitchSignature?: () => void
}

export default function NewCourtGame({ onExit, onSwitchClassic, onSwitchSignature }: NewCourtGameProps) {
  const [id, setId] = useState<string | null>(null)
  const [snap, setSnap] = useState<CourtSnapshot | null>(null)
  const [daily, setDaily] = useState<DailyChallengeInfo | null>(null)
  const [lines, setLines] = useState<JudgeLine[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<GameResultLike | null>(null)
  const [relationshipChange, setRelationshipChange] = useState<{ delta: number; toType: string; reason: string } | null>(null)
  const [resultCard, setResultCard] = useState<Record<string, unknown> | null>(null)
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [pendingCard, setPendingCard] = useState<CourtCardKind | null>(null)
  const [draft, setDraft] = useState('')
  const [pickedEvidence, setPickedEvidence] = useState<CourtEvidence | null>(null)
  const [tutorialStep, setTutorialStep] = useState<number>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem(LS_TUTORIAL_DONE) === '1' ? -1 : 0,
  )
  const seenEventsRef = useRef(0)
  const lineIdRef = useRef(0)

  const pushLines = useCallback((events: EngineEvent[], prevSeen: number) => {
    const fresh = events.slice(prevSeen)
    if (fresh.length === 0) return
    setLines((old) => {
      const added: JudgeLine[] = []
      for (const ev of fresh) {
        const p = (ev.payload ?? {}) as Record<string, unknown>
        if (ev.type === 'court_card_resolved') {
          added.push({
            id: ++lineIdRef.current,
            text: (p.judgeComment as string) ?? (p.hit ? '牌面成立。' : '牌面效力不足。'),
            tone: p.hit ? 'hit' : 'miss',
          })
        } else if (ev.type === 'court_balance_update') {
          added.push({
            id: ++lineIdRef.current,
            text: (p.reason as string) ?? '天平发生了变化。',
            tone: String(p.reason ?? '').includes('反驳') ? 'rebuttal' : 'judge',
          })
        } else if (ev.type === 'game_result') {
          // 结果在外面统一处理，这里不口播。
        }
      }
      return [...old, ...added].slice(-8)
    })
  }, [])

  const applyResponse = useCallback((resp: { snapshot: CourtSnapshot; events: EngineEvent[] } & { result?: GameResultLike; relationshipChange?: { delta: number; toType: string; reason: string } | null; resultCard?: Record<string, unknown> | null; streak?: { current: number; best: number } }, prevSeen: number) => {
    setSnap(resp.snapshot)
    seenEventsRef.current = resp.events.length
    pushLines(resp.events, prevSeen)
    // R5：路由层返回的结算钩子数据优先。
    if (resp.result) setResult(resp.result)
    if (resp.relationshipChange) setRelationshipChange(resp.relationshipChange)
    if (resp.resultCard) setResultCard(resp.resultCard)
    if (resp.streak) setStreak(resp.streak)
    // game_result 事件 → 结算面板（兜底）
    const resultEv = resp.events.find((e) => e.type === 'game_result')
    if (resultEv?.payload && !result && !resp.result) {
      setResult((resultEv.payload as { result: GameResultLike }).result)
    }
  }, [pushLines, result])

  // 开局 + 每日挑战
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setBusy(true)
      try {
        const [game, d] = await Promise.all([createCourtGame('plaintiff'), getCourtDailyChallenge()])
        if (cancelled) return
        setId(game.id)
        seenEventsRef.current = game.events.length
        setSnap(game.snapshot)
        setDaily(d)
        setLines([{
          id: ++lineIdRef.current,
          text: '开庭！争议焦点已列在上方，天平居中在你方与对方之间。',
          tone: 'judge',
        }])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '开局失败')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const state = snap?.state ?? null
  const mySide = state?.playerSide ?? 'plaintiff'
  const myAmmo = state ? state.ammo[mySide] : 0
  const myBalance = state ? Math.round(state.balance[mySide]) : 50
  const isPlayerTurn = Boolean(snap && snap.phase === 'playing' && state?.stage === 'player_turn')
  const isDone = Boolean(snap && snap.phase === 'results')

  const submitCard = useCallback(async (card: CourtCardKind) => {
    if (!id || busy) return
    setBusy(true)
    setError('')
    const prevSeen = seenEventsRef.current
    try {
      const resp = await playCourtCard(id, {
        card,
        ...(card === 'evidence' && pickedEvidence ? { targetEvidenceId: pickedEvidence.id } : {}),
        ...(card === 'attack' || card === 'request_record' ? { freeText: draft.trim() } : {}),
        ...(card === 'mock' && draft.trim() ? { freeText: draft.trim() } : {}),
      })
      applyResponse(resp, prevSeen)
      setPendingCard(null)
      setDraft('')
      setPickedEvidence(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '出牌失败')
    } finally {
      setBusy(false)
    }
  }, [id, busy, pickedEvidence, draft, applyResponse])

  const endTurn = useCallback(async () => {
    if (!id || busy) return
    setBusy(true)
    setError('')
    const prevSeen = seenEventsRef.current
    try {
      const resp = await passCourtTurn(id)
      applyResponse(resp, prevSeen)
    } catch (e) {
      setError(e instanceof Error ? e.message : '认输失败')
    } finally {
      setBusy(false)
    }
  }, [id, busy, applyResponse])

  const restart = useCallback(() => {
    window.location.reload()
  }, [])

  const tutorialDone = useCallback(() => {
    try { window.localStorage.setItem(LS_TUTORIAL_DONE, '1') } catch { /* noop */ }
    setTutorialStep(-1)
  }, [])

  // 档案上报（胜负）
  useEffect(() => {
    if (result && snap) {
      const win = result.winner === 'slot-0'
      try {
        submitGameResult('court', {
          won: win,
          score: result.scores['slot-0'] ?? 0,
          detail: { tier: result.tier.label },
        })
      } catch { /* 档案上报失败不阻断 */ }
    }
  }, [result, snap])

  const unresolved = state?.unresolved ?? []
  const resolved = state?.resolved ?? []
  const evidencePool = state?.evidencePool ?? []

  const balancePct = Math.max(0, Math.min(100, myBalance))

  return (
    <div data-testid="new-court-game" style={{
      position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column',
      pointerEvents: 'none', fontFamily: 'inherit',
    }}>
      {/* 顶栏 */}
      <div style={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        background: 'linear-gradient(180deg, rgba(20,12,6,0.92), rgba(20,12,6,0.78))',
        borderBottom: '1px solid rgba(255,208,106,0.25)',
      }}>
        <button onClick={onExit} style={iconBtn} data-testid="court-exit"><ArrowLeft size={15} /></button>
        <Gavel size={16} color="#ffd06a" />
        <span style={{ fontSize: 16, fontWeight: 800, color: '#ffd06a' }}>⚖ 趣味法庭 · 牌面对决</span>
        <span style={{ fontSize: 11, color: 'rgba(255,240,214,0.55)' }}>3 轮 · 天平定胜负</span>
        <div style={{ flex: 1 }} />
        {onSwitchSignature && (
          <button onClick={onSwitchSignature} style={ghostBtn} data-testid="court-signature-btn">🎭 招牌模式</button>
        )}
        {onSwitchClassic && (
          <button onClick={onSwitchClassic} style={ghostBtn} data-testid="court-classic-btn">经典模式</button>
        )}
      </div>

      {/* 每日挑战横幅 */}
      {daily && (
        <div data-testid="court-daily-banner" style={{
          pointerEvents: 'auto', margin: '8px 14px 0', padding: '6px 12px', borderRadius: 8,
          background: 'rgba(255,208,106,0.12)', border: '1px solid rgba(255,208,106,0.4)',
          fontSize: 12, color: '#ffe6a8', display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <Sparkles size={13} />
          <b>每日挑战：{daily.title}</b>
          <span style={{ color: 'rgba(255,230,168,0.7)' }}>{daily.modifier} · {daily.description}</span>
        </div>
      )}

      {/* 天平 + 轮次 */}
      <div style={{
        pointerEvents: 'auto', margin: '10px 14px 0', padding: '10px 14px', borderRadius: 10,
        background: 'rgba(10,6,3,0.82)', border: '1px solid rgba(255,208,106,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: '#9ecbff', fontWeight: 700 }}>你方 {state ? state.balance[mySide] : 50}</span>
          <span data-testid="court-round" style={{ color: '#ffd06a', fontWeight: 800 }}>
            第 {state?.round ?? 0}/{snap?.maxRounds ?? 3} 轮 · 弹药 {myAmmo}
          </span>
          <span style={{ color: '#ff9db0', fontWeight: 700 }}>对方 {state ? state.balance[mySide === 'plaintiff' ? 'defendant' : 'plaintiff'] : 50}</span>
        </div>
        <div style={{ position: 'relative', height: 14, borderRadius: 7, overflow: 'hidden', display: 'flex', background: 'rgba(255,255,255,0.08)' }}>
          <div data-testid="court-balance" style={{
            width: `${balancePct}%`, background: 'linear-gradient(90deg, #4a90d9, #9ecbff)',
            transition: 'width 0.9s cubic-bezier(0.22,1,0.36,1)',
          }} />
          <div style={{ flex: 1, background: 'linear-gradient(90deg, #d94a6a, #ff9db0)' }} />
        </div>
        {/* 争议焦点 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,240,214,0.5)' }}>争议焦点：</span>
          {unresolved.map((p) => (
            <span key={p} data-testid="court-unresolved" style={chip('#ffd06a', 'rgba(255,208,106,0.15)')}>◌ {p}</span>
          ))}
          {resolved.map((p) => (
            <span key={p} style={chip('#7ee0c0', 'rgba(126,224,192,0.12)')}>✓ {p}</span>
          ))}
        </div>
      </div>

      {/* 法官口播流 */}
      <div style={{ pointerEvents: 'auto', margin: '8px 14px 0', maxHeight: 110, overflowY: 'auto' }}>
        {lines.map((l) => (
          <div key={l.id} data-testid="court-judge-line" style={{
            fontSize: 12.5, lineHeight: 1.5, padding: '5px 10px', marginBottom: 4, borderRadius: 6,
            background: l.tone === 'hit' ? 'rgba(126,224,192,0.14)'
              : l.tone === 'miss' ? 'rgba(255,122,89,0.12)'
              : l.tone === 'rebuttal' ? 'rgba(255,157,176,0.12)'
              : 'rgba(255,255,255,0.05)',
            borderLeft: `3px solid ${l.tone === 'hit' ? '#7ee0c0' : l.tone === 'miss' ? '#ff7a59' : l.tone === 'rebuttal' ? '#ff9db0' : '#ffd06a'}`,
            color: '#f4e8d0',
          }}>
            {l.tone === 'judge' ? '法官：' : l.tone === 'hit' ? '✅ 命中：' : l.tone === 'rebuttal' ? '⚡ 对方反驳：' : '⚠️ '}
            {l.text}
          </div>
        ))}
      </div>

      {/* 底部手牌区 */}
      {!isDone && (
        <div style={{ marginTop: 'auto', pointerEvents: 'auto', padding: '10px 14px 14px' }}>
          {error && <div data-testid="court-error" style={{ color: '#ff8a8a', fontSize: 12, marginBottom: 6 }}>{error}</div>}

          {/* 出牌操作面板 */}
          {pendingCard && isPlayerTurn && (
            <div data-testid="court-card-action" style={{
              background: 'rgba(15,9,4,0.95)', border: '1px solid rgba(255,208,106,0.4)',
              borderRadius: 10, padding: 12, marginBottom: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#ffd06a', marginBottom: 8 }}>
                {CARD_META[pendingCard].icon} {CARD_META[pendingCard].title}
                <span style={{ fontWeight: 400, color: 'rgba(255,240,214,0.5)', marginLeft: 8 }}>{CARD_META[pendingCard].desc}</span>
              </div>
              {(pendingCard === 'attack' || pendingCard === 'request_record' || pendingCard === 'mock') && (
                <>
                  <textarea
                    data-testid="court-card-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={pendingCard === 'attack' ? '陈述你的论点，最好带上争议焦点关键词（如：凌晨扰民）…'
                      : pendingCard === 'request_record' ? '请法官记录在案的事实…' : '一句得体的幽默（别说脏话）…'}
                    rows={2}
                    style={textAreaStyle}
                  />
                </>
              )}
              {pendingCard === 'evidence' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {evidencePool.map((ev) => (
                    <button
                      key={ev.id}
                      data-testid={`court-evidence-${ev.id}`}
                      onClick={() => setPickedEvidence(ev)}
                      style={{
                        ...evidenceBtn,
                        borderColor: pickedEvidence?.id === ev.id ? '#ffd06a' : 'rgba(255,255,255,0.12)',
                        background: pickedEvidence?.id === ev.id ? 'rgba(255,208,106,0.15)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <b>{ev.name}</b><span style={{ fontSize: 11, color: 'rgba(255,240,214,0.6)' }}> — {ev.content}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => { setPendingCard(null); setDraft(''); setPickedEvidence(null) }} style={ghostBtn}>取消</button>
                <button
                  data-testid="court-submit-card"
                  onClick={() => void submitCard(pendingCard)}
                  disabled={busy || (pendingCard === 'evidence' && !pickedEvidence)}
                  style={{ ...primaryBtn, opacity: busy || (pendingCard === 'evidence' && !pickedEvidence) ? 0.5 : 1 }}
                >
                  {busy ? '审理中…' : '打出这张牌'}
                </button>
              </div>
            </div>
          )}

          {/* 4 张手牌 */}
          {isPlayerTurn && !pendingCard && (
            <div data-testid="court-hand" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {(Object.keys(CARD_META) as CourtCardKind[]).map((card) => {
                const meta = CARD_META[card]
                const affordable = myAmmo >= meta.cost
                return (
                  <button
                    key={card}
                    data-testid={`court-card-${card}`}
                    onClick={() => affordable && setPendingCard(card)}
                    disabled={!affordable || busy}
                    style={{
                      ...cardStyle,
                      opacity: affordable ? 1 : 0.4,
                      cursor: affordable ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <div style={{ fontSize: 22 }}>{meta.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#ffd06a' }}>{meta.title}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,240,214,0.55)', marginTop: 3, lineHeight: 1.3 }}>{meta.desc}</div>
                    <div style={{ fontSize: 10, marginTop: 4, color: '#9ecbff' }}>
                      {meta.cost === 0 ? '免费' : `⚡ ${meta.cost} 弹药`}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {isPlayerTurn && !pendingCard && (
            <button onClick={() => void endTurn()} disabled={busy} style={{ ...ghostBtn, width: '100%', marginTop: 8 }} data-testid="court-end-turn">
              <Zap size={13} /> 结束本轮（交给对方反驳）
            </button>
          )}
          {!isPlayerTurn && !isDone && (
            <div style={{ textAlign: 'center', color: 'rgba(255,240,214,0.6)', fontSize: 13, padding: 12 }}>
              对方律师 / 法官发言中…
            </div>
          )}
          {busy && !pendingCard && <div style={{ textAlign: 'center', color: '#ffd06a', fontSize: 12, padding: 6 }}>⌛ 审理中…</div>}
        </div>
      )}

      {/* 结算面板 */}
      {isDone && result && (
        <div data-testid="court-results" style={{
          pointerEvents: 'auto', margin: 'auto 14px 14px', padding: 18, borderRadius: 12,
          background: 'rgba(12,7,3,0.95)', border: '1px solid rgba(255,208,106,0.5)',
          textAlign: 'center',
        }}>
          <Trophy size={30} color="#ffd06a" />
          <div style={{ fontSize: 24, fontWeight: 900, color: result.winner === 'slot-0' ? '#7ee0c0' : '#ff9db0', margin: '6px 0' }}>
            {result.winner === 'slot-0' ? '胜诉！' : result.winner == null ? '平局' : '惜败'}
          </div>
          <div style={{ fontSize: 14, color: '#ffd06a', fontWeight: 700 }}>段位：{result.tier.label}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,240,214,0.6)', marginTop: 4 }}>
            你方天平 {result.scores['slot-0'] ?? 0} : {result.scores['slot-1'] ?? 0}
          </div>
          {/* R5：关系变化 + 连胜 */}
          {relationshipChange && (
            <div data-testid="court-relationship" style={{ fontSize: 12.5, color: '#9ecbff', marginTop: 8 }}>
              与对方名人关系：{relationshipChange.delta >= 0 ? '+' : ''}{relationshipChange.delta}（{relationshipChange.toType}）· {relationshipChange.reason}
            </div>
          )}
          {streak && (
            <div data-testid="court-streak" style={{ fontSize: 12.5, color: '#ffd06a', marginTop: 4 }}>
              🔥 当前 {streak.current > 0 ? `${streak.current} 连胜` : streak.current < 0 ? `${Math.abs(streak.current)} 连败` : '无连胜'} · 最佳 {streak.best}
            </div>
          )}
          <div style={{ textAlign: 'left', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,240,214,0.55)' }}>高光时刻：</div>
            {result.highlights.map((h, i) => (
              <div key={i} data-testid="court-highlight" style={{ fontSize: 12.5, color: '#f4e8d0' }}>· {h}</div>
            ))}
          </div>
          {/* R5：战果卡 */}
          {resultCard && (
            <div data-testid="court-result-card" style={{ marginTop: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,208,106,0.25)', borderRadius: 8, padding: 8, display: 'flex', gap: 8 }}>
              <button data-testid="court-copy-card" onClick={() => {
                const text = resultCardToText(resultCard as never as Parameters<typeof resultCardToText>[0])
                navigator.clipboard?.writeText(text).then(() => { setCopyStatus('已复制文案'); window.setTimeout(() => setCopyStatus(''), 1800) }).catch(() => { setCopyStatus('复制失败') })
              }} style={ghostBtn}>{copyStatus || '复制战果文案'}</button>
              <button data-testid="court-share-card" onClick={() => {
                const text = resultCardToText(resultCard as never as Parameters<typeof resultCardToText>[0])
                if (navigator.share) navigator.share({ text }).catch(() => {})
                else navigator.clipboard?.writeText(text).catch(() => {})
              }} style={ghostBtn}>分享</button>
            </div>
          )}
          <button onClick={restart} style={{ ...primaryBtn, width: '100%', marginTop: 14 }} data-testid="court-again">再来一局（指名同一对手）</button>
        </div>
      )}

      {/* 新手引导浮层 */}
      {tutorialStep >= 0 && tutorialStep < TUTORIAL.length && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
        }} data-testid="court-tutorial" onClick={tutorialDone}>
          <div onClick={(e) => e.stopPropagation()} style={{
            maxWidth: 380, padding: 22, borderRadius: 14, background: '#1a1208',
            border: '1px solid rgba(255,208,106,0.5)', color: '#f4e8d0',
          }}>
            <div style={{ fontSize: 12, color: '#ffd06a', letterSpacing: 2 }}>新手引导 {tutorialStep + 1}/{TUTORIAL.length}</div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: '8px 0' }}>{TUTORIAL[tutorialStep].title}</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>{TUTORIAL[tutorialStep].desc}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={tutorialDone} style={ghostBtn} data-testid="court-tutorial-skip">跳过引导</button>
              <button onClick={() => setTutorialStep((s) => s + 1)} style={primaryBtn} data-testid="court-tutorial-next">
                {tutorialStep === TUTORIAL.length - 1 ? '开始庭审' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!snap && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd06a' }}>
          <Scale size={28} className="spin" /> 法庭布置中…
        </div>
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}'}</style>
    </div>
  )
}

function chip(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: 11, padding: '2px 8px', borderRadius: 999, color, background: bg,
    border: `1px solid ${color}55`,
  }
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#f4e8d0', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
  color: '#f4e8d0', fontSize: 12.5, cursor: 'pointer',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 16px',
  borderRadius: 8, background: '#ffd06a', border: 'none', color: '#1a1208',
  fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
}
const cardStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
  padding: '10px 6px', borderRadius: 10, background: 'rgba(20,12,6,0.92)',
  border: '1px solid rgba(255,208,106,0.35)', cursor: 'pointer',
}
const evidenceBtn: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)', color: '#f4e8d0', fontSize: 12.5, cursor: 'pointer',
}
const textAreaStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7,
  border: '1px solid rgba(255,208,106,0.35)', background: '#0d0803', color: '#f4e8d0',
  fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit',
}
