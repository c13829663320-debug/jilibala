import { useState } from 'react'
import type { WerewolfDayAction, WerewolfPublicPlayer, WerewolfRole } from '@balabala/shared'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'
const RED = '#ff2a3a'

const CLAIM_ROLES: Array<{ role: 'seer' | 'witch' | 'hunter' | 'villager'; label: string; emoji: string }> = [
  { role: 'seer', label: '预言家', emoji: '🔮' },
  { role: 'witch', label: '女巫', emoji: '🧪' },
  { role: 'hunter', label: '猎人', emoji: '🏹' },
  { role: 'villager', label: '村民', emoji: '👤' },
]

/**
 * Round2：白天 90s 自由发言窗口左侧常驻动作条。
 * [起跳身份] [报查验结果] [怀疑某人] [辩护某人] [划水过]
 */
export default function DayActionBar({
  players,
  mySeat,
  myRole,
  seerResults,
  secondsLeft,
  onAction,
}: {
  players: WerewolfPublicPlayer[]
  mySeat: number
  myRole?: WerewolfRole
  seerResults?: Array<{ seat: number; isWolf: boolean; day: number }>
  secondsLeft: number
  onAction: (a: WerewolfDayAction) => void
}) {
  const [pickMode, setPickMode] = useState<'suspect' | 'defend' | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const others = players.filter((p) => p.alive && p.seat !== mySeat)
  const isSeer = myRole === 'seer'

  return (
    <div style={{ marginBottom: 12, padding: 10, background: '#0F0F0F', borderRadius: 10, border: '1px solid rgba(255,214,0,0.35)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: YELLOW }}>🗣️ 发言动作条</span>
        <span style={{ fontSize: 12, color: secondsLeft <= 15 ? RED : 'rgba(237,237,240,0.5)' }}>
          窗口剩 {secondsLeft}s
        </span>
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <ActBtn label="🎭 起跳身份" color={YELLOW} onClick={() => { setClaimOpen((v) => !v); setPickMode(null); setReportOpen(false) }} />
        <ActBtn label="📋 报查验" color="#7e52c7" disabled={!isSeer} onClick={() => { setReportOpen((v) => !v); setClaimOpen(false); setPickMode(null) }} />
        <ActBtn label="❓ 怀疑" color={RED} onClick={() => { setPickMode('suspect'); setClaimOpen(false); setReportOpen(false) }} />
        <ActBtn label="🛡️ 辩护" color={TEAL} onClick={() => { setPickMode('defend'); setClaimOpen(false); setReportOpen(false) }} />
        <ActBtn label="💧 划水过" color="#8a90a6" onClick={() => onAction({ kind: 'pass' })} />
      </div>

      {claimOpen && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)', marginBottom: 5 }}>公开宣告你的身份（若真预言家已跳则对跳）：</div>
          {CLAIM_ROLES.map((r) => (
            <button key={r.role} onClick={() => { onAction({ kind: 'claim_role', role: r.role }); setClaimOpen(false) }} style={chipBtn}>
              {r.emoji} {r.label}
            </button>
          ))}
        </div>
      )}

      {reportOpen && isSeer && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)', marginBottom: 5 }}>公布一条你的查验结果：</div>
          {(seerResults ?? []).length === 0 && <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.35)' }}>你还没有查验结果。</div>}
          {(seerResults ?? []).map((r) => (
            <button key={r.seat} onClick={() => { onAction({ kind: 'report_check', seat: r.seat, isWolf: r.isWolf }); setReportOpen(false) }} style={chipBtn}>
              {r.day}天 · {r.seat + 1}号 = {r.isWolf ? '🐺狼人' : '☀️好人'}
            </button>
          ))}
        </div>
      )}

      {pickMode && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)', marginBottom: 5 }}>
            {pickMode === 'suspect' ? '选择你怀疑的存活玩家：' : '选择你要辩护的存活玩家：'}
          </div>
          {others.map((p) => (
            <button
              key={p.seat}
              onClick={() => { onAction({ kind: pickMode, seat: p.seat }); setPickMode(null) }}
              style={targetBtn(pickMode === 'suspect' ? RED : TEAL)}
            >
              {p.seat + 1}号 · {p.nickname}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActBtn({ label, color, disabled, onClick }: { label: string; color: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      flex: '1 1 40%', padding: '7px 6px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 12, border: 'none', background: disabled ? '#2a2a2a' : color,
      color: disabled ? '#666' : '#000', fontWeight: 700, opacity: disabled ? 0.5 : 1,
    }}>{label}</button>
  )
}

const chipBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
  padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
  background: '#141414', color: '#EDEDF0', fontSize: 12, cursor: 'pointer',
}

const targetBtn = (color: string): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
  padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  border: `1px solid ${color}55`, background: `${color}18`, color: '#EDEDF0',
})
