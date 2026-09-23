import { useState, type ReactNode } from 'react'
import { ArrowLeft, Archive } from 'lucide-react'
import { CourtroomBackdrop, type ActiveSpeaker } from './CourtroomBackdrop'
import type { Celebrity } from '@balabala/shared'
import type { CourtCase, Perspective } from './types'

export function useCourtTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('balabala.court-theme') as 'light' | 'dark') || 'dark'
    } catch { return 'dark' }
  })
  return { theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }
}

type TopbarProps = {
  onExit: () => void
  onOpenArchive: () => void
}

export function CourtTopbar({ onExit, onOpenArchive }: TopbarProps) {
  return (
    <header className="court-topbar">
      <button className="court-topbar__back" onClick={onExit} aria-label="退出法庭">
        <ArrowLeft size={16} />
      </button>
      <div className="court-topbar__brand">
        <span className="court-topbar__mark">⚖</span>
        <span>叽里呱啦 · 趣味法庭</span>
      </div>
      <div className="court-topbar__actions">
        <button className="court-btn court-btn--ghost court-btn--sm" onClick={onOpenArchive}>
          <Archive size={15} /> 案卷库
        </button>
      </div>
    </header>
  )
}

/** S1~S4 共享的外壳:全屏 3D 法庭 + 磨砂层 + 顶栏 + 底部视角切换。 */
type ShellProps = {
  character?: Celebrity | null
  courtCase?: CourtCase | null
  activeSpeaker?: ActiveSpeaker | null
  onExit: () => void
  onOpenArchive: () => void
  /** 磨砂更强(文字多的页面用,提升可读性) */
  frostStrong?: boolean
  /** 视角切换回调(仅切换镜头,不影响案件逻辑) */
  onPerspectiveChange?: (p: Perspective) => void
  /** 覆盖浮层容器 class(如 noscroll 居中模式) */
  overlayClassName?: string
  children: ReactNode
}

export function CourtroomShell({
  character: _character, courtCase, activeSpeaker, onExit, onOpenArchive,
  frostStrong, onPerspectiveChange, overlayClassName, children,
}: ShellProps) {
  const [perspective, setPerspective] = useState<Perspective>('audience')
  const switchTo = (p: Perspective) => {
    setPerspective(p)
    onPerspectiveChange?.(p)
  }
  return (
    <div className="live-screen">
      <CourtroomBackdrop courtCase={courtCase} activeSpeaker={activeSpeaker} />
      <div className={`live-frost${frostStrong ? ' live-frost--strong' : ''}`} aria-hidden="true" />

      <div className="live-topbar live-topbar--bare">
        <button className="live-topbar__back" onClick={onExit} aria-label="退出法庭">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/balabala-mark.jpg" alt="叽里呱啦" className="court-brand-mark" />
        <span className="live-topbar__spacer" />
        <button className="live-topbar__archive" onClick={onOpenArchive} aria-label="案卷库">
          <Archive size={15} /> 案卷
        </button>
      </div>

      <div className={`live-overlay-ui${overlayClassName ? ' ' + overlayClassName : ''}`}>{children}</div>

      <div className="live-perspective-switch">
        {(['plaintiff', 'audience', 'defendant'] as Perspective[]).map((p) => (
          <button key={p} className={perspective === p ? 'is-active' : ''} onClick={() => switchTo(p)}>
            {p === 'plaintiff' ? '原告席' : p === 'audience' ? '观众席' : '被告席'}
          </button>
        ))}
      </div>
    </div>
  )
}
