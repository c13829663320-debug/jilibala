import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ui.css'
import './a11y.css'
import './transitions.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

/** 统一按钮：primary=明黄黑字 / secondary=青绿 / ghost=描边 */
export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = `ui-btn ui-btn--${variant} ui-btn--${size} ${className}`.trim()
  return <button type={type} className={cls} {...rest} />
}
