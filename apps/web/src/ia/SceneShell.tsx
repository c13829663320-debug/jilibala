/**
 * R5-IA 统一场景壳（SceneShell）：负责全屏 3D 画布的导航骨架。
 *
 * 职责边界（Shell = 容器与导航，View = 场景内 3D 内容与交互）：
 *  - 左上角统一返回按钮（←）；
 *  - 顶部面包屑（广场 > 场景名 > 对局）；
 *  - 加载 / 错误占位；
 *  - 头部信息栏。
 *
 * 渐进式接入：本壳以「覆盖层」方式叠在各场景已有 Shell 之上，不重写其内部 3D 内容。
 * children 原样透传（由 SceneRouter 注入对应场景的 Shell/View）。
 */
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { SceneShellProps } from '@balabala/shared'
import LoadingFallback from '../LoadingFallback'
import './ia.css'

export type UnifiedSceneShellProps = SceneShellProps & {
  /** 场景内 3D 内容与交互（由各域 View/Shell 提供）。 */
  children: ReactNode
}

export default function SceneShell({ title, mode, breadcrumb, onBack, error, loading, children }: UnifiedSceneShellProps) {
  return (
    <div className={`iascene-shell ${mode === 'fullscreen' ? 'iascene-shell--fullscreen' : 'iascene-shell--cards'}`}>
      {/* 统一顶部导航骨架：返回 + 面包屑 + 标题 */}
      <header className="iascene-shell__head">
        <button type="button" className="iascene-shell__back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <nav className="iascene-shell__crumb" aria-label="面包屑">
          {breadcrumb.map((item, i) => (
            <span key={i} className="iascene-shell__crumb-item">
              {i > 0 && <span className="iascene-shell__crumb-sep" aria-hidden="true">›</span>}
              <span className={i === breadcrumb.length - 1 ? 'is-current' : ''}>{item.label}</span>
            </span>
          ))}
        </nav>
        <span className="iascene-shell__title">{title}</span>
      </header>

      {/* 场景内容（全屏 3D 画布） */}
      <div className="iascene-shell__body">{children}</div>

      {/* 加载 / 错误占位 */}
      {loading && (
        <div className="iascene-shell__overlay">
          <LoadingFallback label={`正在加载${title}…`} />
        </div>
      )}
      {error && (
        <div className="iascene-shell__overlay iascene-shell__overlay--error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onBack}>返回</button>
        </div>
      )}
    </div>
  )
}
