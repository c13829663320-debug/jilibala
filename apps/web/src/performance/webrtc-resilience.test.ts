import { describe, it, expect } from 'vitest'
import { classifyIceState, shouldFallbackToText, adaptiveAudioBitrate } from './webrtc-resilience'

describe('classifyIceState', () => {
  it('maps connected/completed', () => {
    expect(classifyIceState('connected')).toBe('connected')
    expect(classifyIceState('completed')).toBe('connected')
  })
  it('maps failed/closed', () => {
    expect(classifyIceState('failed')).toBe('failed')
    expect(classifyIceState('closed')).toBe('failed')
  })
  it('maps disconnected to reconnecting', () => {
    expect(classifyIceState('disconnected')).toBe('reconnecting')
  })
})

describe('shouldFallbackToText', () => {
  it('does not fall back while connected', () => {
    expect(shouldFallbackToText('connected', 99999)).toBe(false)
  })
  it('falls back after failed threshold', () => {
    expect(shouldFallbackToText('failed', 5000, 8000)).toBe(false)
    expect(shouldFallbackToText('failed', 9000, 8000)).toBe(true)
  })
  it('gives reconnecting twice the grace', () => {
    expect(shouldFallbackToText('reconnecting', 10000, 8000)).toBe(false)
    expect(shouldFallbackToText('reconnecting', 17000, 8000)).toBe(true)
  })
})

describe('adaptiveAudioBitrate', () => {
  it('high on good network', () => {
    expect(adaptiveAudioBitrate(80, 0.5)).toBe('high')
  })
  it('medium on moderate loss/latency', () => {
    expect(adaptiveAudioBitrate(400, 2)).toBe('medium')
    expect(adaptiveAudioBitrate(100, 5)).toBe('medium')
  })
  it('low on bad network', () => {
    expect(adaptiveAudioBitrate(700, 1)).toBe('low')
    expect(adaptiveAudioBitrate(100, 12)).toBe('low')
  })
})
