// ===== WebRTC 信令健壮性集成测试（真实 fastify + ws 客户端）=====
//
// 验证 ws.ts 中 RTC 信令的健壮性语义：
//   1. rtc_sdp / rtc_ice 转发：只有目标收到，发起方无回声，第三方收不到；
//   2. 目标不在线：回复 rtc_error 给发起方（而非静默丢弃）；
//   3. welcome 后下发 rtc_config（公共 STUN，可选 TURN）；
//   4. glare 冲突：双方同时发 offer，后到者收到 rtc_error(offer_conflict)；
//   5. rtc_retry / rtc_fallback 在线校验后透传；
//   6. rtc_sdp 携带 seq 透传。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";

type AnyMsg = Record<string, unknown>;

/** 等待某个连接收到指定 type 的消息，超时则失败。 */
function waitFor(ws: WebSocket, type: string, timeoutMs = 3000): Promise<AnyMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时`)), timeoutMs);
    const onMsg = (raw: Buffer) => {
      let msg: AnyMsg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === type) {
        clearTimeout(timer)
        ws.removeListener('message', onMsg)
        resolve(msg)
      }
    }
    ws.on('message', onMsg)
  })
}

/** 收集一段窗口内收到的所有消息，用于"没收到"断言。 */
async function collectFor(ws: WebSocket, ms = 150): Promise<AnyMsg[]> {
  const out: AnyMsg[] = []
  const onMsg = (raw: Buffer) => {
    try { out.push(JSON.parse(raw.toString())) } catch { /* noop */ }
  }
  ws.on('message', onMsg)
  await new Promise((r) => setTimeout(r, ms))
  ws.removeListener('message', onMsg)
  return out
}

/**
 * 连接 WS 并缓冲早期消息。
 * 服务端在握手后立即发 welcome / rtc_config，若等 open 后再挂 message 监听会丢消息，
 * 故从构造起就缓冲所有消息，waitFor 优先消费缓冲。
 * 返回 ws；连接早期（welcome 之前）到达的消息挂在 ws._early 上（含 rtc_config）。
 */
async function connect(base: string, userId: string, room: string): Promise<WebSocket & { _early?: AnyMsg[] }> {
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`)
  const buffer: AnyMsg[] = []
  let bufferWaiter: ((msg: AnyMsg) => void) | null = null

  ws.on('message', (raw: Buffer) => {
    let msg: AnyMsg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (bufferWaiter) {
      const w = bufferWaiter
      bufferWaiter = null
      w(msg)
    } else {
      buffer.push(msg)
    }
  })

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })

  // 等 welcome：先查缓冲，没有则等下一条
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 welcome 超时')), 3000)
    const idx = buffer.findIndex((m) => m.type === 'welcome')
    if (idx >= 0) {
      buffer.splice(idx, 1)
      clearTimeout(timer)
      resolve()
      return
    }
    bufferWaiter = (msg) => {
      if (msg.type === 'welcome') {
        clearTimeout(timer)
        resolve()
      }
    }
  })

  ;(ws as WebSocket & { _early?: AnyMsg[] })._early = buffer
  return ws
}

