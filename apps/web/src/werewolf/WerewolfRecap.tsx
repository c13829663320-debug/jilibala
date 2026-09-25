import { Upload, Crown, Skull, Brain } from 'lucide-react'
import type { WerewolfPersonalReport, WerewolfPublicPlayer, WerewolfReportData, WerewolfRole } from '@balabala/shared'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'
const RED = '#ff2a3a'

const ROLE_INFO: Record<WerewolfRole, { label: string; emoji: string }> = {
  werewolf: { label: '狼人', emoji: '🐺' },
  seer: { label: '预言家', emoji: '🔮' },
  witch: { label: '女巫', emoji: '🧪' },
  hunter: { label: '猎人', emoji: '🏹' },
  villager: { label: '村民', emoji: '👤' },
}

/** Round2：结束后复盘页 —— 胜负 + 我的角色 + 关键行动 + 推理分 + MVP + 高光。 */
export default function WerewolfRecap({
  winner,
  personal,
  perf,
  publicReport,
  players,
  publishing,
  publishMsg,
  onPublish,
  onRestart,
  onPlaza,
}: {
  winner: 'wolf' | 'good' | null
  personal: WerewolfPersonalReport | null
  perf: { score: number; survivedDays: number; voteAccuracy: number; correctVotes: number; totalVotes: number; won: boolean; side: 'wolf' | 'good' } | null
  publicReport: WerewolfReportData | null
  players: WerewolfPublicPlayer[]
  publishing: boolean
  publishMsg: string
  onPublish: () => void
  onRestart: () => void
  onPlaza?: () => void
}) {
  const winColor = winner === 'wolf' ? RED : TEAL
  const myRole = personal?.myRole
  const roleInfo = myRole ? ROLE_INFO[myRole] : null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', color: '#EDEDF0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
    }}>
      <div style={{
        width: 560, maxHeight: '92vh', overflowY: 'auto', padding: 20,
        background: '#0d0d0d', border: '1px solid rgba(255,214,0,0.25)', borderRadius: 16,
      }}>
        {/* 胜负 */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 52 }}>{winner === 'wolf' ? '🐺' : '☀️'}</div>
          <h2 style={{ margin: '6px 0', fontSize: 28, color: winColor }}>
            {winner === 'wolf' ? '狼人胜利' : '好人胜利'}
          </h2>
          <p style={{ color: 'rgba(237,237,240,0.48)', fontSize: 13 }}>共 {publicReport?.totalDays ?? '?'} 天 · 9 人局</p>
        </div>

        {/* 我的角色 + 推理分 */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 14, padding: 14, borderRadius: 12,
          background: 'rgba(255,214,0,0.07)', border: '1px solid rgba(255,214,0,0.3)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.45)' }}>我的身份</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: YELLOW }}>
              {roleInfo ? `${roleInfo.emoji} ${roleInfo.label}` : '—'}
            </div>
            {perf && (
              <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.65)', marginTop: 6, lineHeight: 1.7 }}>
                <div>生存 {perf.survivedDays} 天 · 投票正确 {perf.correctVotes}/{perf.totalVotes}</div>
                <div style={{ color: perf.won ? TEAL : RED }}>{perf.won ? '阵营胜利' : '阵营惜败'}</div>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.45)' }}>推理分</div>
            <div style={{ fontSize: 40, fontWeight: 900, color: YELLOW, lineHeight: 1 }}>
              {personal?.reasoningScore ?? perf?.score ?? '—'}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(237,237,240,0.4)' }}>/100</div>
          </div>
        </div>

        {/* MVP */}
        {personal && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px',
            borderRadius: 10, background: 'rgba(255,214,0,0.12)', color: YELLOW, fontSize: 13,
          }}>
            <Crown size={15} /> MVP：{personal.mvpSeat + 1} 号玩家
          </div>
        )}

        {/* 关键行动回放 */}
        {personal && personal.myKeyActions.length > 0 && (
          <Section title="🎬 我的关键行动">
            {personal.myKeyActions.map((k, i) => (
              <div key={i} style={rowStyle}>
                <span style={{ color: 'rgba(237,237,240,0.4)', width: 44 }}>第{k.day}天</span>
                <span style={{ flex: 1 }}>{k.action}</span>
                <span style={{ color: TEAL, fontSize: 11 }}>{k.outcome}</span>
              </div>
            ))}
          </Section>
        )}

        {/* 高光 */}
        {personal && personal.highlights.length > 0 && (
          <Section title="✨ 本局高光">
            {personal.highlights.map((h, i) => (
              <div key={i} style={{ ...rowStyle, border: 'none', padding: '4px 0' }}>
                <Brain size={12} color={TEAL} /> <span style={{ fontSize: 12.5 }}>{h}</span>
              </div>
            ))}
          </Section>
        )}

        {/* 全员身份揭示 */}
        <Section title="🔓 全员身份">
          {(publicReport?.players ?? players.map((p) => ({
            seat: p.seat, nickname: p.nickname, role: 'villager' as WerewolfRole, survived: p.alive,
          }))).map((rp) => {
            const info = ROLE_INFO[rp.role]
            return (
              <div key={rp.seat} style={rowStyle}>
                <span style={{ color: 'rgba(237,237,240,0.45)', width: 34 }}>{rp.seat + 1}号</span>
                <span style={{ flex: 1 }}>{rp.nickname}</span>
                {info && <span style={{ fontSize: 13 }}>{info.emoji} {info.label}</span>}
                {!rp.survived && <Skull size={13} color="rgba(237,237,240,0.3)" />}
              </div>
            )
          })}
        </Section>

        <button onClick={onPublish} disabled={publishing} style={{
          ...btn, width: '100%', justifyContent: 'center', marginTop: 8,
          background: YELLOW, color: '#000', fontWeight: 800, padding: '12px 0',
        }}>
          <Upload size={15} /> {publishMsg || '发布战报到广场'}
        </button>
        <button onClick={onRestart} style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 8, background: '#1a1a1a' }}>
          再来一局
        </button>
        {onPlaza && (
          <button onClick={onPlaza} style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)' }}>
            去广场
          </button>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
  background: '#0a0a0a', borderRadius: 8, marginBottom: 4, fontSize: 13,
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
  background: '#1A1A1A', color: '#EDEDF0',
}
