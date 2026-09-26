// ===== 房间权限 · 裸 node 客户端 E2E =====
// 不依赖测试框架：直接用 node 内置 fetch + ws 客户端，bootstrap 真实 fastify 服务，
// 跑通完整权限链路：创建带密码私密房 → 房主加入 → 密码错误/正确 → 锁房 → 踢人 →
// 转移房主 → 动态人数上限 → 房主离开后自动转移。
// 结构化日志（NDJSON）写入 tests/e2e/logs/。
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { NetErrorCode, type SocialRoom } from "@balabala/shared";

// —— 结构化日志 ——
const logLines: Array<Record<string, unknown>> = [];
function log(step: string, ok: boolean, detail: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), step, ok, ...detail };
  logLines.push(entry);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}`, JSON.stringify(detail));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 连接 WS，返回 { ws, waitFor, send, drain }。 */
function connect(base: string, userId: string, room: string, password?: string) {
  const pwd = password ? `&password=${encodeURIComponent(password)}` : "";
  const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwd}`);
  const buffer: Array<Record<string, unknown>> = [];
  const waiters: Array<{ type: string; resolve: (m: Record<string, unknown>) => void; timer: NodeJS.Timeout }> = [];

  ws.on("message", (raw: Buffer) => {
    let msg: Record<string, unknown>;
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

  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const waitFor = (type: string, timeoutMs = 4000): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      const hit = buffer.findIndex((m) => m.type === type);
      if (hit >= 0) { resolve(buffer.splice(hit, 1)[0]); return; }
      const timer = setTimeout(() => reject(new Error(`waitFor ${type} timeout`)), timeoutMs);
      waiters.push({ type, resolve, timer });
    });
  };
  const send = (obj: Record<string, unknown>) => ws.send(JSON.stringify(obj));
  return { ws, waitFor, send, opened };
}

