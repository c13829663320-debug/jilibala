import { useEffect, useState } from 'react'
import { Check, Loader2, Sparkles, Users } from 'lucide-react'
import { CELEBRITIES } from '@balabala/shared'
import { useIdentity } from './identity'
import { celebrityToUi, fetchMyCharacters, fetchPublicCharacters, type UiCharacter } from './custom-characters'

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
 * 同时支持选择「我的人物」与「广场人物」（自定义人物），id 传给后端 resolveCharacter。
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
  const { user } = useIdentity()
  const [customMine, setCustomMine] = useState<UiCharacter[]>([])
  const [customPublic, setCustomPublic] = useState<UiCharacter[]>([])
  const [loading, setLoading] = useState(true)
  const cap = Math.max(minCount, Math.min(maxCount, benchSize))
  const canConfirm = selectedIds.length >= minCount

  // 拉取自定义人物（我的 + 广场）
  useEffect(() => {
    let alive = true
    const userId = user?.userId ?? ''
    Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()]).then(([mine, pub]) => {
      if (!alive) return
      setCustomMine(mine)
      setCustomPublic(pub)
      setLoading(false)
    })
    return () => { alive = false }
  }, [user?.userId])

  const celebs = CELEBRITIES.map(celebrityToUi)
  // 广场中与我重复的（我自己的公开人物）去重，避免重复卡片
  const mineIds = new Set(customMine.map((c) => c.id))
  const publicOnly = customPublic.filter((c) => !mineIds.has(c.id))
  const list: Array<{ group: '名人' | '我的人物' | '广场人物'; char: UiCharacter }> = [
    ...celebs.map((char) => ({ group: '名人' as const, char })),
    ...customMine.map((char) => ({ group: '我的人物' as const, char })),
    ...publicOnly.map((char) => ({ group: '广场人物' as const, char })),
  ]

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

      {loading ? (
        <div className="bench-selection__loading"><Loader2 size={16} className="spin" /> 加载可选人物…</div>
      ) : (
        <div className="bench-selection__grid">
          {list.map(({ group, char }) => {
            const selected = selectedIds.includes(char.id)
            const atCap = !selected && selectedIds.length >= cap
            const fieldLabel = char.isCustom
              ? (char.visibility === 'public' ? '广场人物' : '我的人物')
              : (group === '名人' ? char.field : group)
            return (
              <button
                key={char.id}
                type="button"
                className={`bench-selection__card ${selected ? 'is-selected' : ''} ${atCap ? 'is-locked' : ''}`}
                onClick={() => onToggle(char.id)}
                aria-pressed={selected}
                disabled={atCap}
              >
                <div className="bench-selection__avatar">
                  {char.portrait ? (
                    <img src={char.portrait} alt={char.name} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <span className="bench-selection__avatar-fallback">{char.name[0]}</span>
                  )}
                  {selected && (
                    <span className="bench-selection__check">
                      <Check size={12} />
                    </span>
                  )}
                </div>
                <div className="bench-selection__meta">
                  <b>{char.name}</b>
                  <small>{char.title}</small>
                  <span className="bench-selection__field">{fieldLabel}</span>
                  <div className="bench-selection__tags">
                    {char.tags.slice(0, 3).map((t: string) => (
                      <em key={t}>{t}</em>
                    ))}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="bench-selection__footer">
        <p className="bench-selection__hint">
          至少选择 {minCount} 位，最多 {cap} 位合议庭成员。支持选自定义人物。
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
