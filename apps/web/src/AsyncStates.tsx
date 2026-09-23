import { Loader, Inbox, AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

/** 统一加载态：spinner + 文字。 */
export function LoadingState({ label = '加载中…' }: { label?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '40px 16px', color: '#999',
    }}>
      <Loader size={22} color="#FFD600" className="bb-spin" style={{ animation: 'bb-spin 0.9s linear infinite' }} />
      <span style={{ fontSize: 13 }}>{label}</span>
      <style>{`@keyframes bb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

/** 统一空数据态：图标 + 文案 + 可选操作按钮。 */
export function EmptyState({ title = '暂无内容', hint, action }: {
  title?: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: '48px 20px', textAlign: 'center',
    }}>
      <div style={{
        display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 16,
        background: 'rgba(255,214,0,0.08)', color: '#FFD600',
      }}>
        <Inbox size={26} />
      </div>
      <h3 style={{ margin: '6px 0 0', color: '#f2f2f2', fontSize: 16 }}>{title}</h3>
      {hint && <p style={{ margin: 0, color: '#888', fontSize: 12, lineHeight: 1.6, maxWidth: 320 }}>{hint}</p>}
      {action}
    </div>
  )
}

/** 统一失败态：错误图标 + 文案 + 重试按钮。 */
export function ErrorState({ title = '加载失败', message, onRetry }: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: '40px 20px', textAlign: 'center',
    }}>
      <div style={{
        display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 16,
        background: 'rgba(255,120,145,0.1)', color: '#ff8aa0',
      }}>
        <AlertTriangle size={26} />
      </div>
      <h3 style={{ margin: '6px 0 0', color: '#f2f2f2', fontSize: 16 }}>{title}</h3>
      {message && <p style={{ margin: 0, color: '#999', fontSize: 12, lineHeight: 1.6, maxWidth: 360 }}>{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
            minHeight: 44, padding: '10px 18px', border: 0, borderRadius: 10,
            background: '#FFD600', color: '#111', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} /> 重试
        </button>
      )}
    </div>
  )
}
