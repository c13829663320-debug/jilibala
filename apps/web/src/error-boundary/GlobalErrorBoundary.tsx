// ===== Round4 R4-04: 全局 React 错误边界 =====
//
// 捕获整个 React 子树的渲染异常，显示品牌化错误页：
//   纯黑底 #000 + 明黄 #FFD600 + 青绿 #4fb3a5
// 提供「刷新页面」「返回广场」两个按钮。
// 错误信息上报到 console；可选通过 onErrorReport 回调发到 WS client_error 事件。

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 错误上报回调（接入 WS client_error）。可选。 */
  onErrorReport?: (report: { message: string; componentStack?: string }) => void
}

type State = { hasError: boolean; message: string; componentStack?: string }

export default class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 1) console 永远保留原始堆栈，便于调试
    console.error('[GlobalErrorBoundary]', error, info.componentStack)
    // 2) 可选上报到 WS client_error
    try {
      this.props.onErrorReport?.({
        message: error.message || String(error),
        componentStack: info.componentStack ?? undefined,
      })
    } catch { /* 上报失败不能影响错误页渲染 */ }
  }

  private handleReload = () => window.location.reload()
  private handleBackToPlaza = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          padding: 24,
          background: '#000',
          color: '#f5f5f5',
          textAlign: 'center',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }}>🫠</div>
        <h1 style={{ margin: 0, fontSize: 22, color: '#FFD600', fontWeight: 800 }}>
          页面开小差了
        </h1>
        <p style={{ margin: 0, maxWidth: 440, color: '#4fb3a5', fontSize: 13, lineHeight: 1.7 }}>
          叽里呱啦遇到了一点小故障，别担心——你的数据都还在。
          点下面的按钮刷新，或返回广场继续逛。
        </p>
        {this.state.message && (
          <p
            style={{
              margin: 0,
              maxWidth: 440,
              color: '#666',
              fontSize: 11,
              lineHeight: 1.6,
              wordBreak: 'break-all',
            }}
          >
            错误信息：{this.state.message}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              minHeight: 44,
              padding: '10px 26px',
              border: 0,
              borderRadius: 10,
              background: '#FFD600',
              color: '#111',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
          <button
            type="button"
            onClick={this.handleBackToPlaza}
            style={{
              minHeight: 44,
              padding: '10px 26px',
              border: `1px solid #4fb3a5`,
              borderRadius: 10,
              background: 'transparent',
              color: '#4fb3a5',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            返回广场
          </button>
        </div>
      </div>
    )
  }
}
