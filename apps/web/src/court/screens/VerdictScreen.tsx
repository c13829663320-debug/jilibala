import { CourtroomShell } from '../shared'
import type { CourtCase, CourtVerdict } from '../types'

type Props = {
  character?: unknown
  courtCase: CourtCase
  verdict: CourtVerdict
  onSaveArchive: () => void
  onOpenArchive: () => void
  onPublishToPlaza: () => void
  onNewTrial: () => void
  onExit: () => void
  publishing?: boolean
  publishError?: string
}

export default function VerdictScreen({
  courtCase, verdict, onSaveArchive, onOpenArchive, onPublishToPlaza, onNewTrial, onExit,
  publishing, publishError,
}: Props) {
  const outcomeText =
    verdict.outcome === 'plaintiff' ? '原告方胜诉'
    : verdict.outcome === 'defendant' ? '被告方胜诉'
    : verdict.outcome === 'dismissed' ? '驳回诉求'
    : '折中处理'
  return (
    <CourtroomShell courtCase={courtCase} onExit={onExit} onOpenArchive={onOpenArchive} frostStrong overlayClassName="live-overlay-ui--noscroll">
      <div className="verdict-overlay">
        <div className="verdict-stamp" data-stamp={outcomeText}>
          <div className="verdict-stamp__seal">⚖️</div>
          <div className="verdict-stamp__text">
            <span className="verdict-stamp__case">{verdict.caseNo}</span>
            <h2 className="verdict-stamp__title">{outcomeText}</h2>
            <span className="verdict-stamp__charge">本案已结案</span>
          </div>
        </div>

        <div className="verdict-doc">
          <header className="verdict-doc__head">
            <h3>判决书</h3>
            <p>本案经法庭审理，现已查明事实，依法判决如下。</p>
          </header>

          <section className="verdict-doc__section">
            <h4>📜 案件事实</h4>
            <p>{verdict.facts || courtCase.description}</p>
          </section>

          <section className="verdict-doc__section">
            <h4>👤 原告诉称</h4>
            <p>{verdict.plaintiffClaim || verdict.plaintiffArguments || '详见庭审记录'}</p>
          </section>

          <section className="verdict-doc__section">
            <h4>🛡 被告辩称</h4>
            <p>{verdict.defense || verdict.defendantArguments || '详见庭审记录'}</p>
          </section>

          <section className="verdict-doc__section">
            <h4>🧑‍⚖️ 法官心证</h4>
            <p>{verdict.judgeNote || verdict.judgeAnalysis || verdict.quote}</p>
          </section>

          <section className="verdict-doc__quote">
            <blockquote>"{verdict.quote || verdict.sentence}"</blockquote>
          </section>
        </div>

        <div className="verdict-actions">
          <button className="court-btn court-btn--secondary" onClick={onSaveArchive}>归档案卷</button>
          <button className="court-btn court-btn--secondary" onClick={onNewTrial}>再来一场</button>
          <button
            className="court-btn court-btn--primary"
            onClick={onPublishToPlaza}
            disabled={publishing}
          >
            {publishing ? '发布中…' : '分享到广场'}
          </button>
        </div>
        {publishError && <div className="court-error" style={{ marginTop: 10 }}>{publishError}</div>}
      </div>
    </CourtroomShell>
  )
}
