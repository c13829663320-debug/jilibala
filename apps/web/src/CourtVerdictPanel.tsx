import { useEffect, useRef, useState } from 'react'
import { Gavel, Home, Share2 } from 'lucide-react'
import type { CourtVerdict, R5Highlight, R5StreakState } from '@balabala/shared'
import { r5ShareCardToText } from '@balabala/shared'
import PlayAgainBar from './gameplay/PlayAgainBar'
import CourtHighlightReplay, { pickSignatureQuote } from './gameplay/CourtHighlightReplay'
import { recordResult } from './gameplay/streak'
import { buildShareCard, courtHighlights } from './gameplay/highlight'

const VERDICT_LABEL: Record<CourtVerdict['verdict'], { text: string; cls: string }> = {
  plaintiff: { text: '原告胜诉', cls: 'cr-verdict-badge--plaintiff' },
  defendant: { text: '被告胜诉', cls: 'cr-verdict-badge--defendant' },
  mixed: { text: '部分支持', cls: 'cr-verdict-badge--mixed' },
  dismissed: { text: '驳回', cls: 'cr-verdict-badge--dismissed' },
}

export default function CourtVerdictPanel({
  verdict,
  playerSide,
  opponentName,
  onPublish,
  onBackToHall,
  onAgain,
  publishing,
  publishStatus,
}: {
  verdict: CourtVerdict
  /** 玩家扮演的一方（来自 courtCase.player_side）；旁观/观众局不传则不计连胜。 */
  playerSide?: 'plaintiff' | 'defendant'
  /** 对席名人名（用于关系进展文案）。 */
  opponentName?: string
  onPublish: () => void
  onBackToHall: () => void
  onAgain: () => void
  publishing: boolean
  publishStatus: string
}) {
  const v = VERDICT_LABEL[verdict.verdict]
  // 玩家胜 = 判决结果落在玩家方；无 player_side（观众局）不计胜负连胜。
  const won = Boolean(playerSide) && verdict.verdict === playerSide

  // R5 核心循环：本局结算一次性记录连胜、构造高光/关系/战果卡（ref 防重复上报）。
  const [streak, setStreak] = useState<R5StreakState>({ current: 0, best: 0, lastPlayedAt: null })
  const [highlights, setHighlights] = useState<R5Highlight[]>([])
  const reportedRef = useRef(false)
  useEffect(() => {
    if (reportedRef.current) return
    reportedRef.current = true
    if (playerSide) {
      const outcome = recordResult('court', won).outcome
      setStreak(outcome.streak)
    }
    setHighlights(courtHighlights(verdict.player_moves, verdict.key_moments))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 名场面引用：把玩家关键牌原文嵌进结论。
  const signatureQuote = pickSignatureQuote(verdict.player_moves)

  const shareCard = buildShareCard({
    scene: 'court',
    won,
    score: undefined,
    streak,
    highlights,
    relations: playerSide && opponentName
      ? [{ celebrityId: '', celebrityName: opponentName, delta: won ? 1 : 0, reason: won ? '当庭击败对手' : '庭上惜败' }]
      : [],
    extraLines: [verdict.case_summary].filter(Boolean),
  })

  const copyShare = async () => {
    const text = r5ShareCardToText(shareCard)
    try { await navigator.clipboard.writeText(text) } catch { window.prompt('复制判决书摘要：', text) }
  }

  return (
    <div className="cr-ui cr-center cr-verdict-card">
      <span className="cr-step-tag"><Gavel size={13} /> 宣判</span>
      <h2>判决书</h2>
      <span className={`cr-verdict-badge ${v.cls}`}>{v.text}</span>

      <h3>案情概要</h3>
      <p className="cr-verdict-summary">{verdict.case_summary}</p>

      <h3>关键事实</h3>
      <ul>{verdict.key_facts.map((f, i) => <li key={i}>{f}</li>)}</ul>

      <h3>关键证据</h3>
      {verdict.key_evidence.length ? <ul>{verdict.key_evidence.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p>无</p>}

      <h3>原告主张</h3>
      <ul>{verdict.plaintiff_arguments.map((a, i) => <li key={i}>{a}</li>)}</ul>

      <h3>被告抗辩</h3>
      <ul>{verdict.defendant_arguments.map((a, i) => <li key={i}>{a}</li>)}</ul>

      <h3>法官分析</h3>
      <p>{verdict.judge_analysis}</p>

      <h3>判决理由</h3>
      <p>{verdict.reasoning}</p>

      <h3>结论</h3>
      <p className="cr-verdict-summary">{verdict.conclusion}</p>
      {signatureQuote && (
        <p className="cr-verdict-summary" style={{ fontStyle: 'italic', opacity: 0.85 }}>
          —— 庭上名场面：“{signatureQuote}”
        </p>
      )}

      {/* R5 招牌：高光时刻回放（逐步播放，含逆转标签） */}
      <CourtHighlightReplay verdict={verdict} />

      <div className="cr-verdict-actions">
        <button type="button" className="cr-btn cr-btn--primary" onClick={onPublish} disabled={publishing}>
          <Share2 size={15} /> {publishing ? '发布中…' : '发布到广场'}
        </button>
        <button type="button" className="cr-btn" onClick={() => void copyShare()}>
          <Share2 size={15} /> 复制判决书摘要
        </button>
        <button type="button" className="cr-btn cr-btn--ghost" onClick={onBackToHall}><Home size={15} /> 返回大厅</button>
      </div>
      {publishStatus && <div className="cr-toast-msg">{publishStatus}</div>}

      {/* R5 统一再来一局条：连胜钩子 + 即时高光 */}
      {playerSide && (
        <PlayAgainBar
          streak={streak}
          highlight={highlights.find((h) => h.isReverse)?.text ?? highlights[0]?.text}
          onPlayAgain={onAgain}
          playAgainLabel="再来一局"
        />
      )}
    </div>
  )
}
