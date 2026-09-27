import { Spinner } from './Spinner'

export interface LoadingStateProps {
  /** 骨架条数；0 则只显示 spinner */
  skeletonRows?: number
  label?: string
}

/** 统一加载态：品牌色 spinner + 骨架屏 */
export function LoadingState({ skeletonRows = 3, label = '加载中' }: LoadingStateProps) {
  return (
    <div className="ui-loading" role="status" aria-label={label}>
      <Spinner size="lg" label={label} />
      {skeletonRows > 0 ? (
        <div style={{ width: 'min(320px, 80%)', display: 'flex', flexDirection: 'column', gap: 10 }} aria-hidden="true">
          {Array.from({ length: skeletonRows }, (_, i) => (
            <div
              key={i}
              className="ui-skeleton"
              style={{ height: i === 0 ? 20 : 14, width: `${100 - i * 12}%` }}
            />
          ))}
        </div>
      ) : null}
      <span className="ui-sr-only">{label}</span>
    </div>
  )
}
