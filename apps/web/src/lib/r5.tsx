// ============================================================================
// R5 · 结算演出面板（talkshow / werewolf / bar 三场景共用）
// 渲染：高光回放 / 关系变化 / 连胜 / 战果卡（复制文案+分享）/ 再来一局钩子。
// ============================================================================
import { Copy, Flame, Share2, Sparkles, Trophy, Users, TrendingUp } from 'lucide-react'

export interface R5Highlight {
  id: string
  scene: string
  type: string
  timestamp: number
  round?: number
  description: string
  data?: Record<string, unknown>
}

export interface R5RelationshipChange {
  celebrityId: string
  delta: number
  fromType: string
  toType: string
  reason: string
  newUnlock?: string
}

export interface R5ResultCard {
  scene: string
  sceneLabel: string
  result: 'win' | 'draw' | 'loss'
  settlementType: string
  score: number
  maxScore: number
  tier: { level: string; label: string }
  rankPoints: number
  streak: { current: number; best: number; isNewBest: boolean }
  highlights: R5Highlight[]
  relationshipChanges: R5RelationshipChange[]
  opponent: { id: string; name: string; type: string }
}

export interface R5Bundle {
  relationshipChanges: R5RelationshipChange[]
  highlights: R5Highlight[]
  streak: { current: number; best: number; isNewBest: boolean }
  resultCard: R5ResultCard
  comeback: boolean
  settlementType: string
}

const SETTLEMENT_LABEL: Record<string, string> = {
  big_win: '大胜！',
  narrow_win: '小胜',
  comeback_win: '逆风翻盘！',
  draw: '平局',
  narrow_loss: '惜败',
  big_loss: '惨败',
}

const REL_LABEL: Record<string, string> = {
  stranger: '陌路',
  acquaintance: '点头之交',
  friend: '好友',
  close: '知己',
  soulmate: '灵魂搭档',
  rival: '宿敌',
}

const HL_ICON: Record<string, string> = {
  key_evidence: '🔍',
  golden_quote: '🏆',
  epic_rebuttal: '⚡',
  prophet_vote: '🔮',
  extreme_performance: '💪',
  high_combo: '🔁',
  comeback: '🔄',
  perfect_round: '✨',
}

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

/** 根据结算包推导「再来一局」钩子文案。 */
export function nextHookText(bundle: R5Bundle): string {
  const result = bundle.resultCard.result
  const { streak, comeback } = bundle
  const oppName = bundle.resultCard.opponent.name
  if (comeback) return '惊天翻盘！再战一局巩固地位？'
  if (result === 'loss') return `${oppName}表示不服，再来一局？`
  if (streak.current >= 2) return `已 ${streak.current} 连胜，继续挑战？`
  if (bundle.relationshipChanges.some((c) => c.newUnlock)) return `与名人关系提升，解锁专属内容！`
  return '状态不错，再来一局？'
}

