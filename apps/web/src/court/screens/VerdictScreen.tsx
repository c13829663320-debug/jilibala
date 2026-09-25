import { useState } from 'react'
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
  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState('')

  const copyShareLink = async () => {
    const caseId = courtCase.backendCaseId
    if (!caseId || sharing) return
    setSharing(true); setShareMsg('')
    try {
      const res = await fetch(`/api/court/cases/${encodeURIComponent(caseId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '' }),
      })
      const data = await res.json().catch(() => ({})) as { shareUrl?: string; message?: string }
      if (!res.ok || !data.shareUrl) throw new Error(data.message ?? '生成分享链接失败')
      const full = `${window.location.origin}${data.shareUrl}`
      try { await navigator.clipboard.writeText(full) } catch { window.prompt('复制此分享链接', full) }
      setShareMsg('分享链接已复制 ✓')
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : '分享失败')
    } finally {
      setSharing(false)
    }
  }

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

        {/* 你的表现：最终局势优势 + 玩家归因 */}
        {courtCase.player_side && (
          <div className="verdict-doc" style={{ marginTop: 12 }}>
            <header className="verdict-doc__head">
              <h3>🌟 你的表现</h3>
              <p>你以「{courtCase.player_side === 'plaintiff' ? '原告' : '被告'}」身份亲自出庭。</p>
            </header>
            <section className="verdict-doc__section">
              <h4>⚖️ 庭审局势（原告 : 被告）</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#FFD60A', fontWeight: 700 }}>{courtCase.momentum?.plaintiff ?? 50}</span>
                <div style={{ flex: 1, height: 10, borderRadius: 999, background: '#4fb3a5', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${courtCase.momentum?.plaintiff ?? 50}%`, background: '#FFD60A', transition: 'width .6s' }} />
                </div>
                <span style={{ color: '#4fb3a5', fontWeight: 700 }}>{courtCase.momentum?.defendant ?? 50}</span>
              </div>
              <p style={{ marginTop: 8, fontSize: 13 }}>
                {(() => {
                  const p = courtCase.momentum?.plaintiff ?? 50
                  const d = courtCase.momentum?.defendant ?? 50
                  const you = courtCase.player_side === 'plaintiff' ? p : d
                  const rival = courtCase.player_side === 'plaintiff' ? d : p
                  if (you - rival > 20) return `你在庭上表现强势（优势 ${you}:${rival}），判决明显倾向你这一方。`
                  if (rival - you > 20) return `对方庭上更占上风（劣势 ${you}:${rival}），下次多出示证据、多质问对方。`
                  return `双方势均力敌（${you}:${rival}），法官按事实与证据作出了裁决。`
                })()}
              </p>
            </section>
            <section className="verdict-doc__section">
              <h4>📝 法官怎么说你</h4>
              <p>{(verdict as { reasoning?: string }).reasoning || verdict.judgeNote || '（判决理由未记录）'}</p>
            </section>
          </div>
        )}

        <div className="verdict-actions">
          <button className="court-btn court-btn--secondary" onClick={onSaveArchive}>归档案卷</button>
          <button className="court-btn court-btn--secondary" onClick={onNewTrial}>再来一场</button>
          <button
            className="court-btn court-btn--secondary"
            onClick={() => void copyShareLink()}
            disabled={sharing}
          >
            {sharing ? '生成中…' : '复制分享链接'}
          </button>
          <button
            className="court-btn court-btn--primary"
            onClick={onPublishToPlaza}
            disabled={publishing}
          >
            {publishing ? '发布中…' : '分享到广场'}
          </button>
        </div>
        {shareMsg && <div className="live-hint" style={{ marginTop: 8 }}>{shareMsg}</div>}
        {publishError && <div className="court-error" style={{ marginTop: 10 }}>{publishError}</div>}
      </div>
    </CourtroomShell>
  )
}
