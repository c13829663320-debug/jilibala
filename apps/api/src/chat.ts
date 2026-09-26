// ===== Round4 R4-07：私聊消息管理 =====
// - 服务端校验好友关系（非好友不能私聊）
// - 接收方在线时 WS 直推；离线时存为离线消息，上线补发
// - 历史存 JSON 文件 apps/api/.data/messages/<convId>.json，最多保留最近 200 条
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrivateMessage } from "@balabala/shared";
import { areFriends } from "./friends.js";

const DEFAULT_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DEFAULT_MESSAGES_DIR = resolve(DEFAULT_DATA_DIR, "messages");

let dataDir = process.env.BALABALA_TEST_DATA_DIR ? resolve(process.env.BALABALA_TEST_DATA_DIR) : DEFAULT_DATA_DIR;
let messagesDir = resolve(dataDir, "messages");

/** 测试用：覆盖数据目录。 */
export function _setDataDirForTest(dir: string): void {
  dataDir = resolve(dir);
  messagesDir = resolve(dataDir, "messages");
}

const MAX_HISTORY_PER_CONV = 200;

/** 业务错误。 */
export class ChatError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** conversationId = [a,b].sort().join("_")，双向唯一。 */
export function conversationIdOf(a: string, b: string): string {
  return [a, b].sort().join("_");
}

function convFile(convId: string): string {
  // convId 由两个 userId 用 "_" 拼成，userId 是 UUID（不含特殊字符），安全。
  return resolve(messagesDir, `${convId}.json`);
}

function loadConversation(convId: string): PrivateMessage[] {
  try {
    const f = convFile(convId);
    if (!existsSync(f)) return [];
    const arr = JSON.parse(readFileSync(f, "utf-8")) as PrivateMessage[];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("[chat] 读取会话文件失败:", convId, e);
    return [];
  }
}

function saveConversation(convId: string, messages: PrivateMessage[]): void {
  try {
    mkdirSync(messagesDir, { recursive: true });
    const trimmed = messages.slice(-MAX_HISTORY_PER_CONV);
    writeFileSync(convFile(convId), JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (e) {
    console.warn("[chat] 写入会话文件失败:", convId, e);
  }
}

// ===== Presence 注入（由 ws.ts 注册，与 friends 共用同一 provider） =====
export interface ChatPresenceProvider {
  isOnline(userId: string): boolean;
  sendToUser(userId: string, msg: unknown): void;
}
let chatPresence: ChatPresenceProvider | null = null;
export function setChatPresenceProvider(p: ChatPresenceProvider): void {
  chatPresence = p;
}

/** 内存中尚未投递的离线消息（key: toUserId）。服务重启后由客户端拉历史兜底。 */
const undelivered = new Map<string, PrivateMessage[]>();

/** 测试用：清空状态。 */
export function _resetChatForTest(): void {
  undelivered.clear();
}

export function sendPrivateMessage(
  fromUserId: string,
  toUserId: string,
  text: string,
): PrivateMessage {
  if (!fromUserId || !toUserId) throw new ChatError(400, "bad_request", "fromUserId/toUserId 不能为空");
  if (fromUserId === toUserId) throw new ChatError(400, "self_chat", "不能给自己发私聊");
  const trimmed = text.trim().slice(0, 1000);
  if (!trimmed) throw new ChatError(400, "empty_text", "消息内容不能为空");
  if (!areFriends(fromUserId, toUserId)) {
    throw new ChatError(403, "not_friends", "你们还不是好友，不能私聊");
  }

  const convId = conversationIdOf(fromUserId, toUserId);
  const message: PrivateMessage = {
    messageId: randomUUID(),
    conversationId: convId,
    fromUserId,
    toUserId,
    text: trimmed,
    timestamp: new Date().toISOString(),
  };

  const history = loadConversation(convId);
  history.push(message);
  saveConversation(convId, history);

  const recipientOnline = chatPresence?.isOnline(toUserId) ?? false;
  if (recipientOnline) {
    chatPresence?.sendToUser(toUserId, { type: "private_message", message });
  } else {
    // 离线：暂存，等上线补发
    const list = undelivered.get(toUserId) ?? [];
    list.push(message);
    undelivered.set(toUserId, list);
  }
  return message;
}

/** 用户上线时调用：补发所有离线消息。 */
export function flushOfflineMessages(userId: string): PrivateMessage[] {
  const list = undelivered.get(userId) ?? [];
  if (list.length > 0) {
    undelivered.delete(userId);
    chatPresence?.sendToUser(userId, { type: "offline_messages", messages: list });
  }
  return list;
}

export function getHistory(userId: string, friendId: string, limit = 50): PrivateMessage[] {
  const convId = conversationIdOf(userId, friendId);
  const all = loadConversation(convId);
  return all.slice(-Math.max(1, Math.min(limit, MAX_HISTORY_PER_CONV)));
}

/**
 * 已读回执：readerId 已读到 lastReadMessageId。
 * 更新内存中的 readBy 标记（历史文件里的消息不回写，避免高频 IO），并通知对方。
 */
export function markRead(conversationId: string, readerId: string, lastReadMessageId: string): void {
  // 找出会话另一端
  const [a, b] = conversationId.split("_");
  if (!a || !b) return;
  const other = readerId === a ? b : readerId === b ? a : null;
  if (!other) return;
  chatPresence?.sendToUser(other, {
    type: "message_read",
    conversationId,
    userId: readerId,
    lastReadMessageId,
  });
}

// ===== REST 路由 =====
export function registerChatRoutes(app: FastifyInstance): void {
  app.get("/api/messages/history", async (req, reply) => {
    const query = req.query as { userId?: string; friendId?: string; limit?: string };
    const userId = (query.userId ?? "").trim();
    const friendId = (query.friendId ?? "").trim();
    if (!userId || !friendId) return reply.code(400).send({ error: "userId 和 friendId 不能为空" });
    const limit = parseInt(query.limit ?? "50", 10);
    return { messages: getHistory(userId, friendId, Number.isFinite(limit) ? limit : 50) };
  });
}
