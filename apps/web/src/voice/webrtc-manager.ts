// ===== WebRTC 健壮性管理器（单对端 PeerConnection 生命周期封装）=====
//
// 职责（与 ws.ts 信令协议配套）：
//  1. 封装 createOffer / handleOffer / handleAnswer / addIceCandidate 全生命周期；
//  2. 监控 iceConnectionState：failed 时自动重试（最多 3 次，间隔 2s/5s/10s 递增），
//     每次重试先发 rtc_retry 通知对端，并强制 iceTransportPolicy='relay' 走 TURN 中继；
//  3. 信令超时：offer 发出后 10s 未收到 answer → 计入失败重试；ICE 收集 15s 未完成 → 失败；
//  4. 重试耗尽 / getUserMedia 不可用 → 优雅降级：关闭 PeerConnection、向对端发 rtc_fallback，
//     双方 UI 切文字聊天（文字始终可用，语音是增强）；
//  5. 通过事件接口对外暴露 onConnected/onFailed/onFallback/onRemoteStream/onRetry。
//
// 可测试性：本模块不直接 import 任何 WebRTC/DOM 全局构造器——RTCPeerConnection 工厂与
// 定时器均可注入（node 单测里用 mock PC + fake timers，绝不在 node 环境 new 真实 PC）。

import type { IceServerConfig } from '@balabala/shared'

export type RtcFallbackReason = 'ice_failed' | 'no_media' | 'timeout' | 'user_disabled'

/** 信令通道：由调用方（useSpatialVoice/Plaza3D）注入，内部即 ws.send。 */
export interface RtcTransport {
  send: (msg: Record<string, unknown>) => void
}

/** 对外事件回调集合。 */
export interface RtcPeerEvents {
  /** ICE 连接成功（双方都会触发）。 */
  onConnected: (peerId: string) => void
  /** 单次协商失败（已计入重试次数，尚未降级）。 */
  onFailed: (peerId: string, reason: string, attempt: number) => void
  /** 降级触发（本地重试耗尽/无媒体，或收到对端 rtc_fallback）。 */
  onFallback: (peerId: string, reason: RtcFallbackReason) => void
  /** 收到远端媒体流（接空间音频图）。 */
  onRemoteStream: (peerId: string, stream: unknown) => void
  /** 重试通知（本地发起重试时触发，供 UI/日志）。 */
  onRetry?: (peerId: string, attempt: number, reason: string) => void
  /** 内部状态变化（调试/UI）。 */
  onStateChange?: (peerId: string, state: RtcPeerLifecycle) => void
}

export type RtcPeerLifecycle =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'retrying'
  | 'fallback'
  | 'closed'

/**
 * 最小化 RTCPeerConnection 接口（结构类型）。
 * 浏览器里真实 RTCPeerConnection 天然满足；node 单测注入 mock 实现。
 */
export interface RtcPcLike {
  iceConnectionState: string
  connectionState: string
  signalingState: string
  iceGatheringState?: string
  onicecandidate: ((ev: { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }) => void) | null
  oniceconnectionstatechange: (() => void) | null
  onconnectionstatechange: (() => void) | null
  onicegatheringstatechange: (() => void) | null
  ontrack: ((ev: { streams: unknown[] }) => void) | null
  localDescription: { type: string; sdp: string } | null
  addTrack(track: unknown, stream: unknown): unknown
  createOffer(): Promise<unknown>
  createAnswer(): Promise<unknown>
  setLocalDescription(desc: unknown): Promise<void>
  setRemoteDescription(desc: unknown): Promise<void>
  addIceCandidate(cand: unknown): Promise<void>
  close(): void
}

export interface RtcPeerManagerOptions {
  myUserId: string
  peerId: string
  transport: RtcTransport
  /** 服务端下发的 ICE 服务器（STUN + TURN）。 */
  iceServers: IceServerConfig[]
  /** 我是否为 offerer（mesh 中 userId 字典序小的一方）。 */
  iAmOfferer: boolean
  /** 本地麦克流（可选；无媒体时 PC 仅 recvonly）。 */
  localStream?: { getAudioTracks(): unknown[] } | null
  events: Partial<RtcPeerEvents>
  /** 注入 PC 工厂（测试用 mock；默认用全局 RTCPeerConnection）。 */
  pcFactory?: (config: RTCConfiguration) => RtcPcLike
  /** 注入定时器（测试用 fake timers）。 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
  /** offer 发出后等待 answer 超时（ms），默认 10000。 */
  offerAnswerTimeoutMs?: number
  /** ICE 收集超时（ms），默认 15000。 */
  iceGatherTimeoutMs?: number
  /** 每次失败后的重试间隔（ms），默认 2000/5000/10000。 */
  retryDelaysMs?: number[]
}

