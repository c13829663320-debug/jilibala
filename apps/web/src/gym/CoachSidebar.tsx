// ===== M14：名人教练侧边栏（异步点评飘入，不阻塞）=====
import type { Celebrity, MiniGameKind } from '@balabala/shared'
import { CIRCUIT_STATIONS } from '@balabala/shared'

export interface CoachNote {
  kind: MiniGameKind
  text: string
  name: string
  status: 'loading' | 'done'
}

const STATION_NAME = Object.fromEntries(CIRCUIT_STATIONS.map((s) => [s.kind, s.title])) as Record<MiniGameKind, string>

export default function CoachSidebar({ celebrity, notes }: { celebrity: Celebrity | undefined; notes: CoachNote[] }) {
  return (
    <aside className="cc-sidebar">
      <div className="cc-coach">
        <img src={celebrity?.portrait ?? '/portraits/celebrities/_default.jpg'} alt={celebrity?.name} />
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{celebrity?.name ?? '教练'}</div>
          <div style={{ fontSize: 11, color: '#4fb3a5' }}>你的名人教练</div>
        </div>
      </div>
      {notes.length === 0 && (
        <div className="cc-loading">每关结束后，教练会在这里点评一句…</div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="cc-note">
          <div className="cc-note__station">{STATION_NAME[n.kind]}点评</div>
          {n.status === 'loading'
            ? <span className="cc-loading">教练思考中…</span>
            : <span>“{n.text}”</span>}
        </div>
      ))}
    </aside>
  )
}
