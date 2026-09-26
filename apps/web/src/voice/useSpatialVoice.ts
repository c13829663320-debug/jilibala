// ===== 社交临场感：useSpatialVoice —— WebRTC mesh 距离语音 + 统一 3D 空间音频 =====
//
// 架构要点（关键决策在注释中说明）：
//
// 1. WebRTC mesh（全互联）：每个近端 peer 由一个 RtcPeerManager 管理一条 PeerConnection。
//    协商策略（避免 glare/同时发 offer 冲突）：**userId 字典序较小的一方主动发 offer**，
//    由 manager 的 iAmOfferer 标志决定。
//
// 2. 健壮性（WebRTC 分片）：RtcPeerManager 封装
//    createOffer/handleAnswer/addIceCandidate/ICE 状态监控/自动重试（2s/5s/10s，
//    强制 TURN relay）/10s 信令超时/15s ICE 收集超时/重试耗尽降级文字。
//    本 hook 只负责：近端订阅裁剪、空间音频图、麦克采集、说话检测。
//
// 3. 信令：通过 wsRef.current 发送 {type:'rtc_sdp'|'rtc_ice'|'rtc_bye'|'rtc_retry'|'rtc_fallback'}，
//    服务端做目标在线校验（离线回 rtc_error）与每对用户状态机。本 hook 用
//    addEventListener('message') 挂监听，与 Plaza3D 自带的 onmessage 共存。
//
// 4. 距离订阅裁剪：每 ~300ms 用 pickSubscribers(localPos, playersRef, maxSubscribers,
//    maxDistance) 算出"应连接的近端 peer 集合"。超出集合的 manager 关闭并发 rtc_bye。
//
// 5. 空间音频：每个远端流 → MediaStreamSource → PannerNode(只做方位) →
//    GainNode(computeDistanceGain 衰减) → AudioContext.destination。
//
// 6. 优雅降级：ICE 重试耗尽 / 麦克被拒 → onFallback，UI 提示"语音不可用，已切换文字"，
//    文字聊天始终可用；用户可手动重试语音。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { IceServerConfig } from '@balabala/shared'
import { useMicrophone } from './useMicrophone'
import { computeDistanceGain, pickSubscribers, type Vec2 } from './spatial-audio'
import { RtcPeerManager, type RtcFallbackReason } from './webrtc-manager'

export type SpatialVoiceOptions = {
  wsRef: RefObject<WebSocket | null>
  userId: string
  roomId: string
  /** 当前所有远端玩家位置 Map（高频写在 ref 上） */
  playersRef: RefObject<Map<string, { x: number; z: number }>>
  /** 本地玩家位置 */
  localPosRef: RefObject<{ x: number; z: number }>
  /** 全局语音开关（来自 voice-settings），false 时不发不收 */
  enabled: boolean
  /** 最大可听距离（世界单位/米），默认 15 */
  maxDistance?: number
  /** 最多同时建立的语音连接数，默认 8 */
  maxSubscribers?: number
  /** 服务端下发的 ICE 服务器配置（含 TURN）；缺省仅公共 STUN */
  rtcIceServers?: IceServerConfig[]
}

export type SpatialVoiceResult = {
  muted: boolean
  setMuted: (m: boolean) => void
  pushToTalk: boolean
  setPushToTalk: (v: boolean) => void
  /** 本地是否正在说话（麦克风电平超阈值） */
  isSpeaking: boolean
  /** 正在说话的远端 userId 集合 */
  speakingPeers: Set<string>
  error: string | null
  /** 请求麦克风授权（建议在用户点击麦克风按钮的手势里调用） */
  requestMic: () => Promise<boolean>
  /**
   * 【契约外扩展】按键说：按住期间设 true，松开设 false。
   * 仅在 pushToTalk=true 时生效。由调用方在 keydown/keyup 中调用。
   */
  setPushing: (v: boolean) => void
  /** 是否处于语音降级状态（语音不可用，已切文字） */
  fallbackActive: boolean
  /** 降级原因提示文案（null = 未降级） */
  fallbackNotice: string | null
  /** 手动重试语音（降级后用户点击） */
  retryVoice: () => void
}

