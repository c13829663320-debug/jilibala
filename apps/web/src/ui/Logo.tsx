export interface LogoProps {
  /** 尺寸 px */
  size?: number
  /** 深色底变体（默认）：白 logo；yellow=明黄字标 */
  variant?: 'dark' | 'yellow'
  /** 是否显示文字字标 */
  withWordmark?: boolean
  className?: string
}

/** 统一 Logo 封装：public/brand 下的白标资源 + 文字字标。
 *  SplashScreen / 导航 / 加载页统一使用。 */
export function Logo({ size = 32, variant = 'dark', withWordmark = true, className = '' }: LogoProps) {
  const src = variant === 'yellow' ? '/brand/balabala-logo-white.png' : '/brand/balabala-logo-white.png'
  const cls = `ui-logo${variant === 'yellow' ? ' ui-logo--yellow' : ''} ${className}`.trim()
  return (
    <span className={cls} aria-label="叽里呱啦 BalaBala">
      <img src={src} alt="" width={size} height={size} style={{ borderRadius: size / 6 }} />
      {withWordmark ? (
        <span className="ui-logo__wordmark" style={{ fontSize: size * 0.62 }}>
          BALA&nbsp;BALA
        </span>
      ) : null}
    </span>
  )
}
