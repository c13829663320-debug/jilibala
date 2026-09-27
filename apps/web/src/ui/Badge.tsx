import type { HTMLAttributes, ReactNode } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'yellow' | 'teal'
  children: ReactNode
}

/** 统一徽章 */
export function Badge({ variant = 'default', className = '', children, ...rest }: BadgeProps) {
  const cls = `ui-badge${variant !== 'default' ? ` ui-badge--${variant}` : ''} ${className}`.trim()
  return <span className={cls} {...rest}>{children}</span>
}
