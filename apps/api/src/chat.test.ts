// ===== Round4 R4-07: 私聊测试 =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

type ChatMod = typeof import("./chat.js");
type FriendsMod = typeof import("./friends.js");
type DbMod = typeof import("./db.js");

let chat: ChatMod;
let friends: FriendsMod;
let db: DbMod;
let tmpDir: string;

const online = new Set<string>();
const inbox = new Map<string, unknown[]>();

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-chat-"));
  process.env.DB_PATH = join(tmpDir, "test.db");
  process.env.BALABALA_TEST_DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("./db.js");
  friends = await import("./friends.js");
  chat = await import("./chat.js");

  online.clear();
  inbox.clear();
  chat.setChatPresenceProvider({
    isOnline: (uid) => online.has(uid),
    sendToUser: (uid, msg) => {
      const list = inbox.get(uid) ?? [];
      list.push(msg);
      inbox.set(uid, list);
    },
  });

  db.upsertUser({ userId: "u1", nickname: "小明", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u2", nickname: "小红", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u3", nickname: "小刚", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });

  // u1 <-> u2 是好友
  const req = friends.sendRequest("u1", "u2");
  friends.acceptRequest(req.requestId, "u2");
  inbox.clear();
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.DB_PATH;
  delete process.env.BALABALA_TEST_DATA_DIR;
});

describe("私聊发送", () => {
  it("好友之间发送消息成功并持久化", () => {
    online.add("u2");
    const msg = chat.sendPrivateMessage("u1", "u2", "你好");
    expect(msg.fromUserId).toBe("u1");
    expect(msg.toUserId).toBe("u2");
    expect(msg.text).toBe("你好");
    expect(msg.messageId).toBeTruthy();
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "private_message" });
  });

  it("非好友发送被拒绝（403）", () => {
    online.add("u3");
    expect(() => chat.sendPrivateMessage("u1", "u3", "hi")).toThrowError(/不是好友/);
    try { chat.sendPrivateMessage("u1", "u3", "hi"); } catch (e: any) {
      expect(e.statusCode).toBe(403);
    }
  });

  it("给自己发消息返回 400", () => {
    expect(() => chat.sendPrivateMessage("u1", "u1", "hi")).toThrowError(/自己/);
  });

  it("空消息返回 400", () => {
    expect(() => chat.sendPrivateMessage("u1", "u2", "   ")).toThrowError(/不能为空/);
  });

  it("消息被截断到 1000 字", () => {
    online.add("u2");
    const long = "啊".repeat(2000);
    const msg = chat.sendPrivateMessage("u1", "u2", long);
    expect(msg.text.length).toBe(1000);
  });
});

describe("离线补发", () => {
  it("接收方离线时消息暂存，上线后补发", () => {
    online.delete("u2");
    chat.sendPrivateMessage("u1", "u2", "离线时发的");
    expect(inbox.get("u2")).toBeUndefined();

    online.add("u2");
    const flushed = chat.flushOfflineMessages("u2");
    expect(flushed).toHaveLength(1);
    expect(flushed[0].text).toBe("离线时发的");
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "offline_messages" });

    inbox.set("u2", []);
    expect(chat.flushOfflineMessages("u2")).toHaveLength(0);
  });
});

describe("历史查询", () => {
  it("getHistory 返回最近 N 条", () => {
    online.add("u2");
    for (let i = 0; i < 5; i += 1) chat.sendPrivateMessage("u1", "u2", `消息${i}`);
    const hist = chat.getHistory("u1", "u2", 3);
    expect(hist).toHaveLength(3);
    expect(hist[2].text).toBe("消息4");
  });

  it("历史最多保留 200 条", () => {
    online.add("u2");
    for (let i = 0; i < 250; i += 1) chat.sendPrivateMessage("u1", "u2", `m${i}`);
    const hist = chat.getHistory("u1", "u2", 300);
    expect(hist.length).toBe(200);
    expect(hist[0].text).toBe("m50");
  });

  it("conversationId 双向对称", () => {
    expect(chat.conversationIdOf("u1", "u2")).toBe(chat.conversationIdOf("u2", "u1"));
    expect(chat.conversationIdOf("u1", "u2")).toBe("u1_u2");
  });
});

describe("已读回执", () => {
  it("markRead 通知会话另一端", () => {
    online.add("u1");
    online.add("u2");
    const msg = chat.sendPrivateMessage("u1", "u2", "你好");
    inbox.set("u1", []);
    inbox.set("u2", []);
    chat.markRead(chat.conversationIdOf("u1", "u2"), "u2", msg.messageId);
    expect(inbox.get("u1")?.[0]).toMatchObject({
      type: "message_read",
      userId: "u2",
      lastReadMessageId: msg.messageId,
    });
  });
});

describe("REST 历史端点", () => {
  it("GET /api/messages/history 返回消息列表", async () => {
    online.add("u2");
    chat.sendPrivateMessage("u1", "u2", "你好");
    chat.sendPrivateMessage("u1", "u2", "在吗");

    const app = Fastify();
    chat.registerChatRoutes(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/messages/history?userId=u1&friendId=u2&limit=10" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ messages: unknown[] }>().messages).toHaveLength(2);
    await app.close();
  });

  it("缺少参数返回 400", async () => {
    const app = Fastify();
    chat.registerChatRoutes(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/messages/history?userId=u1" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
