// ===== 裸 node 客户端 e2e：WebRTC 信令健壮性验证 =====
//
// 不依赖浏览器 / 真实 WebRTC：用真实 WS 客户端（ws 包）直连起在本地的服务端，
// 验证：
//   1. rtc_config 下发（STUN + 可选 TURN）
//   2. rtc_sdp offer/answer 转发 + seq 透传 + 无回声
//   3. 目标不在线 → rtc_error（而非静默丢弃）
//   4. rtc_retry 透传（重试通知）
//   5. rtc_fallback 透传（语音降级 → 文字）
//
// 每一步写结构化 JSONL 日志到 tests/e2e/logs/，作为联调证据。
//
// 注意：真实浏览器端的媒体面（ICE 打洞 / TURN relay / 语音双向）需浏览器真机验证
// （--use-fake-device-for-media-stream），node 侧只验证信令面。

import { mkdtempSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";

type AnyMsg = Record<string, unknown>

const LOG_DIR = join(process.cwd(), "tests", "e2e", "logs")
const LOG_FILE = join(LOG_DIR, `webrtc-signaling-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`)

let logCount = 0
function log(step: string, detail: Record<string, unknown>): void {
  logCount += 1
  const entry = { ts: new Date().toISOString(), step, ...detail }
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8")
  // 同时打到控制台，便于 CI 直接看
  console.log(`[rtc-e2e #${logCount}] ${step}`, JSON.stringify(detail))
}

function waitFor(ws: WebSocket, type: string, timeoutMs = 3000): Promise<AnyMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时`)), timeoutMs)
    const onMsg = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as AnyMsg
        if (msg.type === type) {
          clearTimeout(timer)
          ws.removeListener("message", onMsg)
          resolve(msg)
        }
      } catch { /* noop */ }
    }
    ws.on("message", onMsg)
  })
}

type TestClient = WebSocket & { waitFor: (type: string, ms?: number) => Promise<AnyMsg> }

async function connect(base: string, userId: string, room: string): Promise<TestClient> {
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`)
  // 从构造起缓冲消息，避免 welcome 在挂监听前到达被吞
  const buffer: AnyMsg[] = []
  let waiter: ((msg: AnyMsg) => void) | null = null
  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as AnyMsg
      if (waiter) { const w = waiter; waiter = null; w(msg) } else { buffer.push(msg) }
    } catch { /* noop */ }
  })
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve())
    ws.once("error", reject)
  })
  // 等 welcome：先查缓冲，没有则等下一条
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待 welcome 超时")), 3000)
    const idx = buffer.findIndex((m) => m.type === "welcome")
    if (idx >= 0) { buffer.splice(idx, 1); clearTimeout(timer); resolve(); return }
    waiter = (msg) => { if (msg.type === "welcome") { clearTimeout(timer); resolve() } }
  })
  // 缓冲里的 rtc_config 等早期消息，交给后续 waitFor 通过 buffer 消费
  const origWaitFor = waitFor
  return new Proxy(ws, {
    get(target, prop) {
      if (prop === "waitFor") return (type: string, t?: number) => {
        const idx = buffer.findIndex((m) => m.type === type)
        if (idx >= 0) return Promise.resolve(buffer.splice(idx, 1)[0])
        return origWaitFor(target, type, t)
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop]
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  }) as TestClient
}

