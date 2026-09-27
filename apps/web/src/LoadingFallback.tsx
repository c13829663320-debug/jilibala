import { Logo } from './ui'
import { LoadingState } from './ui'

/**
 * 通用懒加载 fallback：Logo + 统一 LoadingState（品牌色 spinner + 骨架）。
 * R5 视觉品牌域：原来内联写死 #000/#4fb3a5，现收敛到 ui 组件库。
 */
export default function LoadingFallback({ label = '加载中…' }: { label?: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, background: 'var(--color-bg-pure, #000)',
    }}>
      <Logo size={36} variant="dark" />
      <LoadingState skeletonRows={0} label={label} />
    </div>
  )
}
