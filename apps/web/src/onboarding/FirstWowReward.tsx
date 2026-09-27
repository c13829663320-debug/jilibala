/**
 * R5 分片B：FirstWowReward —— 首次哇时刻庆祝弹窗
 *
 * 监听 onboardingBus 的 reward 事件；收到后调 claimFirstWow() 确保只领一次，
 * 仅当本次领取成功（返回 true）时弹窗。由宿主（分片A）挂载在 App 顶层，
 * 或直接放在 RoomEntry / 场景外层均可。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { onboardingBus } from './onboarding-events'
import { onboardingActions } from './onboarding-store'
import { FIRST_WOW_CONTENT, shouldShowFirstWowDialog, type FirstWowContent } from './first-wow'

export type FirstWowRewardProps = {
  /** 文案可覆盖（测试/定制场景用）。 */
  content?: FirstWowContent
  /** 关闭弹窗后回调。 */
  onClose?: () => void
}

export default function FirstWowReward({ content = FIRST_WOW_CONTENT, onClose }: FirstWowRewardProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const unsubscribe = onboardingBus.subscribe((event) => {
      if (event.type !== 'reward') return
      // claimFirstWow 内部幂等：已领过返回 false → 不弹窗。
      const claimed = onboardingActions.claimFirstWow()
      if (shouldShowFirstWowDialog(claimed)) setOpen(true)
    })
    return unsubscribe
  }, [])

  const close = () => {
    setOpen(false)
    onClose?.()
  }

  if (!open) return null

  return createPortal(
    <div className="ob-reward-backdrop" onClick={close} data-testid="first-wow-reward">
      <div className="ob-reward-card" role="dialog" aria-label="首次奖励" onClick={(e) => e.stopPropagation()}>
        <span className="ob-reward-emoji" aria-hidden="true">{content.emoji}</span>
        <h2>{content.title}</h2>
        <p>{content.body}</p>
        <span className="ob-reward-badge">🏅 「{content.badge}」徽章</span>
        <button type="button" className="ob-cta" onClick={close}>收下了</button>
      </div>
    </div>,
    document.body,
  )
}
