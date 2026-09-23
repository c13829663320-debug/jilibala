import { useState } from 'react'
import { Check, Sparkles, Users } from 'lucide-react'
import { CELEBRITIES } from '@balabala/shared'

export interface BenchSelectionProps {
  selectedIds: string[]
  onToggle: (id: string) => void
  onAutoSelect: (count: number) => void
  onConfirm: () => void
  maxCount?: number
  minCount?: number
}

/**
 * Pick the celebrity panel (3-5 members) that will sit on the bench.
 * Card grid with a count selector and an AI quick-pick button.
 */
export function BenchSelection({
  selectedIds,
  onToggle,
  onAutoSelect,
  onConfirm,
  maxCount = 5,
  minCount = 3,
}: BenchSelectionProps) {
  const [benchSize, setBenchSize] = useState(3)
  const cap = Math.max(minCount, Math.min(maxCount, benchSize))
  const canConfirm = selectedIds.length >= minCount

  return (
    <div className="bench-selection">
      <div className="bench-selection__head">
        <div>
          <span className="micro-label">SELECT THE BENCH</span>
          <h3>挑选合议庭名人</h3>
        </div>
        <span className="bench-selection__count">
          已选 <b>{selectedIds.length}</b> / {minCount}-{maxCount}
        </span>
      </div>

      <div className="bench-selection__toolbar">
        <div className="bench-selection__sizes" role="group" aria-label="合议庭人数">
          <span className="bench-selection__sizes-label"><Users size={13} /> 席位</span>
          {[3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`bench-selection__size ${benchSize === n ? 'is-active' : ''}`}
              onClick={() => setBenchSize(n)}
            >
              {n} 人
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bench-selection__auto"
          onClick={() => onAutoSelect(cap)}
        >
          <Sparkles size={14} /> AI 智能推荐
        </button>
      </div>

      <div className="bench-selection__grid">
        {CELEBRITIES.map((c) => {
          const selected = selectedIds.includes(c.id)
          const atCap = !selected && selectedIds.length >= cap
          return (
            <button
              key={c.id}
              type="button"
              className={`bench-selection__card ${selected ? 'is-selected' : ''} ${atCap ? 'is-locked' : ''}`}
              onClick={() => onToggle(c.id)}
              aria-pressed={selected}
              disabled={atCap}
            >
              <div className="bench-selection__avatar">
                <img src={c.portrait} alt={c.name} loading="lazy" />
                {selected && (
                  <span className="bench-selection__check">
                    <Check size={12} />
                  </span>
                )}
              </div>
              <div className="bench-selection__meta">
                <b>{c.name}</b>
                <small>{c.title}</small>
                <span className="bench-selection__field">{c.field}</span>
                <div className="bench-selection__tags">
                  {c.tags.slice(0, 3).map((t) => (
                    <em key={t}>{t}</em>
                  ))}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="bench-selection__footer">
        <p className="bench-selection__hint">
          至少选择 {minCount} 位，最多 {cap} 位合议庭成员。
        </p>
        <button
          type="button"
          className="bench-selection__confirm"
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          开庭审理（{selectedIds.length} 位法官）
        </button>
      </div>
    </div>
  )
}

export default BenchSelection
