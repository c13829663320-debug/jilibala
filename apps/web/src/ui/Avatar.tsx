export interface AvatarProps {
  /** 头像图片地址；不传则显示首字母占位 */
  src?: string
  /** 名字（用于 alt 与首字母占位） */
  name: string
  size?: 'sm' | 'md' | 'lg'
  /** 在线状态点；undefined=不渲染 */
  online?: boolean
  className?: string
}

/** 统一头像：白底圆角 + 在线状态点。名人头像 / 用户头像统一走这里。 */
export function Avatar({ src, name, size = 'md', online, className = '' }: AvatarProps) {
  const cls = `ui-avatar ui-avatar--${size} ${className}`.trim()
  const initial = (name || '?').trim().charAt(0)
  return (
    <span className={cls} role="img" aria-label={name}>
      {src ? (
        <img src={src} alt={name} loading="lazy" />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
      {typeof online === 'boolean' ? (
        <span
          className={`ui-avatar__dot${online ? '' : ' ui-avatar__dot--off'}`}
          role="status"
          aria-label={online ? '在线' : '离线'}
        />
      ) : null}
    </span>
  )
}
