// ===== R5: 语音电平 / VAD 纯函数 =====
//
// 从 AnalyserNode 计算 0~1 的说话电平。Analyser 通过最小接口注入，
// 单测里用 fake analyser 喂已知波形，无需真实音频设备。

/** AnalyserNode 的最小接口（便于测试注入）。 */
export interface AudioLevelSource {
  fftSize: number
  getByteTimeDomainData(data: Uint8Array): void
}

/** RMS 增益映射：人耳对小声音不敏感，x3 放大后钳到 0~1。 */
export const LEVEL_GAIN = 3

/** VAD 判定阈值：电平超过该值视为「在说话」。 */
export const SPEECH_THRESHOLD = 0.12

/**
 * 计算当前电平 0~1。
 * 实现与 useMicrophone 里的采样一致：时域 RMS。
 */
export function computeVoiceLevel(analyser: AudioLevelSource): number {
  const size = Math.max(1, analyser.fftSize)
  const data = new Uint8Array(size)
  analyser.getByteTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128 // -1~1
    sum += v * v
  }
  const rms = Math.sqrt(sum / data.length)
  return Math.min(1, rms * LEVEL_GAIN)
}

/** 给定电平，是否判定为「正在说话」。 */
export function isSpeaking(level: number, threshold: number = SPEECH_THRESHOLD): boolean {
  return level >= threshold
}

/**
 * 平滑电平：newLevel 与旧值按权重混合，避免音量条抖动。
 * attack（电平上升）跟手快一点，release（下降）慢一点更自然。
 */
export function smoothLevel(prev: number, next: number): number {
  const alpha = next > prev ? 0.5 : 0.2
  return prev + (next - prev) * alpha
}
