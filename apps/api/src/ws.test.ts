// ===== ws.ts 纯逻辑测试：房间广播过滤 / 视角隔离，不启动真实 WS 服务器 =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

type WsModule = typeof import("./ws.js");
type DbModule = typeof import("./db.js");

/** 构造一个不真正联网的假 WebSocket。 */
function fakeSocket() {
  return {
    readyState: 1, // WebSocket.OPEN
    OPEN: 1,       // ws.safeSend 里用 socket.OPEN 判定
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

async function loadWs(): Promise<{ mod: WsModule; dbmod: DbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-ws-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./ws.js");
  // 与 ws.js 共享同一 db 模块实例（resetModules 后同一注册表）。
  const dbmod = await import("./db.js");
  return { mod, dbmod, dir };
}

function makeRoomUser(mod: WsModule, userId: string, socket: ReturnType<typeof fakeSocket>) {
  return {
    userId,
    nickname: userId,
    avatarType: "capsule" as const,
    avatarRef: "",
    x: 0, z: 0, rotation: 0, lastMove: 0,
    socket: socket as unknown as WebSocket,
  };
}

describe("ws 房间纯逻辑", () => {
  let ctx: { mod: WsModule; dbmod: DbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadWs();
  });

  afterAll(() => {
    try {
      ctx.dbmod.db.close();
    } catch {
      // ignore
    }
    delete process.env.DB_PATH;
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄可能延迟释放
    }
  });

  it("isValidRoom：合法/非法房间前缀判定", () => {
    expect(ctx.mod.isValidRoom("plaza")).toBe(true);
    expect(ctx.mod.isValidRoom("court:case-1")).toBe(true);
    expect(ctx.mod.isValidRoom("talkshow:abc")).toBe(true);
    expect(ctx.mod.isValidRoom("bar:room1")).toBe(true);
    expect(ctx.mod.isValidRoom("library:room1")).toBe(true);
    expect(ctx.mod.isValidRoom("werewolf:game1")).toBe(true);
    expect(ctx.mod.isValidRoom("court")).toBe(false);
    expect(ctx.mod.isValidRoom("random")).toBe(false);
    expect(ctx.mod.isValidRoom("")).toBe(false);
  });

  it("broadcastToRoom：向房间内所有在线用户发送同一消息", () => {
    ctx.mod._resetRoomsForTest();
    const room = ctx.mod.getOrCreateRoom("plaza");
    const sA = fakeSocket();
    const sB = fakeSocket();
    room.users.set("uA", makeRoomUser(ctx.mod, "uA", sA));
    room.users.set("uB", makeRoomUser(ctx.mod, "uB", sB));

    ctx.mod.broadcastToRoom("plaza", { type: "chat", text: "hi" });

    expect(sA.send).toHaveBeenCalledTimes(1);
    expect(sB.send).toHaveBeenCalledTimes(1);
    const payloadA = JSON.parse(sA.send.mock.calls[0][0] as string);
    expect(payloadA).toEqual({ type: "chat", text: "hi" });
  });

  it("广播隔离：A 房间的广播不会到达 B 房间用户", () => {
    ctx.mod._resetRoomsForTest();
    const roomA = ctx.mod.getOrCreateRoom("plaza");
    const roomB = ctx.mod.getOrCreateRoom("court:case-9");
    const sA = fakeSocket();
    const sB = fakeSocket();
    roomA.users.set("uA", makeRoomUser(ctx.mod, "uA", sA));
    roomB.users.set("uB", makeRoomUser(ctx.mod, "uB", sB));

    ctx.mod.broadcastToRoom("plaza", { type: "chat", text: "only plaza" });

    expect(sA.send).toHaveBeenCalledTimes(1);
    expect(sB.send).not.toHaveBeenCalled();
  });

  it("sendToUserInRoom：私密消息只发给目标用户，其他人收不到", () => {
    ctx.mod._resetRoomsForTest();
    const room = ctx.mod.getOrCreateRoom("werewolf:g1");
    const sA = fakeSocket();
    const sB = fakeSocket();
    room.users.set("uA", makeRoomUser(ctx.mod, "uA", sA));
    room.users.set("uB", makeRoomUser(ctx.mod, "uB", sB));

    ctx.mod.sendToUserInRoom("werewolf:g1", "uA", {
      type: "werewolf_snapshot",
      snapshot: { gameId: "g1", phase: "night", day: 1, players: [], winner: null, lastNightDeaths: [], log: [] },
    } as never);

    expect(sA.send).toHaveBeenCalledTimes(1);
    expect(sB.send).not.toHaveBeenCalled();
    const payload = JSON.parse(sA.send.mock.calls[0][0] as string);
    expect(payload.type).toBe("werewolf_snapshot");
  });

  it("sendToUserInRoom：房间或用户不存在时静默不抛错", () => {
    ctx.mod._resetRoomsForTest();
    expect(() => ctx.mod.sendToUserInRoom("no-such-room", "uX", { type: "pong" } as never)).not.toThrow();
    const room = ctx.mod.getOrCreateRoom("plaza");
    const sA = fakeSocket();
    room.users.set("uA", makeRoomUser(ctx.mod, "uA", sA));
    expect(() => ctx.mod.sendToUserInRoom("plaza", "ghost", { type: "pong" } as never)).not.toThrow();
    expect(sA.send).not.toHaveBeenCalled();
  });

  it("法庭房间：getOrCreateRoom 自动初始化 courtState，updateCourtState 局部更新", () => {
    ctx.mod._resetRoomsForTest();
    const before = ctx.mod.getCourtState("case-1");
    expect(before).toBeUndefined();

    ctx.mod.updateCourtState("case-1", { phase: "config" });
    const created = ctx.mod.getCourtState("case-1")!;
    expect(created).toBeDefined();
    expect(created.caseId).toBe("case-1");
    expect(created.votes).toEqual({ plaintiff: 0, defendant: 0 });

    ctx.mod.updateCourtState("case-1", { currentStage: "verdict" });
    const after = ctx.mod.getCourtState("case-1")!;
    expect(after.currentStage).toBe("verdict");
    // 未被覆盖的字段保留。
    expect(after.votes).toEqual({ plaintiff: 0, defendant: 0 });
  });

  it("场景房间：updateSceneState / getSceneState 回读", () => {
    ctx.mod._resetRoomsForTest();
    ctx.mod.updateSceneState("bar", "sess-1", { phase: "playing", participants: 3 });
    const state = ctx.mod.getSceneState("bar", "sess-1")!;
    expect(state.scene).toBe("bar");
    expect(state.sessionId).toBe("sess-1");
    expect(state.phase).toBe("playing");
    expect(state.participants).toBe(3);
  });

  it("broadcastSceneEvent：以 scene_event 类型向场景房间广播", () => {
    ctx.mod._resetRoomsForTest();
    const room = ctx.mod.getOrCreateRoom("bar:sess-1");
    const sA = fakeSocket();
    room.users.set("uA", makeRoomUser(ctx.mod, "uA", sA));

    ctx.mod.broadcastSceneEvent("bar", "sess-1", { text: "new song" });

    expect(sA.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sA.send.mock.calls[0][0] as string);
    expect(payload.type).toBe("scene_event");
    expect(payload.scene).toBe("bar");
    expect(payload.event).toEqual({ text: "new song" });
  });
});
