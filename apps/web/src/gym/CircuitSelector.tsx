// ===== M14：今日三关预览 + 开始 =====
import { CELEBRITIES, CIRCUIT_STATIONS, type Celebrity } from '@balabala/shared'

interface Props {
  celebrity: Celebrity | undefined
  onCelebrityChange: (id: string) => void
  onStart: () => void
}

export default function CircuitSelector({ celebrity, onCelebrityChange, onStart }: Props) {
  return (
    <div className="cc-center">
      <div className="cc-station-label">90 秒三关电路</div>
      <h1 style={{ margin: '4px 0', fontSize: 30, color: '#ffd600', letterSpacing: 2 }}>
        {celebrity?.name ?? '名人'}教练，给你排了三关
      </h1>
      <div style={{ color: 'rgba(237,237,240,0.6)', fontSize: 14 }}>连闯三关，总分解锁段位。输完不打卡就算你赢。</div>

      <div className="cc-station-cards">
        {CIRCUIT_STATIONS.map((s, i) => (
          <div key={s.kind} className="cc-station-card">
            <div className="cc-station-card__num">{i + 1}</div>
            <div style={{ fontWeight: 800, margin: '6px 0 2px' }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#4fb3a5' }}>{s.durationSec}s · {s.goal}</div>
            <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.55)', marginTop: 8, lineHeight: 1.5 }}>{s.tips}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.5)', marginBottom: 4 }}>选你的带练名人</div>
      <div className="cc-celeb-pick">
        {CELEBRITIES.slice(0, 6).map((c) => (
          <button key={c.id} className={celebrity?.id === c.id ? 'is-active' : ''} onClick={() => onCelebrityChange(c.id)}>
            <img src={c.portrait} alt={c.name} />
            <span style={{ fontSize: 12 }}>{c.name}</span>
          </button>
        ))}
      </div>

      <button className="cc-btn" onClick={onStart}>⚡ 开始电路挑战</button>
    </div>
  )
}
