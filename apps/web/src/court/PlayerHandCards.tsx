// PlayerHandCards：底部 4 张预制牌 + 弹药 ⚡×N，灰=弹药不足。
import { useState } from 'react'
import { Swords, FileText, Laugh, BookMarked, Zap } from 'lucide-react'
import type { CourtCardType } from '@balabala/shared'

type CardDef = {
  type: CourtCardType
  title: string
  desc: string
  cost: number
  icon: React.ReactNode
}

const CARDS: CardDef[] = [
  { type: 'attack', title: '攻击论点', desc: '自由写一句，命中争议点 +6', cost: 1, icon: <Swords size={18} /> },
  { type: 'evidence', title: '出示证据', desc: '选已上传证据，命中 +8 并查明', cost: 1, icon: <FileText size={18} /> },
  { type: 'mock', title: '嘲讽对方', desc: '幽默 +3，越界则 -3', cost: 1, icon: <Laugh size={18} /> },
  { type: 'request_record', title: '要求记录', desc: '免费，把事实记入庭审', cost: 0, icon: <BookMarked size={18} /> },
]

export default function PlayerHandCards({
  visible,
  ammo,
  onPlay,
  onPickEvidence,
}: {
  visible: boolean
  ammo: number
  onPlay: (card: CourtCardType, freeText?: string) => void
  onPickEvidence: () => void
}) {
  const [textCard, setTextCard] = useState<CourtCardType | null>(null)
  const [text, setText] = useState('')
  if (!visible) return null

  const click = (c: CardDef) => {
    if (c.cost > ammo) return
    if (c.type === 'evidence') { onPickEvidence(); return }
    setTextCard(c.type); setText('')
  }
  const confirmText = () => {
    if (!textCard) return
    onPlay(textCard, text.trim() || undefined)
    setTextCard(null); setText('')
  }

  return (
    <div className="hand-cards">
      <div className="hand-cards__ammo">
        弹药 {Array.from({ length: 2 }).map((_, i) => (
          <Zap key={i} size={14} className={i < ammo ? 'is-on' : 'is-off'} fill={i < ammo ? '#FFD600' : 'none'} />
        ))}
      </div>
      <div className="hand-cards__row">
        {CARDS.map((c) => {
          const disabled = c.cost > ammo
          return (
            <button key={c.type} className={`hand-card ${disabled ? 'is-disabled' : ''}`} disabled={disabled} onClick={() => click(c)}>
              <span className="hand-card__icon">{c.icon}</span>
              <span className="hand-card__title">{c.title}</span>
              <span className="hand-card__desc">{c.desc}</span>
              <span className="hand-card__cost">{c.cost === 0 ? '免费' : `⚡${c.cost}`}</span>
            </button>
          )
        })}
      </div>
      {textCard && (
        <div className="hand-cards__textbox">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={textCard === 'mock' ? '写一句幽默的嘲讽（别太刻薄）…' : textCard === 'request_record' ? '要法官记录哪条事实…' : '写一句直击争议点的论点…'}
            maxLength={120}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmText() }}
          />
          <button className="court-btn court-btn--primary court-btn--sm" onClick={confirmText}>出牌</button>
          <button className="court-btn court-btn--ghost court-btn--sm" onClick={() => setTextCard(null)}>取消</button>
        </div>
      )}
    </div>
  )
}
