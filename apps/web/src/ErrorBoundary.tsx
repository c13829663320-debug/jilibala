import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 自定义 fallback 文案，例如「3D 渲染失败」。 */
  title?: string
  /** 重试回调（用于懒加载 chunk 失败后重新触发 import）。若提供，「重新加载」按钮调用它；否则 window.location.reload()。 */
  onRetry?: () => void
  /** 是否为 WebGL/3D 场景的错误（文案略不同）。 */
  is3D?: boolean
}

type State = { hasError: boolean }

/**
 * 通用错误边界：捕获子树渲染异常，展示友好的 fallback + 重载按钮。
 * - 顶层使用：覆盖整个 React 树。
 * - 懒加载场景外包裹：chunk 加载失败时可点击「重试」重新触发 import()（由父级通过 key 重建）。
 * - 3D 场景内部使用：WebGL/GPU 崩溃时不白屏。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 控制台仍输出原始错误，便于调试；用户侧不暴露技术栈。
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReload = () => {
    if (this.props.onRetry) {
      this.props.onRetry()
      // 父级会通过 key 变化重建子树；本地先清除错误态，避免过渡闪烁。
      this.setState({ hasError: false })
    } else {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const title = this.props.title ?? (this.props.is3D ? '3D 场景渲染失败' : '页面出现了一点问题')
    const hint = this.props.is3D
      ? '当前设备的显卡或浏览器暂未成功渲染 3D 画面，你可以尝试切换设备或刷新页面。'
      : '别担心，你的数据不会丢失。点击下方按钮刷新即可继续。'
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 14, padding: 24, background: '#000', color: '#f5f5f5',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>⚠️</div>
        <h1 style={{ margin: 0, fontSize: 20, color: '#4fb3a5' }}>{title}</h1>
        <p style={{ margin: 0, maxWidth: 420, color: '#999', fontSize: 13, lineHeight: 1.7 }}>{hint}</p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 6, minHeight: 44, minWidth: 140, padding: '10px 22px',
            border: 0, borderRadius: 10, background: '#4fb3a5', color: '#111',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          重新加载
        </button>
      </div>
    )
  }
}