describe('rtc 信令健壮性（端到端）', () => {
  let dir: string
  let base: string
  let closeServer: (() => Promise<void>) | null = null

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'balabala-rtc-'))
    process.env.DB_PATH = join(dir, 'test.db')
    const { registerWebSocket } = await import('./ws.js')
    const app = Fastify({ logger: false })
    await app.register(fastifyWebSocket)
    registerWebSocket(app)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (typeof address === 'string' || !address) throw new Error('无法获取监听端口')
    base = `http://127.0.0.1:${address.port}`
    closeServer = async () => { await app.close() }
  })

  beforeEach(async () => {
    // 每个用例前清空房间与 RTC 信令状态，避免跨用例污染
    const { _resetRoomsForTest } = await import('./ws.js')
    _resetRoomsForTest()
  })

  afterAll(async () => {
    if (closeServer) await closeServer()
    delete process.env.DB_PATH
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟 */ }
  })

  it('welcome 后下发 rtc_config：含公共 STUN，TURN 未配置时不出现凭据', async () => {
    delete process.env.WEBRTC_TURN_URL
    const a = await connect(base, 'uA', 'plaza')
    const cfg = (a._early ?? []).find((m) => m.type === 'rtc_config')
    expect(cfg).toBeTruthy()
    const iceServers = cfg!.iceServers as Array<{ urls: string; username?: string; credential?: string }>
    expect(iceServers.length).toBeGreaterThanOrEqual(1)
    expect(iceServers[0].urls).toBe('stun:stun.l.google.com:19302')
    expect(iceServers.some((s) => s.username || s.credential)).toBe(false)
    a.close()
  })

  it('配置 TURN 环境变量时：rtc_config 附带 TURN 条目', async () => {
    process.env.WEBRTC_TURN_URL = 'turn:turn.example.com:3478'
    process.env.WEBRTC_TURN_USERNAME = 'fakeuser'
    process.env.WEBRTC_TURN_CREDENTIAL = 'fakecred'
    try {
      const a = await connect(base, 'uA', 'plaza')
      const cfg = (a._early ?? []).find((m) => m.type === 'rtc_config')
      expect(cfg).toBeTruthy()
      const iceServers = cfg!.iceServers as Array<{ urls: string; username?: string; credential?: string }>
      const turn = iceServers.find((s) => String(s.urls).startsWith('turn:'))
      expect(turn).toBeTruthy()
      expect(turn!.urls).toBe('turn:turn.example.com:3478')
      expect(turn!.username).toBe('fakeuser')
      expect(turn!.credential).toBe('fakecred')
      a.close()
    } finally {
      delete process.env.WEBRTC_TURN_URL
      delete process.env.WEBRTC_TURN_USERNAME
      delete process.env.WEBRTC_TURN_CREDENTIAL
    }
  })

  it('rtc_sdp：A 发给 B，只有 B 收到，A 不收回声，C 也收不到', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    const c = await connect(base, 'uC', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    const sdp = { type: 'offer' as const, sdp: 'FAKE_SDP_FROM_A' }
    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'uB', sdp, seq: 7 }))

    const fromB = await waitFor(b, 'rtc_sdp')
    expect(fromB.from).toBe('uA')
    expect(fromB.to).toBe('uB')
    expect(fromB.sdp).toEqual(sdp)
    expect(fromB.seq).toBe(7) // seq 透传

    const aMsgs = await collectFor(a)
    expect(aMsgs.some((m) => m.type === 'rtc_sdp')).toBe(false)
    const cMsgs = await collectFor(c)
    expect(cMsgs.some((m) => m.type === 'rtc_sdp')).toBe(false)

    a.close(); b.close(); c.close()
  })

  it('rtc_sdp：目标不在线时回复 rtc_error（而非静默丢弃）', async () => {
    const a = await connect(base, 'uA', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'ghost', sdp: { type: 'offer', sdp: 'x' }, seq: 3 }))
    const err = await waitFor(a, 'rtc_error')
    expect(err.code).toBe('rtc_target_offline')
    expect(err.to).toBe('uA')
    expect(err.reqSeq).toBe(3)
    a.close()
  })

  it('rtc_ice：A 发给 B，只有 B 收到 candidate；目标离线回 rtc_error', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    const candidate = { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 }
    a.send(JSON.stringify({ type: 'rtc_ice', from: 'uA', to: 'uB', candidate }))

    const fromB = await waitFor(b, 'rtc_ice')
    expect(fromB.from).toBe('uA')
    expect(fromB.to).toBe('uB')
    expect(fromB.candidate).toEqual(candidate)

    // 目标离线 → rtc_error
    a.send(JSON.stringify({ type: 'rtc_ice', from: 'uA', to: 'ghost', candidate: { candidate: 'x', sdpMid: null, sdpMLineIndex: null } }))
    const err = await waitFor(a, 'rtc_error')
    expect(err.code).toBe('rtc_target_offline')

    a.close(); b.close()
  })

  it('glare：A→B offer 后 B→A offer 冲突，B 收到 rtc_error(offer_conflict)', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    // A 先向 B 发 offer（pair 进入 answering，offerer=uA）
    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'uB', sdp: { type: 'offer', sdp: 'O1' } }))
    await waitFor(b, 'rtc_sdp')

    // B 同时向 A 发 offer（glare）：B 应收到 rtc_error，A 不应收到这条新 offer
    b.send(JSON.stringify({ type: 'rtc_sdp', from: 'uB', to: 'uA', sdp: { type: 'offer', sdp: 'O2' } }))
    const err = await waitFor(b, 'rtc_error')
    expect(err.code).toBe('rtc_offer_conflict')

    const aMsgs = await collectFor(a)
    expect(aMsgs.some((m) => m.type === 'rtc_sdp' && (m.sdp as { sdp?: string })?.sdp === 'O2')).toBe(false)

    a.close(); b.close()
  })

  it('answer 到达后该对转入 connected：后续重 offer 正常转发（不冲突）', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'uB', sdp: { type: 'offer', sdp: 'O1' } }))
    await waitFor(b, 'rtc_sdp')
    b.send(JSON.stringify({ type: 'rtc_sdp', from: 'uB', to: 'uA', sdp: { type: 'answer', sdp: 'A1' } }))
    await waitFor(a, 'rtc_sdp')

    // 重协商：A 再发 offer，正常转发（不 glare）
    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'uB', sdp: { type: 'offer', sdp: 'O2' } }))
    const again = await waitFor(b, 'rtc_sdp')
    expect((again.sdp as { sdp: string }).sdp).toBe('O2')

    a.close(); b.close()
  })

  it('rtc_retry：A 发给 B 透传；B 离线回 rtc_error', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_retry', from: 'uA', to: 'uB', attempt: 1, reason: 'ice_failed' }))
    const retry = await waitFor(b, 'rtc_retry')
    expect(retry.attempt).toBe(1)
    expect(retry.reason).toBe('ice_failed')

    a.send(JSON.stringify({ type: 'rtc_retry', from: 'uA', to: 'ghost', attempt: 2, reason: 'x' }))
    const err = await waitFor(a, 'rtc_error')
    expect(err.code).toBe('rtc_target_offline')

    a.close(); b.close()
  })

  it('rtc_fallback：A 发给 B 透传 suggestText', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_fallback', from: 'uA', to: 'uB', reason: 'ice_failed', suggestText: true }))
    const fb = await waitFor(b, 'rtc_fallback')
    expect(fb.reason).toBe('ice_failed')
    expect(fb.suggestText).toBe(true)
    a.close(); b.close()
  })

  it('rtc_bye：B 收到 A 的 bye 通知', async () => {
    const a = await connect(base, 'uA', 'plaza')
    const b = await connect(base, 'uB', 'plaza')
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_bye', from: 'uA', to: 'uB' }))
    const bye = await waitFor(b, 'rtc_bye')
    expect(bye.from).toBe('uA')
    expect(bye.to).toBe('uB')
    a.close(); b.close()
  })
})
