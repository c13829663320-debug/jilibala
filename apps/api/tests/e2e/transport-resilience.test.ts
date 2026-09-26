// ===== E2E: 传输层韧性（真实 Fastify WS 服务 + 裸 ws 客户端） =====
// 多开连接进同一 social 房间，模拟断线重连：
//  - welcome 下发 HeartbeatConfig + SessionToken
//  - 心跳 ping/pong 携带 clientSeq/serverTs/playerCount
//  - 断线 -> player_disconnecting；窗口内重连 -> 进度事件 + 补发 + player_reconnected
//  - 窗口到期未重连 -> user_left + 房主转移兜底
// 结构化日志写入 ./logs/transport-resilience.<ts>.json
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

// —— 必须在导入 ws/room 模块前设置窗口（模块加载时读取 env） ——
// 心跳超时给长（整段测试期间不被看门狗误踢），重连窗口给短（快速验证到期移除/房主转移）。
process.env.TRANSPORT_HEARTBEAT_TIMEOUT_MS = "10000";
process.env.TRANSPORT_RECONNECT_WINDOW_MS = "2500";
process.env.TRANSPORT_WATCHDOG_MS = "200";
process.env.PORT = "0";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "balabala-e2e-")), "e2e.db");

const here = dirname(fileURLToPath(import.meta.url));
const logsDir = join(here, "logs");
mkdirSync(logsDir, { recursive: true });

type LogEntry = { t: number; dir: "in" | "out" | "sys"; who: string; type: string; payload?: unknown };
const events: LogEntry[] = [];
function log(who: string, dir: LogEntry["dir"], type: string, payload?: unknown) {
  events.push({ t: Date.now(), dir, who, type, payload });
}

let fastify: import("fastify").FastifyInstance;
let port: number;

beforeAll(async () => {
  const Fastify = (await import("fastify")).default;
  const websocket = (await import("@fastify/websocket")).default;
  const { registerWebSocket, _resetTransportForTest, _resetRoomsForTest } = await import("../../src/ws.js");
  const { registerRoomRoutes, _resetSocialRoomsForTest } = await import("../../src/room-routes.js");

  _resetTransportForTest();
  _resetRoomsForTest();
  _resetSocialRoomsForTest();

  fastify = Fastify({ logger: false });
  await fastify.register(websocket);
  registerWebSocket(fastify);
  registerRoomRoutes(fastify);
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  port = (fastify.server.address() as import("node:net").AddressInfo).port;
});

afterAll(async () => {
  const out = join(logsDir, `transport-resilience.${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ startedAt: new Date().toISOString(), eventCount: events.length, events }, null, 2));
  console.log("[e2e] logs written:", out);
  try { await fastify?.close(); } catch { /* noop */ }
});

// ---------------------------------------------------------------------------
// 裸 ws 客户端封装
// ---------------------------------------------------------------------------
interface TestClient {
  ws: WebSocket;
  userId: string;
  messages: string[];            // 原始文本消息
  waitFor: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any>;
  close: () => void;
}

function connect(userId: string, room: string, extraQuery = ""): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${extraQuery}`;
    const ws = new WebSocket(url);
    const messages: string[] = [];
    const waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void; timer: NodeJS.Timeout }> = [];

    ws.on("open", () => log(userId, "out", "__open__"));
    ws.on("message", (raw: Buffer) => {
      const text = raw.toString();
      messages.push(text);
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = { type: "raw", text }; }
      log(userId, "in", parsed?.type ?? "unknown", parsed);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(parsed)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(parsed);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on("error", (err) => { log(userId, "sys", "__error__", String(err)); reject(err); });
    ws.on("close", () => log(userId, "sys", "__close__"));

    ws.on("open", () => {
      resolve({
        ws, userId, messages,
        waitFor: (pred, timeoutMs = 5000) => new Promise((res, rej) => {
          // 竞态防护：先扫描已缓冲消息（welcome 可能在 waitFor 注册前就到达）。
          for (const text of messages) {
            try {
              const parsed = JSON.parse(text);
              if (pred(parsed)) { res(parsed); return; }
            } catch { /* ignore */ }
          }
          const timer = setTimeout(() => rej(new Error(`waitFor timeout (${timeoutMs}ms) for ${userId}`)), timeoutMs);
          waiters.push({ pred, resolve: res, timer });
        }),
        close: () => { try { ws.close(); } catch { /* noop */ } },
      });
    });
  });
}

async function createRoom(creatorId: string, creatorName: string) {
  const res = await fastify.inject({
    method: "POST", url: "/api/rooms",
    payload: { name: "E2E 韧性房", creatorId, creatorName },
  });
  const body = res.json() as { room: { id: string; code: string; creatorId: string } };
  return body.room;
}