const DEFAULT_OFFER_ANSWER_TIMEOUT_MS = 10_000
const DEFAULT_ICE_GATHER_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

/** 浏览器端默认 PC 工厂：惰性读取全局 RTCPeerConnection，node 下未注入工厂时直接抛错。 */
function defaultPcFactory(config: RTCConfiguration): RtcPcLike {
  const Ctor = (globalThis as { RTCPeerConnection?: new (c: RTCConfiguration) => RtcPcLike }).RTCPeerConnection
  if (!Ctor) {
    throw new Error('RTCPeerConnection 不可用（node 环境必须注入 pcFactory）')
  }
  return new Ctor(config)
}

export class RtcPeerManager {
  readonly myUserId: string
  readonly peerId: string
  private readonly transport: RtcTransport
  private readonly iceServers: IceServerConfig[]
  private readonly iAmOfferer: boolean
  private localStream: { getAudioTracks(): unknown[] } | null
  private readonly events: Partial<RtcPeerEvents>
  private readonly pcFactory: (config: RTCConfiguration) => RtcPcLike
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown
  private readonly clearTimeoutFn: (handle: unknown) => void
  private readonly offerAnswerTimeoutMs: number
  private readonly iceGatherTimeoutMs: number
  private readonly retryDelaysMs: number[]

  private pc: RtcPcLike | null = null
  lifecycle: RtcPeerLifecycle = 'idle'
  /** 已失败次数（0 = 首次协商中）。 */
  attempts = 0
  /** 信令序号（每对端单调递增）。 */
  private seq = 0
  private answerTimer: unknown = null
  private gatherTimer: unknown = null
  private retryTimer: unknown = null
  /** 本次协商是否已收到 answer / 已连通，防止 answerTimer 与 ice failed 重复计数。 */
  private settled = false

  constructor(opts: RtcPeerManagerOptions) {
    this.myUserId = opts.myUserId
    this.peerId = opts.peerId
    this.transport = opts.transport
    this.iceServers = opts.iceServers
    this.iAmOfferer = opts.iAmOfferer
    this.localStream = opts.localStream ?? null
    this.events = opts.events
    this.pcFactory = opts.pcFactory ?? defaultPcFactory
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.offerAnswerTimeoutMs = opts.offerAnswerTimeoutMs ?? DEFAULT_OFFER_ANSWER_TIMEOUT_MS
    this.iceGatherTimeoutMs = opts.iceGatherTimeoutMs ?? DEFAULT_ICE_GATHER_TIMEOUT_MS
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  }

  /** 更新本地麦克流（授权后注入，后续重建 PC 时携带）。 */
  setLocalStream(stream: { getAudioTracks(): unknown[] } | null): void {
    this.localStream = stream
  }

  private setState(s: RtcPeerLifecycle): void {
    this.lifecycle = s
    try { this.events.onStateChange?.(this.peerId, s) } catch { /* noop */ }
  }

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  private clearTimers(): void {
    if (this.answerTimer !== null) { this.clearTimeoutFn(this.answerTimer); this.answerTimer = null }
    if (this.gatherTimer !== null) { this.clearTimeoutFn(this.gatherTimer); this.gatherTimer = null }
    if (this.retryTimer !== null) { this.clearTimeoutFn(this.retryTimer); this.retryTimer = null }
  }

  // ===== 对外入口 =====

  /** 开始协商：offerer 主动发 offer；answerer 进入等待 offer 状态（收到 offer 再建 PC）。 */
  start(): void {
    if (this.lifecycle === 'closed' || this.lifecycle === 'fallback') return
    if (this.iAmOfferer) {
      void this.negotiate({ forceRelay: false, reason: 'initial' })
    } else {
      this.setState('connecting')
    }
  }

  /** 用户手动重试语音（降级后点"重试语音"）。 */
  retryVoice(): void {
    this.attempts = 0
    this.settled = false
    this.clearTimers()
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    if (this.iAmOfferer) {
      this.setState('idle') // 解除 fallback 态，允许 negotiate 重新进入
      void this.negotiate({ forceRelay: true, reason: 'manual_retry' })
    } else {
      // answerer 侧等待对端（offerer）重发 offer
      this.setState('connecting')
    }
  }

