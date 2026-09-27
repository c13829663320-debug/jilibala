// ===== 房间权限分片 · 单元测试 =====
// 覆盖：踢人（房主/非房主/被踢后无法重连）、转移房主、锁房/解锁、私密房列表、
// 密码正确/错误、人数上限与动态调整、房主离开后转移新房主。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { NetErrorCode, type SocialRoom } from "@balabala/shared";

type AnyMsg = Record<string, unknown>;

interface Conn {
  ws: WebSocket;
  waitFor: (type: string, timeoutMs?: number) => Promise<AnyMsg>;
  send: (obj: Record<string, unknown>) => void;
}

/** 连接 WS 并缓冲早期消息；返回可等待指定 type 的连接。 */
async function connect(base: string, userId: string, room: string, password?: string): Promise<Conn> {
  const pwd = password ? `&password=${encodeURIComponent(password)}` : "";
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwd}`);
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

  const send = (obj: Record<string, unknown>) => ws.send(JSON.stringify(obj));

  await waitFor("welcome");
  return { ws, waitFor, send };
}

/** 连接一个应当被拒绝的房间，返回服务端发来的 error（含 code）。 */
function expectRejected(base: string, userId: string, room: string, password?: string): Promise<{ code?: number; message: string }> {
  return new Promise((resolve, reject) => {
    const pwd = password ? `&password=${encodeURIComponent(password)}` : "";
    const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwd}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("拒绝连接超时")); }, 3000);
    ws.on("message", (raw: Buffer) => {
      let msg: AnyMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "error") {
        clearTimeout(timer);
        resolve({ code: typeof msg.code === "number" ? msg.code : undefined, message: String(msg.message ?? "") });
        ws.close();
      }
    });
    ws.on("error", () => { /* close 后触发 */ });
  });
}

describe("房间权限分片", () => {
  let dir: string;
  let base: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let closeServer: (() => Promise<void>) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transport: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-perm-"));
    process.env.DB_PATH = join(dir, "test.db");
    const wsMod = await import("./ws.js");
    const { registerWebSocket, _resetRoomsForTest, _setOwnerGraceMsForTest, _resetTransportForTest } = wsMod;
    transport = wsMod.transport;
    const { registerRoomRoutes, _resetSocialRoomsForTest } = await import("./room-routes.js");
    // 用例里等待房主转移时只需要极短宽限（集成后由传输层引擎控制）。
    _setOwnerGraceMsForTest(60);
    transport.config.reconnectWindowMs = 50;
    // 注意：不缩短 heartbeatTimeoutMs——测试客户端不发 ping，
    // 手动 tick(now+1000) 会把所有活跃会话误判为超时并关闭其 socket。
    app = Fastify({ logger: false });
    await app.register(fastifyWebSocket);
    registerWebSocket(app);
    registerRoomRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || !address) throw new Error("无法获取监听端口");
    base = `http://127.0.0.1:${address.port}`;
    closeServer = async () => { await app.close(); };
    beforeEachReset = async () => {
      _resetRoomsForTest();
      _resetSocialRoomsForTest();
      _resetTransportForTest();
      transport.config.reconnectWindowMs = 50;
    };
  });

  let beforeEachReset: () => Promise<void> = async () => {};
  beforeEach(async () => { await beforeEachReset(); });

  afterAll(async () => {
    if (closeServer) await closeServer();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 句柄延迟 */ }
  });

  async function createRoom(body: Record<string, unknown>): Promise<{ statusCode: number; room?: SocialRoom; error?: string }> {
    const res = await app.inject({ method: "POST", url: "/api/rooms", payload: body });
    const json = res.json() as { room?: SocialRoom; error?: string };
    return { statusCode: res.statusCode, room: json.room, error: json.error };
  }

  it("创建房间带密码/私密/locked 默认 false；DTO 不含明文密码", async () => {
    const { room } = await createRoom({ name: "密码房", creatorId: "owner1", password: "s3cret", isPrivate: true });
    expect(room).toBeDefined();
    expect(room!.locked).toBe(false);
    expect(room!.hasPassword).toBe(true);
    expect(room!.isPublic).toBe(false);
    // 类型与运行时都不应泄露密码字段
    expect((room! as Record<string, unknown>).password).toBeUndefined();

    // 私密房不出现在公开列表
    const list = await app.inject({ method: "GET", url: "/api/rooms" });
    expect(((list.json() as { rooms: SocialRoom[] }).rooms.some((r) => r.code === room!.code))).toBe(false);

    // 详情接口仍可按 code 查到，且只暴露 hasPassword
    const detail = await app.inject({ method: "GET", url: `/api/rooms/${room!.code}` });
    const d = (detail.json() as { room: SocialRoom }).room;
    expect(d.hasPassword).toBe(true);
    expect((d as Record<string, unknown>).password).toBeUndefined();
  });

  it("密码预检 REST：正确 200 / 错误 403 / 无密码恒通过", async () => {
    const { room } = await createRoom({ name: "预检房", creatorId: "o", password: "pw123" });
    const ok = await app.inject({ method: "POST", url: `/api/rooms/${room!.code}/verify-password`, payload: { password: "pw123" } });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { ok: boolean }).ok).toBe(true);

    const bad = await app.inject({ method: "POST", url: `/api/rooms/${room!.code}/verify-password`, payload: { password: "nope" } });
    expect(bad.statusCode).toBe(403);

    const { room: openRoom } = await createRoom({ name: "无密码房", creatorId: "o" });
    const anyPwd = await app.inject({ method: "POST", url: `/api/rooms/${openRoom!.code}/verify-password`, payload: { password: "whatever" } });
    expect(anyPwd.statusCode).toBe(200);
  });

  it("WS 加入密码房：不带密码被拒 WRONG_PASSWORD，带正确密码放行", async () => {
    const { room } = await createRoom({ name: "密码联机房", creatorId: "ownerP", password: "hunter2" });
    const roomId = `social:${room!.code}`;

    // 房主连接不需要密码
    const owner = await connect(base, "ownerP", roomId);
    await owner.waitFor("room_info");

    // 新人不带密码 → WRONG_PASSWORD
    const rej = await expectRejected(base, "eve", roomId);
    expect(rej.code).toBe(NetErrorCode.WRONG_PASSWORD);

    // 新人带错误密码 → 同样 WRONG_PASSWORD
    const rej2 = await expectRejected(base, "eve", roomId, "wrong");
    expect(rej2.code).toBe(NetErrorCode.WRONG_PASSWORD);

    // 带正确密码 → 成功
    const eve = await connect(base, "eve", roomId, "hunter2");
    await eve.waitFor("room_info");

    owner.ws.close();
    eve.ws.close();
  });

  it("房主踢人：被踢者收到 KICKED 错误且无法用同 userId 重连", async () => {
    const { room } = await createRoom({ name: "踢人房", creatorId: "hostK", maxPlayers: 16 });
    const roomId = `social:${room!.code}`;
    const host = await connect(base, "hostK", roomId);
    await host.waitFor("room_info");
    const bob = await connect(base, "bob", roomId, "");
    await bob.waitFor("room_info");

    // 房主踢 bob
    host.send({ type: "kick", targetUserId: "bob", reason: "测试" });
    const kicked = await bob.waitFor("error");
    expect(kicked.code).toBe(NetErrorCode.KICKED);
    await new Promise((r) => setTimeout(r, 100));

    // 房主收到 room_kicked 广播
    const ev = await host.waitFor("room_kicked");
    expect(ev.targetUserId).toBe("bob");
    expect(ev.byUserId).toBe("hostK");

    // bob 用同 userId 重连被拒（KICKED）
    const rej = await expectRejected(base, "bob", roomId);
    expect(rej.code).toBe(NetErrorCode.KICKED);

    host.ws.close();
  });

  it("非房主踢人被拒（NOT_OWNER），目标不受影响", async () => {
    const { room } = await createRoom({ name: "非房主房", creatorId: "hostX" });
    const roomId = `social:${room!.code}`;
    const host = await connect(base, "hostX", roomId);
    await host.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");
    const carol = await connect(base, "carol", roomId);
    await carol.waitFor("room_info");

    // bob（普通成员）试图踢 carol
    bob.send({ type: "kick", targetUserId: "carol" });
    const err = await bob.waitFor("error");
    expect(err.code).toBe(NetErrorCode.NOT_OWNER);

    // carol 仍在房间：还能正常收到人数更新
    carol.send({ type: "ping" });
    await carol.waitFor("pong");

    host.ws.close();
    bob.ws.close();
    carol.ws.close();
  });

  it("转移房主：新房主获得权限，旧房主失去权限", async () => {
    const { room } = await createRoom({ name: "转移房", creatorId: "oldOwner" });
    const roomId = `social:${room!.code}`;
    const oldOwner = await connect(base, "oldOwner", roomId);
    await oldOwner.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");

    oldOwner.send({ type: "transfer_owner", newOwnerId: "bob" });
    const ev = await oldOwner.waitFor("room_owner_changed");
    expect(ev.oldOwnerId).toBe("oldOwner");
    expect(ev.newOwnerId).toBe("bob");
    // bob 也应收到同一广播
    const evBob = await bob.waitFor("room_owner_changed");
    expect(evBob.newOwnerId).toBe("bob");

    // 旧房主再操作 → NOT_OWNER
    oldOwner.send({ type: "lock_room", locked: true });
    const err = await oldOwner.waitFor("error");
    expect(err.code).toBe(NetErrorCode.NOT_OWNER);

    // 新房主可以锁房
    bob.send({ type: "lock_room", locked: true });
    const lockEv = await bob.waitFor("room_locked");
    expect(lockEv.locked).toBe(true);

    oldOwner.ws.close();
    bob.ws.close();
  });

  it("锁房后新连接被拒 ROOM_LOCKED，解锁后放行；房主与已在房用户可重连", async () => {
    const { room } = await createRoom({ name: "锁房", creatorId: "lockOwner", maxPlayers: 16 });
    const roomId = `social:${room!.code}`;
    const owner = await connect(base, "lockOwner", roomId);
    await owner.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");

    owner.send({ type: "lock_room", locked: true });
    const ev = await owner.waitFor("room_locked");
    expect(ev.locked).toBe(true);

    // 新用户 carol 被拒
    const rej = await expectRejected(base, "carol", roomId);
    expect(rej.code).toBe(NetErrorCode.ROOM_LOCKED);

    // 已在房的 bob 重连仍放行
    bob.ws.close();
    await new Promise((r) => setTimeout(r, 60));
    const bob2 = await connect(base, "bob", roomId);
    bob2.ws.close();

    // 解锁后 carol 可加入
    owner.send({ type: "lock_room", locked: false });
    await owner.waitFor("room_locked");
    const carol = await connect(base, "carol", roomId);
    await carol.waitFor("room_info");

    owner.ws.close();
    carol.ws.close();
  });

  it("设置/清除密码：广播 hasPassword，绝不泄露明文", async () => {
    const { room } = await createRoom({ name: "改密房", creatorId: "pwOwner" });
    const roomId = `social:${room!.code}`;
    const owner = await connect(base, "pwOwner", roomId);
    await owner.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");

    owner.send({ type: "set_password", password: "newpw" });
    const ev = await owner.waitFor("room_password_changed");
    expect(ev.hasPassword).toBe(true);
    // 广播里绝不能出现密码本身
    expect((ev as Record<string, unknown>).password).toBeUndefined();

    // 之后新人必须带密码
    const rej = await expectRejected(base, "eve", roomId);
    expect(rej.code).toBe(NetErrorCode.WRONG_PASSWORD);

    // 清除密码
    owner.send({ type: "set_password", password: null });
    const ev2 = await owner.waitFor("room_password_changed");
    expect(ev2.hasPassword).toBe(false);

    // 清除后新人无需密码即可加入
    const eve = await connect(base, "eve", roomId);
    await eve.waitFor("room_info");

    owner.ws.close();
    bob.ws.close();
    eve.ws.close();
  });

  it("动态调整人数上限：set_max_players 后原满员房可再进人", async () => {
    const { room } = await createRoom({ name: "扩容房", creatorId: "capOwner", maxPlayers: 1 });
    const roomId = `social:${room!.code}`;
    const owner = await connect(base, "capOwner", roomId);
    await owner.waitFor("room_info");

    // 第 2 人被拒 ROOM_FULL
    const rej = await expectRejected(base, "bob", roomId);
    expect(rej.code).toBe(NetErrorCode.ROOM_FULL);

    // 房主把上限调到 2
    owner.send({ type: "set_max_players", maxPlayers: 2 });
    const ev = await owner.waitFor("room_max_players_changed");
    expect(ev.maxPlayers).toBe(2);

    // 现在 bob 可以加入
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");

    owner.ws.close();
    bob.ws.close();
  });

  it("房主离开（宽限后）自动转移给下一位在线用户", async () => {
    const { room } = await createRoom({ name: "遗同房", creatorId: "leaver", maxPlayers: 16 });
    const roomId = `social:${room!.code}`;
    const leaver = await connect(base, "leaver", roomId);
    await leaver.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");
    const carol = await connect(base, "carol", roomId);
    await carol.waitFor("room_info");

    // 房主离开
    leaver.ws.close();

    // 手动推进传输层看门狗：宽限已设为 50ms，tick 到未来即触发 finalizeRemoval → 房主转移
    await new Promise((r) => setTimeout(r, 60));
    transport.tick(Date.now() + 1000);

    // 宽限后 bob（最早在线）收到 room_owner_changed
    const ev = await bob.waitFor("room_owner_changed", 3000);
    expect(ev.oldOwnerId).toBe("leaver");
    expect(ev.newOwnerId).toBe("bob");

    // 新房主 bob 现在可锁房（旧房主 leaver 已不在，验证权限落在 bob 身上）
    bob.send({ type: "lock_room", locked: true });
    const lockEv = await bob.waitFor("room_locked");
    expect(lockEv.locked).toBe(true);

    bob.ws.close();
    carol.ws.close();
  });

  it("房主在宽限期内重连：不转移房主", async () => {
    const { room } = await createRoom({ name: "重连房", creatorId: "quick", maxPlayers: 16 });
    const roomId = `social:${room!.code}`;
    const quick = await connect(base, "quick", roomId);
    await quick.waitFor("room_info");
    const bob = await connect(base, "bob", roomId);
    await bob.waitFor("room_info");

    // 房主短暂断开后立刻重连
    quick.ws.close();
    await new Promise((r) => setTimeout(r, 20)); // < 60ms 宽限
    const quick2 = await connect(base, "quick", roomId);
    await quick2.waitFor("room_info");

    // 等待超过宽限：不应发生转移
    await new Promise((r) => setTimeout(r, 150));
    // 房主仍可执行权限操作（仍为 owner）
    quick2.send({ type: "lock_room", locked: true });
    const lockEv = await quick2.waitFor("room_locked");
    expect(lockEv.locked).toBe(true);

    quick2.ws.close();
    bob.ws.close();
  });
});