describe("传输层韧性 E2E", () => {
  it("完整链路：心跳/welcome token/断线平滑/重连补发/进度/房主转移", async () => {
    const room = await createRoom("owner1", "房主");
    log("sys", "sys", "room_created", room);

    // 1) 房主与 alice 全新加入
    const owner = await connect("owner1", room.id);
    const welcomeOwner = await owner.waitFor((m) => m.type === "welcome");
    expect(welcomeOwner.heartbeat).toBeDefined();
    expect(welcomeOwner.heartbeat.reconnectWindowMs).toBe(2500);
    expect(welcomeOwner.sessionToken?.sessionId).toBeTruthy();
    const ownerToken: string = welcomeOwner.sessionToken.sessionId;

    const alice = await connect("alice", room.id);
    const aliceWelcome = await alice.waitFor((m) => m.type === "welcome");
    // owner 在 alice 之前加入，应出现在 welcome 快照里（而非 user_joined 事件）。
    expect(aliceWelcome.users.map((u: { userId: string }) => u.userId)).toContain("owner1");
    expect(aliceWelcome.sessionToken?.sessionId).toBeTruthy();

    // 2) 心跳：owner 发 ping(clientSeq=42)，期待 pong 回带 clientSeq/serverTs/playerCount
    owner.ws.send(JSON.stringify({ type: "ping", clientSeq: 42 }));
    const pong = await owner.waitFor((m) => m.type === "pong");
    expect(pong.clientSeq).toBe(42);
    expect(typeof pong.serverTs).toBe("number");
    expect(pong.playerCount).toBe(2);

    // 3) owner 发一条 chat（alice 实时收到）
    owner.ws.send(JSON.stringify({ type: "chat", text: "before-drop" }));
    await alice.waitFor((m) => m.type === "chat" && m.text === "before-drop");

    // 4) owner 断线（模拟网络中断）
    owner.close();
    const dc = await alice.waitFor((m) => m.type === "player_disconnecting" && m.userId === "owner1");
    expect(dc.reconnectWindowMs).toBe(2500);
    // 活跃人数应下降为 1
    const count1 = await alice.waitFor((m) => m.type === "room_player_update" && m.playerCount === 1);
    expect(count1.playerCount).toBe(1);

    // 断线期间 alice 发消息——owner 重连后应补发收到（在途消息不丢）
    alice.ws.send(JSON.stringify({ type: "chat", text: "while-owner-away" }));

    // 5) owner 在窗口内用 sessionId 重连
    const owner2 = await connect("owner1", room.id, `&sessionId=${ownerToken}&lastServerSeq=0`);
    // 进度事件序列
    const p1 = await owner2.waitFor((m) => m.type === "reconnect_progress" && m.stage === "resuming");
    const p2 = await owner2.waitFor((m) => m.type === "reconnect_progress" && m.stage === "replaying");
    const p3 = await owner2.waitFor((m) => m.type === "reconnect_progress" && m.stage === "syncing_state");
    const p4 = await owner2.waitFor((m) => m.type === "reconnect_progress" && m.stage === "done");
    expect([p1.progress, p2.progress, p3.progress, p4.progress]).toEqual([0.1, 0.3, 0.7, 1]);

    // 在途消息补发：owner 应收到断线期间 alice 的消息
    await owner2.waitFor((m) => m.type === "chat" && m.text === "while-owner-away");

    const rr = await owner2.waitFor((m) => m.type === "reconnect_response");
    expect(rr.accepted).toBe(true);
    expect(rr.sessionId).toBe(ownerToken);
    const welcome2 = await owner2.waitFor((m) => m.type === "welcome" && m.resumed === true);
    expect(welcome2.resumed).toBe(true);
    // alice 应收到 player_reconnected
    await alice.waitFor((m) => m.type === "player_reconnected" && m.userId === "owner1");

    // 6) owner 再次断线，且不再回来——窗口到期后应真正移除并转移房主给 alice
    owner2.close();
    await alice.waitFor((m) => m.type === "player_disconnecting" && m.userId === "owner1");
    // 窗口到期（2.5s）+ 看门狗（200ms），等真正的 user_left + room_owner_changed
    const userLeft = await alice.waitFor((m) => m.type === "user_left" && m.userId === "owner1", 8000);
    expect(userLeft.userId).toBe("owner1");
    const ownerChanged = await alice.waitFor((m) => m.type === "room_owner_changed" && m.newOwnerId === "alice", 3000);
    expect(ownerChanged.oldOwnerId).toBe("owner1");

    alice.close();
  }, 25000);
});