  /** 处理对端信令消息（rtc_sdp / rtc_ice / rtc_retry / rtc_fallback / rtc_error / rtc_bye）。 */
  handleSignal(msg: {
    type: string
    from?: string
    to?: string
    sdp?: { type: string; sdp: string }
    candidate?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
    attempt?: number
    reason?: string
    suggestText?: boolean
  }): void {
    if (this.lifecycle === 'closed') return
    switch (msg.type) {
      case 'rtc_sdp': {
        if (!msg.sdp) return
        void this.handleSdp(msg.sdp as { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp: string })
        break
      }
      case 'rtc_ice': {
        if (!msg.candidate) return
        void this.pc?.addIceCandidate(msg.candidate).catch(() => {
          // candidate 可能早于 remoteDescription 到达，忽略即可
        })
        break
      }
      case 'rtc_retry': {
        // 对端即将重连：清空本地等待态，准备接收新 offer
        if (this.answerTimer !== null) { this.clearTimeoutFn(this.answerTimer); this.answerTimer = null }
        try { this.events.onRetry?.(this.peerId, Number(msg.attempt ?? 0), String(msg.reason ?? '')) } catch { /* noop */ }
        break
      }
      case 'rtc_fallback': {
        this.onRemoteFallback(String(msg.reason ?? 'ice_fallback') as RtcFallbackReason)
        break
      }
      case 'rtc_error': {
        // 目标离线/冲突等：直接走降级（文字仍可用）
        this.onRemoteFallback('timeout')
        break
      }
      case 'rtc_bye': {
        this.close(false)
        break
      }
    }
  }

  /** getUserMedia 被拒/无设备：本地主动降级。 */
  notifyNoMedia(): void {
    this.doFallback('no_media')
  }

  /** 关闭并通知对端（leave/卸载时调用）。 */
  close(notifyBye: boolean): void {
    this.clearTimers()
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    if (notifyBye && this.lifecycle !== 'closed') {
      try {
        this.transport.send({ type: 'rtc_bye', from: this.myUserId, to: this.peerId })
      } catch { /* noop */ }
    }
    this.setState('closed')
  }

  // ===== 内部协商 =====

