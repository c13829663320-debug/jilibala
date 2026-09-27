/**
 * R5 新手引导事件总线（轻量发布订阅）
 *
 * 用于跨组件通信：引导步骤变更、首次事件触发、奖励领取等。
 * 不依赖 React，组件通过 useEffect 订阅。
 */

export type OnboardingEvent =
  | { type: 'phase-change'; phase: string }
  | { type: 'first-time'; key: string }
  | { type: 'reward'; reward: 'firstWow' }
  | { type: 'flow-skipped' }
  | { type: 'flow-completed' }
  | { type: 'guide-dismissed'; guideId: string }

type Listener = (event: OnboardingEvent) => void

class OnboardingEventBus {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(event: OnboardingEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* listener errors don't break bus */ }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

export const onboardingBus = new OnboardingEventBus()
