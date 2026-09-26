import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * PWA Service Worker 更新提示条。
 *
 * vite-plugin-pwa 在 registerType: 'autoUpdate' 下，检测到新 SW 就绪时会触发
 * needRefresh。这里用明黄配色显示一条可点击的提示条，点击后调用
 * updateSW(true) 激活新 SW 并刷新页面。
 *
 * 注意：main.tsx 中不再重复调用 registerSW，由本组件通过 useRegisterSW 统一注册。
 */
export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh) return null

  return createPortal(
    <button
      onClick={() => {
        setNeedRefresh(false)
        updateServiceWorker(true)
      }}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 18px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background: '#FFD700',
        color: '#000000',
        fontSize: 14,
        fontWeight: 700,
        boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
        maxWidth: 'min(92vw, 420px)',
      }}
    >
      <RefreshCw size={16} strokeWidth={2.5} />
      有新版本可用，点击刷新
    </button>,
    document.body,
  )
}
