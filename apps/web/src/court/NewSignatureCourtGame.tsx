// ============================================================================
// R5 · 名人法庭招牌模式 · 前端面板
// 案件选择 → 3 轮举证（天平 + 陪审团情绪）→ 结案陈词 → 陪审团裁决。
// 服务端权威 /api/engine/court-signature/*，前端只做渲染与操作。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Gavel, Scale, Sparkles, Trophy, Zap, Users, Drama } from 'lucide-react'
import {
  actSignatureGame, createSignatureGame, listSignatureCases,
  type CelebrityCourtCase, type SignatureResponse, type SignatureResult,
  type SignatureState, type CourtCardKind,
} from './engine-client'

const CARD_META: Record<CourtCardKind, { title: string; desc: string; cost: number; icon: string }> = {
  attack: { title: '攻击论点', desc: '陈述直击争议焦点的论点', cost: 1, icon: '⚔️' },
  evidence: { title: '出示证据', desc: '提交我方证据，命中争议点', cost: 1, icon: '📄' },
  mock: { title: '幽默嘲讽', desc: '逗乐陪审团；越界会被警告', cost: 1, icon: '🎭' },
  request_record: { title: '要求记录', desc: '请法官记录事实（不花弹药）', cost: 0, icon: '📝' },
}

interface JudgeLine { id: number; text: string; tone: 'judge' | 'hit' | 'miss' | 'rebuttal' | 'moment' | 'mood' }

export type NewSignatureCourtGameProps = {
  onExit: () => void
  /** 切回普通牌面对决。 */
  onSwitchClassic?: () => void
  /** 直达指定案件（?signature=caseId 时用）。 */
  initialCaseId?: string
}

