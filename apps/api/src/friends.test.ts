// ===== Round4 R4-07: 好友系统测试 =====
// 每个文件用独立临时 SQLite（DB_PATH）+ 动态 import，避免与其它测试并行时 database is locked。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

type FriendsMod = typeof import("./friends.js");
type DbMod = typeof import("./db.js");

let friends: FriendsMod;
let db: DbMod;
let tmpDir: string;

/** 捕获发往各用户的 WS 消息。 */
const online = new Set<string>();
const presenceRoom = new Map<string, string>();
const inbox = new Map<string, unknown[]>();

async function loadModules(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-friends-"));
  process.env.DB_PATH = join(tmpDir, "test.db");
  process.env.BALABALA_TEST_DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("./db.js");
  friends = await import("./friends.js");
  friends.setPresenceProvider({
    isOnline: (uid) => online.has(uid),
    getSocialRoomCode: (uid) => (online.has(uid) ? presenceRoom.get(uid) : undefined),
    sendToUser: (uid, msg) => {
      const list = inbox.get(uid) ?? [];
      list.push(msg);
      inbox.set(uid, list);
    },
  });
}

beforeEach(async () => {
  online.clear();
  presenceRoom.clear();
  inbox.clear();
  await loadModules();
  friends._resetFriendsForTest();
  db.upsertUser({ userId: "u1", nickname: "小明", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u2", nickname: "小红", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u3", nickname: "小刚", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.DB_PATH;
  delete process.env.BALABALA_TEST_DATA_DIR;
});

describe("好友请求", () => {
  it("发送请求创建 pending 记录", () => {
    const req = friends.sendRequest("u1", "u2", "一起玩吗");
    expect(req.status).toBe("pending");
    expect(req.fromUserId).toBe("u1");
    expect(req.toUserId).toBe("u2");
    expect(req.message).toBe("一起玩吗");
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "friend_request" });
  });

  it("重复发送同一请求返回 409", () => {
    friends.sendRequest("u1", "u2");
    expect(() => friends.sendRequest("u1", "u2")).toThrowError(/待处理/);
    try { friends.sendRequest("u1", "u2"); } catch (e: any) {
      expect(e.statusCode).toBe(409);
    }
  });

  it("反方向已有 pending 请求也返回 409", () => {
    friends.sendRequest("u2", "u1");
    expect(() => friends.sendRequest("u1", "u2")).toThrowError(/待处理/);
  });

  it("给自己发请求返回 400", () => {
    expect(() => friends.sendRequest("u1", "u1")).toThrowError(/自己/);
  });

  it("接受请求后双方建立好友关系", () => {
    const req = friends.sendRequest("u1", "u2");
    const accepted = friends.acceptRequest(req.requestId, "u2");
    expect(accepted.status).toBe("accepted");
    expect(friends.areFriends("u1", "u2")).toBe(true);
    expect(friends.areFriends("u2", "u1")).toBe(true);
    expect(inbox.get("u1")?.at(-1)).toMatchObject({ type: "friend_request_handled", status: "accepted" });
  });

  it("接受不存在的请求返回 404", () => {
    expect(() => friends.acceptRequest("nope", "u2")).toThrowError(/不存在/);
  });

  it("非接收人接受请求返回 403", () => {
    const req = friends.sendRequest("u1", "u2");
    expect(() => friends.acceptRequest(req.requestId, "u3")).toThrowError(/只能处理/);
  });

  it("重复接受已处理请求返回 409", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    expect(() => friends.acceptRequest(req.requestId, "u2")).toThrowError(/已被处理/);
  });

  it("拒绝请求标记为 rejected，不建立关系", () => {
    const req = friends.sendRequest("u1", "u2");
    const rejected = friends.rejectRequest(req.requestId, "u2");
    expect(rejected.status).toBe("rejected");
    expect(friends.areFriends("u1", "u2")).toBe(false);
    expect(inbox.get("u1")?.at(-1)).toMatchObject({ type: "friend_request_handled", status: "rejected" });
  });
});

describe("好友列表与删除", () => {
  it("getFriends 返回好友列表（含昵称）", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    const list = friends.getFriends("u1");
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe("u2");
    expect(list[0].nickname).toBe("小红");
  });

  it("删除好友后双向解除关系并通知对方", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    friends.removeFriend("u1", "u2");
    expect(friends.areFriends("u1", "u2")).toBe(false);
    expect(friends.getFriends("u1")).toHaveLength(0);
    expect(inbox.get("u2")?.at(-1)).toMatchObject({ type: "friend_removed", userId: "u1" });
  });

  it("删除非好友返回 404", () => {
    expect(() => friends.removeFriend("u1", "u3")).toThrowError(/不是好友/);
  });

  it("getRequests 返回发给我的 pending 请求", () => {
    friends.sendRequest("u1", "u2");
    friends.sendRequest("u3", "u2");
    const list = friends.getRequests("u2");
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.toUserId === "u2" && r.status === "pending")).toBe(true);
  });
});

describe("在线状态", () => {
  it("上线时通知好友 friend_online（含房间码）", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    inbox.set("u1", []);
    online.add("u2");
    presenceRoom.set("u2", "ABC123");
    friends.notifyUserOnline("u2", "ABC123");
    expect(inbox.get("u1")?.[0]).toMatchObject({ type: "friend_online", userId: "u2", roomCode: "ABC123" });
  });

  it("下线时通知好友 friend_offline", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    inbox.set("u1", []);
    online.add("u2");
    friends.notifyUserOffline("u2");
    expect(inbox.get("u1")?.[0]).toMatchObject({ type: "friend_offline", userId: "u2" });
  });
});

describe("邀请进房", () => {
  it("邀请好友发送 friend_invite 通知", () => {
    const req = friends.sendRequest("u1", "u2");
    friends.acceptRequest(req.requestId, "u2");
    inbox.set("u2", []);
    const invite = friends.sendInvite("u1", "u2", "ROOM1");
    expect(invite.roomCode).toBe("ROOM1");
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "friend_invite" });
  });

  it("邀请非好友返回 403", () => {
    expect(() => friends.sendInvite("u1", "u3", "ROOM1")).toThrowError(/只能邀请好友/);
  });
});

describe("REST 路由", () => {
  it("完整 REST 流程：request → accept → list → delete", async () => {
    const app = Fastify();
    friends.registerFriendRoutes(app);
    await app.ready();

    const r1 = await app.inject({ method: "POST", url: "/api/friends/request", payload: { fromUserId: "u1", toUserId: "u2" } });
    expect(r1.statusCode).toBe(201);
    const requestId = r1.json<{ request: { requestId: string } }>().request.requestId;

    const dup = await app.inject({ method: "POST", url: "/api/friends/request", payload: { fromUserId: "u1", toUserId: "u2" } });
    expect(dup.statusCode).toBe(409);

    const acc = await app.inject({ method: "POST", url: "/api/friends/accept", payload: { requestId, userId: "u2" } });
    expect(acc.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/friends/u1" });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ friends: unknown[] }>().friends).toHaveLength(1);

    const del = await app.inject({ method: "DELETE", url: "/api/friends/u1?friendId=u2" });
    expect(del.statusCode).toBe(200);
    await app.close();
  });
});
