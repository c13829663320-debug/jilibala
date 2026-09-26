import { Gavel, Home, RotateCcw, Share2 } from 'lucide-react'
import type { CourtVerdict } from '@balabala/shared'

const VERDICT_LABEL: Record<CourtVerdict['verdict'], { text: string; cls: string }> = {
  plaintiff: { text: '原告胜诉', cls: 'cr-verdict-badge--plaintiff' },
  defendant: { text: '被告胜诉', cls: 'cr-verdict-badge--defendant' },
  mixed: { text: '部分支持', cls: 'cr-verdict-badge--mixed' },
  dismissed: { text: '驳回', cls: 'cr-verdict-badge--dismissed' },
}

export default function CourtVerdictPanel({
  verdict,
  onPublish,
  onBackToHall,
  onAgain,
  publishing,
  publishStatus,
}: {
  verdict: CourtVerdict
  onPublish: () => void
  onBackToHall: () => void
  onAgain: () => void
  publishing: boolean
  publishStatus: string
}) {
  const v = VERDICT_LABEL[verdict.verdict]
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

      <div className="cr-verdict-actions">
        <button type="button" className="cr-btn cr-btn--primary" onClick={onPublish} disabled={publishing}>
          <Share2 size={15} /> {publishing ? '发布中…' : '发布到广场'}
        </button>
        <button type="button" className="cr-btn" onClick={onAgain}><RotateCcw size={15} /> 再来一局</button>
        <button type="button" className="cr-btn cr-btn--ghost" onClick={onBackToHall}><Home size={15} /> 返回大厅</button>
      </div>
      {publishStatus && <div className="cr-toast-msg">{publishStatus}</div>}
    </div>
  )
}
