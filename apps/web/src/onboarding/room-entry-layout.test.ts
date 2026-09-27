/**
 * R5 分片B：RoomEntry 渐进式披露逻辑单测
 * 覆盖：首启用户只显示招牌+全部体验、回归用户显示全部、展开后 6 场景可达。
 */
import { describe, expect, it } from 'vitest'
import {
  SIGNATURE_SCENE_ID,
  allScenesReachableWhenOpen,
  computeRoomEntryLayout,
  shouldShowConvergedLayout,
} from './room-entry-layout'
import type { OnboardingState } from './onboarding-store'
import { EMPTY_STATE } from './onboarding-store'

function newUser(): OnboardingState {
  return { ...EMPTY_STATE, flowCompleted: false, phase: 'splash' }
}

function returningUser(): OnboardingState {
  return { ...EMPTY_STATE, flowCompleted: true, flowSkipped: false, phase: 'completed' }
}

describe('渐进式披露：收敛布局判定', () => {
  it('首启用户（flowCompleted=false）走收敛布局', () => {
    expect(shouldShowConvergedLayout(newUser())).toBe(true)
  })

  it('回归用户（flowCompleted=true）保持完整展示', () => {
    expect(shouldShowConvergedLayout(returningUser())).toBe(false)
  })

  it('跳过主流程也算完成，不收敛', () => {
    const skipped: OnboardingState = { ...EMPTY_STATE, flowCompleted: true, flowSkipped: true, phase: 'skipped' }
    expect(shouldShowConvergedLayout(skipped)).toBe(false)
  })
})

describe('首启用户布局', () => {
  it('未展开时只渲染招牌场景（法庭），其余 5 个收进面板', () => {
    const layout = computeRoomEntryLayout(newUser(), false)
    expect(layout.visibleScenes).toEqual([SIGNATURE_SCENE_ID])
    expect(layout.signature).toBe('court')
    expect(layout.collapsed).toHaveLength(5)
    expect(layout.collapsed).not.toContain('court')
    expect(layout.createEntriesCollapsed).toBe(true)
    expect(layout.panelOpen).toBe(false)
  })

  it('展开「全部体验」后 6 个场景全部可达，创造入口放出', () => {
    const layout = computeRoomEntryLayout(newUser(), true)
    expect(layout.visibleScenes).toHaveLength(6)
    expect(allScenesReachableWhenOpen(layout)).toBe(true)
    expect(layout.collapsed).toHaveLength(5)
  })
})

describe('回归用户布局', () => {
  it('无论 panelOpen 传什么，都完整展示全部场景', () => {
    for (const open of [false, true]) {
      const layout = computeRoomEntryLayout(returningUser(), open)
      expect(layout.visibleScenes).toHaveLength(6)
      expect(layout.createEntriesCollapsed).toBe(false)
      expect(layout.collapsed).toHaveLength(0)
      expect(allScenesReachableWhenOpen(layout)).toBe(true)
    }
  })
})
