// ===== M14：三关结算 · 总分 + 段位 + 打卡 + R5 钩子四件套 =====
import { useEffect, useRef, useState } from 'react'
import {
  CIRCUIT_TIER_META,
  CIRCUIT_STATIONS,
  HIGHLIGHT_TYPE_LABEL,
  RELATIONSHIP_TYPE_LABEL,
  type CircuitTier,
  type StationResult,
} from '@balabala/shared'
import { submitGameResult } from '../profile'
import type { GymGameResult } from './engine'

interface Props {
  results: StationResult[]
  total: number
  tier: CircuitTier
  checking: boolean
  checked: boolean
  /** R5: 引擎结算钩子数据（高光/关系/连胜/战果卡）。 */
  hooks?: GymGameResult | null
  onCheckin: () => void
  onExit: () => void
}

const STATION_NAME = Object.fromEntries(CIRCUIT_STATIONS.map((s) => [s.kind, s.title])) as Record<string, string>

export default function CircuitResults({ results, total, tier, checking, checked, hooks, onCheckin, onExit }: Props) {
  const meta = CIRCUIT_TIER_META[tier]
  // 全局档案上报一次：金/爆杆段位视为获胜，总分作为 bestScore。
  const reportedRef = useRef(false)
  useEffect(() => {
    if (reportedRef.current) return
    reportedRef.current = true
    submitGameResult('gym', { won: tier === 'gold' || tier === 'explosive', score: total })
  }, [total, tier])

  const [copied, setCopied] = useState(false)
  const shareText = hooks?.resultCardText ?? ''
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用 */ }
  }

  const rel = hooks?.relationshipChanges?.[0]
  const replayCta = (() => {
    if (!hooks) return null
    if (hooks.comeback || hooks.settlementType === 'big_win') return '新纪录！挑战更高难度？'
    if (hooks.settlementType === 'narrow_loss' || hooks.settlementType === 'big_loss') return '教练说：还差一点，再来一组？'
    return '状态不错，再来一组保持节奏？'
  })()

  return (
    <div className="cc-center">
      <div className="cc-station-label">三关完成</div>
      <div className="cc-tier">{meta.emoji} {meta.label}</div>
      <div style={{ fontSize: 52, fontWeight: 900, color: '#ffd600', fontVariantNumeric: 'tabular-nums' }}>{total}</div>
      <div style={{ color: 'rgba(237,237,240,0.55)', fontSize: 13, marginBottom: 18 }}>总分（反应 + 节奏 + 力量）</div>

      {results.map((r) => (
        <div key={r.kind} className="cc-result-row">
          <span>{STATION_NAME[r.kind]}</span>
          <span style={{ fontWeight: 800, color: '#ffd600' }}>{r.score}</span>
        </div>
      ))}

      {/* R5: 高光回放 */}
      {hooks && hooks.capturedHighlights.length > 0 && (
        <div style={{ marginTop: 16, width: '100%' }}>
          <div style={{ fontSize: 12, color: '#4fb3a5', letterSpacing: 2, marginBottom: 6 }}>高光回放</div>
          {hooks.capturedHighlights.map((h) => (
            <div key={h.id} style={{ fontSize: 13, color: '#ffd600', padding: '3px 0' }}>
              ✦ 【{HIGHLIGHT_TYPE_LABEL[h.type] ?? '高光'}】{h.description}
            </div>
          ))}
        </div>
      )}

      {/* R5: 教练关系变化 */}
      {rel && (
        <div style={{ marginTop: 12, fontSize: 13, color: rel.delta >= 0 ? '#4fb3a5' : '#ff6b6b' }}>
          教练好感度 {rel.delta >= 0 ? '+' : ''}{rel.delta}（{RELATIONSHIP_TYPE_LABEL[rel.fromType]} → {RELATIONSHIP_TYPE_LABEL[rel.toType]}）
          <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.6)', marginTop: 2 }}>{rel.reason}</div>
        </div>
      )}

      {/* R5: 连胜 */}
      {hooks && hooks.streak.current > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#ffd600' }}>
          🔥 连续挑战 {hooks.streak.current} 次{hooks.streak.current >= hooks.streak.best ? '（新纪录！）' : ''}
        </div>
      )}
      {hooks?.comeback && (
        <div style={{ marginTop: 6, fontSize: 13, color: '#ff9f43' }}>⚡ 逆风翻盘：前两关落后，力量关爆发！</div>
      )}

      {/* R5: 再来一局钩子 */}
      {replayCta && (
        <div style={{ marginTop: 14, fontSize: 13.5, color: '#4fb3a5', fontStyle: 'italic' }}>「{replayCta}」</div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="cc-btn" disabled={checking || checked} onClick={onCheckin}>
          {checked ? '✓ 已打卡' : checking ? '打卡中…' : '完成打卡'}
        </button>
        {shareText && (
          <button className="cc-btn--ghost cc-btn" onClick={() => void copyShare()}>
            {copied ? '✓ 已复制' : '复制战果卡'}
          </button>
        )}
        <button className="cc-btn--ghost cc-btn" onClick={onExit}>返回健身房</button>
      </div>
      {checked && <div style={{ marginTop: 10, fontSize: 12, color: '#4fb3a5' }}>连续天数已累计，教练金句已记录。</div>}
    </div>
  )
}
