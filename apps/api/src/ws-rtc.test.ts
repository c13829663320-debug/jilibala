// ===== WebRTC 信令转发集成测试（真实 fastify + ws 客户端）=====
//
// 验证 ws.ts 中 rtc_sdp / rtc_ice / rtc_bye 的转发语义：
//   1. A 发给 B 的 rtc_sdp 只有 B 收到，A 自己收不到回声，其他人也收不到。
//   2. 目标用户不存在时静默丢弃，不抛错。
//   3. rtc_ice 同上。
//
// 与 ws.test.ts 的纯逻辑风格不同：这里必须起真实 WS 服务，因为 rtc_* handler
// 写在 socket.on('message') 闭包里，不导出；用真实连接端到端验证最贴近行为。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * 服务端在握手后立即发 welcome，若等 open 后再挂 message 监听会丢消息，
 * 故从构造起就缓冲所有消息，waitFor 优先消费缓冲。
 */
async function connect(base: string, userId: string, room: string): Promise<WebSocket> {
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

  return ws
}

describe('rtc 信令转发（端到端）', () => {
  let dir: string
  let base: string
  let closeServer: (() => Promise<void>) | null = null

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'balabala-rtc-'))
    process.env.DB_PATH = join(dir, 'test.db')
    // 动态 import 让 db 在设置 DB_PATH 后再初始化
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

  afterAll(async () => {
    if (closeServer) await closeServer()
    delete process.env.DB_PATH
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟 */ }
  })

  it('rtc_sdp：A 发给 B，只有 B 收到，A 不收回声，C 也收不到', async () => {
    const room = `plaza`
    const a = await connect(base, 'uA', room)
    const b = await connect(base, 'uB', room)
    const c = await connect(base, 'uC', room)
    // 等 B/C 的 user_joined 在 A 侧结算
    await new Promise((r) => setTimeout(r, 100))

    const sdp = { type: 'offer' as const, sdp: 'FAKE_SDP_FROM_A' }
    a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'uB', sdp }))

    const fromB = await waitFor(b, 'rtc_sdp')
    expect(fromB.from).toBe('uA')
    expect(fromB.to).toBe('uB')
    expect(fromB.sdp).toEqual(sdp)

    // A 自己不应收到回声
    const aMsgs = await collectFor(a)
    expect(aMsgs.some((m) => m.type === 'rtc_sdp')).toBe(false)
    // 第三方 C 不应收到
    const cMsgs = await collectFor(c)
    expect(cMsgs.some((m) => m.type === 'rtc_sdp')).toBe(false)

    a.close(); b.close(); c.close()
  })

  it('rtc_sdp：目标不存在时静默丢弃，不报错、不广播', async () => {
    const room = `plaza`
    const a = await connect(base, 'uA', room)
    await new Promise((r) => setTimeout(r, 100))

    // 发送给不存在的 ghost
    expect(() => {
      a.send(JSON.stringify({ type: 'rtc_sdp', from: 'uA', to: 'ghost', sdp: { type: 'offer', sdp: 'x' } }))
    }).not.toThrow()

    const aMsgs = await collectFor(a)
    // 服务端不应回 rtc_sdp 也不应回 error
    expect(aMsgs.some((m) => m.type === 'rtc_sdp')).toBe(false)
    a.close()
  })

  it('rtc_ice：A 发给 B，只有 B 收到 candidate', async () => {
    const room = `plaza`
    const a = await connect(base, 'uA', room)
    const b = await connect(base, 'uB', room)
    await new Promise((r) => setTimeout(r, 100))

    const candidate = { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 }
    a.send(JSON.stringify({ type: 'rtc_ice', from: 'uA', to: 'uB', candidate }))

    const fromB = await waitFor(b, 'rtc_ice')
    expect(fromB.from).toBe('uA')
    expect(fromB.to).toBe('uB')
    expect(fromB.candidate).toEqual(candidate)

    const aMsgs = await collectFor(a)
    expect(aMsgs.some((m) => m.type === 'rtc_ice')).toBe(false)

    a.close(); b.close()
  })

  it('rtc_ice：目标不存在时静默', async () => {
    const room = `plaza`
    const a = await connect(base, 'uA', room)
    await new Promise((r) => setTimeout(r, 100))

    expect(() => {
      a.send(JSON.stringify({ type: 'rtc_ice', from: 'uA', to: 'ghost', candidate: { candidate: 'x', sdpMid: null, sdpMLineIndex: null } }))
    }).not.toThrow()
    a.close()
  })

  it('rtc_bye：B 收到 A 的 bye 通知', async () => {
    const room = `plaza`
    const a = await connect(base, 'uA', room)
    const b = await connect(base, 'uB', room)
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: 'rtc_bye', from: 'uA', to: 'uB' }))
    const bye = await waitFor(b, 'rtc_bye')
    expect(bye.from).toBe('uA')
    expect(bye.to).toBe('uB')
    a.close(); b.close()
  })
})
