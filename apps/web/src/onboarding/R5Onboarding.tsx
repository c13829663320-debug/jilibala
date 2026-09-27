import { CELEBRITIES, type CelebrityField } from '@balabala/shared'
import WelcomeScreen from './WelcomeScreen'
import R5IdentityStep from './R5IdentityStep'
import R5InterestPicker from './R5InterestPicker'
import TourOverlay from './TourOverlay'
import type { UseOnboarding } from './useOnboarding'
import './r5-onboarding.css'

export type R5OnboardingProps = {
  /** useOnboarding() 的返回值（由 App 持有单实例，共享状态）。 */
  ob: UseOnboarding
  /** 导航：去人物馆（高亮推荐名人）。 */
  onGoCharacters: () => void
  /** 导航：去一场法庭。 */
  onGoCourt: () => void
  /** 落地：广场（跳过 / 收尾）。 */
  onGoPlaza: () => void
}

/** 按兴趣领域推荐首位名人（取该领域第一位名人；纯展示选择）。 */
export function recommendCelebrityForField(field: CelebrityField): string | null {
  return CELEBRITIES.find((c) => c.field === field)?.id ?? null
}

function celebrityName(id: string | null): string {
  if (!id) return '一位名人'
  return CELEBRITIES.find((c) => c.id === id)?.name ?? '一位名人'
}

/**
 * R5 新手引导主控制器：状态机
 *   welcome → identity → interest → first-celebrity-chat → first-court → complete
 * splash 由宿主在本控制器之前播放；任意一步「跳过」直接落地广场并标记 skipped。
 *
 * 全屏步骤（welcome/identity/interest）自渲染；到达名人对话/法庭步骤时
 * 退化为 TourOverlay 气泡，叠加在真实页面上做导航引导（不重写名人/法庭主体）。
 */
export default function R5Onboarding({ ob, onGoCharacters, onGoCourt, onGoPlaza }: R5OnboardingProps) {
  const { state, show, advance, skip, complete, setInterest, markFirstWow } = ob

  // 已完成 / 已跳过 / 终态：不渲染任何东西。
  if (!show) return null

  const handleSkip = () => { skip(); onGoPlaza() }

  switch (state.step) {
    case 'welcome':
      return <WelcomeScreen onContinue={advance} onSkip={handleSkip} />

    case 'identity':
      return <R5IdentityStep onDone={() => advance()} onSkip={handleSkip} />

    case 'interest':
      return (
        <R5InterestPicker
          onPick={(field) => { setInterest(field, recommendCelebrityForField(field)); advance() }}
          onSkip={handleSkip}
        />
      )

    case 'first-celebrity-chat':
      return (
        <TourOverlay
          title="为你推荐了一位名人"
          body={`去人物馆和「${celebrityName(state.recommendedCelebrityId)}」聊一句吧——开口即对话，这就是第一个哇时刻。`}
          step={3}
          total={5}
          onSkip={handleSkip}
          nextLabel="前往人物馆"
          onNext={() => { onGoCharacters(); advance() }}
        />
      )

    case 'first-court':
      return (
        <TourOverlay
          title="聊过瘾了？再来一场"
          body="和名人对话过一次后，去打一场趣味法庭——把小事吵成大案，当庭宣判。"
          step={4}
          total={5}
          onSkip={() => { complete(); onGoPlaza() }}
          nextLabel="去一场法庭"
          onNext={() => { markFirstWow(); complete(); onGoCourt() }}
        />
      )

    default:
      return null
  }
}
