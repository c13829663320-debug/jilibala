// ===== R5 发布域：前端审核总线测试 =====
import { describe, expect, it, vi } from 'vitest'
import {
  subscribeModeration,
  getModerationState,
  pushModerationHit,
  setMuteStatus,
  handleIncomingModerationFrame,
} from './moderation-bus'

describe('moderation-bus', () => {
  it('pushModerationHit 更新 lastHitAt 并通知订阅者', () => {
    const spy = vi.fn()
    const unsub = subscribeModeration(spy)
    pushModerationHit()
    expect(getModerationState().lastHitAt).toBeGreaterThan(0)
    expect(spy).toHaveBeenCalled()
    unsub()
  })

  it('setMuteStatus 设置禁言状态', () => {
    const until = Date.now() + 60_000
    setMuteStatus({ muted: true, mutedUntil: until, reason: 'profanity' })
    const s = getModerationState()
    expect(s.mute.muted).toBe(true)
    expect(s.mute.mutedUntil).toBe(until)
    expect(s.mute.reason).toBe('profanity')
  })

  it('handleIncomingModerationFrame 只识别 mute_status 帧', () => {
    setMuteStatus({ muted: false })
    handleIncomingModerationFrame({ type: 'chat' })
    expect(getModerationState().mute.muted).toBe(false)
    handleIncomingModerationFrame({ type: 'mute_status', muted: true, mutedUntil: 12345 })
    expect(getModerationState().mute.muted).toBe(true)
    expect(getModerationState().mute.mutedUntil).toBe(12345)
  })
})