/** 缺省 ICE 配置：仅公共 STUN（服务端未下发配置时兜底）。 */
const FALLBACK_ICE_SERVERS: IceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** 订阅重建节拍（ms） */
const TICK_MS = 300
/** 说话判定电平阈值（远端 RMS） */
const SPEAKING_THRESHOLD = 0.06

type PeerAudioGraph = {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  panner: PannerNode
  gain: GainNode
  analyser: AnalyserNode
}

export function useSpatialVoice(opts: SpatialVoiceOptions): SpatialVoiceResult {
  const {
    wsRef,
    userId,
    roomId,
    playersRef,
    localPosRef,
    enabled,
    maxDistance = 15,
    maxSubscribers = 8,
    rtcIceServers,
  } = opts

  // —— 麦克风采集（含电平分析） ——
  const mic = useMicrophone()

  // —— 对外状态 ——
  const [muted, setMutedState] = useState(false)
  const [pushToTalk, setPushToTalkState] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingPeers, setSpeakingPeers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)

  // —— 内部可变引用（避免闭包过期） ——
  const peerManagers = useRef(new Map<string, RtcPeerManager>())
  const audioGraphMap = useRef(new Map<string, PeerAudioGraph>())
  const audioCtxRef = useRef<AudioContext | null>(null)
  const wiredWsRef = useRef<WebSocket | null>(null)
  const pushingRef = useRef(false)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(false)
  const pushToTalkRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const roomIdRef = useRef(roomId)
  const iceServersRef = useRef<IceServerConfig[]>(rtcIceServers ?? FALLBACK_ICE_SERVERS)

  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => { iceServersRef.current = rtcIceServers?.length ? rtcIceServers : FALLBACK_ICE_SERVERS }, [rtcIceServers])

  // ===== AudioContext 懒创建（单例） =====
  const getAudioCtx = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current
    if (typeof window === 'undefined') return null
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    audioCtxRef.current = ctx
    try {
      if (typeof ctx.listener.forwardX !== 'undefined') {
        ctx.listener.forwardX.value = 0
        ctx.listener.forwardY.value = 0
        ctx.listener.forwardZ.value = -1
        ctx.listener.upX.value = 0
        ctx.listener.upY.value = 1
      }
    } catch { /* older API */ }
    return ctx
  }, [])

  // ===== 本地发送闸门 =====
  const applyLocalSendGate = useCallback(() => {
    const stream = micStreamRef.current
    if (!stream) return
    let send = enabledRef.current
    if (send && mutedRef.current) send = false
    if (send && pushToTalkRef.current) send = pushingRef.current
    for (const track of stream.getAudioTracks()) {
      track.enabled = send
    }
  }, [])

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m)
    mutedRef.current = m
    mic.setMuted(m)
    applyLocalSendGate()
  }, [mic, applyLocalSendGate])

  const setPushToTalk = useCallback((v: boolean) => {
    setPushToTalkState(v)
    pushToTalkRef.current = v
    applyLocalSendGate()
  }, [applyLocalSendGate])

  const setPushing = useCallback((v: boolean) => {
    pushingRef.current = v
    applyLocalSendGate()
  }, [applyLocalSendGate])

  // ===== 把远端流接入 PannerNode → Gain → destination =====
  const attachRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    if (audioGraphMap.current.has(peerId)) return
    const ctx = getAudioCtx()
    if (!ctx) return
    try { void ctx.resume() } catch { /* noop */ }

    const source = ctx.createMediaStreamSource(stream)
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 0.001
    panner.rolloffFactor = 0
    panner.maxDistance = maxDistance
    const gain = ctx.createGain()
    gain.gain.value = 0
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256

    source.connect(panner)
    panner.connect(gain)
    gain.connect(ctx.destination)
    source.connect(analyser)

    audioGraphMap.current.set(peerId, { stream, source, panner, gain, analyser })
  }, [getAudioCtx, maxDistance])

  // ===== 降级回调：展示"语音不可用，已切换文字" =====
  const handleFallback = useCallback((_peerId: string, reason: RtcFallbackReason) => {
    const text = reason === 'no_media'
      ? '麦克风不可用，已切换文字聊天'
      : '语音不可用，已切换文字聊天'
    setFallbackNotice(text)
  }, [])

  // ===== 创建单对端 RtcPeerManager =====
  const createManager = useCallback((peerId: string): RtcPeerManager | null => {
    if (!userId) return null
    const existing = peerManagers.current.get(peerId)
    if (existing) return existing

    const manager = new RtcPeerManager({
      myUserId: userId,
      peerId,
      transport: {
        send: (msg) => {
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg))
          }
        },
      },
      iceServers: iceServersRef.current,
      iAmOfferer: userId < peerId,
      localStream: micStreamRef.current,
      events: {
        onRemoteStream: (_pid, stream) => attachRemoteStream(peerId, stream as MediaStream),
        onFallback: handleFallback,
        onConnected: () => { /* 连通后清除降级提示（对端单独重连成功） */ },
      },
    })
    peerManagers.current.set(peerId, manager)
    manager.start()
    return manager
  }, [userId, wsRef, attachRemoteStream, handleFallback])

  // ===== 关闭单个 peer 的 manager 与音频图 =====
  const closePeer = useCallback((peerId: string, notify: boolean) => {
    const manager = peerManagers.current.get(peerId)
    if (manager) {
      peerManagers.current.delete(peerId)
      manager.close(notify)
    }
    const graph = audioGraphMap.current.get(peerId)
    if (graph) {
      audioGraphMap.current.delete(peerId)
      try { graph.source.disconnect() } catch { /* noop */ }
      try { graph.panner.disconnect() } catch { /* noop */ }
      try { graph.gain.disconnect() } catch { /* noop */ }
      try { graph.analyser.disconnect() } catch { /* noop */ }
    }
  }, [])

  // ===== 挂接 WS 信令监听 =====
  const wireWs = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws === wiredWsRef.current) return

    const onMessage = (ev: MessageEvent) => {
      let msg: { type?: string; from?: string; to?: string; sdp?: { type: string; sdp: string }; candidate?: unknown; attempt?: number; reason?: string; suggestText?: boolean }
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
      if (!msg || !msg.type || msg.to !== userId || !msg.from) return

      // 收到对端 offer 时本端可能还没建 manager（answerer 侧），按需创建
      if (msg.type === 'rtc_sdp' && msg.sdp?.type === 'offer' && !peerManagers.current.has(msg.from)) {
        createManager(msg.from)
      }
      const manager = peerManagers.current.get(msg.from)
      manager?.handleSignal(msg as Parameters<typeof manager.handleSignal>[0])
    }

    ws.addEventListener('message', onMessage)
    wiredWsRef.current = ws
  }, [wsRef, userId, createManager])

  // ===== 请求麦克风（对外） =====
  const requestMic = useCallback(async (): Promise<boolean> => {
    const ok = await mic.requestMic()
    if (ok && mic.stream) {
      micStreamRef.current = mic.stream
      // 授权前已建的连接是 recvonly：更新本地流后关闭，由节拍重建
      for (const manager of peerManagers.current.values()) {
        manager.setLocalStream(mic.stream)
      }
      for (const peerId of [...peerManagers.current.keys()]) {
        closePeer(peerId, true)
      }
      setFallbackNotice(null)
      applyLocalSendGate()
    } else {
      setError(mic.error)
      // 麦克被拒/无设备 → 降级文字
      for (const manager of peerManagers.current.values()) {
        manager.notifyNoMedia()
      }
      setFallbackNotice('麦克风不可用，已切换文字聊天')
    }
    return ok
  }, [mic, closePeer, applyLocalSendGate])

  // 手动重试语音：清除降级提示，重建所有 peer manager
  const retryVoice = useCallback(() => {
    setFallbackNotice(null)
    for (const peerId of [...peerManagers.current.keys()]) {
      closePeer(peerId, false)
    }
    // 节拍会在 300ms 内重建
  }, [closePeer])

  useEffect(() => {
    if (mic.error) setError(mic.error)
  }, [mic.error])

  // ===== 主节拍：连接裁剪 + Panner 位置/增益更新 + 说话检测 =====
  useEffect(() => {
    const tick = window.setInterval(() => {
      wireWs()

      const localPos = localPosRef.current
      const players = playersRef.current
      if (!localPos || !players) return

      const peersForSubscription = new Map<string, Vec2>()
      for (const [id, pos] of players) {
        if (id !== userId) peersForSubscription.set(id, { x: pos.x, z: pos.z })
      }
      const desired = new Set(pickSubscribers(localPos, peersForSubscription, maxSubscribers, maxDistance))

      // 关闭超出订阅范围的连接
      for (const peerId of [...peerManagers.current.keys()]) {
        if (!desired.has(peerId)) closePeer(peerId, true)
      }

      // 为目标 peer 建连（manager.start 内部按 iAmOfferer 决定是否发 offer）
      for (const peerId of desired) {
        if (!peerManagers.current.has(peerId)) {
          createManager(peerId)
        }
      }

      // 更新 AudioListener 位置
      const ctx = audioCtxRef.current
      if (ctx) {
        try {
          const listener = ctx.listener
          if (typeof listener.positionX !== 'undefined') {
            listener.positionX.value = localPos.x
            listener.positionZ.value = localPos.z
          }
        } catch { /* noop */ }
      }

      // 更新每个已连接 peer 的 Panner 位置与距离增益
      const newSpeaking = new Set<string>()
      for (const [peerId, graph] of audioGraphMap.current) {
        const pos = peersForSubscription.get(peerId)
        if (!pos || !desired.has(peerId)) {
          graph.gain.gain.value = 0
          continue
        }
        try {
          if (typeof graph.panner.positionX !== 'undefined') {
            graph.panner.positionX.value = pos.x
            graph.panner.positionZ.value = pos.z
          }
        } catch { /* noop */ }
        const d = Math.hypot(pos.x - localPos.x, pos.z - localPos.z)
        const gain = enabledRef.current
          ? computeDistanceGain(d, 1, maxDistance, 1)
          : 0
        graph.gain.gain.value = gain

        const data = new Uint8Array(graph.analyser.fftSize)
        graph.analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        if (rms > SPEAKING_THRESHOLD) newSpeaking.add(peerId)
      }

      const anySpeakingLocal = mic.level > SPEAKING_THRESHOLD && enabledRef.current && !mutedRef.current
      setIsSpeaking(anySpeakingLocal)

      setSpeakingPeers((prev) => {
        if (prev.size === newSpeaking.size && [...prev].every((p) => newSpeaking.has(p))) return prev
        return newSpeaking
      })
    }, TICK_MS)

    return () => window.clearInterval(tick)
  }, [wireWs, localPosRef, playersRef, userId, maxDistance, maxSubscribers, createManager, closePeer, mic.level])

  useEffect(() => {
    enabledRef.current = enabled
    applyLocalSendGate()
  }, [enabled, applyLocalSendGate])

  // ===== 卸载清理 =====
  useEffect(() => {
    return () => {
      for (const manager of peerManagers.current.values()) manager.close(false)
      peerManagers.current.clear()
      mic.cleanup()
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => { /* noop */ })
        audioCtxRef.current = null
      }
    }
  }, [mic])

  return {
    muted,
    setMuted,
    pushToTalk,
    setPushToTalk,
    isSpeaking,
    speakingPeers,
    error,
    requestMic,
    setPushing,
    fallbackActive: fallbackNotice !== null,
    fallbackNotice,
    retryVoice,
  }
}
