// ============================================================================
// R5 统一结算面板：各玩法结算时复用，统一展示
//   胜负 / 名人关系进展 / 本局高光 / 连胜 / 可分享战果卡 / 再来一局。
// 场景专属内容（判决书正文、身份揭示、榜单等）通过 children 注入。
// 纯展示组件，不直接读写 localStorage；连胜由调用方记录后传入。
// ============================================================================
import { useState } from 'react'
import { Copy, Heart, Share2, Sparkles, TrendingUp } from 'lucide-react'
import type { R5Highlight, R5RelationGain, R5ShareCard, R5StreakState } from '@balabala/shared'
import { r5ShareCardToText } from '@balabala/shared'
import PlayAgainBar from './PlayAgainBar'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'
const RED = '#ff2a3a'

export default function GameResultPanel({
  emoji,
  title,
  won,
  relations,
  highlights,
  streak,
  shareCard,
  onPlayAgain,
  onExit,
  playAgainLabel = '再来一局',
  children,
}: {
  emoji: string
  title: string
  won: boolean
  relations?: R5RelationGain[]
  highlights?: R5Highlight[]
  streak: R5StreakState
  shareCard?: R5ShareCard
  onPlayAgain: () => void
  onExit?: () => void
  playAgainLabel?: string
  /** 场景专属结算正文（判决书 / 榜单 / 身份揭示等）。 */
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const oneLine = highlights && highlights.length > 0
    ? (highlights.find((h) => h.isReverse) ?? highlights[0]).text
    : undefined

  const copyShare = async () => {
    if (!shareCard) return
    const text = r5ShareCardToText(shareCard)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('复制战果卡：', text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      style={{
        width: 560,
        maxWidth: '92vw',
        maxHeight: '92vh',
        overflowY: 'auto',
        padding: 22,
        borderRadius: 16,
        background: '#0d0d0d',
        border: `1px solid ${won ? 'rgba(255,214,0,0.35)' : 'rgba(255,255,255,0.12)'}`,
        color: '#EDEDF0',
        fontFamily: 'inherit',
      }}
    >
      {/* 胜负头 */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 46 }}>{emoji}</div>
        <h2 style={{ margin: '4px 0', fontSize: 26, color: won ? YELLOW : 'rgba(237,237,240,0.85)' }}>
          {title}
        </h2>
        <span style={{ fontSize: 13, color: won ? TEAL : RED }}>
          {won ? '🏆 本局获胜' : '本局惜败'}
        </span>
      </div>

      {/* 名人关系进展 */}
      {relations && relations.length > 0 && (
        <Block title="💞 名人关系进展">
          {relations.map((r, i) => (
            <div key={i} style={rowStyle}>
              <Heart size={13} color={r.delta >= 0 ? YELLOW : RED} />
              <span style={{ flex: 1 }}>{r.celebrityName}</span>
              <span style={{ color: r.delta >= 0 ? TEAL : RED, fontSize: 12 }}>
                好感{r.delta > 0 ? '+' : ''}{r.delta} · {r.reason}
              </span>
            </div>
          ))}
        </Block>
      )}

      {/* 本局高光 */}
      {highlights && highlights.length > 0 && (
        <Block title="✨ 本局高光">
          {highlights.map((h, i) => (
            <div key={i} style={{ ...rowStyle, border: 'none', padding: '4px 0' }}>
              <TrendingUp size={12} color={h.isReverse ? YELLOW : TEAL} />
              <span style={{ fontSize: 13 }}>
                {h.isReverse && <b style={{ color: YELLOW }}>⚡逆转 </b>}
                {h.text}
              </span>
            </div>
          ))}
        </Block>
      )}

      {/* 场景专属正文 */}
      {children}

      {/* 可分享战果卡 */}
      {shareCard && (
        <button
          type="button"
          onClick={() => void copyShare()}
          style={{
            ...btnGhost,
            width: '100%',
            justifyContent: 'center',
            marginTop: 14,
          }}
        >
          <Share2 size={14} /> <Copy size={13} />
          {copied ? '战果卡已复制 ✓' : '复制可分享战果卡'}
        </button>
      )}

      {/* 再来一局条 */}
      <PlayAgainBar streak={streak} highlight={oneLine} onPlayAgain={onPlayAgain} playAgainLabel={playAgainLabel} />

      {onExit && (
        <button
          type="button"
          onClick={onExit}
          style={{ ...btnGhost, width: '100%', justifyContent: 'center', marginTop: 8 }}
        >
          返回大厅
        </button>
      )}

      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'rgba(237,237,240,0.3)' }}>
        <Sparkles size={10} style={{ verticalAlign: -1 }} /> 与古今中外名人同台 · 关系网持续收集
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px',
  background: '#0a0a0a',
  borderRadius: 8,
  marginBottom: 4,
  fontSize: 13,
}

const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.14)',
  cursor: 'pointer',
  fontSize: 13,
  background: '#1a1a1a',
  color: '#EDEDF0',
}
