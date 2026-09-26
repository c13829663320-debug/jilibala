// ===== 实时状态同步 · 裸 node 客户端 E2E =====
// 真实起 fastify + @fastify/websocket，用 ws 客户端模拟多客户端高频发送 move，
// 验证：
//   1. welcome 下发 StateSyncConfig
//   2. 服务端 10Hz 聚合广播（高频 move 被聚合成远少于发送条数的 presence）
//   3. 序号去重（重复 seq 旧位置不生效）
//   4. 乱序跳跃 seq 仍应用最新状态，presence 携带 lastKnownSeq
//   5. request_state 回复完整房间快照 state_snapshot（丢包补偿）
//   6. 频率超限回 RATE_LIMITED
// 结构化日志写入 tests/e2e/logs/state-sync.jsonl
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";

type AnyMsg = Record<string, unknown>;
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "logs", "state-sync.jsonl");

// 清空上次日志
writeFileSync(LOG_PATH, "");
function log(event: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: Date.now(), event, ...extra });
  appendFileSync(LOG_PATH, line + "\n");
  // eslint-disable-next-line no-console
  console.log(line);
}

/** 连接 WS 并缓冲早期消息（welcome 在握手后立即下发）。 */
function connect(base: string, userId: string, room: string): Promise<{ ws: WebSocket; next: () => Promise<AnyMsg> }> {
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`);
  const pending: AnyMsg[] = [];
  let waiter: ((m: AnyMsg) => void) | null = null;
  const listeners: Array<() => void> = [];

  ws.on("message", (raw: Buffer) => {
    let msg: AnyMsg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (waiter) { const w = waiter; waiter = null; w(msg); } else pending.push(msg);
  });

  const next = () =>
    new Promise<AnyMsg>((resolve) => {
      if (pending.length) return resolve(pending.shift()!);
      waiter = resolve;
    });

  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, next }));
    ws.once("error", reject);
  }).then(async (c) => {
    // 等 welcome
    while (true) {
      const m = await c.next();
      if (m.type === "welcome") { log("welcome", { userId, stateSync: m.stateSync }); break; }
    }
    return c;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("实时状态同步 E2E（多客户端高频 move）", () => {
  let dir: string;
  let base: string;
  let closeServer: (() => Promise<void>) | null = null;
  let roomSeq = 0;
  const nextRoom = () => `plaza`; // 全局广场，每个用例用不同时间戳区分观察

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-ssync-"));
    process.env.DB_PATH = join(dir, "test.db");
    const { registerWebSocket } = await import("../../apps/api/src/ws.ts");
    const app = Fastify({ logger: false });
    await app.register(fastifyWebSocket);
    registerWebSocket(app); // 内部启动 10Hz presence ticker
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || !address) throw new Error("无法获取端口");
    base = `http://127.0.0.1:${address.port}`;
    closeServer = async () => { await app.close(); };
    log("server_started", { base });
  });

  afterAll(async () => {
    if (closeServer) await closeServer();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 句柄延迟 */ }
    log("server_stopped", {});
  });

  it("welcome 下发 StateSyncConfig", async () => {
    roomSeq++;
    const a = await connect(base, `ss_cfg_a`, nextRoom());
    // 已在 connect 内消费 welcome；重连一条以抓 config
    const ws2 = new WebSocket(`${base}/api/ws?userId=ss_cfg_a2&room=${nextRoom()}`);
    const welcome = await new Promise<AnyMsg>((resolve, reject) => {
      ws2.on("error", reject);
      ws2.on("message", (raw: Buffer) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "welcome") resolve(m);
      });
    });
    const cfg = welcome.stateSync as { serverTickHz: number; clientSendMaxHz: number } | undefined;
    expect(cfg).toBeDefined();
    expect(cfg!.serverTickHz).toBe(10);
    expect(cfg!.clientSendMaxHz).toBe(15);
    log("assert_welcome_config", { ok: true, cfg });
    a.ws.close(); ws2.close();
  });

  it("10Hz 聚合：高频 move 被聚合成远少于发送条数的 presence", async () => {
    const a = await connect(base, "ss_agg_a", nextRoom());
    const b = await connect(base, "ss_agg_b", nextRoom());
    await sleep(150); // 等 join 结算

    // B 侧统计窗口内收到的 presence 数
    let presenceCount = 0;
    const onB = (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "presence") presenceCount++;
    };
    b.ws.on("message", onB);

    // A 高频发送 30 条 move（带递增 seq），在 ~300ms 内发完
    const MOVES = 30;
    for (let i = 1; i <= MOVES; i++) {
      a.ws.send(JSON.stringify({ type: "move", seq: i, x: i * 0.1, z: 0, rotation: 0 }));
    }
    log("high_freq_moves_sent", { from: "ss_agg_a", count: MOVES });

    await sleep(700); // 覆盖 ~7 个 tick
    b.ws.off("message", onB);
    log("presence_count_observed", { from: "ss_agg_b", movesSent: MOVES, presenceReceived: presenceCount });

    // 聚合效果：presence 条数应远小于发送条数（30 → 个位数），且在 10Hz 量级（≤10）
    expect(presenceCount).toBeLessThanOrEqual(10);
    expect(presenceCount).toBeGreaterThanOrEqual(1);
    expect(presenceCount).toBeLessThan(MOVES);

    a.ws.close(); b.ws.close();
  });

  it("序号去重：重复 seq 的旧位置不生效；跳跃 seq 应用最新且携带 lastKnownSeq", async () => {
    const a = await connect(base, "ss_seq_a", nextRoom());
    const b = await connect(base, "ss_seq_b", nextRoom());
    await sleep(150);

    // A 发送 seq=1 到 (5,5)，再发重复 seq=1 到 (999,999)（乱序旧包，应被丢弃）
    a.ws.send(JSON.stringify({ type: "move", seq: 1, x: 5, z: 5, rotation: 0 }));
    await sleep(150);
    a.ws.send(JSON.stringify({ type: "move", seq: 1, x: 999, z: 999, rotation: 0 }));
    // 跳跃 seq=4（中间丢 2,3）到 (8,8)
    a.ws.send(JSON.stringify({ type: "move", seq: 4, x: 8, z: 8, rotation: 0 }));
    log("seq_series_sent", { series: [1, 1 /*dup*/, 4 /*gap*/] });

    // 收集若干 presence，找最后一条含 ss_seq_a 的状态
    let lastSeen: AnyMsg | null = null;
    let observedLastKnownSeq: number | undefined;
    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      const m = await Promise.race([
        b.next(),
        sleep(200).then(() => null),
      ]);
      if (!m) break;
      if (m.type !== "presence") continue;
      const users = m.users as Array<Record<string, unknown>>;
      const me = users.find((u) => u.userId === "ss_seq_a");
      if (me) {
        lastSeen = me;
        if (typeof me.lastKnownSeq === "number") observedLastKnownSeq = me.lastKnownSeq;
      }
    }
    log("seq_last_seen", { lastSeen, observedLastKnownSeq });

    // 重复 seq=1 的 (999,999) 必须被丢弃，位置应为跳跃后的 (8,8)
    expect(lastSeen).not.toBeNull();
    expect(lastSeen!.x).toBeCloseTo(8);
    expect(lastSeen!.z).toBeCloseTo(8);
    // presence 应携带服务端已知的最新 seq=4（供客户端检测 gap）
    expect(observedLastKnownSeq).toBe(4);

    a.ws.close(); b.ws.close();
  });

  it("request_state 回复完整房间快照（丢包补偿）", async () => {
    const a = await connect(base, "ss_snap_a", nextRoom());
    const b = await connect(base, "ss_snap_b", nextRoom());
    await sleep(150);
    a.ws.send(JSON.stringify({ type: "move", seq: 10, x: 3.5, z: -2.5, rotation: 1.2 }));
    await sleep(150);

    // B 主动请求状态快照
    b.ws.send(JSON.stringify({ type: "request_state" }));
    const snap = await (async () => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const m = await Promise.race([b.next(), sleep(200).then(() => null)]);
        if (!m) continue;
        if (m.type === "state_snapshot") return m;
      }
      throw new Error("未收到 state_snapshot");
    })();
    log("state_snapshot_received", { players: (snap.players as AnyMsg[]).map((p) => ({ id: p.userId, x: p.x })) });
    const players = snap.players as Array<Record<string, unknown>>;
    expect(snap.serverTs).toBeTypeOf("number");
    const me = players.find((p) => p.userId === "ss_snap_a");
    expect(me).toBeDefined();
    expect(me!.x).toBeCloseTo(3.5);
    expect(me!.z).toBeCloseTo(-2.5);

    a.ws.close(); b.ws.close();
  });

  it("频率超限：>15Hz 发送收到 RATE_LIMITED(3001)", async () => {
    const a = await connect(base, "ss_rate_a", nextRoom());
    let rateLimited = 0;
    const onA = (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "error" && (m.code === 3001 || m.code === "RATE_LIMITED")) rateLimited++;
    };
    a.ws.on("message", onA);

    // 1 秒内瞬间发 25 条（>15），应触发限流
    for (let i = 1; i <= 25; i++) {
      a.ws.send(JSON.stringify({ type: "move", seq: 100 + i, x: i, z: 0, rotation: 0 }));
    }
    await sleep(300);
    a.ws.off("message", onA);
    log("rate_limit_result", { sent: 25, rateLimitedErrors: rateLimited });
    expect(rateLimited).toBeGreaterThan(0);

    a.ws.close();
  });
});
