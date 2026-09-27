/**
 * useOnboarding：R5 新手引导的 React 接入层。
 *
 * - localStorage 持久化（key=balabala.r5.onboarding.v1）；
 * - 已完成 / 已跳过用户不再触发；
 * - 每次页面加载 bump 一次 sessionCount（驱动 feature gates 渐进披露）；
 * - 提供 advance / skip / complete / setInterest / markFirstWow / reset。
 *
 * 纯读写函数 loadR5State / saveR5State 接受可选 Storage 注入，便于 node 环境单测。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bumpR5Session,
  completeR5Onboarding,
  createInitialR5Onboarding,
  markR5FirstWow,
  nextR5Step,
  recordR5Interest,
  shouldShowR5Onboarding,
  skipR5Onboarding,
  type R5OnboardingState,
} from '@balabala/shared'

export const R5_ONBOARDING_STORAGE_KEY = 'balabala.r5.onboarding.v1'

/** R4 旧引导 key：存在即视为老用户，R5 自动标记已跳过，不重复引导。 */
const LEGACY_R4_ONBOARDING_KEY = 'balabala.onboarding.v1'

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 从存储读取 R5 引导状态；损坏/缺失返回初始状态。 */
export function loadR5State(storage?: Storage | null): R5OnboardingState {
  const store = storage ?? defaultStorage()
  const fresh = createInitialR5Onboarding()
  if (!store) return fresh
  try {
    const raw = store.getItem(R5_ONBOARDING_STORAGE_KEY)
    if (!raw) {
      // 迁移：老 R4 用户（已有旧引导记录）不重新跑 R5，直接视为已跳过。
      if (store.getItem(LEGACY_R4_ONBOARDING_KEY) != null) {
        return { ...fresh, completed: true, skipped: true }
      }
      return fresh
    }
    const p = JSON.parse(raw) as Partial<R5OnboardingState>
    return {
      ...createInitialR5Onboarding(),
      step: p.step ?? 'welcome',
      completed: p.completed === true,
      skipped: p.skipped === true,
      completedAt: typeof p.completedAt === 'string' ? p.completedAt : null,
      interestField: typeof p.interestField === 'string' ? p.interestField : null,
      recommendedCelebrityId: typeof p.recommendedCelebrityId === 'string' ? p.recommendedCelebrityId : null,
      sessionCount: typeof p.sessionCount === 'number' ? Math.max(0, Math.floor(p.sessionCount)) : 0,
      firstWowDone: p.firstWowDone === true,
    }
  } catch {
    return createInitialR5Onboarding()
  }
}

export function saveR5State(state: R5OnboardingState, storage?: Storage | null): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  try {
    store.setItem(R5_ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode / quota */
  }
}

export type UseOnboarding = {
  state: R5OnboardingState
  /** 是否需要展示引导（未完成且未跳过）。 */
  show: boolean
  /** 前进到下一步。 */
  advance: () => void
  /** 跳过整个引导（落地广场）。 */
  skip: () => void
  /** 完成引导（记录完成时间）。 */
  complete: () => void
  /** 记录兴趣领域 + 推荐首位名人。 */
  setInterest: (field: string, celebrityId: string | null) => void
  /** 标记首个哇时刻已发生。 */
  markFirstWow: () => void
  /** 设置页调用：重置引导，下次重新触发。 */
  reset: () => void
}

export function useOnboarding(): UseOnboarding {
  const [state, setState] = useState<R5OnboardingState>(() => loadR5State())
  const bumpedRef = useRef(false)

  // 每次页面加载 bump 一次会话计数（StrictMode 下 effect 会跑两次，用 ref 去重）。
  useEffect(() => {
    if (bumpedRef.current) return
    bumpedRef.current = true
    setState((prev) => {
      const next = bumpR5Session(prev)
      saveR5State(next)
      return next
    })
  }, [])

  const advance = useCallback(() => {
    setState((prev) => {
      const next = nextR5Step(prev)
      saveR5State(next)
      return next
    })
  }, [])

  const skip = useCallback(() => {
    setState((prev) => {
      const next = skipR5Onboarding(prev)
      saveR5State(next)
      return next
    })
  }, [])

  const complete = useCallback(() => {
    setState((prev) => {
      const next = completeR5Onboarding(prev, new Date().toISOString())
      saveR5State(next)
      return next
    })
  }, [])

  const setInterest = useCallback((field: string, celebrityId: string | null) => {
    setState((prev) => {
      const next = recordR5Interest(prev, field, celebrityId)
      saveR5State(next)
      return next
    })
  }, [])

  const markFirstWow = useCallback(() => {
    setState((prev) => {
      const next = markR5FirstWow(prev)
      saveR5State(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const fresh = createInitialR5Onboarding()
    saveR5State(fresh)
    setState(fresh)
  }, [])

  const show = useMemo(() => shouldShowR5Onboarding(state), [state])

  return { state, show, advance, skip, complete, setInterest, markFirstWow, reset }
}
