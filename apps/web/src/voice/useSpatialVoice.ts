// ===== 社交临场感：useSpatialVoice —— WebRTC mesh 距离语音 + 统一 3D 空间音频 =====
//
// 架构要点（关键决策在注释中说明）：
//
// 1. WebRTC mesh（全互联）：维护 Map<userId, RTCPeerConnection>。
//    协商策略（避免 glare/同时发 offer 冲突）：**userId 字典序较小的一方主动发 offer**。
//    双方都跑同一个 reconciliation 节拍，判断"我是否该对这个 peer 发 offer"：
//      myUserId < peerId  → 我创建 offer；否则我只接收对方的 offer 并回 answer。
//    这样同一对 peer 永远只有一侧发起，不会双侧同时 createOffer。
//
// 2. 信令：通过 wsRef.current 发送 {type:'rtc_sdp'|'rtc_ice'|'rtc_bye'}，
//    服务端只按 to 单发转发，不广播。本 hook 用 addEventListener('message')
//    挂监听，与 Plaza3D 自带的 onmessage 共存（WebSocket 支持多监听器）。
//
// 3. 距离订阅裁剪：每 ~300ms 用 pickSubscribers(localPos, playersRef, maxSubscribers,
//    maxDistance) 算出"应连接的近端 peer 集合"。超出集合的 PC 关闭并发 rtc_bye；
//    重新进入范围时下一个节拍自动重建。人多时只与最近 N 个建连，节省带宽/编解码。
//
// 4. 空间音频：每个远端流 → MediaStreamSource → PannerNode(只做方位) →
//    GainNode(computeDistanceGain 衰减) → AudioContext.destination。
//    PannerNode 位置每节拍随 peer 坐标更新；AudioListener 位置绑定 localPosRef。
//    PannerNode 的 distanceModel 设为 inverse + rolloffFactor=0，让它只负责
//    左右/前后方位，不做衰减；衰减统一交给 computeDistanceGain（与纯逻辑单测一致）。
//
// 5. 静音/按键说：用 track.enabled=false 控制发送（不 removeTrack，避免重协商）。
//    全局 enabled=false 时远端全部 gain=0、本地不发。pushToTalk 模式下，仅当
//    pushingRef.current=true（调用方按住按键）时发送。
//
// 6. 优雅降级：getUserMedia 失败/拒绝 → error 字段提示，PC 仍可作为 recvonly
//    收听他人；卸载时关闭所有 PC、停止麦克流、关闭 AudioContext。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMicrophone } from './useMicrophone'
import { computeDistanceGain, pickSubscribers, type Vec2 } from './spatial-audio'

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
}

