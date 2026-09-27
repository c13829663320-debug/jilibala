// ============================================================================
// MyWorks —— 我的作品：已发布/草稿/失败，支持编辑/重新发布/删除
// ============================================================================
import { useEffect, useState } from 'react'
import type { UgcSceneMeta } from '@balabala/shared'
import { useIdentity } from '../identity'
import { deleteUgcScene, fetchMyWorks, updateUgcScene } from './ugcApi'

export interface MyWorksProps {
  /** 编辑（回到一句话创作）。 */
  onEdit: (work: UgcSceneMeta) => void
}

const STATUS_LABEL: Record<UgcSceneMeta['status'], string> = {
  published: '已发布', draft: '草稿', previewing: '发布中', failed: '发布失败',
}
const STATUS_COLOR: Record<UgcSceneMeta['status'], string> = {
  published: '#4fb3a5', draft: '#888', previewing: '#FFD600', failed: '#ff6b6b',
}

export default function MyWorks({ onEdit }: MyWorksProps) {
  const { user } = useIdentity()
  const [works, setWorks] = useState<UgcSceneMeta[]>([])
  const [loading, setLoading] = useState(true)

  const userId = user?.userId ?? 'anonymous'
  const reload = () => {
    setLoading(true)
    fetchMyWorks(userId)
      .then(setWorks)
      .catch(() => setWorks([]))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [userId])

  const handleDelete = async (work: UgcSceneMeta) => {
    await deleteUgcScene(work.sceneId, userId).catch(() => undefined)
    reload()
  }

  const handleRepublish = async (work: UgcSceneMeta) => {
    // 重新发布：把失败态切回已发布（owner 操作）
    await updateUgcScene(work.sceneId, userId, { status: 'published' }).catch(() => undefined)
    reload()
  }

  if (loading) return <div style={{ color: '#888', textAlign: 'center' }}>加载我的作品…</div>

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', color: '#eee' }}>
      <h3 style={{ marginTop: 0 }}>我的作品（{works.length}）</h3>
      {works.length === 0 && <div style={{ color: '#888' }}>还没有作品，去“一句话造场景”创作一个吧。</div>}
      {works.map((w) => (
        <div key={w.sceneId} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8,
          background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{w.name}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{w.style} · {w.playCount} 次进入</div>
          </div>
          <span style={{
            fontSize: 12, color: STATUS_COLOR[w.status],
            border: `1px solid ${STATUS_COLOR[w.status]}`, borderRadius: 6, padding: '2px 8px',
          }}>
            {STATUS_LABEL[w.status]}
          </span>
          <button onClick={() => onEdit(w)} style={btn('#4fb3a5')}>编辑</button>
          {w.status === 'failed' && <button onClick={() => handleRepublish(w)} style={btn('#FFD600')}>重发</button>}
          <button onClick={() => handleDelete(w)} style={btn('#ff6b6b')}>删除</button>
        </div>
      ))}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
    background: 'transparent', color, border: `1px solid ${color}`,
  }
}
