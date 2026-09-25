// ===== 社交临场感：空间化 TTS =====
//
// 与 tts.ts 的关系：
//  - 不修改 tts.ts 的任何导出；tts.ts 的 playTts 仍是全局单例（平板/UI 朗读）。
//  - 本模块面向"场景内 NPC 在 3D 空间里说话"：拉取 /api/tts 音频后，
//    通过 HTMLAudioElement → MediaElementAudioSourceNode → PannerNode → 扬声器输出，
//    并按指定世界坐标做方位/距离衰减。
//  - 同一时间只播一条位置化 TTS（避免广场里多个 NPC 抢声），新调用会打断旧的。
//
// 用法：
//   const tts = usePositionalTts()
//   tts.play('你好', { x: 5, z: -3 }, { voice: 'female' })
//
// 注：浏览器自动播放策略要求 play() 在用户手势后调用；NPC 触发若被拦截会 reject。

import { useCallback, useEffect, useRef, useState } from 'react'
import { computeDistanceGain, type Vec2 } from './spatial-audio'

export type PositionalTtsOptions = {
  voice?: string
  maxDistance?: number
  /** 本地位置（用于距离衰减），不传则不衰减 */
  localPos?: Vec2
}

export type PositionalTtsHandle = {
  /** 拉取并在指定位置播放 TTS；返回 Promise 在播放结束/失败时 settle */
  play: (text: string, pos: Vec2, opts?: PositionalTtsOptions) => Promise<void>
  stop: () => void
  isPlaying: boolean
}

export function usePositionalTts(): PositionalTtsHandle {
  const ctxRef = useRef<AudioContext | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const pannerRef = useRef<PannerNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    pannerRef.current = null
    gainRef.current = null
    setIsPlaying(false)
  }, [])

  const stop = useCallback(() => {
    cleanupAudio()
  }, [cleanupAudio])

  const play = useCallback(async (text: string, pos: Vec2, opts?: PositionalTtsOptions): Promise<void> => {
    const clean = text.trim().replace(/[“”"]/g, '')
    if (!clean) return
    cleanupAudio()

    if (typeof window === 'undefined') return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return

    if (!ctxRef.current) ctxRef.current = new Ctx()
    const ctx = ctxRef.current
    try { await ctx.resume() } catch { /* autoplay */ }

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, ...(opts?.voice ? { voice: opts.voice } : {}) }),
    })
    if (!res.ok) throw new Error('TTS 请求失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    urlRef.current = url

    const audio = new Audio(url)
    audioRef.current = audio

    // 注意：一个 HTMLAudioElement 只能 createMediaElementSource 一次；
    // 每次 play 新建 Audio 元素，故每次新建 source。
    const source = ctx.createMediaElementSource(audio)
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 0.001
    panner.rolloffFactor = 0
    panner.positionX.value = pos.x
    panner.positionZ.value = pos.z
    pannerRef.current = panner

    const gain = ctx.createGain()
    const maxDist = opts?.maxDistance ?? 15
    if (opts?.localPos) {
      const d = Math.hypot(pos.x - opts.localPos.x, pos.z - opts.localPos.z)
      gain.gain.value = computeDistanceGain(d, 1, maxDist, 1)
    } else {
      gain.gain.value = 1
    }
    gainRef.current = gain

    source.connect(panner)
    panner.connect(gain)
    gain.connect(ctx.destination)

    setIsPlaying(true)
    audio.onended = () => { cleanupAudio() }
    audio.onerror = () => { cleanupAudio() }
    await audio.play()
  }, [cleanupAudio])

  useEffect(() => {
    return () => {
      cleanupAudio()
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => { /* noop */ })
        ctxRef.current = null
      }
    }
  }, [cleanupAudio])

  return { play, stop, isPlaying }
}
