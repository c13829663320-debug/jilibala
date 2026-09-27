export interface SpinnerProps {
  size?: 'md' | 'lg'
  /** 读屏标签 */
  label?: string
}

/** 统一加载 spinner（明黄顶弧品牌色动画） */
export function Spinner({ size = 'md', label = '加载中' }: SpinnerProps) {
  return (
    <span
      className={`ui-spinner${size === 'lg' ? ' ui-spinner--lg' : ''}`}
      role="status"
      aria-label={label}
    >
      <span className="ui-sr-only">{label}</span>
    </span>
  )
}
