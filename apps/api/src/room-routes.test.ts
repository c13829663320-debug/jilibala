// ===== Round3: 真人多人社交房间测试 =====
// REST 用 fastify inject；WS 行为起真实监听服务 + ws 客户端端到端验证。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";
import type { SocialRoom } from "@balabala/shared";

type AnyMsg = Record<string, unknown>;

interface Conn {
  ws: WebSocket;
  waitFor: (type: string, timeoutMs?: number) => Promise<AnyMsg>;
}

/** 连接 WS 并缓冲早期消息；返回可等待指定 type 的连接。 */
async function connect(base: string, userId: string, room: string): Promise<Conn> {
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`);
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

  // 服务端握手后必发 welcome；缓冲期到达前先等它。
  await waitFor("welcome");
  return { ws, waitFor };
}

/** 连接一个应当被服务端拒绝的房间，返回服务端发来的 error.message。 */
function expectRejected(base: string, userId: string, room: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("拒绝连接超时")); }, 3000);
    ws.on("message", (raw: Buffer) => {
      let msg: AnyMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "error") {
        clearTimeout(timer);
        resolve(String(msg.message ?? ""));
        ws.close();
      }
    });
    ws.on("error", () => { /* close 后触发，忽略 */ });
  });
}

describe("Round3 社交房间", () => {
  let dir: string;
  let base: string;
  // 在 beforeAll 中由动态 import 填充
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-rooms-"));
    process.env.DB_PATH = join(dir, "test.db");
    const { registerWebSocket, _resetRoomsForTest } = await import("./ws.js");
    const { registerRoomRoutes, _resetSocialRoomsForTest } = await import("./room-routes.js");
    app = Fastify({ logger: false });
    await app.register(fastifyWebSocket);
    registerWebSocket(app);
    registerRoomRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || !address) throw new Error("无法获取监听端口");
    base = `http://127.0.0.1:${address.port}`;
    closeServer = async () => { await app.close(); };
    // 暴露 reset 给 beforeEach
    beforeEachReset = async () => {
      _resetRoomsForTest();
      _resetSocialRoomsForTest();
    };
  });

  let beforeEachReset: () => Promise<void> = async () => {};
  beforeEach(async () => { await beforeEachReset(); });

  afterAll(async () => {
    if (closeServer) await closeServer();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });

  // 便捷：创建房间并返回 { room }
  async function createRoom(body: Record<string, unknown>): Promise<{ statusCode: number; room?: SocialRoom; error?: string }> {
    const res = await app.inject({ method: "POST", url: "/api/rooms", payload: body });
    const json = res.json() as { room?: SocialRoom; error?: string };
    return { statusCode: res.statusCode, room: json.room, error: json.error };
  }

  it("创建房间：返回 6 位房间码、正确字段、playerCount=0", async () => {
    const { statusCode, room } = await createRoom({ name: "周末开黑房", creatorId: "u-host" });
    expect(statusCode).toBe(201);
    expect(room).toBeDefined();
    expect(room!.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(room!.code).not.toMatch(/[01IO]/);
    expect(room!.id).toBe(`social:${room!.code}`);
    expect(room!.name).toBe("周末开黑房");
    expect(room!.scene).toBe("plaza");
    expect(room!.maxPlayers).toBe(16);
    expect(room!.isPublic).toBe(true);
    expect(room!.playerCount).toBe(0);
    expect(typeof room!.createdAt).toBe("string");
  });

  it("创建私有房间：不出现在公开列表", async () => {
    await createRoom({ name: "公开房A" });
    await createRoom({ name: "私密房", isPublic: false });
    const res = await app.inject({ method: "GET", url: "/api/rooms" });
    const json = res.json() as { rooms: SocialRoom[] };
    expect(json.rooms.some((r) => r.name === "私密房")).toBe(false);
    expect(json.rooms.some((r) => r.name === "公开房A")).toBe(true);
  });

  it("公开列表按 createdAt 倒序、playerCount 实时同步", async () => {
    await createRoom({ name: "旧房" });
    await new Promise((r) => setTimeout(r, 5));
    await createRoom({ name: "新房" });
    const res = await app.inject({ method: "GET", url: "/api/rooms" });
    const json = res.json() as { rooms: SocialRoom[] };
    expect(json.rooms.length).toBe(2);
    expect(json.rooms[0].name).toBe("新房");
    expect(json.rooms[1].name).toBe("旧房");
    for (const r of json.rooms) expect(r.playerCount).toBe(0);
  });

  it("GET /api/rooms/:code 命中与 404", async () => {
    const { room } = await createRoom({ name: "详情房" });
    const hit = await app.inject({ method: "GET", url: `/api/rooms/${room!.code}` });
    expect(hit.statusCode).toBe(200);
    expect((hit.json() as { room: SocialRoom }).room.code).toBe(room!.code);

    const miss = await app.inject({ method: "GET", url: "/api/rooms/NOPEXX" });
    expect(miss.statusCode).toBe(404);
    expect((miss.json() as { error: string }).error).toBe("room not found");
  });

  it("房间码唯一：连续创建 50 个不重复", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const { room } = await createRoom({ name: `房${i}` });
      expect(room).toBeDefined();
      codes.add(room!.code);
    }
    expect(codes.size).toBe(50);
  });

  it("WS social 房间：收到 room_info，第二人加入后 player_update=2，断开后=1", async () => {
    const { room } = await createRoom({ name: "联机房" });
    const roomId = `social:${room!.code}`;

    const a = await connect(base, "uA", roomId);
    const infoA = await a.waitFor("room_info");
    expect((infoA.room as SocialRoom).code).toBe(room!.code);
    expect((infoA.room as SocialRoom).playerCount).toBe(1);
    // 自己加入也会触发一次全员广播 player_update=1，先 drain 掉
    const selfUpd = await a.waitFor("room_player_update");
    expect(selfUpd.playerCount).toBe(1);

    const b = await connect(base, "uB", roomId);
    const infoB = await b.waitFor("room_info");
    expect((infoB.room as SocialRoom).playerCount).toBe(2);

    // 第一人收到人数更新=2
    const updA = await a.waitFor("room_player_update");
    expect(updA.roomId).toBe(roomId);
    expect(updA.playerCount).toBe(2);

    // 第二人断开 → 第一人收到人数=1
    b.ws.close();
    const updA2 = await a.waitFor("room_player_update");
    expect(updA2.playerCount).toBe(1);

    a.ws.close();
  });

  it("人数上限拒绝：maxPlayers=1 时第二人连接被拒", async () => {
    const { room } = await createRoom({ name: "满员房", maxPlayers: 1 });
    const roomId = `social:${room!.code}`;

    const a = await connect(base, "uA", roomId);
    await a.waitFor("room_info");

    const errMsg = await expectRejected(base, "uB", roomId);
    expect(errMsg).toContain("满");

    a.ws.close();
  });

  it("无效房间码连接被拒", async () => {
    const errMsg = await expectRejected(base, "uGhost", "social:NOTREAL");
    expect(errMsg).toContain("不存在");
  });
});
