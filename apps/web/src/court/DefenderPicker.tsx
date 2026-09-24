// 专家辅助人（额外辩护人）选择器：新 CourtFlow 与旧 bench 共用。
// 固定律师位之外，把名人 / 我的人物 / 广场人物指派为「原告方」或「被告方」辅助人。
// 可选、可为 0；输出 DefenderAssignments，随 /start 的 defenderAssignments 传给后端。
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Users, X } from 'lucide-react'
import { useIdentity } from '../identity'
import {
  celebrityListToUi, fetchMyCharacters, fetchPublicCharacters, type UiCharacter,
} from '../custom-characters'

export type DefenderAssignments = { plaintiff: string[]; defendant: string[] }
export const EMPTY_ASSIGNMENTS: DefenderAssignments = { plaintiff: [], defendant: [] }

type Props = {
  assignments: DefenderAssignments
  onChange: (next: DefenderAssignments) => void
  maxPerSide?: number
}

type Side = 'plaintiff' | 'defendant'

export default function DefenderPicker({ assignments, onChange, maxPerSide = 3 }: Props) {
  const { user } = useIdentity()
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<UiCharacter[]>([])
  const [pub, setPub] = useState<UiCharacter[]>([])

  useEffect(() => {
    let alive = true
    const userId = user?.userId ?? ''
    void Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()]).then(([m, p]) => {
      if (!alive) return
      setMine(m); setPub(p)
    })
    return () => { alive = false }
  }, [user?.userId])

  const sideOf = (id: string): Side | null =>
    assignments.plaintiff.includes(id)
      ? 'plaintiff'
      : assignments.defendant.includes(id) ? 'defendant' : null

  const assign = (id: string, side: Side) => {
    const cur = sideOf(id)
    const next: DefenderAssignments = {
      plaintiff: [...assignments.plaintiff],
      defendant: [...assignments.defendant],
    }
    if (cur === side) {
      next[side] = next[side].filter((x) => x !== id) // 再点同侧 → 取消
      onChange(next); return
    }
    if (cur) next[cur] = next[cur].filter((x) => x !== id) // 从对侧移走
    if (next[side].length >= maxPerSide) {
      onChange({ plaintiff: next.plaintiff, defendant: next.defendant }); return
    }
    next[side] = [...next[side], id]
    onChange(next)
  }

  const total = assignments.plaintiff.length + assignments.defendant.length

  const groups = useMemo(() => {
    const mineIds = new Set(mine.map((c) => c.id))
    const publicOnly = pub.filter((c) => !mineIds.has(c.id))
    return [
      { label: '古今名人', chars: celebrityListToUi() },
      { label: '我的人物', chars: mine },
      { label: '广场人物', chars: publicOnly },
    ].filter((g) => g.chars.length > 0)
  }, [mine, pub])

  return (
    <div className={`defender-picker${open ? ' is-open' : ''}`}>
      <button type="button" className="defender-picker__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="defender-picker__title">
          <Users size={15} /> 邀请专家辅助人（可选）
        </span>
        <span className="defender-picker__summary">
          <em className="is-plaintiff">原告 {assignments.plaintiff.length}</em>
          <em className="is-defendant">被告 {assignments.defendant.length}</em>
        </span>
        <ChevronDown size={16} className="defender-picker__chevron" />
      </button>

      {open && (
        <>
          <div className="defender-picker__grid">
            {groups.map((g) => (
              <div className="defender-picker__group" key={g.label}>
                <div className="defender-picker__group-title">{g.label}</div>
                <div className="defender-picker__cards">
                  {g.chars.map((char) => {
                    const side = sideOf(char.id)
                    return (
                      <div key={char.id} className={`defender-picker__card${side ? ` is-${side}` : ''}`}>
                        <div className="defender-picker__avatar">
                          {char.portrait ? (
                            <img src={char.portrait} alt={char.name} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            <span>{char.name[0]}</span>
                          )}
                        </div>
                        <div className="defender-picker__meta">
                          <b>{char.name}</b>
                          <small>{char.title}</small>
                        </div>
                        <div className="defender-picker__sides">
                          <button
                            type="button"
                            className={side === 'plaintiff' ? 'is-active is-plaintiff' : 'is-plaintiff'}
                            onClick={() => assign(char.id, 'plaintiff')}
                          >
                            帮原告
                          </button>
                          <button
                            type="button"
                            className={side === 'defendant' ? 'is-active is-defendant' : 'is-defendant'}
                            onClick={() => assign(char.id, 'defendant')}
                          >
                            帮被告
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="defender-picker__foot">
            <span>固定律师已就位；每方最多邀请 {maxPerSide} 位辅助人，不邀请也能开庭。</span>
            {total > 0 && (
              <button type="button" className="defender-picker__clear" onClick={() => onChange(EMPTY_ASSIGNMENTS)}>
                <X size={12} /> 清空（{total}）
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
