import type { ReactNode } from 'react'
import { Button } from './Button'

export interface EmptyStateProps {
  /** 图标（建议 lucide-react 组件，48px 内） */
  icon?: ReactNode
  title: string
  subtitle?: string
  /** 主行动按钮文案；不传则不渲染按钮 */
  actionLabel?: string
  onAction?: () => void
  /** 行动按钮变体 */
  actionVariant?: 'primary' | 'secondary' | 'ghost'
}

/** 统一空状态：图标 + 标题 + 副标题 + 行动按钮。
 *  用于名人图鉴未收集 / 广场无内容 / 我的作品为空等场景。 */
export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  actionVariant = 'primary',
}: EmptyStateProps) {
  return (
    <div className="ui-empty" role="status">
      {icon ? <div className="ui-empty__icon" aria-hidden="true">{icon}</div> : null}
      <h3 className="ui-empty__title">{title}</h3>
      {subtitle ? <p className="ui-empty__subtitle">{subtitle}</p> : null}
      {actionLabel ? (
        <Button variant={actionVariant} onClick={onAction} aria-label={actionLabel}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
