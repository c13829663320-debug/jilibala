// ===== RtcPeerManager 单测：mock RTCPeerConnection + 可控定时器 =====
//
// node 环境没有真实 RTCPeerConnection，全部用 MockPc 驱动：
//  - 验证 offerer 发 offer / answerer 回 answer；
//  - 验证 ICE failed 自动重试（2s/5s/10s 递增，重试强制 relay）；
//  - 验证 3 次重试耗尽 → rtc_fallback 降级；
//  - 验证 10s 信令超时 / 15s ICE 收集超时；
//  - 验证收到对端 rtc_fallback 本地切文字、不回环。

import { describe, expect, it, vi } from 'vitest'
import { RtcPeerManager, type RtcPcLike } from './webrtc-manager'

/** 可控 Mock PeerConnection：状态由测试手动驱动。 */
class MockPc implements RtcPcLike {
  iceConnectionState = 'new'
  connectionState = 'new'
  signalingState = 'stable'
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'new'
  onicecandidate: RtcPcLike['onicecandidate'] = null
  oniceconnectionstatechange: RtcPcLike['oniceconnectionstatechange'] = null
  onconnectionstatechange: RtcPcLike['onconnectionstatechange'] = null
  onicegatheringstatechange: RtcPcLike['onicegatheringstatechange'] = null
  ontrack: RtcPcLike['ontrack'] = null
  localDescription: { type: string; sdp: string } | null = null
  closed = false
  constructor(public config: RTCConfiguration) {}
  addTrack(): unknown { return null }
  async createOffer(): Promise<unknown> { return { type: 'offer', sdp: 'FAKE_OFFER_SDP' } }
  async createAnswer(): Promise<unknown> { return { type: 'answer', sdp: 'FAKE_ANSWER_SDP' } }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(): Promise<void> { this.signalingState = 'stable' }
  async addIceCandidate(): Promise<void> {}
  close(): void { this.closed = true; this.iceConnectionState = 'closed' }
}

interface Harness {
  manager: RtcPeerManager
  sent: Array<Record<string, unknown>>
  events: {
    onConnected: ReturnType<typeof vi.fn>
    onFailed: ReturnType<typeof vi.fn>
    onFallback: ReturnType<typeof vi.fn>
    onRemoteStream: ReturnType<typeof vi.fn>
    onRetry: ReturnType<typeof vi.fn>
  }
  pcFactory: ReturnType<typeof vi.fn>
  /** 手动推进虚拟时钟，触发到期定时器。 */
  advance: (ms: number) => void
  /** 取出当前 PC（内部字段，测试用）。 */
  pc: () => MockPc | null
  flush: () => Promise<void>
}

type ManagerOptions = ConstructorParameters<typeof RtcPeerManager>[0]

function setup(opts: Partial<ManagerOptions> = {}): Harness {
  const sent: Array<Record<string, unknown>> = []
  let now = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  let nextHandle = 1
  const setTimeoutFn = (fn: () => void, ms: number) => {
    const h = nextHandle++
    pending.set(h, { at: now + ms, fn })
    return h
  }
  const clearTimeoutFn = (h: unknown) => { pending.delete(h as number) }

  const events = {
    onConnected: vi.fn(),
    onFailed: vi.fn(),
    onFallback: vi.fn(),
    onRemoteStream: vi.fn(),
    onRetry: vi.fn(),
  }
  const pcs: MockPc[] = []
  const pcFactory = vi.fn((cfg: RTCConfiguration) => {
    const pc = new MockPc(cfg)
    pcs.push(pc)
    return pc
  })

  const manager = new RtcPeerManager({
    myUserId: 'userA',
    peerId: 'userB',
    transport: { send: (m) => sent.push(m) },
    iceServers: [{ urls: 'stun:stub.example:19302' }],
    iAmOfferer: true,
    events,
    pcFactory,
    setTimeoutFn,
    clearTimeoutFn,
    ...opts,
  })

  const advance = (ms: number) => {
    now += ms
    // 重复执行直到没有到期定时器（定时器回调里可能再注册）
    for (let guard = 0; guard < 100; guard++) {
      let best: { h: number; at: number; fn: () => void } | null = null
      for (const [h, t] of pending) {
        if (t.at <= now && (!best || t.at < best.at)) best = { h, ...t }
      }
      if (!best) return
      pending.delete(best.h)
      best.fn()
    }
  }
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return {
    manager, sent, events, pcFactory, advance, flush,
    pc: () => (manager as unknown as { pc: MockPc | null }).pc,
  }
}

