// 专家辅助人（额外辩护人）选择器：新 CourtFlow 与旧 bench 共用。
// 固定律师位之外，把名人 / 我的人物 / 广场人物指派为「原告方」或「被告方」辅助人。
// 可选、可为 0；输出 DefenderAssignments，随 /start 的 defenderAssignments 传给后端。
import { useEffect, useMemo, useRef, useState } from 'react'
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

const sideOfIn = (a: DefenderAssignments, id: string): Side | null =>
  a.plaintiff.includes(id)
    ? 'plaintiff'
    : a.defendant.includes(id) ? 'defendant' : null

export default function DefenderPicker({ assignments, onChange, maxPerSide = 3 }: Props) {
  const { user } = useIdentity()
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<UiCharacter[]>([])
  const [pub, setPub] = useState<UiCharacter[]>([])

  // 防快速双击 / 重入：assign 期间忽略后续点击，直到本次同步计算落定。
  // assign 本身同步，但 rapid double-click 在 React 提交间隙可能读到旧闭包 props，
  // 造成「点了帮原告又点帮被告」时前一次提交被覆盖（状态错乱）。
  const lockRef = useRef(false)
  // 始终镜像最新 assignments，assign 内部读 ref 而非闭包 prop，杜绝 stale closure。
  const assignmentsRef = useRef(assignments)
  assignmentsRef.current = assignments

  useEffect(() => {
    let alive = true
    const userId = user?.userId ?? ''
    void Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()]).then(([m, p]) => {
      if (!alive) return
      setMine(m); setPub(p)
    })
    return () => { alive = false }
  }, [user?.userId])

  const sideOf = (id: string): Side | null => sideOfIn(assignments, id)

  const assign = (id: string, side: Side) => {
    if (lockRef.current) return
    lockRef.current = true
    try {
      const cur = sideOfIn(assignmentsRef.current, id)
      const curA = assignmentsRef.current
      const next: DefenderAssignments = {
        plaintiff: [...curA.plaintiff],
        defendant: [...curA.defendant],
      }
      if (cur === side) {
        next[side] = next[side].filter((x) => x !== id) // 再点同侧 → 取消
        onChange(next)
        assignmentsRef.current = next
        return
      }
      if (cur) next[cur] = next[cur].filter((x) => x !== id) // 从对侧移走
      if (next[side].length >= maxPerSide) {
        const blocked: DefenderAssignments = { plaintiff: next.plaintiff, defendant: next.defendant }
        onChange(blocked)
        assignmentsRef.current = blocked
        return
      }
      next[side] = [...next[side], id]
      onChange(next)
      assignmentsRef.current = next
    } finally {
      // 同步计算已完成；下一宏任务再放开锁，吞掉同 tick 的第二次点击（双击防护）。
      window.setTimeout(() => { lockRef.current = false }, 0)
    }
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