/** STUN 服务器：NAT 穿越必需；内网/单机环境可留空。 */
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

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
  } = opts

  // —— 麦克风采集（含电平分析） ——
  const mic = useMicrophone()

  // —— 对外状态 ——
  const [muted, setMutedState] = useState(false)
  const [pushToTalk, setPushToTalkState] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingPeers, setSpeakingPeers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // —— 内部可变引用（避免闭包过期） ——
  const pcMap = useRef(new Map<string, RTCPeerConnection>())
  const audioGraphMap = useRef(new Map<string, PeerAudioGraph>())
  const audioCtxRef = useRef<AudioContext | null>(null)
  const wiredWsRef = useRef<WebSocket | null>(null)
  const pushingRef = useRef(false)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(false)
  const pushToTalkRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const roomIdRef = useRef(roomId)

  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => { roomIdRef.current = roomId }, [roomId])

  // ===== AudioContext 懒创建（单例） =====
  const getAudioCtx = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current
    if (typeof window === 'undefined') return null
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    audioCtxRef.current = ctx
    // 朝向：本地面向 -Z，+X 为右（three.js 约定）
    try {
      if (typeof ctx.listener.forwardX !== 'undefined') {
        ctx.listener.forwardX.value = 0
        ctx.listener.forwardY.value = 0
        ctx.listener.forwardZ.value = -1
        ctx.listener.upX.value = 0
        ctx.listener.upY.value = 1
        ctx.listener.upZ.value = 0
      }
    } catch { /* older API */ }
    return ctx
  }, [])

  // ===== 本地发送闸门：根据 muted / pushToTalk / pushing / 全局 enabled 决定 track.enabled =====
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
    mic.setMuted(m) // 同步底层 track.enabled
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

  // ===== 关闭单个 peer 的 PC 与音频图 =====
  const closePeer = useCallback((peerId: string, notify: boolean) => {
    const pc = pcMap.current.get(peerId)
    if (pc) {
      pcMap.current.delete(peerId)
      try { pc.close() } catch { /* noop */ }
    }
    const graph = audioGraphMap.current.get(peerId)
    if (graph) {
      audioGraphMap.current.delete(peerId)
      try { graph.source.disconnect() } catch { /* noop */ }
      try { graph.panner.disconnect() } catch { /* noop */ }
      try { graph.gain.disconnect() } catch { /* noop */ }
      try { graph.analyser.disconnect() } catch { /* noop */ }
      for (const track of graph.stream.getTracks()) {
        // 远端流不 stop（属于对端），仅断开引用
      }
    }
    if (notify) {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'rtc_bye', from: userId, to: peerId }))
      }
    }
  }, [wsRef, userId])

  // ===== 创建并配置一个 RTCPeerConnection =====
  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(DEFAULT_RTC_CONFIG)
    pcMap.current.set(peerId, pc)

    // 加入本地麦克流（若已授权）
    const localStream = micStreamRef.current
    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream)
      }
    }

    // ICE candidate → 通过 WS 发给对端
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({
        type: 'rtc_ice',
        from: userId,
        to: peerId,
        candidate: {
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        },
      }))
    }

    // 协商失败/断开时清理
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        // disconnected 可能短暂抖动，不立即关；failed/closed 才清理
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (pcMap.current.get(peerId) === pc) closePeer(peerId, true)
        }
      }
    }

    // 远端音频流到达 → 接入空间音频图
    pc.ontrack = (ev) => {
      const [remoteStream] = ev.streams
      if (!remoteStream) return
      attachRemoteStream(peerId, remoteStream)
    }

    return pc
  }, [closePeer, userId, wsRef])

  // ===== 把远端流接入 PannerNode → Gain → destination =====
  const attachRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    // 已存在则跳过
    if (audioGraphMap.current.has(peerId)) return
    const ctx = getAudioCtx()
    if (!ctx) return
    try { void ctx.resume() } catch { /* noop */ }

    const source = ctx.createMediaStreamSource(stream)
    const panner = ctx.createPanner()
    // PannerNode 只做方位，不做距离衰减（衰减交给 GainNode = computeDistanceGain）
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
    source.connect(analyser) // 旁路做说话检测

    audioGraphMap.current.set(peerId, { stream, source, panner, gain, analyser })
  }, [getAudioCtx, maxDistance])

  // ===== 发 offer（仅当本端是 userId 较小的一方） =====
  const maybeSendOffer = useCallback(async (peerId: string) => {
    // 协商策略：字典序小的一方发 offer，避免 glare
    if (userId >= peerId) return
    const existing = pcMap.current.get(peerId)
    if (!existing) return
    // 已有本地/远端描述则不重复 offer
    if (existing.signalingState !== 'stable') return
    try {
      const offer = await existing.createOffer()
      await existing.setLocalDescription(offer)
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({
        type: 'rtc_sdp',
        from: userId,
        to: peerId,
        sdp: { type: existing.localDescription!.type, sdp: existing.localDescription!.sdp },
      }))
    } catch (e) {
      console.warn('[spatial-voice] createOffer 失败', peerId, e)
    }
  }, [userId, wsRef])

  // ===== 挂接 WS 信令监听（与 Plaza3D 的 onmessage 共存） =====
  const wireWs = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws === wiredWsRef.current) return

    const onMessage = (ev: MessageEvent) => {
      let msg: { type?: string; from?: string; to?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
      if (!msg || msg.to !== userId) return // 只处理发给自己的信令

      if (msg.type === 'rtc_sdp' && msg.from && msg.sdp) {
        void handleIncomingSdp(msg.from, msg.sdp)
      } else if (msg.type === 'rtc_ice' && msg.from && msg.candidate) {
        void handleIncomingIce(msg.from, msg.candidate)
      } else if (msg.type === 'rtc_bye' && msg.from) {
        closePeer(msg.from, false)
      }
    }

    ws.addEventListener('message', onMessage)
    wiredWsRef.current = ws
  }, [wsRef, userId, closePeer])

  // ===== 处理收到的 SDP（offer 或 answer） =====
  const handleIncomingSdp = useCallback(async (peerId: string, sdp: RTCSessionDescriptionInit) => {
    let pc = pcMap.current.get(peerId)
    if (!pc) {
      // 收到 offer：本端是 userId 较大的一方，创建 PC 并回 answer
      pc = createPeerConnection(peerId)
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      if (sdp.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'rtc_sdp',
            from: userId,
            to: peerId,
            sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp },
          }))
        }
      }
    } catch (e) {
      console.warn('[spatial-voice] SDP 协商失败', peerId, e)
    }
  }, [createPeerConnection, userId, wsRef])

  // ===== 处理收到的 ICE candidate =====
  const handleIncomingIce = useCallback(async (peerId: string, candidate: RTCIceCandidateInit) => {
    const pc = pcMap.current.get(peerId)
    if (!pc) return
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch {
      // ICE candidate 可能在 remoteDescription 之前到达，忽略即可
    }
  }, [])

  // ===== 请求麦克风（对外）：包装 useMicrophone，并在授权后重建 PC 以携带本地轨 =====
  const requestMic = useCallback(async (): Promise<boolean> => {
    const ok = await mic.requestMic()
    if (ok && mic.stream) {
      micStreamRef.current = mic.stream
      // 授权前已建的 PC 是 recvonly；关闭后由节拍重建，新 PC 会 addTrack
      for (const peerId of [...pcMap.current.keys()]) {
        closePeer(peerId, true)
      }
      applyLocalSendGate()
    } else {
      setError(mic.error)
    }
    return ok
  }, [mic, closePeer, applyLocalSendGate])

  // 同步 mic 错误到对外 error
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

      // 关闭超出订阅范围的 PC
      for (const peerId of [...pcMap.current.keys()]) {
        if (!desired.has(peerId)) closePeer(peerId, true)
      }

      // 为目标 peer 建连（仅字典序小的一方发 offer）
      for (const peerId of desired) {
        if (!pcMap.current.has(peerId)) {
          const pc = createPeerConnection(peerId)
          void maybeSendOffer(peerId)
          void pc // maybeSendOffer 内部读 pcMap
        } else {
          // 已存在：若本端是 offerer 且处于 stable（例如刚对端 bye 后重建），补一次 offer
          void maybeSendOffer(peerId)
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
      let anySpeakingLocal = false
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

        // 远端说话检测
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

      // 本地说话指示
      if (mic.level > SPEAKING_THRESHOLD && enabledRef.current && !mutedRef.current) anySpeakingLocal = true
      setIsSpeaking(anySpeakingLocal)

      // 仅在集合变化时更新 state，避免每节拍重渲染
      setSpeakingPeers((prev) => {
        if (prev.size === newSpeaking.size && [...prev].every((p) => newSpeaking.has(p))) return prev
        return newSpeaking
      })
    }, TICK_MS)

    return () => window.clearInterval(tick)
  }, [wireWs, localPosRef, playersRef, userId, maxDistance, maxSubscribers, createPeerConnection, maybeSendOffer, closePeer, mic.level])

  // 全局 enabled 变化时立即应用发送闸门
  useEffect(() => {
    enabledRef.current = enabled
    applyLocalSendGate()
  }, [enabled, applyLocalSendGate])

  // ===== 卸载清理 =====
  useEffect(() => {
    return () => {
      for (const peerId of [...pcMap.current.keys()]) closePeer(peerId, false)
      mic.cleanup()
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => { /* noop */ })
        audioCtxRef.current = null
      }
    }
  }, [closePeer, mic])

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
  }
}
