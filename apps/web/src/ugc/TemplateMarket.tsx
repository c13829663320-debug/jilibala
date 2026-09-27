// ============================================================================
// TemplateMarket —— 模板市场：官方模板 + 热门用户作品，卡片列表，点击即用
// ============================================================================
import { useEffect, useState } from 'react'
import type { SceneTemplate, UgcSceneMeta } from '@balabala/shared'
import { fetchUgcTemplates } from './ugcApi'

export interface TemplateMarketProps {
  /** 选中官方模板（套用其参数）或用户作品（进入分享场景）。 */
  onPickTemplate: (t: SceneTemplate) => void
  onPickUserWork: (work: UgcSceneMeta) => void
}

export default function TemplateMarket({ onPickTemplate, onPickUserWork }: TemplateMarketProps) {
  const [official, setOfficial] = useState<SceneTemplate[]>([])
  const [hot, setHot] = useState<UgcSceneMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void fetchUgcTemplates()
      .then((data) => { if (alive) { setOfficial(data.official); setHot(data.hot) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : '加载模板失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <div style={{ color: '#888', textAlign: 'center' }}>模板加载中…</div>
  if (error) return <div style={{ color: '#ff6b6b', textAlign: 'center' }}>{error}</div>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', color: '#eee' }}>
      <h3 style={{ marginTop: 0 }}>官方模板</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {official.map((t) => (
          <button key={t.id} onClick={() => onPickTemplate(t)} style={{
            textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer',
            background: '#141414', border: '1px solid #2a2a2a', color: '#eee',
          }}>
            <div style={{ fontSize: 28 }}>{t.thumbnail}</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2, lineHeight: 1.4 }}>{t.description}</div>
          </button>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>热门用户作品</h3>
      {hot.length === 0 && <div style={{ color: '#888', fontSize: 13 }}>还没有热门作品，快来发布第一个！</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {hot.map((w) => (
          <button key={w.sceneId} onClick={() => onPickUserWork(w)} style={{
            textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer',
            background: `linear-gradient(135deg, #141414, ${w.theme.includes('cyber') ? '#1a0f2e' : '#0d1f1c'})`,
            border: '1px solid #2a2a2a', color: '#eee',
          }}>
            <div style={{ fontWeight: 700 }}>{w.name}</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{w.style} · {w.theme}</div>
            <div style={{ fontSize: 12, color: '#4fb3a5', marginTop: 4 }}>▶ {w.playCount} 次进入</div>
          </button>
        ))}
      </div>
    </div>
  )
}
