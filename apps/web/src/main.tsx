import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import SplashScreen from './SplashScreen'

// 直达分享链接时不需要开屏，直接看判决书
const SKIP_SPLASH = typeof window !== 'undefined' && /^\/share\//.test(window.location.pathname)

function Root() {
  const [showSplash, setShowSplash] = useState(!SKIP_SPLASH)
  return (
    <StrictMode>
      <App />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
