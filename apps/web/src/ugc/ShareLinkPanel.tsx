// ============================================================================
// ShareLinkPanel —— 发布成功后展示分享链接 + 复制按钮
// ============================================================================
import { useState } from 'react'
import type { SceneShareLink } from '@balabala/shared'

export interface ShareLinkPanelProps {
  link: SceneShareLink
}

export default function ShareLinkPanel({ link }: ShareLinkPanelProps) {
  const [copied, setCopied] = useState(false)
  const fullUrl = `${window.location.origin}${link.url}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 真机无剪贴板权限时降级：选中提示
      setCopied(false)
    }
  }

  return (
    <div style={{
      background: '#0d1f1c', border: '1px solid #4fb3a5', borderRadius: 10,
      padding: 14, marginTop: 12,
    }}>
      <div style={{ color: '#4fb3a5', fontWeight: 700, marginBottom: 6 }}>发布成功，分享出去吧</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{
          flex: 1, fontSize: 12, color: '#ccc', background: '#0a0a0a',
          padding: '6px 8px', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {fullUrl}
        </code>
        <button
          onClick={copy}
          style={{
            padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: copied ? '#4fb3a5' : '#FFD600', color: '#141414', fontWeight: 700,
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}