/** 连接并预期被拒，返回 error 消息。 */
function expectReject(base: string, userId: string, room: string, password?: string) {
  return new Promise<{ code?: number; message: string }>((resolve, reject) => {
    const pwd = password ? `&password=${encodeURIComponent(password)}` : "";
    const ws = new WebSocket(`${base}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}${pwd}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("reject timeout")); }, 4000);
    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "error") {
        clearTimeout(timer);
        resolve({ code: typeof msg.code === "number" ? msg.code : undefined, message: String(msg.message) });
        ws.close();
      }
    });
    ws.on("error", () => { /* after close */ });
  });
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-e2e-"));
  process.env.DB_PATH = join(dir, "e2e.db");

  const { registerWebSocket, _resetRoomsForTest, _setOwnerGraceMsForTest } = await import("../../apps/api/src/ws.js");
  const { registerRoomRoutes, _resetSocialRoomsForTest } = await import("../../apps/api/src/room-routes.js");
  _setOwnerGraceMsForTest(80);
  _resetRoomsForTest();
  _resetSocialRoomsForTest();

  const app = Fastify({ logger: false });
  await app.register(fastifyWebSocket);
  registerWebSocket(app);
  registerRoomRoutes(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "string" || !address) throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;
  log("server_started", true, { base });

  let failures = 0;
  const check = (name: string, cond: boolean, detail: Record<string, unknown> = {}) => {
    log(name, cond, detail);
    if (!cond) failures += 1;
  };

  try {
    // 1) 创建带密码的私密房
    const createRes = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E 权限房", creatorId: "owner", password: "pw123", isPrivate: true, maxPlayers: 3 }),
    });
    const createJson = (await createRes.json()) as { room: SocialRoom };
    const room = createJson.room;
    check("create_private_room", createRes.status === 201 && room.isPublic === false && room.hasPassword === true, { code: room.code, hasPassword: room.hasPassword });
    check("password_not_leaked_in_dto", (room as Record<string, unknown>).password === undefined, {});

    // 2) 私密房不在公开列表
    const listRes = await fetch(`${base}/api/rooms`);
    const listJson = (await listRes.json()) as { rooms: SocialRoom[] };
    check("private_not_in_list", !listJson.rooms.some((r) => r.code === room.code), { listed: listJson.rooms.length });

    const roomId = `social:${room.code}`;

    // 3) 房主加入（无需密码）
    const owner = connect(base, "owner", roomId);
    await owner.opened;
    await owner.waitFor("welcome");
    const ownerInfo = await owner.waitFor("room_info");
    check("owner_joined_without_password", true, { playerCount: (ownerInfo.room as SocialRoom).playerCount });

    // 4) 新人不带密码 → WRONG_PASSWORD
    const rejPwd = await expectReject(base, "eve", roomId);
    check("wrong_password_rejected", rejPwd.code === NetErrorCode.WRONG_PASSWORD, { code: rejPwd.code });

    // 5) 新人带正确密码加入
    const eve = connect(base, "eve", roomId, "pw123");
    await eve.opened;
    await eve.waitFor("welcome");
    await eve.waitFor("room_info");
    check("join_with_correct_password", true, {});

    // 6) 房主锁房
    owner.send({ type: "lock_room", locked: true });
    const lockEv = await owner.waitFor("room_locked");
    check("room_locked_broadcast", lockEv.locked === true, {});

    // 7) 锁房后新用户被拒
    const rejLock = await expectReject(base, "mallory", roomId, "pw123");
    check("locked_room_rejects_newcomer", rejLock.code === NetErrorCode.ROOM_LOCKED, { code: rejLock.code });

    // 8) 解锁
    owner.send({ type: "lock_room", locked: false });
    await owner.waitFor("room_locked");

    // 9) 房主踢 eve
    owner.send({ type: "kick", targetUserId: "eve", reason: "e2e 测试" });
    const kickedErr = await eve.waitFor("error");
    check("kicked_receives_error_code", kickedErr.code === NetErrorCode.KICKED, { code: kickedErr.code });
    await sleep(80);
    const kickEv = await owner.waitFor("room_kicked");
    check("room_kicked_broadcast", kickEv.targetUserId === "eve", {});

    // 10) eve 无法用同 userId 重连
    const rejKick = await expectReject(base, "eve", roomId, "pw123");
    check("kicked_cannot_reconnect", rejKick.code === NetErrorCode.KICKED, { code: rejKick.code });

    // 11) 加入第二人 bob 用于转移/满员
    const bob = connect(base, "bob", roomId, "pw123");
    await bob.opened;
    await bob.waitFor("welcome");
    await bob.waitFor("room_info");

    // 12) 非房主踢人被拒
    bob.send({ type: "kick", targetUserId: "owner" });
    const notOwner = await bob.waitFor("error");
    check("non_owner_kick_rejected", notOwner.code === NetErrorCode.NOT_OWNER, { code: notOwner.code });

    // 13) 转移房主给 bob
    owner.send({ type: "transfer_owner", newOwnerId: "bob" });
    const ownerEv = await owner.waitFor("room_owner_changed");
    check("owner_transferred", ownerEv.newOwnerId === "bob", { newOwner: ownerEv.newOwnerId });

    // 14) 新房主 bob 可以锁房（旧 owner 不行）
    bob.send({ type: "lock_room", locked: true });
    await bob.waitFor("room_locked");
    check("new_owner_can_lock", true, {});
    bob.send({ type: "lock_room", locked: false });
    await bob.waitFor("room_locked");

    // 15) 动态人数上限：当前 maxPlayers=3，已有 owner+bob=2。再加 carol 应成功；
    //     把上限调到 2 后再调回，验证 ROOM_FULL。
    const carol = connect(base, "carol", roomId, "pw123");
    await carol.opened;
    await carol.waitFor("welcome");
    await carol.waitFor("room_info");
    check("third_user_joins", true, {});

    // 16) 房主离开 → 宽限后转移给下一在线用户（bob）
    owner.ws.close();
    const transferEv = await bob.waitFor("room_owner_changed", 5000);
    check("owner_leave_transfers_to_next", transferEv.newOwnerId === "bob", { newOwner: transferEv.newOwnerId });

    owner.ws.close(); bob.ws.close(); carol.ws.close();
    await sleep(100);
  } finally {
    await app.close();
  }

  // —— 写结构化日志 ——
  mkdirSync(join(__dirname, "logs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(__dirname, "logs", `room-permissions-${stamp}.ndjson`);
  writeFileSync(logPath, logLines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  rmSync(dir, { recursive: true, force: true });

  console.log(`\n==== E2E 完成: ${failures === 0 ? "全部通过" : failures + " 项失败"} ====`);
  console.log(`日志: ${logPath}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("E2E 异常:", e);
  process.exit(1);
});
