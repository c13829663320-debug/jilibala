import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './splash-screen.css'

export type SplashScreenProps = {
  /** 开屏消散完成、整层淡出后回调，宿主此时卸载开屏。 */
  onDone: () => void
}

const MEGA: string[] = ['B', 'A', 'L', 'A', ' ', 'B', 'A', 'L', 'A']

/** Anton 仅用于开屏，按需注入，避免拖慢主应用首屏。 */
function ensureSplashFonts() {
  if (document.getElementById('splash-fonts')) return
  const link = document.createElement('link')
  link.id = 'splash-fonts'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Anton&display=swap'
  document.head.appendChild(link)
}

/**
 * 开屏页：只有居中超大的 BALA BALA + 叽里呱啦，背景半透明。
 * 点击任意处后逐字柔和淡出（轻微上浮+轻微模糊，不拆散不旋转），整层再交叉淡出，
 * 露出下层已挂载的场景选择页。
 */
export default function SplashScreen({ onDone }: SplashScreenProps) {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const megaRef = useRef<HTMLHeadingElement | null>(null)
  const leavingRef = useRef(false)
  const timersRef = useRef<number[]>([])

  const leave = () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    megaRef.current?.querySelectorAll<HTMLElement>('span[data-i]').forEach((letter, index) => {
      // 用 Web Animations API 驱动退出，绕开 CSS animation 在 StrictMode 下的状态问题
      letter.getAnimations().forEach((a) => a.cancel())
      letter.animate(
        [
          { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
          { opacity: 0, filter: 'blur(6px)', transform: 'translateY(-18px) scale(1.02)' },
        ],
        { duration: 800, delay: index * 60, easing: 'cubic-bezier(.32,.72,.42,1)', fill: 'forwards' },
      )
    })
    timersRef.current.push(window.setTimeout(() => setGone(true), 620))
    timersRef.current.push(window.setTimeout(onDone, 1150))
  }

  useEffect(() => {
    ensureSplashFonts()
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        leave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section
      className={`splash${leaving ? ' is-leaving' : ''}${gone ? ' is-gone' : ''}`}
      onClick={leave}
      role="button"
      tabIndex={0}
      aria-label="叽里呱啦开屏页，点击任意处进入场景"
    >
      <div className="splash__hero">
        <h1 className="splash__mega" ref={megaRef} aria-label="BALA BALA">
          {MEGA.map((char, index) => {
            if (char === ' ') return <span className="sp" key={index} aria-hidden="true" />
            const letter = (
              <span key={index} data-i={index} style={{ '--i': index } as CSSProperties}>
                <span className="sp-bob">{char}</span>
              </span>
            )
            return index === 0 || index === 3 ? <em key={index}>{letter}</em> : letter
          })}
        </h1>
        <div className="splash__cnsub">叽<i>里</i>呱啦</div>
      </div>
      <div className="splash__hint">点击任意处进入</div>
    </section>
  )
}
