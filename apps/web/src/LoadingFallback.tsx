/**
 * 通用懒加载 fallback：居中 spinner + 「加载中…」文字。
 * 纯黑底 + 明黄 spinner，与主题色一致。
 */
export default function LoadingFallback({ label = '加载中…' }: { label?: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, background: '#000', color: '#f5f5f5',
    }}>
      <span style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '3px solid rgba(79,179,165,0.18)', borderTopColor: '#4fb3a5',
        animation: 'bb-spin 0.9s linear infinite',
      }} />
      <span style={{ color: '#999', fontSize: 13, letterSpacing: '.04em' }}>{label}</span>
      <style>{`@keyframes bb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