  private async negotiate(opts: { forceRelay: boolean; reason: string }): Promise<void> {
    if (this.lifecycle === 'closed' || this.lifecycle === 'fallback') return
    this.clearTimers()
    // 关闭旧 PC
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    this.settled = false
    this.setState(opts.forceRelay ? 'retrying' : 'connecting')

    const config: RTCConfiguration = {
      iceServers: this.iceServers,
    }
    // 重试强制走 TURN 中继
    if (opts.forceRelay) {
      ;(config as { iceTransportPolicy?: string }).iceTransportPolicy = 'relay'
    }

    let pc: RtcPcLike
    try {
      pc = this.pcFactory(config)
    } catch (e) {
      // PC 创建失败（无 WebRTC 环境）→ 直接降级
      console.warn('[webrtc-manager] 创建 PeerConnection 失败', this.peerId, e)
      this.doFallback('no_media')
      return
    }
    this.pc = pc

    // 携带本地麦克流
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks() as Array<{ enabled: boolean } & unknown>) {
        try { pc.addTrack(track, this.localStream as unknown as MediaStream) } catch { /* noop */ }
      }
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      try {
        this.transport.send({
          type: 'rtc_ice',
          from: this.myUserId,
          to: this.peerId,
          seq: this.nextSeq(),
          candidate: ev.candidate,
        })
      } catch { /* noop */ }
    }

    pc.ontrack = (ev) => {
      const [stream] = ev.streams
      if (!stream) return
      try { this.events.onRemoteStream?.(this.peerId, stream) } catch { /* noop */ }
    }

    pc.oniceconnectionstatechange = () => {
      this.handleIceState(pc.iceConnectionState)
    }
    pc.onconnectionstatechange = () => {
      // 兜底：部分浏览器 connectionState 更可靠
      if (pc.connectionState === 'connected') this.handleIceState('connected')
      else if (pc.connectionState === 'failed') this.handleIceState('failed')
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete' && this.gatherTimer !== null) {
        this.clearTimeoutFn(this.gatherTimer)
        this.gatherTimer = null
      }
    }

    // ICE 收集 15s 未完成 → 视为失败（NAT/TURN 不通）
    this.gatherTimer = this.setTimeoutFn(() => {
      this.gatherTimer = null
      if (!this.settled && this.pc === pc && pc.iceGatheringState !== 'complete') {
        this.failAttempt('ice_gather_timeout')
      }
    }, this.iceGatherTimeoutMs)

    if (this.iAmOfferer) {
      await this.sendOffer()
    }
    // answerer 侧等待对端 offer（由 handleSignal 驱动）
  }

  private async sendOffer(): Promise<void> {
    const pc = this.pc
    if (!pc) return
    try {
      const offer = (await pc.createOffer()) as { type: string; sdp: string }
      await pc.setLocalDescription(offer)
      const local = pc.localDescription ?? offer
      this.transport.send({
        type: 'rtc_sdp',
        from: this.myUserId,
        to: this.peerId,
        seq: this.nextSeq(),
        sdp: { type: local.type, sdp: local.sdp },
      })
      // offer 发出后 10s 未收到 answer → 超时重试/降级
      this.answerTimer = this.setTimeoutFn(() => {
        this.answerTimer = null
        if (!this.settled) this.failAttempt('answer_timeout')
      }, this.offerAnswerTimeoutMs)
    } catch (e) {
      console.warn('[webrtc-manager] createOffer 失败', this.peerId, e)
      this.failAttempt('create_offer_failed')
    }
  }

  private async handleSdp(sdp: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp: string }): Promise<void> {
    // answerer 收到 offer 时可能还没建 PC（首次协商）
    if (!this.pc) {
      // 重建一个 PC（answerer 不强制 relay，除非已在重试中）
      await this.negotiate({ forceRelay: this.attempts > 0, reason: 'incoming_offer' })
    }
    const pc = this.pc
    if (!pc) return
    try {
      await pc.setRemoteDescription(sdp)
      if (sdp.type === 'offer') {
        const answer = (await pc.createAnswer()) as { type: string; sdp: string }
        await pc.setLocalDescription(answer)
        const local = pc.localDescription ?? answer
        this.transport.send({
          type: 'rtc_sdp',
          from: this.myUserId,
          to: this.peerId,
          seq: this.nextSeq(),
          sdp: { type: local.type, sdp: local.sdp },
        })
      } else if (sdp.type === 'answer') {
        // 收到 answer：停掉等待超时
        if (this.answerTimer !== null) { this.clearTimeoutFn(this.answerTimer); this.answerTimer = null }
      }
    } catch (e) {
      console.warn('[webrtc-manager] SDP 协商失败', this.peerId, sdp.type, e)
      this.failAttempt('sdp_failed')
    }
  }

  private handleIceState(state: string): void {
    if (this.lifecycle === 'closed' || this.lifecycle === 'fallback') return
    if (state === 'connected' || state === 'completed') {
      this.settled = true
      if (this.answerTimer !== null) { this.clearTimeoutFn(this.answerTimer); this.answerTimer = null }
      if (this.gatherTimer !== null) { this.clearTimeoutFn(this.gatherTimer); this.gatherTimer = null }
      if (this.lifecycle !== 'connected') {
        this.setState('connected')
        try { this.events.onConnected?.(this.peerId) } catch { /* noop */ }
      }
    } else if (state === 'failed') {
      this.failAttempt('ice_failed')
    }
    // disconnected/disoroved 视为短暂抖动，不立即处理（等 failed 或恢复 connected）
  }

  /** 协商失败一次：按递增间隔重试，耗尽则降级。 */
  private failAttempt(reason: string): void {
    if (this.lifecycle === 'closed' || this.lifecycle === 'fallback') return
    // 旧 PC 即将被弃用：清掉其上挂着的 answer/gather 超时，避免误触发二次计数
    if (this.answerTimer !== null) { this.clearTimeoutFn(this.answerTimer); this.answerTimer = null }
    if (this.gatherTimer !== null) { this.clearTimeoutFn(this.gatherTimer); this.gatherTimer = null }
    this.attempts += 1
    const attempt = this.attempts
    try { this.events.onFailed?.(this.peerId, reason, attempt) } catch { /* noop */ }

    if (attempt > this.retryDelaysMs.length) {
      // 3 次重试仍失败 → 降级文字
      this.doFallback(reason === 'answer_timeout' || reason === 'ice_gather_timeout' ? 'timeout' : 'ice_failed')
      return
    }

    const delay = this.retryDelaysMs[attempt - 1]
    // 通知对端即将重试
    try {
      this.transport.send({
        type: 'rtc_retry',
        from: this.myUserId,
        to: this.peerId,
        attempt,
        reason,
      })
      this.events.onRetry?.(this.peerId, attempt, reason)
    } catch { /* noop */ }

    this.setState('retrying')
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null
      // 强制 relay 走 TURN 重试
      void this.negotiate({ forceRelay: true, reason })
    }, delay)
  }

  /** 降级：关闭 PC、通知对端、触发 onFallback。 */
  private doFallback(reason: RtcFallbackReason): void {
    this.clearTimers()
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    try {
      this.transport.send({
        type: 'rtc_fallback',
        from: this.myUserId,
        to: this.peerId,
        reason,
        suggestText: true,
      })
    } catch { /* noop */ }
    this.setState('fallback')
    try { this.events.onFallback?.(this.peerId, reason) } catch { /* noop */ }
  }

  /** 收到对端 rtc_fallback：本地切文字（不再回发 fallback，避免循环）。 */
  private onRemoteFallback(reason: RtcFallbackReason): void {
    this.clearTimers()
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    this.setState('fallback')
    try { this.events.onFallback?.(this.peerId, reason) } catch { /* noop */ }
  }
}
