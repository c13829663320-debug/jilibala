// ===== Round4 R4-07：好友系统 =====
// 内存 Map + JSON 文件持久化（apps/api/.data/friends.json）。
// 在线状态由 ws.ts 通过 PresenceProvider 注入，避免循环依赖。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Friend, FriendInvite, FriendRequest } from "@balabala/shared";
import * as db from "./db.js";

const DATA_DIR = process.env.BALABALA_TEST_DATA_DIR
  ? resolve(process.env.BALABALA_TEST_DATA_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const FRIENDS_FILE = resolve(DATA_DIR, "friends.json");

/** 业务错误：REST 层据 statusCode 返回对应 HTTP 状态。 */
export class FriendError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface StoredFriendsData {
  /** userId -> 互为好友的 userId 列表（双向冗余存储，便于查询）。 */
  friendships: Record<string, string[]>;
  /** 全部请求（含已处理，便于审计；pending 才参与新请求判重）。 */
  requests: FriendRequest[];
}

const EMPTY: StoredFriendsData = { friendships: {}, requests: [] };

let data: StoredFriendsData = load();

function load(): StoredFriendsData {
  try {
    if (!existsSync(FRIENDS_FILE)) return structuredClone(EMPTY);
    const raw = JSON.parse(readFileSync(FRIENDS_FILE, "utf-8")) as Partial<StoredFriendsData>;
    return {
      friendships: raw.friendships ?? {},
      requests: Array.isArray(raw.requests) ? raw.requests : [],
    };
  } catch (e) {
    console.warn("[friends] 读取 friends.json 失败，使用空数据:", e);
    return structuredClone(EMPTY);
  }
}

let persistTimer: NodeJS.Timeout | null = null;
function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    // 防抖写盘：高频操作时合并落盘。
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        writeFileSync(FRIENDS_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (e) {
        console.warn("[friends] 写入 friends.json 失败:", e);
      }
    }, 50);
    persistTimer.unref?.();
  } catch {
    /* noop */
  }
}

