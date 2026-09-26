import { useState } from 'react'

export type FirstTimeGuideProps = {
  /** 引导步骤文案；超过 3 步会截断到 3 步。 */
  steps: string[]
  /** 当前场景名（标题角标展示）。 */
  sceneLabel: string
  /** 走完或跳过时回调（由宿主记录"已玩过"）。 */
  onDone: () => void
}

/**
 * 场景首次进入时的半透明引导浮层：
 * - 最多 3 步，底部卡片式；
 * - 背景不拦截游戏操作（pointer-events 只在卡片上）；
 * - 右上角/底部均可一键跳过。
 */
export default function FirstTimeGuide({ steps, sceneLabel, onDone }: FirstTimeGuideProps) {
  const limited = steps.slice(0, 3)
  const [index, setIndex] = useState(0)

  const isLast = index >= limited.length - 1
  const next = () => {
    if (isLast) onDone()
    else setIndex((i) => i + 1)
  }

  if (limited.length === 0) return null

  return (
    <>
      <div className="ob-guide-backdrop" aria-hidden="true" />
      <div className="ob-guide-card" role="dialog" aria-label={`${sceneLabel}新手引导`}>
        <div className="ob-guide-head">
          <span className="ob-guide-scene">{sceneLabel} · 30 秒上手</span>
          <span className="ob-guide-stepno">{Math.min(index + 1, limited.length)} / {limited.length}</span>
        </div>
        <p className="ob-guide-text">{limited[index]}</p>
        <div className="ob-guide-dots" aria-hidden="true">
          {limited.map((_, i) => <i key={i} className={i === index ? 'is-on' : ''} />)}
        </div>
        <div className="ob-guide-actions">
          <button type="button" className="skip" onClick={onDone}>跳过</button>
          <button type="button" className="next" onClick={next}>
            {isLast ? '知道了，开始玩' : '下一步'}
          </button>
        </div>
      </div>
    </>
  )
}
