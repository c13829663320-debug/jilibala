// ===== 社交临场感：麦克风管理 hook =====
//
// 职责：
//  - 请求/释放麦克风权限（getUserMedia），拒绝/无设备时降级为 error 状态，不抛异常
//  - 通过 AnalyserNode 实时计算麦克风电平（0~1），供远端口型/说话指示使用
//  - 静音采用 track.enabled=false（不停止 MediaStream），保持 PeerConnection 不断连
//
// 注意：本 hook 仅做采集与电平分析；远端播放的 PannerNode 图由 useSpatialVoice 维护。
// 云端测试环境无麦克风，requestMic 会返回 false 并设置 error，不影响单测。

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MicrophoneState {
  /** 请求麦克风权限，成功返回 true；拒绝/无设备返回 false（不抛异常） */
  requestMic: () => Promise<boolean>
  /** 采集到的本地麦克流（静音时 track.enabled=false，流本身未停止） */
  stream: MediaStream | null
  /** 电平分析节点（可传给 AvatarLipSync 做口型驱动） */
  analyser: AnalyserNode | null
  /** 实时电平 0~1 */
  level: number
  /** 是否静音（本地不发送音频） */
  muted: boolean
  setMuted: (m: boolean) => void
  /** 错误信息（权限拒绝/无设备/不支持），成功采集后清空 */
  error: string | null
  /** 卸载时清理流与分析器 */
  cleanup: () => void
}

/** 电平采样间隔（ms）。用 setInterval 而非 rAF，避免后台标签页停采样。 */
const LEVEL_INTERVAL_MS = 50

export function useMicrophone(): MicrophoneState {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [level, setLevel] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 用 ref 持有可变引用，避免闭包过期
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const intervalRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopLevelLoop = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cleanup = useCallback(() => {
    stopLevelLoop()
    if (sourceRef.current) {
      try { sourceRef.current.disconnect() } catch { /* noop */ }
      sourceRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try { track.stop() } catch { /* noop */ }
      }
      streamRef.current = null
    }
    // AudioContext 不立即 close：可能被复用；卸载时由本 hook 实例关闭
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => { /* noop */ })
      ctxRef.current = null
    }
    setStream(null)
    setAnalyser(null)
    setLevel(0)
  }, [stopLevelLoop])

  const requestMic = useCallback(async (): Promise<boolean> => {
    // 已在采集则直接返回
    if (streamRef.current) return true

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持麦克风采集')
      return false
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      streamRef.current = media
      setStream(media)
      setError(null)

      // 建立分析图：media → source → analyser（不接 destination，避免回声）
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      try { await ctx.resume() } catch { /* autoplay policy */ }

      const source = ctx.createMediaStreamSource(media)
      const analyserNode = ctx.createAnalyser()
      analyserNode.fftSize = 512
      source.connect(analyserNode)
      sourceRef.current = source
      setAnalyser(analyserNode)

      // 电平采样：计算时域 RMS
      const data = new Uint8Array(analyserNode.fftSize)
      intervalRef.current = window.setInterval(() => {
        if (!analyserNode) return
        analyserNode.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128 // -1~1
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        // 人耳对小声音不敏感，做一点增益映射
        setLevel(Math.min(1, rms * 3))
      }, LEVEL_INTERVAL_MS)

      return true
    } catch (e) {
      const err = e as DOMException
      let msg = '麦克风采集失败'
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg = '麦克风权限被拒绝，请在浏览器地址栏允许后重试'
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg = '未检测到麦克风设备'
      } else if (err?.name === 'NotReadableError') {
        msg = '麦克风被其他应用占用'
      }
      setError(msg)
      return false
    }
  }, [])

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m)
    // 静音/取消静音只切换 track.enabled，保持 MediaStream 与 PeerConnection 不中断
    if (streamRef.current) {
      for (const track of streamRef.current.getAudioTracks()) {
        track.enabled = !m
      }
    }
  }, [])

  // 卸载时自动清理
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  return {
    requestMic,
    stream,
    analyser,
    level,
    muted,
    setMuted,
    error,
    cleanup,
  }
}
