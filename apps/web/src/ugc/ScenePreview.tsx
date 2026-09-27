// ============================================================================
// ScenePreview —— 草稿预览页：3D 占位 + 配置摘要 + 编辑/发布
// 3D 仅用占位几何体（云端无 WebGL，真实渲染需真机确认）。
// ============================================================================
import { useState } from 'react'
import type { SceneDraft } from '@balabala/shared'
import { useIdentity } from '../identity'
import { useScenePublish } from './useScenePublish'
import ShareLinkPanel from './ShareLinkPanel'

export interface ScenePreviewProps {
  draft: SceneDraft
  /** 返回上一步修改描述 */
  onBack: () => void
}

export default function ScenePreview({ draft, onBack }: ScenePreviewProps) {
  const { user } = useIdentity()
  const [name, setName] = useState(draft.title || '我的 UGC 场景')
  const { status, shareLink, error, publishing, publish, reset } = useScenePublish()

  const handlePublish = () => {
    void publish({ userId: user?.userId ?? 'anonymous', name, draft })
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', color: '#eee' }}>
      {/* 3D 占位 */}
      <div style={{
        height: 220, borderRadius: 12, border: '1px dashed #333',
        background: `radial-gradient(circle at 50% 30%, #1b2b3a, #0a0a0a)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ fontSize: 40 }}>🏯</div>
        <div style={{ fontSize: 12, color: '#888' }}>3D 占位预览（真机渲染确认）</div>
      </div>

      {/* 配置摘要 */}
      <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.8 }}>
        <label style={{ color: '#888', fontSize: 12 }}>场景名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, borderRadius: 6,
            background: '#141414', color: '#eee', border: '1px solid #333',
          }}
        />
        <div style={{ marginTop: 8, color: '#bbb', fontSize: 13 }}>
          <div>主题：<b style={{ color: '#4fb3a5' }}>{draft.theme}</b> · {draft.style}</div>
          <div>玩法：{draft.gameType} · 光照：{draft.lightPreset ?? '默认'}</div>
          <div>名人：{draft.celebrityIds.length ? draft.celebrityIds.join('、') : '（未指定）'}</div>
          <div>道具：{draft.props.length} 件</div>
        </div>
      </div>

      {/* 操作 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={onBack}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #444',
            background: 'transparent', color: '#ccc', cursor: 'pointer',
          }}
        >
          ← 修改描述
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || status === 'published'}
          style={{
            flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#FFD600', color: '#141414', fontWeight: 700,
            opacity: publishing || status === 'published' ? 0.6 : 1,
          }}
        >
          {publishing ? '发布中…' : status === 'published' ? '已发布' : '发布分享'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 10, color: '#ff6b6b', fontSize: 13 }}>
          {error.message}
          {error.retryable && (
            <button onClick={handlePublish} style={{ marginLeft: 8, background: 'none', color: '#FFD600', border: 'none', cursor: 'pointer' }}>
              重试
            </button>
          )}
        </div>
      )}

      {status === 'published' && shareLink && <ShareLinkPanel link={shareLink} />}
      {status === 'published' && (
        <button onClick={reset} style={{ marginTop: 8, background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer' }}>
          再造一个
        </button>
      )}
    </div>
  )
}
