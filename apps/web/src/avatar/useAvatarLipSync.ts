// ===== useAvatarLipSync：口型驱动 hook =====
// 支持三种 source：
// - 'mic'：本地麦克风电平驱动（AnalyserNode），并通过 onIntensity 回调发 WS talking
// - 'remote'：收到的远端 talkingIntensity 驱动（intensityRef）
// - 'tts'：TTS 音频电平驱动（intensityRef 或 AnalyserNode）
// 每 ~16ms 读取一次电平 → 映射为口型 → 平滑 → 写到 rig。
import { useEffect, useRef, type MutableRefObject } from 'react'
import { levelToMouthOpen, smoothIntensity, intensityFromAnalyser } from './lip-sync'
import { setMouthOpen, type AvatarRig } from './avatar-rig'

export type LipSyncSource = 'mic' | 'remote' | 'tts'

export interface LipSyncOptions {
  source: LipSyncSource
  /** remote/tts 模式：读取外部传入的强度（0~1） */
  intensityRef?: MutableRefObject<number>
  /** mic 模式：麦克风 AnalyserNode */
  analyser?: AnalyserNode | null
  /** 目标 rig */
  rigRef: MutableRefObject<AvatarRig | null>
  /** 本地说话时回调（用于节流发 WS talking 消息），参数为原始电平 0~1 */
  onIntensity?: (level: number) => void
  /** 平滑系数，默认 0.35（跟随较快） */
  smoothingAlpha?: number
}

export interface LipSyncResult {
  /** 当前口部张开度 0~1 */
  mouthOpen: number
}

const TICK_MS = 16 // ~60fps

export function useAvatarLipSync(opts: LipSyncOptions): LipSyncResult {
  const { source, intensityRef, analyser, rigRef, onIntensity, smoothingAlpha = 0.35 } = opts
  const smoothRef = useRef(0)
  const mouthOpenRef = useRef(0)
  // 用 ref 持有最新回调，避免 interval 闭包过期
  const cbRef = useRef(onIntensity)
  cbRef.current = onIntensity
  const analyserRef = useRef(analyser)
  analyserRef.current = analyser

  useEffect(() => {
    let timer: number | null = null

    const tick = () => {
      let raw = 0
      if (source === 'mic') {
        const an = analyserRef.current
        if (an) raw = intensityFromAnalyser(an)
        // 本地说话电平回调（由 Plaza3D 节流发 WS）
        if (cbRef.current) cbRef.current(raw)
      } else {
        // remote / tts：从外部 intensityRef 读
        raw = intensityRef?.current ?? 0
      }

      // 电平 → 口型 → 指数平滑
      const target = levelToMouthOpen(raw)
      smoothRef.current = smoothIntensity(smoothRef.current, target, smoothingAlpha)
      mouthOpenRef.current = smoothRef.current

      // 写到 rig
      const rig = rigRef.current
      if (rig) setMouthOpen(rig, smoothRef.current)
    }

    timer = window.setInterval(tick, TICK_MS)
    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [source, intensityRef, analyser, rigRef, smoothingAlpha])

  return { mouthOpen: mouthOpenRef.current }
}
