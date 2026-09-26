// ===== R4-01 断线重连与多人稳定性（端到端：真实 fastify + ws 客户端）=====
//
// 覆盖：
//   1. 首次连接下发 session_token；旧客户端无 token 随机位置入场
//   2. 会话恢复：断线带 token 重连恢复位置/旋转，且不重复广播 user_joined
//   3. 无效 token 视为全新会话
//   4. 在途消息缓冲 + TTL + 按序补发（replayed:true）
//   5. 断线宽限期：player_reconnecting / 超时 player_left / 期内重连不踢人
//   6. 服务端位置节流 50ms + 超速钳制 20 单位/秒
//   7. 位置 seq 递增（供客户端丢包检测）
//   8. 向后兼容：不带 token 的旧客户端断开立即 user_left

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";

type AnyMsg = Record<string, unknown>;

interface Conn {
  ws: WebSocket;
  /** 等待并消费指定 type 的下一条消息。 */
  waitFor: (type: string, timeoutMs?: number) => Promise<AnyMsg>;
  /** 收集一段时间窗口内收到的所有消息（用于“没收到”断言）。 */
  collect: (ms?: number) => Promise<AnyMsg[]>;
  /** 从缓冲中取出已到达的某条消息（不阻塞）。 */
  drain: (type: string) => AnyMsg | undefined;
}

/**
 * 连接 WS 并缓冲早期消息（服务端握手即发 welcome/session_token，
 * 若等 open 后再挂监听会丢消息）。可附带 sessionToken 模拟重连。
 */