describe('RtcPeerManager', () => {
  it('offerer 启动：创建 PC 并发送 rtc_sdp offer，首次不强制 relay', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()

    const offer = h.sent.find((m) => m.type === 'rtc_sdp' && m.sdp && (m.sdp as { type: string }).type === 'offer')
    expect(offer).toBeTruthy()
    expect(offer!.from).toBe('userA')
    expect(offer!.to).toBe('userB')
    expect(typeof offer!.seq).toBe('number')
    // 首次协商不强制 relay
    const cfg = h.pcFactory.mock.calls[0][0] as RTCConfiguration & { iceTransportPolicy?: string }
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('answer 到达后清除等待超时：超时窗口内不再重试', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()

    h.manager.handleSignal({ type: 'rtc_sdp', from: 'userB', to: 'userA', sdp: { type: 'answer', sdp: 'ANSWER' } })
    await h.flush()
    h.advance(11_000) // 越过 10s answer 超时
    expect(h.sent.some((m) => m.type === 'rtc_retry')).toBe(false)
    expect(h.events.onFallback).not.toHaveBeenCalled()
  })

  it('ICE failed → 发送 rtc_retry，间隔后重建 PC 并强制 relay 重 offer', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    expect(h.pcFactory).toHaveBeenCalledTimes(1)

    // 模拟 ICE failed
    const pc1 = h.pc()!
    pc1.iceConnectionState = 'failed'
    pc1.oniceconnectionstatechange!()

    expect(h.events.onFailed).toHaveBeenCalledTimes(1)
    const retry = h.sent.find((m) => m.type === 'rtc_retry') as { attempt?: number }
    expect(retry).toBeTruthy()
    expect(retry.attempt).toBe(1)

    h.advance(2_000) // 第一次重试间隔 2s
    await h.flush()
    expect(h.pcFactory).toHaveBeenCalledTimes(2)
    const cfg2 = h.pcFactory.mock.calls[1][0] as RTCConfiguration & { iceTransportPolicy?: string }
    expect(cfg2.iceTransportPolicy).toBe('relay')
    // 重发 offer
    const offers = h.sent.filter((m) => m.type === 'rtc_sdp')
    expect(offers.length).toBe(2)
  })

  it('3 次重试仍失败 → rtc_fallback 降级 + onFallback 回调', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()

    const failNow = async () => {
      const pc = h.pc()!
      pc.iceConnectionState = 'failed'
      pc.oniceconnectionstatechange!()
    }

    await failNow(); h.advance(2_000); await h.flush()   // attempts=1 → retry
    await failNow(); h.advance(5_000); await h.flush()   // attempts=2 → retry
    await failNow(); h.advance(10_000); await h.flush()  // attempts=3 → retry
    await failNow()                                       // attempts=4 > 3 → fallback
    await h.flush()

    expect(h.events.onFallback).toHaveBeenCalledTimes(1)
    expect(h.events.onFallback.mock.calls[0][0]).toBe('userB')
    const fb = h.sent.find((m) => m.type === 'rtc_fallback') as { suggestText?: boolean; reason?: string }
    expect(fb).toBeTruthy()
    expect(fb.suggestText).toBe(true)
    // 降级后不再发送 rtc_retry
    expect(h.sent.filter((m) => m.type === 'rtc_retry').length).toBe(3)
  })

  it('offer 发出后 10s 未收到 answer → 超时计入重试', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    h.advance(10_000)
    await h.flush()
    const retry = h.sent.find((m) => m.type === 'rtc_retry')
    expect(retry).toBeTruthy()
  })

  it('ICE 收集 15s 未完成 → 失败重试', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    // iceGatheringState 保持 'new'（mock 不自动 complete）
    h.advance(15_000)
    await h.flush()
    expect(h.sent.some((m) => m.type === 'rtc_retry')).toBe(true)
  })

  it('answerer 收到 offer → 创建 PC 并回 answer', async () => {
    const h = setup({ iAmOfferer: false })
    h.manager.start() // answerer 启动不发 offer
    await h.flush()
    expect(h.pcFactory).not.toHaveBeenCalled()

    h.manager.handleSignal({ type: 'rtc_sdp', from: 'userB', to: 'userA', sdp: { type: 'offer', sdp: 'OFFER' } })
    await h.flush()
    expect(h.pcFactory).toHaveBeenCalledTimes(1)
    const answer = h.sent.find((m) => m.type === 'rtc_sdp' && (m.sdp as { type: string }).type === 'answer')
    expect(answer).toBeTruthy()
    expect(answer!.to).toBe('userB')
  })

  it('收到对端 rtc_fallback → 本地降级，不回发避免循环', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    h.manager.handleSignal({ type: 'rtc_fallback', from: 'userB', to: 'userA', reason: 'ice_failed', suggestText: true })
    expect(h.events.onFallback).toHaveBeenCalledTimes(1)
    expect(h.events.onFallback.mock.calls[0][1]).toBe('ice_failed')
    expect(h.sent.filter((m) => m.type === 'rtc_fallback').length).toBe(0)
  })

  it('notifyNoMedia → 主动发送 rtc_fallback(no_media)', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    h.manager.notifyNoMedia()
    const fb = h.sent.find((m) => m.type === 'rtc_fallback') as { reason?: string }
    expect(fb?.reason).toBe('no_media')
    expect(h.events.onFallback).toHaveBeenCalledWith('userB', 'no_media')
  })

  it('降级后 retryVoice 可手动重连', async () => {
    const h = setup()
    h.manager.start()
    await h.flush()
    h.manager.notifyNoMedia()
    expect(h.manager.lifecycle).toBe('fallback')

    h.manager.retryVoice()
    await h.flush()
    expect(h.manager.lifecycle).toBe('retrying') // forceRelay=true
    const offers = h.sent.filter((m) => m.type === 'rtc_sdp' && (m.sdp as { type: string }).type === 'offer')
    expect(offers.length).toBeGreaterThanOrEqual(2)
  })
})