/** 测试用：清空内存数据并指向临时文件。 */
export function _resetFriendsForTest(): void {
  data = structuredClone(EMPTY);
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

// ===== Presence 注入（由 ws.ts 注册，避免循环依赖） =====
export interface PresenceProvider {
  isOnline(userId: string): boolean;
  /** 用户当前所在的 social 房间码（若在 social 房间），否则 undefined。 */
  getSocialRoomCode(userId: string): string | undefined;
  /** 向某用户所有在线连接发一条 WS 消息。 */
  sendToUser(userId: string, msg: unknown): void;
}

let presence: PresenceProvider | null = null;
export function setPresenceProvider(p: PresenceProvider): void {
  presence = p;
}

// ===== 核心关系操作 =====
export function areFriends(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  return (data.friendships[a] ?? []).includes(b);
}

export function getFriendIds(userId: string): string[] {
  return [...(data.friendships[userId] ?? [])];
}

export function sendRequest(fromUserId: string, toUserId: string, message?: string): FriendRequest {
  if (!fromUserId || !toUserId) throw new FriendError(400, "bad_request", "fromUserId/toUserId 不能为空");
  if (fromUserId === toUserId) throw new FriendError(400, "self_request", "不能给自己发送好友请求");
  if (areFriends(fromUserId, toUserId)) throw new FriendError(409, "already_friends", "你们已经是好友了");

  // 任一方向存在 pending 请求 => 409
  const dup = data.requests.find(
    (r) => r.status === "pending" &&
      ((r.fromUserId === fromUserId && r.toUserId === toUserId) ||
       (r.fromUserId === toUserId && r.toUserId === fromUserId)),
  );
  if (dup) throw new FriendError(409, "request_pending", "已有待处理的好友请求");

  const fromUser = db.getUser(fromUserId);
  const request: FriendRequest = {
    requestId: randomUUID(),
    fromUserId,
    fromNickname: fromUser?.nickname ?? "匿名用户",
    toUserId,
    message: message?.slice(0, 200),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.requests.push(request);
  persist();

  // 实时推送给被请求方
  presence?.sendToUser(toUserId, { type: "friend_request", request });
  return request;
}

export function acceptRequest(requestId: string, userId: string): FriendRequest {
  const req = data.requests.find((r) => r.requestId === requestId);
  if (!req) throw new FriendError(404, "not_found", "好友请求不存在");
  if (req.toUserId !== userId) throw new FriendError(403, "forbidden", "只能处理发给自己的请求");
  if (req.status !== "pending") throw new FriendError(409, "already_handled", "该请求已被处理");

  req.status = "accepted";
  if (!data.friendships[req.fromUserId]) data.friendships[req.fromUserId] = [];
  if (!data.friendships[req.toUserId]) data.friendships[req.toUserId] = [];
  if (!data.friendships[req.fromUserId].includes(req.toUserId)) data.friendships[req.fromUserId].push(req.toUserId);
  if (!data.friendships[req.toUserId].includes(req.fromUserId)) data.friendships[req.toUserId].push(req.fromUserId);
  persist();

  // 通知发起方
  presence?.sendToUser(req.fromUserId, { type: "friend_request_handled", requestId, status: "accepted" });
  return req;
}

export function rejectRequest(requestId: string, userId: string): FriendRequest {
  const req = data.requests.find((r) => r.requestId === requestId);
  if (!req) throw new FriendError(404, "not_found", "好友请求不存在");
  if (req.toUserId !== userId) throw new FriendError(403, "forbidden", "只能处理发给自己的请求");
  if (req.status !== "pending") throw new FriendError(409, "already_handled", "该请求已被处理");

  req.status = "rejected";
  persist();
  presence?.sendToUser(req.fromUserId, { type: "friend_request_handled", requestId, status: "rejected" });
  return req;
}

export function removeFriend(userId: string, friendId: string): void {
  if (!areFriends(userId, friendId)) throw new FriendError(404, "not_friends", "你们还不是好友");
  data.friendships[userId] = (data.friendships[userId] ?? []).filter((x) => x !== friendId);
  data.friendships[friendId] = (data.friendships[friendId] ?? []).filter((x) => x !== userId);
  persist();
  presence?.sendToUser(friendId, { type: "friend_removed", userId });
}

export function getFriends(userId: string): Friend[] {
  return getFriendIds(userId).map((id) => {
    const u = db.getUser(id);
    const online = presence?.isOnline(id) ?? false;
    const roomCode = online ? (presence?.getSocialRoomCode(id) ?? undefined) : undefined;
    return {
      userId: id,
      nickname: u?.nickname ?? "匿名用户",
      avatarType: u?.avatarType,
      avatarRef: u?.avatarRef,
      status: online ? "online" : "offline",
      ...(roomCode ? { roomCode } : {}),
    } satisfies Friend;
  });
}

export function getRequests(userId: string): FriendRequest[] {
  return data.requests
    .filter((r) => r.toUserId === userId && r.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ===== 邀请进房 =====
export function sendInvite(fromUserId: string, toUserId: string, roomCode: string): FriendInvite {
  if (!areFriends(fromUserId, toUserId)) throw new FriendError(403, "not_friends", "只能邀请好友");
  if (!roomCode) throw new FriendError(400, "bad_request", "roomCode 不能为空");
  const fromUser = db.getUser(fromUserId);
  const invite: FriendInvite = {
    inviteId: randomUUID(),
    fromUserId,
    fromNickname: fromUser?.nickname ?? "匿名用户",
    toUserId,
    roomCode,
    createdAt: new Date().toISOString(),
  };
  presence?.sendToUser(toUserId, { type: "friend_invite", invite });
  return invite;
}

// ===== 在线状态变更回调（ws.ts 调用） =====
/** 用户上线：通知其所有好友 friend_online。 */
export function notifyUserOnline(userId: string, roomCode?: string): void {
  for (const fid of getFriendIds(userId)) {
    presence?.sendToUser(fid, { type: "friend_online", userId, ...(roomCode ? { roomCode } : {}) });
  }
}

/** 用户下线：通知其所有好友 friend_offline。 */
export function notifyUserOffline(userId: string): void {
  for (const fid of getFriendIds(userId)) {
    presence?.sendToUser(fid, { type: "friend_offline", userId });
  }
}

// ===== REST 路由注册 =====
export function registerFriendRoutes(app: FastifyInstance): void {
  app.post("/api/friends/request", async (req, reply) => {
    const body = (req.body ?? {}) as { fromUserId?: string; toUserId?: string; message?: string };
    try {
      const request = sendRequest(body.fromUserId ?? "", body.toUserId ?? "", body.message);
      return reply.code(201).send({ request });
    } catch (e) {
      if (e instanceof FriendError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  app.post("/api/friends/accept", async (req, reply) => {
    const body = (req.body ?? {}) as { requestId?: string; userId?: string };
    try {
      const request = acceptRequest(body.requestId ?? "", body.userId ?? "");
      return { request };
    } catch (e) {
      if (e instanceof FriendError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  app.post("/api/friends/reject", async (req, reply) => {
    const body = (req.body ?? {}) as { requestId?: string; userId?: string };
    try {
      const request = rejectRequest(body.requestId ?? "", body.userId ?? "");
      return { request };
    } catch (e) {
      if (e instanceof FriendError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  app.delete("/api/friends/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    // query 带 ?friendId=X 表示删除 userId 的好友 friendId
    const query = req.query as { friendId?: string };
    const friendId = query.friendId ?? "";
    try {
      removeFriend(userId, friendId);
      return { ok: true };
    } catch (e) {
      if (e instanceof FriendError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  app.get("/api/friends/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    return { friends: getFriends(userId) };
  });

  app.get("/api/friends/requests/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    return { requests: getRequests(userId) };
  });

  app.post("/api/friends/invite", async (req, reply) => {
    const body = (req.body ?? {}) as { fromUserId?: string; toUserId?: string; roomCode?: string };
    try {
      const invite = sendInvite(body.fromUserId ?? "", body.toUserId ?? "", body.roomCode ?? "");
      return reply.code(201).send({ invite });
    } catch (e) {
      if (e instanceof FriendError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });
}
