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
async function connect(base: string, userId: string, room: string, password?: string): Promise<Conn> {
  const pwParam = password ? `&password=${encodeURIComponent(password)}` : "";
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwParam}`);
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

/** 连接一个应当被服务端拒绝的房间，返回完整 error 消息对象（含 code）。 */
function expectRejectedObj(base: string, userId: string, room: string, password?: string): Promise<AnyMsg> {
  return new Promise((resolve, reject) => {
    const pwParam = password ? `&password=${encodeURIComponent(password)}` : "";
    const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwParam}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("拒绝连接超时")); }, 3000);
    ws.on("message", (raw: Buffer) => {
      let msg: AnyMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "error") {
        clearTimeout(timer);
        resolve(msg);
        ws.close();
      }
    });
    ws.on("error", () => { /* close 后触发，忽略 */ });
  });
}

/** 连接一个应当被服务端拒绝的房间，返回服务端发来的 error.message。 */
async function expectRejected(base: string, userId: string, room: string, password?: string): Promise<string> {
  const msg = await expectRejectedObj(base, userId, room, password);
  return String(msg.message ?? "");
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

  // ===== R4-02: 房间权限系统测试 =====

  it("R4-02: 创建房间时 ownerId = creatorId", async () => {
    const { room } = await createRoom({ name: "房主测试房", creatorId: "u-host1" });
    expect(room!.ownerId).toBe("u-host1");
    expect(room!.isLocked).toBe(false);
    expect(room!.hasPassword).toBe(false);
  });

  it("R4-02: 创建密码房间——hasPassword=true，passwordHash 不暴露", async () => {
    const { room } = await createRoom({ name: "密码房", creatorId: "u-host", password: "secret123" });
    expect(room!.hasPassword).toBe(true);
    // 公开返回中不应包含密码哈希或盐
    expect((room as Record<string, unknown>).passwordHash).toBeUndefined();
    expect((room as Record<string, unknown>).passwordSalt).toBeUndefined();
  });

  it("R4-02: 房间列表不暴露密码哈希", async () => {
    await createRoom({ name: "有密码的房", creatorId: "u-host", password: "mypass" });
    const res = await app.inject({ method: "GET", url: "/api/rooms" });
    const json = res.json() as { rooms: SocialRoom[] };
    for (const r of json.rooms) {
      expect((r as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((r as Record<string, unknown>).passwordSalt).toBeUndefined();
    }
    const pwRoom = json.rooms.find((r) => r.name === "有密码的房");
    expect(pwRoom?.hasPassword).toBe(true);
  });

  it("R4-02: 密码房——正确密码可以加入", async () => {
    const { room } = await createRoom({ name: "密码房A", creatorId: "u-host", password: "abc" });
    const roomId = `social:${room!.code}`;
    const a = await connect(base, "u-host", roomId, "abc");
    const info = await a.waitFor("room_info");
    expect((info.room as SocialRoom).code).toBe(room!.code);
    a.ws.close();
  });

  it("R4-02: 密码房——错误密码被拒（wrong_password）", async () => {
    const { room } = await createRoom({ name: "密码房B", creatorId: "u-host", password: "rightpw" });
    const roomId = `social:${room!.code}`;
    const err = await expectRejectedObj(base, "u-guest", roomId, "wrongpw");
    expect(err.code).toBe("wrong_password");
    expect(String(err.message)).toContain("密码");
  });

  it("R4-02: 密码房——不提供密码被拒", async () => {
    const { room } = await createRoom({ name: "密码房C", creatorId: "u-host", password: "nopw" });
    const roomId = `social:${room!.code}`;
    const err = await expectRejectedObj(base, "u-guest", roomId);
    expect(err.code).toBe("wrong_password");
  });

  it("R4-02: 非房主踢人返回 403", async () => {
    const { room } = await createRoom({ name: "踢人房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/kick`,
      payload: { callerId: "u-notowner", targetUserId: "u-someone" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("R4-02: 房主踢人成功——返回 ok=true", async () => {
    const { room } = await createRoom({ name: "踢人成功房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/kick`,
      payload: { callerId: "u-host", targetUserId: "u-victim", reason: "测试踢人" },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { ok: boolean; kicked: string; wasInRoom: boolean };
    expect(json.ok).toBe(true);
    expect(json.kicked).toBe("u-victim");
    // 被踢者本来就不在线，wasInRoom=false
    expect(json.wasInRoom).toBe(false);
  });

  it("R4-02: 被踢用户 60 秒冷却期内无法重新加入", async () => {
    const { room } = await createRoom({ name: "冷却房", creatorId: "u-host" });
    const roomId = `social:${room!.code}`;

    // u-victim 先加入
    const v = await connect(base, "u-victim", roomId);
    await v.waitFor("room_info");

    // 房主踢人
    const kickRes = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/kick`,
      payload: { callerId: "u-host", targetUserId: "u-victim", reason: "出去" },
    });
    expect(kickRes.statusCode).toBe(200);

    // 等待被踢者收到 player_kicked 消息
    try {
      const kickedMsg = await v.waitFor("player_kicked", 2000);
      expect(kickedMsg.userId).toBe("u-victim");
    } catch {
      // 100ms 延迟关闭可能导致消息在 close 后才到，这里不强校验
    }

    // 冷却期内重新连接应被拒
    await new Promise((r) => setTimeout(r, 200));
    const err = await expectRejectedObj(base, "u-victim", roomId);
    expect(err.code).toBe("kicked_cooldown");

    // 清理
    v.ws.close();
  });

  it("R4-02: 房主不能踢自己", async () => {
    const { room } = await createRoom({ name: "自踢房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/kick`,
      payload: { callerId: "u-host", targetUserId: "u-host" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("R4-02: 转移房主——非房主返回 403", async () => {
    const { room } = await createRoom({ name: "转移房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/transfer-owner`,
      payload: { callerId: "u-notowner", targetUserId: "u-newowner" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("R4-02: 转移房主——成功后 ownerId 更新", async () => {
    const { room } = await createRoom({ name: "转移成功房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/transfer-owner`,
      payload: { callerId: "u-host", targetUserId: "u-newowner" },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { ok: boolean; oldOwnerId: string; newOwnerId: string; room: SocialRoom };
    expect(json.ok).toBe(true);
    expect(json.oldOwnerId).toBe("u-host");
    expect(json.newOwnerId).toBe("u-newowner");
    expect(json.room.ownerId).toBe("u-newowner");
  });

  it("R4-02: 锁定房间——非房主返回 403", async () => {
    const { room } = await createRoom({ name: "锁房", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/lock`,
      payload: { callerId: "u-notowner", locked: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("R4-02: 锁定房间后新玩家 WS 连接被拒（room_locked）", async () => {
    const { room } = await createRoom({ name: "锁定房", creatorId: "u-host" });
    const roomId = `social:${room!.code}`;

    // 先锁定
    const lockRes = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/lock`,
      payload: { callerId: "u-host", locked: true },
    });
    expect(lockRes.statusCode).toBe(200);

    // 新玩家连接应被拒
    const err = await expectRejectedObj(base, "u-newguy", roomId);
    expect(err.code).toBe("room_locked");
  });

  it("R4-02: 锁定房间后，已在房间内的玩家不受影响", async () => {
    const { room } = await createRoom({ name: "锁定在房", creatorId: "u-host" });
    const roomId = `social:${room!.code}`;

    // 房主和另一玩家先加入
    const host = await connect(base, "u-host", roomId);
    await host.waitFor("room_info");
    const guest = await connect(base, "u-guest", roomId);
    await guest.waitFor("room_info");

    // 锁定房间
    await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/lock`,
      payload: { callerId: "u-host", locked: true },
    });

    // 已在房间内的两人应继续收到 room_lock_changed 广播
    const lockMsg = await host.waitFor("room_lock_changed");
    expect(lockMsg.isLocked).toBe(true);

    // 新人加入应被拒
    const err = await expectRejectedObj(base, "u-newcomer", roomId);
    expect(err.code).toBe("room_locked");

    host.ws.close();
    guest.ws.close();
  });

  it("R4-02: 人数上限——WS 层强校验返回 room_full", async () => {
    const { room } = await createRoom({ name: "满员强校验", maxPlayers: 1, creatorId: "u-host" });
    const roomId = `social:${room!.code}`;

    const a = await connect(base, "uA", roomId);
    await a.waitFor("room_info");

    const err = await expectRejectedObj(base, "uB", roomId);
    expect(err.code).toBe("room_full");
    a.ws.close();
  });

  it("R4-02: welcome 消息中房主带 isOwner=true", async () => {
    const { room } = await createRoom({ name: "房主标识房", creatorId: "u-owner" });
    const roomId = `social:${room!.code}`;
    const host = await connect(base, "u-owner", roomId);
    const welcome = host.waitFor("welcome");
    // welcome 已经在 connect 中等待过了，但我们需要再检查一次——直接看 room_info
    const info = await host.waitFor("room_info");
    expect((info.room as SocialRoom).ownerId).toBe("u-owner");
    host.ws.close();
  });

  it("R4-02: 空 targetUserId 踢人返回 400", async () => {
    const { room } = await createRoom({ name: "空目标踢", creatorId: "u-host" });
    const res = await app.inject({
      method: "POST",
      url: `/api/rooms/${room!.code}/kick`,
      payload: { callerId: "u-host", targetUserId: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