describe("WebRTC 信令健壮性 · 裸 node e2e", () => {
  let dir: string
  let base: string
  let closeServer: (() => Promise<void>) | null = null

  beforeAll(async () => {
    mkdirSync(LOG_DIR, { recursive: true })
    log("suite_start", { logFile: LOG_FILE, note: "裸 node WS 客户端验证信令面；媒体面需浏览器真机" })
    dir = mkdtempSync(join(tmpdir(), "balabala-rtc-e2e-"))
    process.env.DB_PATH = join(dir, "test.db")
    const { registerWebSocket } = await import("../../apps/api/src/ws.ts")
    const app = Fastify({ logger: false })
    await app.register(fastifyWebSocket)
    registerWebSocket(app)
    await app.listen({ port: 0, host: "127.0.0.1" })
    const address = app.server.address()
    if (typeof address === "string" || !address) throw new Error("无法获取监听端口")
    base = `http://127.0.0.1:${address.port}`
    log("server_listening", { base })
    closeServer = async () => { await app.close() }
  })

  afterAll(async () => {
    if (closeServer) await closeServer()
    delete process.env.DB_PATH
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* noop */ }
    log("suite_end", { logCount })
  })

  it("1) rtc_config 下发：客户端连上即拿到 ICE 服务器配置", async () => {
    const a = await connect(base, "e2eA", "plaza")
    const cfg = await a.waitFor("rtc_config")
    const iceServers = cfg.iceServers as Array<{ urls: string | string[] }>
    log("rtc_config_received", { iceServers })
    expect(iceServers[0].urls).toContain("stun:stun.l.google.com")
    a.close()
  })

  it("2) rtc_sdp offer/answer 转发：B 收到 offer，A 收到 answer，seq 透传", async () => {
    const a = await connect(base, "e2eA", "plaza")
    const b = await connect(base, "e2eB", "plaza")
    await new Promise((r) => setTimeout(r, 100))

    // A → B offer
    const offer = { type: "offer" as const, sdp: "FAKE_OFFER_E2E" }
    a.send(JSON.stringify({ type: "rtc_sdp", from: "e2eA", to: "e2eB", sdp: offer, seq: 11 }))
    const bGot = await b.waitFor("rtc_sdp")
    log("sdp_offer_relayed", { from: "e2eA", to: "e2eB", seq: bGot.seq })
    expect(bGot.from).toBe("e2eA")
    expect(bGot.seq).toBe(11)

    // B → A answer
    const answer = { type: "answer" as const, sdp: "FAKE_ANSWER_E2E" }
    b.send(JSON.stringify({ type: "rtc_sdp", from: "e2eB", to: "e2eA", sdp: answer, seq: 12 }))
    const aGot = await a.waitFor("rtc_sdp")
    log("sdp_answer_relayed", { from: "e2eB", to: "e2eA" })
    expect(aGot.from).toBe("e2eB")
    expect((aGot.sdp as { type: string }).type).toBe("answer")

    a.close(); b.close()
  })

  it("3) 目标不在线：A 发给 ghost 收到 rtc_error（而非静默丢弃）", async () => {
    const a = await connect(base, "e2eA", "plaza")
    await new Promise((r) => setTimeout(r, 100))
    a.send(JSON.stringify({ type: "rtc_sdp", from: "e2eA", to: "ghost", sdp: { type: "offer", sdp: "x" }, seq: 21 }))
    const err = await a.waitFor("rtc_error")
    log("rtc_error_online_check", { code: err.code, reqSeq: err.reqSeq })
    expect(err.code).toBe("rtc_target_offline")
    expect(err.reqSeq).toBe(21)
    a.close()
  })

  it("4) rtc_retry 透传：A 通知 B 即将重试，B 收到 attempt/reason", async () => {
    const a = await connect(base, "e2eA", "plaza")
    const b = await connect(base, "e2eB", "plaza")
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: "rtc_retry", from: "e2eA", to: "e2eB", attempt: 2, reason: "ice_failed" }))
    const retry = await b.waitFor("rtc_retry")
    log("rtc_retry_relayed", { attempt: retry.attempt, reason: retry.reason })
    expect(retry.attempt).toBe(2)
    expect(retry.reason).toBe("ice_failed")
    a.close(); b.close()
  })

  it("5) rtc_fallback 透传：A 通知 B 语音降级，双方切文字", async () => {
    const a = await connect(base, "e2eA", "plaza")
    const b = await connect(base, "e2eB", "plaza")
    await new Promise((r) => setTimeout(r, 100))

    a.send(JSON.stringify({ type: "rtc_fallback", from: "e2eA", to: "e2eB", reason: "ice_failed", suggestText: true }))
    const fb = await b.waitFor("rtc_fallback")
    log("rtc_fallback_relayed", { reason: fb.reason, suggestText: fb.suggestText })
    expect(fb.suggestText).toBe(true)
    a.close(); b.close()
  })
})
