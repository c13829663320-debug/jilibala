// ===== voice-fallback 纯逻辑单测（Node 环境，无浏览器 API）=====
import { describe, expect, it } from 'vitest'
import {
  VoiceFallbackMachine,
  initialVoiceFallbackState,
  micErrorToEvent,
  reduceVoiceFallback,
} from './voice-fallback'

describe('语音 → 文字喊话 回落状态机', () => {
  it('初始状态：voice 模式，无回落原因', () => {
    const s = initialVoiceFallbackState
    expect(s.mode).toBe('voice')
    expect(s.reason).toBe('none')
    expect(s.showMicGuide).toBe(false)
  })

  it('麦克风权限被拒 → 自动切到 text 模式并弹出引导', () => {
    const s = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_DENIED' })
    expect(s.mode).toBe('text')
    expect(s.reason).toBe('mic_denied')
    expect(s.micPermission).toBe('denied')
    expect(s.showMicGuide).toBe(true)
  })

  it('无麦克风硬件 → 切 text 模式，但不弹权限引导', () => {
    const s = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_NO_DEVICE' })
    expect(s.mode).toBe('text')
    expect(s.reason).toBe('no_mic_device')
    expect(s.showMicGuide).toBe(false)
  })

  it('WebRTC 连接失败（已有麦克风）→ 切 text 模式，reason=webrtc_failed', () => {
    const granted = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_GRANTED' })
    expect(granted.mode).toBe('voice')
    const s = reduceVoiceFallback(granted, { type: 'WEBRTC_FAILED' })
    expect(s.mode).toBe('text')
    expect(s.reason).toBe('webrtc_failed')
    expect(s.webrtcHealthy).toBe(false)
  })

  it('WebRTC 链路恢复后，因 webrtc_failed 回落的自动切回 voice', () => {
    const failed = reduceVoiceFallback(
      reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_GRANTED' }),
      { type: 'WEBRTC_FAILED' },
    )
    const s = reduceVoiceFallback(failed, { type: 'WEBRTC_RECOVERED' })
    expect(s.mode).toBe('voice')
    expect(s.reason).toBe('none')
    expect(s.webrtcHealthy).toBe(true)
  })

  it('权限被拒导致的 text 模式，WebRTC 恢复不自动切回（尊重用户）', () => {
    const denied = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_DENIED' })
    const s = reduceVoiceFallback(denied, { type: 'WEBRTC_RECOVERED' })
    expect(s.mode).toBe('text')
    expect(s.reason).toBe('mic_denied')
  })

  it('用户主动关麦 → text 模式；取消静音 → 回 voice', () => {
    const muted = reduceVoiceFallback(initialVoiceFallbackState, { type: 'USER_MUTE_CHANGED', muted: true })
    expect(muted.mode).toBe('text')
    expect(muted.reason).toBe('user_muted')
    const unmuted = reduceVoiceFallback(muted, { type: 'USER_MUTE_CHANGED', muted: false })
    expect(unmuted.mode).toBe('voice')
    expect(unmuted.reason).toBe('none')
  })

  it('取消静音时若不是因 user_muted 回落，不改变当前模式', () => {
    const denied = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_DENIED' })
    const s = reduceVoiceFallback(denied, { type: 'USER_MUTE_CHANGED', muted: false })
    expect(s.mode).toBe('text') // 仍然是权限问题导致的文字模式
  })

  it('用户点「重试语音」→ 回到 voice 等待结果；若再次被拒仍回落 text', () => {
    const denied = reduceVoiceFallback(initialVoiceFallbackState, { type: 'MIC_DENIED' })
    const retrying = reduceVoiceFallback(denied, { type: 'USER_RETRY_VOICE' })
    expect(retrying.mode).toBe('voice')
    expect(retrying.showMicGuide).toBe(false)
    const again = reduceVoiceFallback(retrying, { type: 'MIC_DENIED' })
    expect(again.mode).toBe('text')
    // 用户已重试过一次，按 guideDismissed=true 不再自动弹（dismiss 由 UI 决定）
  })

  it('用户主动选文字喊话 → text 模式 reason=user_chose_text', () => {
    const s = reduceVoiceFallback(initialVoiceFallbackState, { type: 'USER_CHOOSE_TEXT' })
    expect(s.mode).toBe('text')
    expect(s.reason).toBe('user_chose_text')
  })

  it('关闭引导弹窗后，下次权限被拒不再自动弹（guideDismissed）', () => {
    const dismissed = reduceVoiceFallback(initialVoiceFallbackState, { type: 'DISMISS_GUIDE' })
    expect(dismissed.guideDismissed).toBe(true)
    const denied = reduceVoiceFallback(dismissed, { type: 'MIC_DENIED' })
    expect(denied.showMicGuide).toBe(false)
  })

  it('machine 类：isTextMode / canSendVoice 选择器正确', () => {
    const m = new VoiceFallbackMachine()
    expect(m.isTextMode()).toBe(false)
    expect(m.canSendVoice()).toBe(true)
    m.send({ type: 'MIC_DENIED' })
    expect(m.isTextMode()).toBe(true)
    expect(m.canSendVoice()).toBe(false)
    m.send({ type: 'MIC_GRANTED' })
    expect(m.isTextMode()).toBe(false)
    expect(m.canSendVoice()).toBe(true)
  })
})

describe('micErrorToEvent：DOMException.name 映射', () => {
  it('NotAllowedError → MIC_DENIED', () => {
    expect(micErrorToEvent('NotAllowedError')).toEqual({ type: 'MIC_DENIED' })
    expect(micErrorToEvent('PermissionDeniedError')).toEqual({ type: 'MIC_DENIED' })
  })
  it('NotFoundError → MIC_NO_DEVICE', () => {
    expect(micErrorToEvent('NotFoundError')).toEqual({ type: 'MIC_NO_DEVICE' })
    expect(micErrorToEvent('DevicesNotFoundError')).toEqual({ type: 'MIC_NO_DEVICE' })
  })
  it('未知错误名 → MIC_ERROR（按无设备降级处理）', () => {
    expect(micErrorToEvent('NotReadableError')).toEqual({ type: 'MIC_ERROR' })
    expect(micErrorToEvent(undefined)).toEqual({ type: 'MIC_ERROR' })
  })
})