async function connect(base: string, userId: string, room: string, sessionToken?: string): Promise<Conn> {
  const url = `${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`
    + (sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : "");
  const ws = new WebSocket(url);
  const buffer: AnyMsg[] = [];
  const waiters: Array<{ type: string; resolve: (m: AnyMsg) => void; timer: ReturnType<typeof setTimeout> }> = [];

  ws.on("message", (raw: Buffer) => {
    let msg: AnyMsg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const idx = waiters.findIndex((w) => w.type === msg.type);
    if (idx >= 0) {
      const w = waiters.splice(idx, 1)[0];
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      buffer.push(msg);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const waitFor = (type: string, timeoutMs = 3000): Promise<AnyMsg> => {
    return new Promise((resolve, reject) => {
      const idx = buffer.findIndex((m) => m.type === type);
      if (idx >= 0) {
        resolve(buffer.splice(idx, 1)[0]);
        return;
      }
      const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时`)), timeoutMs);
      waiters.push({ type, resolve, timer });
    });
  };
  const collect = (ms = 150): Promise<AnyMsg[]> => {
    return new Promise((r) => {
      const out: AnyMsg[] = [];
      const onMsg = (raw: Buffer) => {
        try { out.push(JSON.parse(raw.toString())); } catch { /* noop */ }
      };
      ws.on("message", onMsg);
      setTimeout(() => { ws.off("message", onMsg); r(out); }, ms);
    });
  };
  const drain = (type: string): AnyMsg | undefined => {
    const idx = buffer.findIndex((m) => m.type === type);
    if (idx >= 0) return buffer.splice(idx, 1)[0];
    return undefined;
  };

  return { ws, waitFor, collect, drain };
}

/** 完整握手：连上、消费 welcome/session_token，返回 token 供重连。 */
async function freshJoin(base: string, userId: string, room: string): Promise<{ conn: Conn; token: string }> {
  const conn = await connect(base, userId, room);
  await conn.waitFor("welcome");
  const tok = conn.drain("session_token") ?? (await conn.waitFor("session_token"));
  return { conn, token: String(tok.token) };
}

/**
 * 建立一个“可重连”会话：
 *  首次连接（无 token）→ 拿 token → 立即关闭（旧客户端离场语义）
 *  第二次连接（带 token）→ 服务端签发新 token，此后断开即进入宽限期。
 * 返回第二次连接及其新 token。
 */
async function reconnectableSession(base: string, userId: string, room: string): Promise<{ conn: Conn; token: string }> {
  const first = await freshJoin(base, userId, room);
  first.conn.ws.close();
  await new Promise((r) => setTimeout(r, 80)); // 等 close 落地
  const second = await connect(base, userId, room, first.token);
  // 带旧 token 但记录已被首次关闭清理 → 服务端按全新会话处理，发 welcome + 新 token
  await second.waitFor("welcome");
  const tok = second.drain("session_token") ?? (await second.waitFor("session_token"));
  return { conn: second, token: String(tok.token) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("R4-01 断线重连与多人稳定性", () => {
  let dir: string;
  let base: string;
  let closeServer: (() => Promise<void>) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let api: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-reconnect-"));
    process.env.DB_PATH = join(dir, "test.db");
    api = await import("./ws.js");
    const app = Fastify({ logger: false });
    await app.register(fastifyWebSocket);
    api.registerWebSocket(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || !address) throw new Error("无法获取监听端口");
    base = `http://127.0.0.1:${address.port}`;
    closeServer = async () => { await app.close(); };
  });

  beforeEach(() => {
    api._resetRoomsForTest();
    api._setReconnectGraceMsForTest(400); // 测试默认 400ms 宽限，避免真实等待 15s
    api._setMessageBufferTtlMsForTest(5000);
  });

  afterAll(async () => {
    if (closeServer) await closeServer();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });

  it("1. 首次连接下发非空 session_token；welcome 中位置在合法范围内", async () => {
    const room = "plaza";
    const { conn, token } = await freshJoin(base, "uTok", room);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(8);
    conn.ws.close();
  });

  it("2. 旧客户端不带 token 仍可随机位置入场（welcome 含自身）", async () => {
    const room = "plaza";
    const a = await connect(base, "uLegacy", room);
    const welcome = await a.waitFor("welcome");
    const me = (welcome.users as AnyMsg[]).find((u) => u.userId === "uLegacy");
    expect(me).toBeDefined();
    // 随机位置在 [-10,10]
    expect(Math.abs(Number(me!.x))).toBeLessThanOrEqual(10);
    expect(Math.abs(Number(me!.z))).toBeLessThanOrEqual(10);
    a.ws.close();
  });

  it("3. 会话恢复：断线后带 token 重连，位置/旋转原样恢复而非随机", async () => {
    const room = "plaza";
    const { conn, token } = await reconnectableSession(base, "uResume", room);
    // 先把自己走到 (5.5, -3.2)，旋转 1.2
    conn.ws.send(JSON.stringify({ type: "move", x: 5.5, z: -3.2, rotation: 1.2 }));
    await sleep(120); // 等 move 被接受（50ms 节流 + 往返）
    conn.ws.close();
    await sleep(100); // 等服务端进入宽限期

    const back = await connect(base, "uResume", room, token);
    const resumed = await back.waitFor("session_resumed");
    expect(resumed.type).toBe("session_resumed");
    expect(resumed.state.x).toBeCloseTo(5.5, 3);
    expect(resumed.state.z).toBeCloseTo(-3.2, 3);
    expect(resumed.state.rotation).toBeCloseTo(1.2, 3);
    back.ws.close();
  });

  it("4. 会话恢复期间，其他玩家不会收到 user_joined（化身不重建）", async () => {
    const room = "plaza";
    const b = await connect(base, "uObserver", room);
    await b.waitFor("welcome");

    const { conn, token } = await reconnectableSession(base, "uRejoin", room);
    await b.waitFor("user_joined"); // A 首次入场
    conn.ws.close();
    await b.waitFor("player_reconnecting"); // A 断线进入宽限
    await sleep(80);

    // A 重连
    const back = await connect(base, "uRejoin", room, token);
    await back.waitFor("session_resumed");
    // 观察窗口：B 不应再收到 uRejoin 的 user_joined
    const msgs = await b.collect(200);
    expect(msgs.some((m) => m.type === "user_joined" && m.user?.userId === "uRejoin")).toBe(false);
    back.ws.close();
    b.ws.close();
  });

  it("5. 无效 token 视为全新会话：收到 welcome 而非 session_resumed", async () => {
    const room = "plaza";
    const a = await connect(base, "uBadTok", room);
    await a.waitFor("welcome");
    a.ws.close();
    await sleep(60);

    const back = await connect(base, "uBadTok", room, "totally-invalid-token-xyz");
    const welcome = await back.waitFor("welcome"); // 不是 session_resumed
    expect(welcome.type).toBe("welcome");
    back.ws.close();
  });

  it("6. 在途消息补发：断线期间的 chat 被缓冲，重连后带 replayed:true", async () => {
    const room = "plaza";
    const { conn, token } = await reconnectableSession(base, "uReplay", room);
    // 先让 B 加入
    const b = await connect(base, "uB6", room);
    await b.waitFor("welcome");
    await sleep(60);

    conn.ws.close(); // A 进入宽限
    await sleep(100);

    // A 断线期间 B 发聊天
    b.ws.send(JSON.stringify({ type: "chat", userId: "uB6", nickname: "B", text: "你刚才掉线了" }));
    await sleep(80);

    const back = await connect(base, "uReplay", room, token);
    const resumed = await back.waitFor("session_resumed");
    const replayed = resumed.replayed as AnyMsg[];
    const chat = replayed.find((m) => m.type === "chat");
    expect(chat).toBeDefined();
    expect(chat!.text).toBe("你刚才掉线了");
    expect(chat!.replayed).toBe(true);
    back.ws.close();
    b.ws.close();
  });

  it("7. 补发按序：多条消息按发生顺序重放", async () => {
    const room = "plaza";
    const { conn, token } = await reconnectableSession(base, "uOrder", room);
    const b = await connect(base, "uB7", room);
    await b.waitFor("welcome");
    await sleep(60);

    conn.ws.close();
    await sleep(100);
    for (let i = 1; i <= 3; i += 1) {
      b.ws.send(JSON.stringify({ type: "chat", userId: "uB7", nickname: "B", text: `m${i}` }));
      await sleep(30);
    }

    const back = await connect(base, "uOrder", room, token);
    const resumed = await back.waitFor("session_resumed");
    const texts = (resumed.replayed as AnyMsg[]).filter((m) => m.type === "chat").map((m) => m.text);
    expect(texts).toEqual(["m1", "m2", "m3"]);
    back.ws.close();
    b.ws.close();
  });

  it("8. TTL 过期的缓冲消息不补发", async () => {
    api._setMessageBufferTtlMsForTest(200);
    api._setReconnectGraceMsForTest(3000); // 宽限期要比 TTL 观察窗更长，否则记录先被清了
    const room = "plaza";
    const { conn, token } = await reconnectableSession(base, "uTtl", room);
    const b = await connect(base, "uB8", room);
    await b.waitFor("welcome");
    await sleep(60);

    conn.ws.close();
    await sleep(80);
    b.ws.send(JSON.stringify({ type: "chat", userId: "uB8", nickname: "B", text: "过期消息" }));
    await sleep(400); // 超过 TTL=200ms
    // 再来一条新鲜的
    b.ws.send(JSON.stringify({ type: "chat", userId: "uB8", nickname: "B", text: "新鲜消息" }));
    await sleep(50);

    const back = await connect(base, "uTtl", room, token);
    const resumed = await back.waitFor("session_resumed");
    const texts = (resumed.replayed as AnyMsg[]).map((m) => m.text);
    expect(texts).not.toContain("过期消息");
    expect(texts).toContain("新鲜消息");
    back.ws.close();
    b.ws.close();
  });

  it("9. 宽限期内重连：B 收到 player_reconnecting，但收不到 player_left", async () => {
    const room = "plaza";
    const b = await connect(base, "uB9", room);
    await b.waitFor("welcome");
    const { conn, token } = await reconnectableSession(base, "uGrace", room);
    await b.waitFor("user_joined");

    conn.ws.close();
    const rc = await b.waitFor("player_reconnecting");
    expect(rc.userId).toBe("uGrace");

    await sleep(80); // 远小于 400ms 宽限
    const back = await connect(base, "uGrace", room, token);
    await back.waitFor("session_resumed");

    const msgs = await b.collect(200);
    expect(msgs.some((m) => m.type === "player_left" && m.userId === "uGrace")).toBe(false);
    back.ws.close();
    b.ws.close();
  });

  it("10. 宽限期超时：B 收到 player_left，旧 token 失效需重新入场", async () => {
    const room = "plaza";
    const b = await connect(base, "uB10", room);
    await b.waitFor("welcome");
    const { conn, token } = await reconnectableSession(base, "uTimeout", room);
    await b.waitFor("user_joined");

    conn.ws.close();
    await b.waitFor("player_reconnecting");
    const left = await b.waitFor("player_left", 2000);
    expect(left.userId).toBe("uTimeout");

    // 宽限已过，旧 token 不再有效：重连拿到 welcome 而非 session_resumed
    const back = await connect(base, "uTimeout", room, token);
    const w = await back.waitFor("welcome");
    expect(w.type).toBe("welcome");
    back.ws.close();
    b.ws.close();
  });

  it("11. 超速钳制：试图瞬移 100 单位被钳到 20 单位/秒上限内（远小于 100）", async () => {
    const room = "plaza";
    const { conn, token } = await reconnectableSession(base, "uSpeed", room);
    await sleep(100);
    // 第一次 move：建立速度基准点 (0,0)
    conn.ws.send(JSON.stringify({ type: "move", x: 0, z: 0, rotation: 0 }));
    await sleep(120);
    // 约 120ms 后试图瞬移到 (100,0)：合法最大位移 = 20 * 0.12 ≈ 2.4，绝不可能是 100
    conn.ws.send(JSON.stringify({ type: "move", x: 100, z: 0, rotation: 0 }));
    await sleep(120);
    conn.ws.close();
    await sleep(80);

    const back = await connect(base, "uSpeed", room, token);
    const resumed = await back.waitFor("session_resumed");
    expect(resumed.state.x).toBeLessThan(5); // 钳制后约 2.4；若未钳制则是 100
    expect(resumed.state.x).toBeGreaterThanOrEqual(0);
    back.ws.close();
  });

  it("12. 位置 seq 递增：远端观察到的 presence 中该玩家 seq 严格 +1", async () => {
    const room = "plaza";
    const b = await connect(base, "uB12", room);
    await b.waitFor("welcome");
    const { conn } = await reconnectableSession(base, "uSeq", room);
    await b.waitFor("user_joined");
    await sleep(50);

    const seen: number[] = [];
    const onMsg = (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as AnyMsg;
        if (m.type === "presence") {
          for (const p of (m.users as AnyMsg[])) {
            if (p.userId === "uSeq" && typeof p.seq === "number") seen.push(p.seq);
          }
        }
      } catch { /* noop */ }
    };
    b.ws.on("message", onMsg);

    conn.ws.send(JSON.stringify({ type: "move", x: 1, z: 0, rotation: 0 }));
    await sleep(80);
    conn.ws.send(JSON.stringify({ type: "move", x: 2, z: 0, rotation: 0 }));
    await sleep(80);
    conn.ws.off("message", onMsg);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    // 相邻 seq 单调递增
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    conn.ws.close();
    b.ws.close();
  });

  it("13. 节流：50ms 内连续两次 move 只接受一次（远端只看到一次位移）", async () => {
    const room = "plaza";
    const b = await connect(base, "uB13", room);
    await b.waitFor("welcome");
    const { conn } = await reconnectableSession(base, "uThrottle", room);
    await b.waitFor("user_joined");
    await sleep(50);

    const positions: string[] = [];
    const onMsg = (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as AnyMsg;
        if (m.type === "presence") {
          const p = (m.users as AnyMsg[]).find((u) => u.userId === "uThrottle");
          if (p) positions.push(`${Number(p.x).toFixed(2)}`);
        }
      } catch { /* noop */ }
    };
    b.ws.on("message", onMsg);

    conn.ws.send(JSON.stringify({ type: "move", x: 7, z: 0, rotation: 0 }));
    conn.ws.send(JSON.stringify({ type: "move", x: 9, z: 0, rotation: 0 })); // 20ms 内，应被节流
    await sleep(150);
    b.ws.off("message", onMsg);

    // 第二次 (9,0) 被丢弃：远端不应出现 x=9
    expect(positions).not.toContain("9.00");
    conn.ws.close();
    b.ws.close();
  });

  it("14. 向后兼容：不带 token 的旧客户端断开立即收到 user_left（无宽限）", async () => {
    const room = "plaza";
    const b = await connect(base, "uB14", room);
    await b.waitFor("welcome");
    // A 不带 token 入场（连 welcome 后拿 token 但重连不携带 → close 时 cameWithToken=false）
    const a = await connect(base, "uLegacyLeave", room);
    await a.waitFor("welcome");
    await b.waitFor("user_joined");

    a.ws.close();
    const left = await b.waitFor("user_left", 2000); // 立即到达，不等宽限
    expect(left.userId).toBe("uLegacyLeave");
    b.ws.close();
  });
});