export default function R5SettlementPanel({
  bundle,
  shareText,
  onAgain,
}: {
  bundle: R5Bundle
  shareText?: string
  onAgain: () => void
}) {
  const { resultCard, settlementType, streak, highlights, relationshipChanges } = bundle
  const result = resultCard.result

  const copyText = async () => {
    const text = shareText ?? ''
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  const share = async () => {
    const text = shareText ?? ''
    try {
      if (navigator.share) await navigator.share({ text })
    } catch {
      /* 用户取消 / 不支持 */
    }
  }

  return (
    <div data-testid="r5-settlement" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 翻盘横幅 */}
      {bundle.comeback && (
        <div data-testid="r5-comeback" style={{
          padding: '10px 12px', borderRadius: 10, textAlign: 'center',
          background: 'linear-gradient(120deg, rgba(255,42,58,0.25), rgba(255,214,0,0.2))',
          border: `1px solid ${YELLOW}`, color: YELLOW, fontWeight: 900, fontSize: 15,
        }}>
          🔄 逆风翻盘！{SETTLEMENT_LABEL[settlementType] ?? settlementType}
        </div>
      )}

      {/* 战果卡头 */}
      <div style={{
        padding: 14, borderRadius: 12, textAlign: 'center',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.5)' }}>
          {resultCard.sceneLabel} · 对手 {resultCard.opponent.name}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 900, margin: '4px 0',
          color: result === 'win' ? YELLOW : result === 'loss' ? TEAL : 'rgba(237,237,240,0.8)',
        }} data-testid="r5-verdict">
          {SETTLEMENT_LABEL[settlementType] ?? settlementType}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.7)' }}>
          {resultCard.tier.label} · 得分 {resultCard.score}/{resultCard.maxScore} · 排位 {resultCard.rankPoints >= 0 ? '+' : ''}{resultCard.rankPoints}
        </div>
      </div>

      {/* 连胜 */}
      <div data-testid="r5-streak" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        background: streak.current > 0 ? 'rgba(255,107,40,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${streak.current > 0 ? '#ff6b28' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10,
      }}>
        {streak.current > 0
          ? <Flame size={18} color="#ff6b28" />
          : <TrendingUp size={18} color="rgba(237,237,240,0.4)" />}
        <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.85)' }}>
          {streak.current > 0
            ? <><b style={{ color: '#ff6b28' }}>{streak.current} 连胜</b>{streak.isNewBest ? ' · 新纪录！' : ''}</>
            : streak.current < 0
              ? <>{Math.abs(streak.current)} 连败</>
              : '无连胜'}
          <span style={{ color: 'rgba(237,237,240,0.45)', marginLeft: 8 }}>最佳 {streak.best}</span>
        </div>
      </div>

      {/* 高光回放 */}
      {highlights.length > 0 && (
        <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Sparkles size={13} /> 高光时刻
          </div>
          {highlights.map((h) => (
            <div key={h.id} data-testid={`r5-hl-${h.id}`} style={{
              fontSize: 13, lineHeight: 1.6, color: 'rgba(237,237,240,0.9)', marginBottom: 4,
            }}>
              <span style={{ marginRight: 6 }}>{HL_ICON[h.type] ?? '⭐'}</span>
              {h.description}
            </div>
          ))}
        </div>
      )}

      {/* 关系变化 */}
      {relationshipChanges.length > 0 && (
        <div style={{ padding: '10px 12px', background: 'rgba(79,179,165,0.06)', borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Users size={13} /> 名人关系
          </div>
          {relationshipChanges.map((c, i) => (
            <div key={i} data-testid={`r5-rel-${i}`} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
              <span style={{ color: c.delta >= 0 ? TEAL : '#ff8a8a', fontWeight: 700 }}>
                {c.delta >= 0 ? '+' : ''}{c.delta}
              </span>
              <span style={{ color: 'rgba(237,237,240,0.7)', marginLeft: 6 }}>
                {REL_LABEL[c.fromType] ?? c.fromType} → {REL_LABEL[c.toType] ?? c.toType}
              </span>
              {c.newUnlock && (
                <span style={{ color: YELLOW, marginLeft: 6, fontSize: 11 }}>🎁 解锁 {c.newUnlock}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 复制 / 分享 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={copyText} data-testid="r5-copy" style={{ ...miniBtn, flex: 1 }}>
          <Copy size={13} /> 复制文案
        </button>
        <button onClick={share} data-testid="r5-share" style={{ ...miniBtn, flex: 1 }}>
          <Share2 size={13} /> 分享
        </button>
      </div>

      {/* 再来一局钩子 */}
      <button onClick={onAgain} data-testid="r5-again" style={{ ...primaryAgain, width: '100%' }}>
        <Trophy size={14} /> {nextHookText(bundle)}
      </button>
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8, color: '#EDEDF0', fontSize: 13, cursor: 'pointer',
}

const primaryAgain: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '11px 16px', background: YELLOW, border: 'none', borderRadius: 8,
  color: '#0A0A0A', fontSize: 14, fontWeight: 800, cursor: 'pointer',
}
