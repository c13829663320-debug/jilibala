import type { WerewolfDayActionRecord } from '@balabala/shared'

const YELLOW = '#FFD600'
const RED = '#ff2a3a'
const TEAL = '#4fb3a5'

/** 把全天动作牌汇总成每个座位头上的标签（最近一次为准）。 */
export function tagsForSeats(records: WerewolfDayActionRecord[]): Map<number, Array<{ text: string; color: string }>> {
  const map = new Map<number, Array<{ text: string; color: string }>>()
  const push = (seat: number, tag: { text: string; color: string }) => {
    const arr = map.get(seat) ?? []
    // 同座位同标签去重，保留最新
    if (!arr.some((t) => t.text === tag.text)) arr.push(tag)
    map.set(seat, arr)
  }
  for (const r of records) {
    const a = r.action
    if (a.kind === 'claim_role') {
      const label = a.role === 'seer' ? '跳预言家' : a.role === 'witch' ? '跳女巫' : a.role === 'hunter' ? '跳猎人' : '跳村民'
      push(r.seat, { text: label, color: YELLOW })
    } else if (a.kind === 'report_check') {
      push(r.seat, { text: `报查验:${a.seat + 1}号${a.isWolf ? '狼' : '好'}`, color: '#7e52c7' })
    } else if (a.kind === 'suspect') {
      // 标签挂在被怀疑者头上
      push(a.seat, { text: `被${r.seat + 1}号怀疑`, color: RED })
    } else if (a.kind === 'defend') {
      push(a.seat, { text: `${r.seat + 1}号辩护`, color: TEAL })
    }
  }
  return map
}

/** 在玩家列表里渲染标签徽章。 */
export default function PlayerTagOverlay({ records }: { records: WerewolfDayActionRecord[] }) {
  const tags = tagsForSeats(records)
  if (records.length === 0) return null
  return (
    <div style={{ marginTop: 6, padding: 6, background: 'rgba(255,214,0,0.05)', borderRadius: 6 }}>
      <div style={{ fontSize: 10.5, color: 'rgba(237,237,240,0.4)', marginBottom: 4 }}>🏷️ 场上标签</div>
      {[...tags.entries()].map(([seat, list]) => (
        <div key={seat} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)', width: 30 }}>{seat + 1}号</span>
          {list.map((t) => (
            <span key={t.text} style={{
              fontSize: 10.5, padding: '1px 6px', borderRadius: 4,
              background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}66`,
            }}>{t.text}</span>
          ))}
        </div>
      ))}
    </div>
  )
}
