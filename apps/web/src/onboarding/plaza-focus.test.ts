/**
 * R5 分片C · Plaza3D 首启聚焦纯逻辑单测
 * 覆盖：首启聚焦触发、回归用户不聚焦、相机出生点朝向正确、markFirstTime 幂等
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_STATE, markFirstTime, type OnboardingState } from './onboarding-store'
import { computeFocusSpawn, shouldFocusRecommended } from './plaza-focus'
import { BUILDINGS } from '../world'

function freshState(): OnboardingState {
  return {
    ...EMPTY_STATE,
    firstTimes: { ...EMPTY_STATE.firstTimes },
    rewards: { ...EMPTY_STATE.rewards },
    multiplayerTour: { ...EMPTY_STATE.multiplayerTour },
    playedScenes: [],
  }
}

describe('shouldFocusRecommended', () => {
  it('全新用户 + 有推荐场景 → 需要聚焦', () => {
    expect(shouldFocusRecommended(freshState(), 'court')).toBe(true)
  })

  it('回归用户（firstTimes.plaza=true）→ 不聚焦', () => {
    const s = markFirstTime(freshState(), 'plaza')
    expect(shouldFocusRecommended(s, 'court')).toBe(false)
  })

  it('没有推荐场景 → 不聚焦', () => {
    expect(shouldFocusRecommended(freshState(), undefined)).toBe(false)
    expect(shouldFocusRecommended(freshState(), null)).toBe(false)
  })

  it('只逛过别的场景、没逛过广场 → 仍需聚焦（plaza 标志独立）', () => {
    const s = markFirstTime(freshState(), 'court')
    expect(shouldFocusRecommended(s, 'library')).toBe(true)
  })
})

describe('markFirstTime 幂等', () => {
  it('重复标记 plaza 不改变状态、不报错', () => {
    const once = markFirstTime(freshState(), 'plaza')
    const twice = markFirstTime(once, 'plaza')
    expect(twice).toBe(once) // 同一引用 = reducer 判定幂等
    expect(twice.firstTimes.plaza).toBe(true)
  })
})

describe('computeFocusSpawn', () => {
  it('出生点 = 建筑入口坐标', () => {
    const court = BUILDINGS.find((b) => b.id === 'court')!
    const spawn = computeFocusSpawn(court.entranceX, court.entranceZ, court.x, court.z)
    expect(spawn.x).toBe(court.entranceX)
    expect(spawn.z).toBe(court.entranceZ)
  })

  it('法庭入口(0,-60) 建筑(0,-70)：相机 yaw≈0（相机在 +Z 身后，看向 -Z 的建筑）', () => {
    const spawn = computeFocusSpawn(0, -60, 0, -70)
    expect(spawn.yaw).toBeCloseTo(0, 5)
  })

  it('通用：相机应背对建筑（相机偏移方向 = 背离建筑）', () => {
    // 图书馆入口(-57,-31) 建筑(-65,-35)
    const spawn = computeFocusSpawn(-57, -31, -65, -35)
    // 相机偏移 = (sin(yaw), cos(yaw)) 应与「背离建筑」同向
    const awayX = -((-65) - (-57))
    const awayZ = -((-35) - (-31))
    const len = Math.hypot(awayX, awayZ)
    expect(Math.sin(spawn.yaw)).toBeCloseTo(awayX / len, 5)
    expect(Math.cos(spawn.yaw)).toBeCloseTo(awayZ / len, 5)
  })

  it('对 6 栋建筑都能算出有限坐标（不 NaN/不 Infinity）', () => {
    for (const b of BUILDINGS) {
      const s = computeFocusSpawn(b.entranceX, b.entranceZ, b.x, b.z)
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.z)).toBe(true)
      expect(Number.isFinite(s.yaw)).toBe(true)
    }
  })
})
