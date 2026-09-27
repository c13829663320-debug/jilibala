// ===== R5: 语音电平 / VAD 纯函数测试 =====
import { describe, expect, it } from 'vitest'
import { computeVoiceLevel, isSpeaking, smoothLevel, type AudioLevelSource } from './voiceLevel'

/** 用给定样本构造 fake analyser。 */
function fakeAnalyser(samples: number[]): AudioLevelSource {
  return {
    fftSize: samples.length,
    getByteTimeDomainData(data: Uint8Array) {
      for (let i = 0; i < data.length; i++) data[i] = samples[i] ?? 128
    },
  }
}

describe('computeVoiceLevel', () => {
  it('静音（全部 128 中点）电平接近 0', () => {
    const silent = Array.from({ length: 512 }, () => 128)
    expect(computeVoiceLevel(fakeAnalyser(silent))).toBe(0)
  })

  it('满幅方波电平钳到 1', () => {
    // 交替 0/255 => v = ±1 => rms = 1 => 钳到 1
    const square = Array.from({ length: 512 }, (_, i) => (i % 2 === 0 ? 255 : 0))
    expect(computeVoiceLevel(fakeAnalyser(square))).toBe(1)
  })

  it('中等音量在 0~1 之间且为正', () => {
    // ±32 的小信号
    const wave = Array.from({ length: 512 }, (_, i) => 128 + Math.round(32 * Math.sin(i)))
    const level = computeVoiceLevel(fakeAnalyser(wave))
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(1)
  })
})

describe('isSpeaking', () => {
  it('低于阈值不算说话，高于阈值算', () => {
    expect(isSpeaking(0.05)).toBe(false)
    expect(isSpeaking(0.5)).toBe(true)
  })
})

describe('smoothLevel', () => {
  it('上升快、下降慢', () => {
    const up = smoothLevel(0.1, 0.6)
    const down = smoothLevel(0.6, 0.1)
    expect(up).toBeCloseTo(0.35, 2)
    expect(down).toBeCloseTo(0.5, 2)
  })
})