export default function NewSignatureCourtGame({ onExit, onSwitchClassic, initialCaseId }: NewSignatureCourtGameProps) {
  const [screen, setScreen] = useState<'select' | 'game'>(initialCaseId ? 'game' : 'select')
  const [cases, setCases] = useState<CelebrityCourtCase[]>([])
  const [id, setId] = useState<string | null>(null)
  const [resp, setResp] = useState<SignatureResponse | null>(null)
  const [lines, setLines] = useState<JudgeLine[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingCard, setPendingCard] = useState<CourtCardKind | null>(null)
  const [draft, setDraft] = useState('')
  const [closing, setClosing] = useState('')
  const seenRef = useRef(0)
  const lineIdRef = useRef(0)

  // 加载案件库
  useEffect(() => {
    if (initialCaseId) return
    void (async () => {
      try {
        const r = await listSignatureCases()
        setCases(r.cases)
      } catch (e) { setError(e instanceof Error ? e.message : '案件库加载失败') }
    })()
  }, [initialCaseId])

  const pushLines = useCallback((r: SignatureResponse) => {
    const fresh = r.events.slice(seenRef.current)
    if (fresh.length === 0) return
    seenRef.current = r.events.length
    setLines((old) => {
      const added: JudgeLine[] = []
      for (const ev of fresh) {
        const p = (ev.payload ?? {}) as Record<string, unknown>
        if (ev.type === 'court_card_resolved') {
          added.push({ id: ++lineIdRef.current, tone: p.hit ? 'hit' : 'miss', text: (p.judgeComment as string) ?? '牌面结算。' })
        } else if (ev.type === 'court_balance_update') {
          added.push({ id: ++lineIdRef.current, tone: String(p.reason ?? '').includes('反驳') || String(p.reason ?? '').includes('回摆') ? 'rebuttal' : 'judge', text: (p.reason as string) ?? '天平变化。' })
        } else if (ev.type === 'jury_mood_update') {
          added.push({ id: ++lineIdRef.current, tone: 'mood', text: `🎭 陪审团情绪 ${p.juryMood}：${(p.reason as string) ?? ''}` })
        } else if (ev.type === 'dramatic_moment') {
          added.push({ id: ++lineIdRef.current, tone: 'moment', text: `🎬 ${p.text}` })
        }
      }
      return [...old, ...added].slice(-10)
    })
  }, [])

  const applyResp = useCallback((r: SignatureResponse) => {
    setResp(r)
    pushLines(r)
  }, [pushLines])

  const startGame = useCallback(async (caseId?: string) => {
    setBusy(true); setError('')
    try {
      const r = await createSignatureGame(caseId)
      setId(r.id!); seenRef.current = r.events.length
      setLines([{ id: ++lineIdRef.current, tone: 'judge', text: `${r.case?.title} —— 开庭！陪审团已就位。` }])
      applyResp(r)
      setScreen('game')
    } catch (e) { setError(e instanceof Error ? e.message : '开局失败') }
    finally { setBusy(false) }
  }, [applyResp])

  // ?signature=caseId 直达
  useEffect(() => { if (initialCaseId) void startGame(initialCaseId) }, [initialCaseId, startGame])

  const state: SignatureState | undefined = resp?.snapshot?.state
  const mySide = state?.playerSide ?? 'plaintiff'
  const myBalance = state ? state.balance[mySide] : 50
  const juryMood = state?.juryMood ?? 50
  const isPlayerTurn = Boolean(resp?.snapshot?.phase === 'playing' && state?.stage === 'player_turn')
  const isClosing = state?.stage === 'closing' && resp?.snapshot?.phase === 'playing'
  const isDone = Boolean(resp?.snapshot?.phase === 'results')
  const result: SignatureResult | null = resp?.result ?? null

  const playCard = useCallback(async (card: CourtCardKind, targetEvidenceId?: string) => {
    if (!id || busy) return
    setBusy(true); setError('')
    try {
      const r = await actSignatureGame(id, { kind: 'play_card', card, ...(targetEvidenceId ? { targetEvidenceId } : {}), freeText: draft.trim() })
      applyResp(r); setPendingCard(null); setDraft('')
    } catch (e) { setError(e instanceof Error ? e.message : '出牌失败') }
    finally { setBusy(false) }
  }, [id, busy, draft, applyResp])

  const endRound = useCallback(async () => {
    if (!id || busy) return
    setBusy(true); setError('')
    try {
      const r = await actSignatureGame(id, { kind: 'pass' })
      applyResp(r)
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }, [id, busy, applyResp])

  const submitClosing = useCallback(async () => {
    if (!id || busy) return
    setBusy(true); setError('')
    try {
      const r = await actSignatureGame(id, { kind: 'submit_closing', text: closing })
      applyResp(r)
    } catch (e) { setError(e instanceof Error ? e.message : '结案陈词提交失败') }
    finally { setBusy(false) }
  }, [id, busy, closing, applyResp])

  // ===== 案件选择页 =====
  if (screen === 'select') {
    return (
      <div data-testid="signature-case-select" style={{ position: 'absolute', inset: 0, zIndex: 20, overflowY: 'auto', background: 'rgba(12,7,3,0.96)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onExit} style={iconBtn} data-testid="signature-exit"><ArrowLeft size={15} /></button>
          <Gavel size={16} color="#ffd06a" />
          <span style={{ fontSize: 18, fontWeight: 900, color: '#ffd06a' }}>🎭 名人法庭 · 招牌模式</span>
          <div style={{ flex: 1 }} />
          {onSwitchClassic && <button onClick={onSwitchClassic} style={ghostBtn} data-testid="signature-classic-btn">经典牌面对决</button>}
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,240,214,0.6)', margin: '10px 0 16px' }}>选择一场世纪名案，担任一方律师，用天平、陪审团情绪与结案陈词赢得裁决。</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {cases.map((c) => (
            <button key={c.id} data-testid={`signature-case-${c.id}`} onClick={() => void startGame(c.id)} disabled={busy}
              style={{ textAlign: 'left', padding: 14, borderRadius: 12, background: 'linear-gradient(160deg, rgba(40,24,10,0.95), rgba(20,12,6,0.95))', border: '1px solid rgba(255,208,106,0.35)', cursor: 'pointer' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#ffd06a' }}>{c.title}</div>
              <div style={{ fontSize: 12, color: '#9ecbff', margin: '6px 0' }}>{c.celebrityPlaintiff.name} <span style={{ color: 'rgba(255,240,214,0.5)' }}>vs</span> {c.celebrityDefendant.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,240,214,0.65)', lineHeight: 1.5 }}>{c.theme}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#7ee0c0' }}>陪审团初始倾向 {c.juryBias > 0 ? '偏原告' : c.juryBias < 0 ? '偏被告' : '中立'}</div>
            </button>
          ))}
        </div>
        {error && <div style={{ color: '#ff8a8a', marginTop: 10 }}>{error}</div>}
      </div>
    )
  }

  // ===== 对局页 =====
  const myAmmo = state ? state.ammo[mySide] : 0
  const balancePct = Math.max(0, Math.min(100, myBalance))
  const unresolved = state?.unresolved ?? []
  const resolved = state?.resolved ?? []
  const evidencePool = state?.evidencePool ?? []
  const caze = result?.case ?? resp?.case

  return (
    <div data-testid="signature-game" style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'linear-gradient(180deg, rgba(20,12,6,0.94), rgba(20,12,6,0.8))', borderBottom: '1px solid rgba(255,208,106,0.25)' }}>
        <button onClick={onExit} style={iconBtn} data-testid="signature-exit"><ArrowLeft size={15} /></button>
        <Gavel size={16} color="#ffd06a" />
        <span style={{ fontSize: 14, fontWeight: 800, color: '#ffd06a' }}>{caze?.title ?? '招牌庭审'}</span>
        <div style={{ flex: 1 }} />
        {onSwitchClassic && <button onClick={onSwitchClassic} style={ghostBtn}>经典牌面对决</button>}
      </div>

      {/* 天平 + 陪审团情绪 */}
      <div style={{ margin: '10px 14px 0', padding: '10px 14px', borderRadius: 10, background: 'rgba(10,6,3,0.85)', border: '1px solid rgba(255,208,106,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: '#9ecbff', fontWeight: 700 }}>你方 {state?.balance[mySide] ?? 50}</span>
          <span data-testid="signature-round" style={{ color: '#ffd06a', fontWeight: 800 }}>第 {state?.round ?? 0}/3 轮 · 弹药 {myAmmo}</span>
          <span style={{ color: '#ff9db0', fontWeight: 700 }}>对方 {state ? state.balance[mySide === 'plaintiff' ? 'defendant' : 'plaintiff'] : 50}</span>
        </div>
        <div style={{ position: 'relative', height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', background: 'rgba(255,255,255,0.08)' }}>
          <div data-testid="signature-balance" style={{ width: `${balancePct}%`, background: 'linear-gradient(90deg,#4a90d9,#9ecbff)', transition: 'width 0.8s cubic-bezier(0.22,1,0.36,1)' }} />
          <div style={{ flex: 1, background: 'linear-gradient(90deg,#d94a6a,#ff9db0)' }} />
        </div>
        {/* 陪审团情绪条 */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,240,214,0.6)' }}>
            <span><Users size={11} /> 陪审团情绪</span>
            <span data-testid="signature-jury-mood" style={{ color: '#ffd06a', fontWeight: 700 }}>{juryMood}/100</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', marginTop: 3, overflow: 'hidden' }}>
            <div data-testid="signature-mood-bar" style={{ width: `${juryMood}%`, height: '100%', background: 'linear-gradient(90deg,#b06a3a,#ffd06a)', transition: 'width 0.6s ease' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,240,214,0.5)' }}>争议焦点：</span>
          {unresolved.map((p) => <span key={p} data-testid="signature-unresolved" style={chip('#ffd06a', 'rgba(255,208,106,0.15)')}>◌ {p}</span>)}
          {resolved.map((p) => <span key={p} style={chip('#7ee0c0', 'rgba(126,224,192,0.12)')}>✓ {p}</span>)}
        </div>
      </div>

      {/* 戏剧化事件播报 */}
      <div style={{ margin: '8px 14px 0', maxHeight: 130, overflowY: 'auto' }}>
        {lines.map((l) => (
          <div key={l.id} data-testid="signature-line" style={{
            fontSize: 12.5, lineHeight: 1.5, padding: '5px 10px', marginBottom: 4, borderRadius: 6,
            background: l.tone === 'hit' ? 'rgba(126,224,192,0.14)' : l.tone === 'miss' ? 'rgba(255,122,89,0.12)' : l.tone === 'rebuttal' ? 'rgba(255,157,176,0.12)' : l.tone === 'moment' ? 'rgba(255,208,106,0.18)' : l.tone === 'mood' ? 'rgba(158,203,255,0.10)' : 'rgba(255,255,255,0.05)',
            borderLeft: `3px solid ${l.tone === 'hit' ? '#7ee0c0' : l.tone === 'miss' ? '#ff7a59' : l.tone === 'rebuttal' ? '#ff9db0' : l.tone === 'moment' ? '#ffd06a' : l.tone === 'mood' ? '#9ecbff' : '#ffd06a'}`,
            color: '#f4e8d0',
          }}>{l.text}</div>
        ))}
      </div>

      {/* 底部操作区 */}
      <div style={{ marginTop: 'auto', padding: '10px 14px 14px' }}>
        {error && <div data-testid="signature-error" style={{ color: '#ff8a8a', fontSize: 12, marginBottom: 6 }}>{error}</div>}

        {/* 结案陈词 */}
        {isClosing && (
          <div data-testid="signature-closing" style={{ background: 'rgba(15,9,4,0.95)', border: '1px solid rgba(255,208,106,0.5)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#ffd06a', marginBottom: 6 }}>🎤 结案陈词</div>
            <p style={{ fontSize: 12, color: 'rgba(255,240,214,0.6)', marginBottom: 8 }}>向陪审团陈词——篇幅充足、援引争议焦点、多用「正义/真相/恳请」等词，天平加成越高（0-15）。</p>
            <textarea data-testid="signature-closing-input" value={closing} onChange={(e) => setClosing(e.target.value)} rows={4}
              placeholder="例如：陪审团的各位，微积分的发明优先权不容抹杀！这份手稿与 dx 的符号，是铁证。真相只有一个，请给出公正的判决……"
              style={textAreaStyle} />
            <button data-testid="signature-closing-submit" onClick={() => void submitClosing()} disabled={busy}
              style={{ ...primaryBtn, width: '100%', marginTop: 8, opacity: busy ? 0.6 : 1 }}>
              {busy ? '陪审团合议中…' : '提交结案陈词'}
            </button>
          </div>
        )}

        {/* 出牌面板 */}
        {pendingCard && isPlayerTurn && (
          <div data-testid="signature-card-action" style={{ background: 'rgba(15,9,4,0.95)', border: '1px solid rgba(255,208,106,0.4)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#ffd06a', marginBottom: 8 }}>
              {CARD_META[pendingCard].icon} {CARD_META[pendingCard].title}
            </div>
            {(pendingCard === 'attack' || pendingCard === 'request_record' || pendingCard === 'mock') && (
              <textarea data-testid="signature-card-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                placeholder={pendingCard === 'attack' ? '陈述你的论点，带上争议焦点关键词…' : '请法官记录的事实 / 一句幽默…'}
                style={textAreaStyle} />
            )}
            {pendingCard === 'evidence' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {evidencePool.map((ev) => (
                  <button key={ev.id} data-testid={`signature-evidence-${ev.id}`}
                    onClick={() => void playCard('evidence', ev.id)}
                    style={evidenceBtn}>
                    <b>{ev.name}</b>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => { setPendingCard(null); setDraft('') }} style={ghostBtn}>取消</button>
              {pendingCard !== 'evidence' && (
                <button data-testid="signature-submit-card" onClick={() => void playCard(pendingCard)} disabled={busy} style={primaryBtn}>
                  {busy ? '审理中…' : '打出这张牌'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 4 张手牌 */}
        {isPlayerTurn && !pendingCard && (
          <div data-testid="signature-hand" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {(Object.keys(CARD_META) as CourtCardKind[]).map((card) => {
              const meta = CARD_META[card]
              const affordable = myAmmo >= meta.cost
              return (
                <button key={card} data-testid={`signature-card-${card}`} onClick={() => affordable && setPendingCard(card)}
                  disabled={!affordable || busy}
                  style={{ ...cardStyle, opacity: affordable ? 1 : 0.4, cursor: affordable ? 'pointer' : 'not-allowed' }}>
                  <div style={{ fontSize: 22 }}>{meta.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#ffd06a' }}>{meta.title}</div>
                  <div style={{ fontSize: 10, marginTop: 4, color: '#9ecbff' }}>{meta.cost === 0 ? '免费' : `⚡ ${meta.cost}`}</div>
                </button>
              )
            })}
          </div>
        )}
        {isPlayerTurn && !pendingCard && (
          <button onClick={() => void endRound()} disabled={busy} style={{ ...ghostBtn, width: '100%', marginTop: 8 }} data-testid="signature-end-round">
            <Zap size={13} /> 结束本轮（对方名人反驳）
          </button>
        )}
        {!isPlayerTurn && !isDone && !isClosing && (
          <div style={{ textAlign: 'center', color: 'rgba(255,240,214,0.6)', fontSize: 13, padding: 12 }}>对方名人 / 法官发言中…</div>
        )}
      </div>

      {/* 结算页 */}
      {isDone && result && (
        <div data-testid="signature-results" style={{ margin: 'auto 14px 14px', padding: 18, borderRadius: 12, background: 'rgba(12,7,3,0.96)', border: '1px solid rgba(255,208,106,0.5)', textAlign: 'center' }}>
          <Drama size={28} color="#ffd06a" />
          <div style={{ fontSize: 24, fontWeight: 900, color: result.winner === 'slot-0' ? '#7ee0c0' : '#ff9db0', margin: '6px 0' }}>
            {result.winner === 'slot-0' ? '陪审团裁决：你方胜诉！' : result.winner == null ? '陪审团裁决：平局' : '陪审团裁决：对方胜'}
          </div>
          <div style={{ fontSize: 13, color: '#ffd06a', fontWeight: 700 }}>
            综合裁断 {result.verdictScore} · 结案陈词 +{result.closingScore} · 陪审团情绪 {result.juryMood}
          </div>
          <div style={{ textAlign: 'left', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,240,214,0.55)', marginBottom: 6 }}>🎬 名场面回放（{result.dramaticMoments.length}）：</div>
            {result.dramaticMoments.slice(0, 3).map((m, i) => (
              <div key={i} data-testid="signature-moment" style={{ fontSize: 12.5, color: '#f4e8d0', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #ffd06a' }}>{m}</div>
            ))}
          </div>
          {resp?.relationshipChange && (
            <div data-testid="signature-relationship" style={{ marginTop: 10, fontSize: 12.5, color: '#9ecbff' }}>
              与「{caze?.celebrityPlaintiff.name === resp.result ? '' : ''}对方名人」关系：
              {resp.relationshipChange.delta >= 0 ? '+' : ''}{resp.relationshipChange.delta}（{resp.relationshipChange.toType}）— {resp.relationshipChange.reason}
            </div>
          )}
          {resp?.resultCard && (
            <div data-testid="signature-result-card" style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,240,214,0.7)', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8 }}>
              📇 战果卡已生成（{result.tier.label}）
            </div>
          )}
          <button onClick={() => { setScreen('select'); setResp(null); setId(null) }} style={{ ...primaryBtn, width: '100%', marginTop: 14 }} data-testid="signature-again">再来一局 · 换个案子</button>
        </div>
      )}

      {!resp && !error && <div style={{ margin: 'auto', color: '#ffd06a' }}><Scale size={26} className="spin" /> 法庭布置中…</div>}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}'}</style>
    </div>
  )
}

function chip(color: string, bg: string): React.CSSProperties {
  return { fontSize: 11, padding: '2px 8px', borderRadius: 999, color, background: bg, border: `1px solid ${color}55` }
}
const iconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#f4e8d0', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#f4e8d0', fontSize: 12.5, cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 16px', borderRadius: 8, background: '#ffd06a', border: 'none', color: '#1a1208', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10px 6px', borderRadius: 10, background: 'rgba(20,12,6,0.92)', border: '1px solid rgba(255,208,106,0.35)', cursor: 'pointer' }
const evidenceBtn: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#f4e8d0', fontSize: 12.5, cursor: 'pointer', width: '100%' }
const textAreaStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,208,106,0.35)', background: '#0d0803', color: '#f4e8d0', fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit' }
