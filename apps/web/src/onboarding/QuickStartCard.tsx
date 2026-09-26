import type { InterestId, SceneId } from './onboardingProgress'
import {
  INTEREST_SCENE_MAP, SCENE_DESCRIPTIONS, SCENE_LABELS,
} from './onboardingProgress'

export type QuickStartCardProps = {
  /** 刚选中的兴趣。 */
  interest: InterestId
  /** 点「立即开始」直达推荐场景。 */
  onStart: () => void
  /** 点「先逛逛」退回入口大厅。 */
  onSkip: () => void
}

/**
 * 兴趣选完后的推荐卡片：一句话告诉用户推荐玩什么，
 * 一个大按钮直接进场景，跳过广场。
 */
export default function QuickStartCard({ interest, onStart, onSkip }: QuickStartCardProps) {
  const scene: SceneId = INTEREST_SCENE_MAP[interest]
  return (
    <section className="ob-overlay" aria-label="为你推荐的第一个游戏">
      <div className="ob-kicker">RECOMMENDED FOR YOU</div>
      <h1 className="ob-title">就它了，<em>马上开玩。</em></h1>

      <div className="ob-card">
        <span className="badge">✦ 为你推荐</span>
        <h2>{SCENE_LABELS[scene]}</h2>
        <p>{SCENE_DESCRIPTIONS[scene]}</p>
        <button type="button" className="ob-cta" onClick={onStart}>立即开始 →</button>
        <div>
          <button type="button" className="ob-ghost" onClick={onSkip}>先逛逛广场</button>
        </div>
      </div>
    </section>
  )
}
