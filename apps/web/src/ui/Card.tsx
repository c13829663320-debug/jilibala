import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** accent 边框变体：yellow=明黄描边 / teal=青绿描边 / 不传=默认细白线 */
  accent?: 'yellow' | 'teal'
  /** 是否加内边距 */
  pad?: boolean
  children: ReactNode
}

/** 统一卡片：黑底 + 品牌色描边变体 */
export function Card({ accent, pad, className = '', children, ...rest }: CardProps) {
  const cls = [
    'ui-card',
    accent === 'yellow' ? 'ui-card--accent-yellow' : '',
    accent === 'teal' ? 'ui-card--accent-teal' : '',
    pad ? 'ui-card--pad' : '',
    className,
  ].filter(Boolean).join(' ')
  return <div className={cls} {...rest}>{children}</div>
}
