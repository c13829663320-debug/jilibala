import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CourtroomShell } from '../shared'
import type { CourtCase, CourtRole, KnowledgeBase } from '../types'

type Props = {
  character?: unknown
  courtCase: CourtCase
  onBack: () => void
  onConfirm: () => void
  onExit: () => void
  onOpenArchive: () => void
  confirming?: boolean
}

function PartyCard({ role, kb, open, onToggle }: { role: CourtRole; kb: KnowledgeBase; open: boolean; onToggle: () => void }) {
  const evidenceNames = kb.evidence
  return (
    <div className="party-card live-review__party" onClick={onToggle} role="button" tabIndex={0}>
      <div className="party-card__head">
        <div className="party-card__avatar" style={{ background: role.accent + '22', color: role.accent }}>⚖</div>
        <div>
          <div className="party-card__name">{role.name}</div>
          <div className="party-card__title">{role.title}</div>
        </div>
      </div>
      <div className="party-card__position">{role.position}</div>
      <div className="party-card__evidence-count">{evidenceNames.length} 件证据 · {kb.arguments.length} 条论点</div>
      {open && (
        <div className="party-kb" onClick={(e) => e.stopPropagation()}>
          <h4>📋 证据书</h4>
          <dl>
            <dt>立场</dt><dd>{kb.position}</dd>
            <dt>核心事实</dt><dd>{kb.facts.join('；') || '—'}</dd>
            <dt>支持观点</dt><dd>{kb.claims.join('；') || '—'}</dd>
            <dt>已有证据</dt><dd>{evidenceNames.length ? evidenceNames.join('、') : '暂无'}</dd>
            <dt>可能的对方反驳</dt><dd>{kb.possibleRebuttals.join('；') || '—'}</dd>
          </dl>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--court-text-3)', fontSize: 11 }}>
        <ChevronDown size={13} style={{ transition: 'var(--court-motion)', transform: open ? 'rotate(180deg)' : 'none' }} />
        {open ? '收起证据书' : '展开证据书'}
      </div>
    </div>
  )
}

export default function PartiesReview({ courtCase, onBack, onConfirm, onExit, onOpenArchive, confirming }: Props) {
  const [openSide, setOpenSide] = useState<'plaintiff' | 'defendant' | null>(null)
  const [factsOpen, setFactsOpen] = useState(false)
  const toggle = (side: 'plaintiff' | 'defendant') => setOpenSide((cur) => (cur === side ? null : side))

  return (
    <CourtroomShell courtCase={courtCase} onExit={onExit} onOpenArchive={onOpenArchive} frostStrong>
      <div className="live-review">
        <div className="live-review__head">
          <span className="live-create__eyebrow">REVIEW</span>
          <h1>双方已就位，请确认开庭</h1>
          <p>AI 已从你的叙述中生成原告与被告。点开任一方查看其证据书，确认无误后开庭。</p>
        </div>

        <div className="live-review__facts" onClick={() => setFactsOpen((v) => !v)} role="button" tabIndex={0}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="court-section-title" style={{ margin: 0 }}>案件事实（{courtCase.facts.length}）</span>
            <ChevronDown size={16} style={{ color: 'var(--court-text-3)', transition: 'var(--court-motion)', transform: factsOpen ? 'rotate(180deg)' : 'none' }} />
          </div>
          {factsOpen && (
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: 'var(--court-text-2)', fontSize: 13, lineHeight: 1.8 }}>
              {courtCase.facts.map((f) => <li key={f.id}>{f.content}{f.disputed ? '（有争议）' : ''}</li>)}
            </ul>
          )}
        </div>

        <div className="live-review__parties">
          <PartyCard role={courtCase.plaintiff} kb={courtCase.knowledgeBases.plaintiff} open={openSide === 'plaintiff'} onToggle={() => toggle('plaintiff')} />
          <PartyCard role={courtCase.defendant} kb={courtCase.knowledgeBases.defendant} open={openSide === 'defendant'} onToggle={() => toggle('defendant')} />
        </div>

        <div className="live-review__actions">
          <button className="court-btn court-btn--secondary" onClick={onBack} disabled={confirming}>← 返回修改</button>
          <button className="court-btn court-btn--primary" style={{ flex: 1 }} onClick={onConfirm} disabled={confirming}>
            {confirming ? '确认中…' : '确认开庭'}
          </button>
        </div>
      </div>
    </CourtroomShell>
  )
}
