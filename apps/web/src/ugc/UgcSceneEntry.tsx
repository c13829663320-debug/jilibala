// ============================================================================
// UgcSceneEntry —— 他人经分享链接进入 UGC 场景的最小接线
// App 启动检测 ?scene=ugc_<id> → 加载；失败用 failureFallback 降级（回广场/逛模板）。
// 真实 3D 场景渲染需真机确认，这里先做占位摘要页。
// ============================================================================
import { useEffect, useState } from 'react'
import type { UgcSceneRecord } from '@balabala/shared'
import { fetchUgcScene } from './ugcApi'
import { decideFallback, type FallbackAction } from './failureFallback'

export interface UgcSceneEntryProps {
  sceneId: string
  /** 加载失败/退出时回到广场。 */
  onBackToPlaza: () => void
}

export default function UgcSceneEntry({ sceneId, onBackToPlaza }: UgcSceneEntryProps) {
  const [record, setRecord] = useState<UgcSceneRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState<FallbackAction | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchUgcScene(sceneId)
      .then((r) => { if (alive) setRecord(r) })
      .catch((e: unknown) => {
        if (!alive) return
        const fb = decideFallback(e as { code?: string; message?: string })
        setFallback(fb)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sceneId])

  if (loading) return <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>正在进入场景…</div>

  if (fallback) {
    return (
      <div style={{ maxWidth: 420, margin: '80px auto', color: '#eee', textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>😅</div>
        <div style={{ marginTop: 10, color: '#ff9b9b' }}>{fallback.message}</div>
        <button onClick={onBackToPlaza} style={{
          marginTop: 16, padding: '9px 20px', borderRadius: 8, border: 'none',
          background: '#FFD600', color: '#141414', fontWeight: 700, cursor: 'pointer',
        }}>回广场逛逛</button>
      </div>
    )
  }

  if (!record) return null

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', color: '#eee' }}>
      <div style={{
        height: 200, borderRadius: 12, border: '1px dashed #333',
        background: 'radial-gradient(circle at 50% 30%, #1b2b3a, #0a0a0a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      }}>
        <div style={{ fontSize: 36 }}>🌏</div>
        <div style={{ fontSize: 12, color: '#888' }}>3D 场景占位（真机渲染确认）</div>
      </div>
      <h2 style={{ marginBottom: 4 }}>{record.name}</h2>
      <div style={{ color: '#bbb', fontSize: 14, lineHeight: 1.8 }}>
        <div>主题：<b style={{ color: '#4fb3a5' }}>{record.theme}</b> · {record.style}</div>
        <div>玩法：{record.draft.gameType}</div>
        <div>名人：{record.draft.celebrityIds.length ? record.draft.celebrityIds.join('、') : '（无）'}</div>
        <div style={{ color: '#888', fontSize: 12 }}>TA 一句话：{record.draft.rawPrompt}</div>
      </div>
      <button onClick={onBackToPlaza} style={{
        marginTop: 16, padding: '9px 20px', borderRadius: 8, border: '1px solid #444',
        background: 'transparent', color: '#ccc', cursor: 'pointer',
      }}>← 回广场</button>
    </div>
  )
}
