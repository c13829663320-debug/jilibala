import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './design-tokens.css'
import './styles.css'
import SplashScreen from './SplashScreen'

// 注册 PWA Service Worker（vite-plugin-pwa virtual module）
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

// 直达分享链接时不需要开屏，直接看判决书
const SKIP_SPLASH = typeof window !== 'undefined' && /^\/share\//.test(window.location.pathname)

/**
 * 全局未捕获错误 / Promise rejection 兜底：
 * - console.error 仍输出原始错误（便于调试）
 * - 用户侧只显示一个可关闭的友好 toast，不暴露技术栈
 */
function useGlobalErrorToast() {
  useEffect(() => {
    const showToast = (text: string) => {
      const el = document.createElement('div')
      el.textContent = text
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
        'z-index:2147483647', 'max-width:min(92vw,420px)',
        'padding:12px 16px', 'border-radius:10px',
        'background:#1a1a1a', 'color:#f5f5f5', 'font-size:13px', 'line-height:1.5',
        'border:1px solid rgba(79,179,165,0.4)', 'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
        'display:flex', 'align-items:center', 'gap:10px',
      ].join(';')
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '×'
      closeBtn.setAttribute('aria-label', '关闭')
      closeBtn.style.cssText = [
        'margin-left:auto', 'flex:none', 'width:28px', 'height:28px',
        'border:0', 'border-radius:6px', 'background:transparent', 'color:#bbb',
        'font-size:18px', 'cursor:pointer',
      ].join(';')
      const dismiss = () => { if (el.parentNode) el.parentNode.removeChild(el) }
      closeBtn.onclick = dismiss
      el.appendChild(closeBtn)
      document.body.appendChild(el)
      window.setTimeout(dismiss, 5000)
    }

    const onError = (event: ErrorEvent) => {
      console.error('[global error]', event.error ?? event.message)
      showToast('哎呀，页面出了点小问题，正在尽力恢复。')
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error('[unhandledrejection]', event.reason)
      showToast('网络或数据加载出现异常，请稍后再试。')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}

function Root() {
  const [showSplash, setShowSplash] = useState(!SKIP_SPLASH)
  useGlobalErrorToast()
  return (
    <StrictMode>
      <App />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
