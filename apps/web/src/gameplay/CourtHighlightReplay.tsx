// ============================================================================
// R5 法庭招牌：判决后「高光时刻回放」。
// 利用 CourtVerdict.player_moves 逐步回放玩家出牌序列（纯前端状态机，不依赖 AI），
// 自动标记「逆转时刻」，并在结论中引用玩家关键牌原文（名场面引用）。
// ============================================================================
import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Clock, Flag, Zap } from 'lucide-react'
import type { CourtPlayerMove, CourtVerdict } from '@balabala/shared'
import { buildCourtReplay, CARD_LABEL } from './highlight'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

export default function CourtHighlightReplay({ verdict }: { verdict: CourtVerdict }) {
  const moves = verdict.player_moves ?? []
  const steps = useMemo(() => buildCourtReplay(moves), [moves])
  const [idx, setIdx] = useState(0)

  if (steps.length === 0) return null
  const step = steps[idx]
  const reverseCount = steps.filter((s) => s.isReverse).length

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        background: '#0a0a0a',
        border: '1px solid rgba(255,214,0,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: YELLOW }}>
          🎬 高光回放 {reverseCount > 0 && <span style={{ color: YELLOW }}>· {reverseCount} 次逆转</span>}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(237,237,240,0.45)' }}>
          {idx + 1} / {steps.length}
        </span>
      </div>

      {/* 天平示意 */}
      <Pendulum cum={step.cumAfter} />

      {/* 当前步 */}
      <div style={{ minHeight: 56, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 4 }}>
          <Clock size={12} color="rgba(237,237,240,0.5)" />
          <span>第 {step.round} 轮 · 打出「{CARD_LABEL[step.card]}」</span>
          {step.isReverse && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: YELLOW, fontWeight: 800, fontSize: 12 }}>
              <Zap size={12} /> 逆转时刻
            </span>
          )}
        </div>
        {step.freeText && (
          <blockquote style={{ margin: '4px 0', padding: '6px 10px', borderLeft: `3px solid ${YELLOW}`, background: 'rgba(255,214,0,0.06)', fontSize: 13, color: '#EDEDF0' }}>
            “{step.freeText}”
          </blockquote>
        )}
        {step.judgeComment && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(237,237,240,0.7)' }}>
            法官：{step.judgeComment}
          </p>
        )}
      </div>

      {/* 控制 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} style={navBtn}>
          <ArrowLeft size={14} /> 上一步
        </button>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={idx === steps.length - 1}
          style={{ ...navBtn, background: YELLOW, color: '#000', border: 'none' }}
        >
          下一步 <ArrowRight size={14} />
        </button>
        {step.isReverse && (
          <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11, color: YELLOW }}>
            <Flag size={11} style={{ verticalAlign: -1 }}> 翻盘标记</Flag>
          </span>
        )}
      </div>
    </div>
  )
}

function Pendulum({ cum }: { cum: number }) {
  // cum 范围大致 -30..+30，映射到天平条
  const clamped = Math.max(-30, Math.min(30, cum))
  const pct = 50 + (clamped / 30) * 50
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(237,237,240,0.45)', marginBottom: 4 }}>
        <span>对方占优</span>
        <span style={{ color: TEAL }}>我方优势 {cum >= 0 ? `+${cum}` : cum}</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: '#222', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.4)' }} />
        <div
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: cum >= 0 ? '50%' : `${pct}%`,
            width: `${Math.abs(pct - 50)}%`,
            background: cum >= 0 ? TEAL : '#ff6b6b',
            transition: 'all .4s',
          }}
        />
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#1a1a1a',
  color: '#EDEDF0',
  cursor: 'pointer',
  fontSize: 13,
}

/**
 * 「名场面引用」：从判决玩家出牌中挑一张最具代表性的牌，
 * 返回可嵌进判决结论的引用句（无原文时返回空串）。
 */
export function pickSignatureQuote(moves: CourtPlayerMove[] | undefined): string {
  if (!moves || moves.length === 0) return ''
  const replay = buildCourtReplay(moves)
  const rev = replay.find((s) => s.isReverse && s.freeText)
  if (rev) return rev.freeText!
  const best = replay.reduce((a, b) => (b.delta > a.delta ? b : a))
  return best.freeText ?? ''
}
