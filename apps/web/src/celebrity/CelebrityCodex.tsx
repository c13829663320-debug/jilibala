// ===== R5: 名人图鉴（收集进度页） =====
// 按领域分组展示收集进度：已结识显示头像，未结识显示剪影 + 解锁条件。
import { CELEBRITIES, CELEBRITY_FIELDS, getCelebrity } from '@balabala/shared'
import { useCelebrityRelation } from './useCelebrityRelation'
import { computeCollectionProgress, isCelebrityMet } from './celebrityProgress'
import AffinityBar from './AffinityBar'
import { FIELD_COLORS } from '../character-gallery'

export interface CelebrityCodexProps {
  onBack: () => void
  /** 点击某位已结识名人 → 进入对话（可选）。 */
  onPick?: (celebrityId: string) => void
}

export function CelebrityCodex({ onBack, onPick }: CelebrityCodexProps) {
  const { relations } = useCelebrityRelation()
  const progress = computeCollectionProgress(relations)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        overflowY: 'auto',
        background: 'radial-gradient(1200px 800px at 50% -10%, #1c2340, #0c0f1d 60%)',
        color: '#fff',
        padding: '24px clamp(16px,5vw,48px) 64px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: 'rgba(255,255,255,0.5)' }}>CELEBRITY CODEX · 名人图鉴</div>
          <h2 style={{ margin: '6px 0 0', fontSize: 26 }}>收集你遇见过的人</h2>
        </div>
        <button
          type="button"
          onClick={onBack}
          style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}
        >
          返回人物馆
        </button>
      </div>

      {/* 总进度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 40, fontWeight: 700 }}>
          {progress.met}
          <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}> / {progress.total}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            收集率 {progress.percent}% · 已点亮 {progress.unlockedFields}/7 个领域
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div style={{ width: `${progress.percent}%`, height: '100%', background: 'linear-gradient(90deg,#4fb3a5,#5b8cff)', transition: 'width .4s' }} />
          </div>
        </div>
      </div>

      {/* 按领域分组 */}
      {progress.byField.map((f) => {
        const color = FIELD_COLORS[f.field] ?? '#8a8a8a'
        const inField = CELEBRITIES.filter((c) => c.field === f.field)
        return (
          <section key={f.field} style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
              <h3 style={{ margin: 0, fontSize: 18 }}>{f.field}</h3>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{f.met}/{f.total}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              {inField.map((c) => {
                const met = isCelebrityMet(c.id, relations)
                const r = relations[c.id]
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!met || !onPick}
                    onClick={() => met && onPick?.(c.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: met ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.3)',
                      cursor: met ? 'pointer' : 'default',
                      color: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {met && c.portrait ? (
                        <img src={c.portrait} alt={c.name} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'rgba(255,255,255,0.3)' }}>
                          ?
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{met ? c.name : '？？？'}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {met ? c.title : '未结识'}
                        </div>
                      </div>
                    </div>
                    {met && r ? (
                      <div style={{ marginTop: 8 }}>
                        <AffinityBar affection={r.affection} level={r.acquaintanceLevel} compact />
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        首次对话或同台解锁
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default CelebrityCodex

// 供测试/外部复用：根据 id 取名人（避免外部再 import）。
export { getCelebrity }
