// ===== M7: WebSocket 实时多人 =====
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type WSUser,
  type CourtRoomState,
  type SceneRoomState,
  type WSMessage,
  type BenchMember,
  type BenchSpeech,
  type BenchStage,
  type Verdict,
  type SceneId,
  type Perspective,
  type EmoteType,
  type SocialRoom,
  type ReportCategory,
} from "@balabala/shared";
import { getCourtCase } from "./db.js";
import { getSocialRoom, verifyRoomPassword, isUserKicked, sanitizeRoom } from "./room-routes.js";
import { filterCaseForPerspective } from "./court-state.js";
import * as db from "./db.js";
import { handleAction as werewolfHandleAction, getSnapshotForPlayer as werewolfSnapshot, replaceHumanWithAI as werewolfReplaceHuman } from "./werewolf-orchestrator.js";
import { metrics } from "./metrics.js";
import { getMultiplayerCourt } from "./court-orchestrator.js";
import { getMultiplayerBar } from "./bar-orchestrator.js";
import {
  setPresenceProvider as setFriendPresenceProvider,
  notifyUserOnline as friendsNotifyOnline,
  notifyUserOffline as friendsNotifyOffline,
} from "./friends.js";
import {
  setChatPresenceProvider,
  flushOfflineMessages,
  sendPrivateMessage,
  markRead,
  ChatError,
} from "./chat.js";
// R5: 组队 / 约局（additive：不改已有好友/私聊/房间 handler）
import {
  setPartyPresenceProvider,
  createParty,
  inviteToParty,
  joinParty,
  setReady,
  chooseScene,
  startGame,
  leaveParty,
  disbandParty,
  flushOfflinePartyInvites,
  PartyError,
} from "./party.js";
// R4-08: 内容治理（敏感词过滤 / 禁言 / 举报阈值自动禁言）
import { moderateText, isMuted, getMutedUntil, registerReport, recordProfanityHit, recordStructuredReport, recordReplaceEvent, listMatchedWords } from "./moderation.js";

// ===== 房间数据结构 =====
export type RoomUser = {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  x: number;
  z: number;
  rotation: number;
  lastMove: number;
  socket: WebSocket;
  // —— 社交临场感扩展（全部可选，向后兼容） ——
  talkingIntensity?: number;
  animation?: string;
  expression?: string;
  headTarget?: { x: number; z: number } | null;
  lastEmote?: number;
  lastTalkingBroadcast?: number;
  // ===== R4-01: 断线重连与会话恢复 =====
  /** 服务端签发的会话 token；首次连接下发，重连时 ?sessionToken= 带回以恢复位置。 */
  sessionToken?: string;
  /** 宽限期内：socket 已断但记录保留，等待重连。 */
  reconnecting?: boolean;
  /** 宽限期计时器：超时后真正移除并广播 player_left。 */
  graceTimer?: NodeJS.Timeout;
  /** 断线期间缓冲的房间广播消息（TTL=30s），重连成功后按序补发。 */
  messageBuffer?: Array<{ at: number; msg: Record<string, unknown> }>;
  /** 位置更新递增序号，供客户端检测丢包并做速度外推。 */
  seq?: number;
  /** 上一次被接受位置的速度校验基准点。 */
  lastSpeedCheck?: { x: number; z: number; t: number };
};

export type Room = {
  id: string;
  users: Map<string, RoomUser>;
  courtState?: CourtRoomState;
  sceneState?: SceneRoomState;
};

/** 供测试使用：清空所有房间，保证用例隔离。 */
export function _resetRoomsForTest(): void {
  rooms.clear();
  sessionIndex.clear();
}

const rooms = new Map<string, Room>();

// ===== R5: 全局 WS 心跳巡检（additive）=====
// 每 30s 对房间内所有连接发一次协议层 ping；上一轮没回 pong 的视为僵死连接，terminate。
// terminate 后会触发上面 socket.on("close") 走既有宽限/清理逻辑，不重复清理房间状态。
const WS_HEARTBEAT_MS = 30_000;
const heartbeatTimer = setInterval(() => {
  for (const room of rooms.values()) {
    for (const user of room.users.values()) {
      const sock = user.socket as WebSocket & { isAlive?: boolean };
      if (sock.isAlive === false) {
        try { sock.terminate(); } catch { /* noop */ }
        continue;
      }
      sock.isAlive = false;
      try { sock.ping(); } catch { /* noop */ }
    }
  }
}, WS_HEARTBEAT_MS);
// 测试/部署时不让定时器挂住事件循环
heartbeatTimer.unref?.();

/**
 * R4-07: 全局用户连接注册表 —— userId -> 该用户所有在线 socket（可能多房间/多标签页）。
 * 用于：好友在线状态、私聊跨房间投递、离线消息补发。
 */
const globalUserSockets = new Map<string, Set<{ socket: WebSocket; roomId: string }>>();

/** 向某用户的所有在线连接发一条 WS 消息。 */
export function sendToGlobalUser(userId: string, msg: unknown): void {
  const set = globalUserSockets.get(userId);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const entry of set) {
    try {
      if (entry.socket.readyState === entry.socket.OPEN) entry.socket.send(payload);
    } catch {
      /* noop */
    }
  }
}

/** 某用户是否至少有一条在线连接。 */
export function isUserGloballyOnline(userId: string): boolean {
  return (globalUserSockets.get(userId)?.size ?? 0) > 0;
}

/** 取用户当前所在的 social 房间码（多房间时取第一个 social 房间）。 */
export function getUserSocialRoomCode(userId: string): string | undefined {
  const set = globalUserSockets.get(userId);
  if (!set) return undefined;
  for (const entry of set) {
    if (entry.roomId.startsWith("social:")) return entry.roomId.slice("social:".length);
  }
  return undefined;
}

/** 测试用：清空全局连接注册表。 */
export function _resetGlobalConnectionsForTest(): void {
  globalUserSockets.clear();
}

// 注册 PresenceProvider 给 friends / chat 模块，避免循环依赖。
setFriendPresenceProvider({
  isOnline: isUserGloballyOnline,
  getSocialRoomCode: getUserSocialRoomCode,
  sendToUser: sendToGlobalUser,
});
setChatPresenceProvider({
  isOnline: isUserGloballyOnline,
  sendToUser: sendToGlobalUser,
});
// R5: 组队模块复用同一套跨房间投递通道。
setPartyPresenceProvider({
  isOnline: isUserGloballyOnline,
  sendToUser: sendToGlobalUser,
});

/**
 * R4-01: 会话 token 索引 —— token -> 所在房间与用户。
 * 用于重连时仅凭 ?sessionToken= 找回断线前的位置/化身状态。
 */
const sessionIndex = new Map<string, { roomId: string; userId: string }>();

/** gym:lobby 最近打卡广播缓冲（最多保留 5 条）。 */
const gymRecentCheckins: Array<{ userId: string; nickname: string; exerciseName: string; createdAt: string }> = [];
const GYM_CHECKIN_BUFFER_MAX = 5;

/** 社交临场感：emote 最小间隔（ms），防止刷屏 */
const EMOTE_THROTTLE_MS = 300;
// R4-08: emote 从 7 种扩充至 15 种（与 shared EmoteType 对齐）。
const VALID_EMOTES: ReadonlySet<string> = new Set([
  "wave", "nod", "shake", "point", "clap", "laugh", "surprised",
  "dance", "bow", "cheer", "cry", "angry", "think", "salute", "heart",
]);
/** talking 消息最小广播间隔（ms），说话强度变化频繁时节流 */
const TALKING_BROADCAST_MS = 120;

// ===== R4-01: 断线重连与多人稳定性参数 =====
/** 断线宽限期默认值：ms（导出供客户端展示；内部用下面的可变变量，便于测试覆盖）。 */
export const RECONNECT_GRACE_MS = 15_000;
/** 在途消息缓冲 TTL 默认值：ms。 */
export const MESSAGE_BUFFER_TTL_MS = 30_000;
/** 位置更新最小间隔（节流）。 */
export const MOVE_THROTTLE_MS = 50;
/** 服务端允许的最大移动速度（单位/秒），超速按方向向量钳制。 */
export const MAX_SPEED_UNITS_PER_SEC = 20;
/** 缓冲消息条数硬上限，防御 presence 洪峰导致内存膨胀。 */
const MESSAGE_BUFFER_MAX = 200;

/** 内部可变参数（测试通过 setter 覆盖，避免真实等待 15s/30s）。 */
let reconnectGraceMs = RECONNECT_GRACE_MS;
let messageBufferTtlMs = MESSAGE_BUFFER_TTL_MS;

/** 测试用：覆盖宽限期。 */
export function _setReconnectGraceMsForTest(ms: number): void {
  reconnectGraceMs = ms;
}
/** 测试用：缓冲 TTL。 */
export function _setMessageBufferTtlMsForTest(ms: number): void {
  messageBufferTtlMs = ms;
}

function pushGymRecentCheckin(entry: { userId: string; nickname: string; exerciseName: string; createdAt: string }): void {
  gymRecentCheckins.push(entry);
  if (gymRecentCheckins.length > GYM_CHECKIN_BUFFER_MAX) gymRecentCheckins.shift();
}

/** M8: 合法房间前缀。plaza 为全局广场，其余为按场景/案件的房间。 */
const VALID_ROOM_PREFIXES = ["plaza", "court:", "talkshow:", "bar:", "library:", "werewolf:", "gym:", "social:"];

export function isValidRoom(roomId: string): boolean {
  return VALID_ROOM_PREFIXES.some((p) => (p.endsWith(":") ? roomId.startsWith(p) : roomId === p));
}

const randomPos = () => (Math.random() * 20 - 10);

export function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, users: new Map() };
    // 法庭房间初始化 courtState
    if (roomId.startsWith("court:")) {
      room.courtState = {
        caseId: roomId.slice("court:".length),
        phase: "config",
        members: [],
        speeches: [],
        currentStage: "forming",
        votes: { plaintiff: 0, defendant: 0 },
        perspectives: {},
      };
    }
    // M8: 场景房间初始化 sceneState
    for (const prefix of ["talkshow:", "bar:", "library:", "werewolf:"] as const) {
      if (roomId.startsWith(prefix)) {
        const scene = prefix.slice(0, -1) as SceneId;
        room.sceneState = {
          scene,
          sessionId: roomId.slice(prefix.length),
          phase: "idle",
          participants: 0,
          payload: {},
        };
        break;
      }
    }
    rooms.set(roomId, room);
  }
  return room;
}

function wsUserOf(u: RoomUser, isOwner = false): WSUser {
  return {
    userId: u.userId,
    nickname: u.nickname,
    avatarType: u.avatarType,
    avatarRef: u.avatarRef,
    x: u.x,
    z: u.z,
    rotation: u.rotation,
    ...(isOwner ? { isOwner: true } : {}),
  };
}

function safeSend(socket: WebSocket, msg: WSMessage): void {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  } catch {
    // 忽略发送失败（可能已断开）
  }
}

/**
 * R4-01: 把一条房间广播写入宽限期内（断线待重连）用户的缓冲。
 * 按 TTL 丢弃过期条目，并硬限制条数防止洪峰内存膨胀。
 */
function bufferMessageForReconnecting(u: RoomUser, msg: Record<string, unknown>): void {
  if (!u.reconnecting) return;
  const now = Date.now();
  if (!u.messageBuffer) u.messageBuffer = [];
  const buf = u.messageBuffer;
  buf.push({ at: now, msg });
  // 按 TTL 修剪过期条目
  while (buf.length > 0 && now - buf[0].at > messageBufferTtlMs) buf.shift();
  // 硬上限：超出时丢弃最旧条目（最旧在前）
  while (buf.length > MESSAGE_BUFFER_MAX) buf.shift();
}

/** 向房间内所有人广播。R4-01：宽限期内断线的用户不丢消息，而是进入其重连缓冲。 */
export function broadcastToRoom(roomId: string, message: unknown): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  const msgObj = message as Record<string, unknown>;
  for (const user of room.users.values()) {
    try {
      if (user.socket.readyState === user.socket.OPEN) {
        user.socket.send(payload);
      } else if (user.reconnecting) {
        // 该用户断线待重连：缓冲这条广播，重连成功后补发。
        bufferMessageForReconnecting(user, msgObj);
      }
    } catch {
      // 忽略
    }
  }
}

/** 向房间内指定用户单独发送（用于狼人杀私密快照，不广播给他人）。 */
export function sendToUserInRoom(roomId: string, userId: string, msg: WSMessage): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const user = room.users.get(userId);
  if (!user) return;
  safeSend(user.socket, msg);
}

/** Round3: 获取某房间当前在线人数（供 REST 房间列表实时同步 playerCount）。 */
export function getRoomPlayerCount(roomId: string): number {
  return rooms.get(roomId)?.users.size ?? 0;
}

/** R4-02: 向房间广播事件（供 REST 路由触发后调用）。 */
export function broadcastRoomEvent(roomId: string, message: unknown): void {
  broadcastToRoom(roomId, message);
}

/**
 * R4-02: 踢用户出房间——广播 player_kicked 给全房间，然后关闭被踢用户的 socket。
 * 返回被踢用户是否确实在房间内。
 */
export function kickUserFromRoom(roomId: string, targetUserId: string, reason: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const target = room.users.get(targetUserId);
  if (!target) return false;

  // 广播 player_kicked 给全房间（含被踢者）
  broadcastToRoom(roomId, {
    type: "player_kicked",
    userId: targetUserId,
    reason,
  });

  // 关闭被踢用户的 socket（稍延迟，让消息先送达）
  try {
    setTimeout(() => {
      try { target.socket.close(); } catch { /* noop */ }
    }, 100);
  } catch { /* noop */ }

  return true;
}

/** 局部更新法庭房间状态。 */
export function updateCourtState(caseId: string, patch: Partial<CourtRoomState>): void {
  const roomId = `court:${caseId}`;
  const room = getOrCreateRoom(roomId);
  if (!room.courtState) {
    room.courtState = {
      caseId,
      phase: "config",
      members: [],
      speeches: [],
      currentStage: "forming",
      votes: { plaintiff: 0, defendant: 0 },
      perspectives: {},
    };
  }
  Object.assign(room.courtState, patch);
}

/** 获取法庭房间状态。 */
export function getCourtState(caseId: string): CourtRoomState | undefined {
  const room = rooms.get(`court:${caseId}`);
  return room?.courtState;
}

// ===== M8: 场景房间状态管理 =====
/** 局部更新场景房间状态。 */
export function updateSceneState(scene: SceneId, sessionId: string, patch: Partial<SceneRoomState>): void {
  const roomId = `${scene}:${sessionId}`;
  const room = getOrCreateRoom(roomId);
  if (!room.sceneState) {
    room.sceneState = { scene, sessionId, phase: "idle", participants: 0, payload: {} };
  }
  Object.assign(room.sceneState, patch);
}

/** 获取场景房间状态。 */
export function getSceneState(scene: SceneId, sessionId: string): SceneRoomState | undefined {
  const room = rooms.get(`${scene}:${sessionId}`);
  return room?.sceneState;
}

/** 向场景房间广播事件。 */
export function broadcastSceneEvent(scene: SceneId, sessionId: string, event: Record<string, unknown>): void {
  broadcastToRoom(`${scene}:${sessionId}`, { type: "scene_event", scene, event });
}

/**
 * R4-05: 真人玩家永久离开某玩法房间——通知对应编排器让 AI 接管其角色位，
 * 避免夜晚/发言/投票阶段因为等一个不会再操作的真人而卡死。
 */
function notifyGameplayPlayerLeft(roomId: string, userId: string): void {
  try {
    if (roomId.startsWith("court:")) {
      getMultiplayerCourt(roomId.slice("court:".length))?.leaveRole(userId);
    } else if (roomId.startsWith("bar:")) {
      getMultiplayerBar(roomId.slice("bar:".length))?.leaveSide(userId);
    } else if (roomId.startsWith("werewolf:")) {
      werewolfReplaceHuman(roomId.slice("werewolf:".length), userId);
    }
  } catch {
    // 编排器不存在或已结束，忽略
  }
}

// ===== Round4 R4-03：安全模块 · 举报日志 =====
/**
 * reports.log 路径：apps/api/.data/reports.log（相对本文件 src/ws.ts 上一级）。
 * 用 import.meta.url 定位，避免依赖 process.cwd()。
 */
const REPORTS_LOG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data", "reports.log");

/** 合法举报分类白名单（与前端 normalizeCategory 对齐） */
const VALID_REPORT_CATEGORIES: ReadonlySet<string> = new Set([
  "harassment", "spam", "abuse", "cheating", "other",
]);

export interface ReportLogEntry {
  reportedAt: string;
  reporterUserId: string;
  reporterNickname: string;
  targetUserId: string;
  reason: string;
  category: ReportCategory;
  room: string;
}

/**
 * 追加一条举报到 reports.log（每行一个 JSON）。
 * 目录不存在时自动创建；写入失败不影响主流程（吞掉异常）。
 */
export function appendReportLog(entry: ReportLogEntry): void {
  try {
    mkdirSync(dirname(REPORTS_LOG_PATH), { recursive: true });
    appendFileSync(REPORTS_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    console.warn("[ws] 写入 reports.log 失败:", e);
  }
}

// ===== 注册 WebSocket 路由 =====
export function registerWebSocket(app: FastifyInstance): void {
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const userId = url.searchParams.get("userId") ?? "";
    const roomId = url.searchParams.get("room") ?? "";
    const password = url.searchParams.get("password") ?? "";

    if (!userId || !roomId) {
      safeSend(socket, { type: "error", message: "缺少 userId 或 room 参数" });
      socket.close();
      return;
    }

    // 验证 room 格式
    if (!isValidRoom(roomId)) {
      safeSend(socket, { type: "error", message: "room 必须是 plaza 或 court:<id>/talkshow:<id>/bar:<id>/library:<id>/werewolf:<id>/gym:lobby/social:<code>" });
      socket.close();
      return;
    }

    // Round3: social 房间——校验房间元数据存在（不存在则拒绝连接）
    let socialMeta: SocialRoom | undefined;
    if (roomId.startsWith("social:")) {
      const code = roomId.slice("social:".length);
      socialMeta = getSocialRoom(code);
      if (!socialMeta) {
        safeSend(socket, { type: "error", message: "房间不存在或已解散", code: "room_not_found" });
        socket.close();
        return;
      }

      // R4-02: 被踢冷却检查（同 userId 重连例外——但被踢后不应有旧连接）
      if (isUserKicked(code, userId)) {
        safeSend(socket, { type: "error", message: "你已被房主移出房间，请稍后再试", code: "kicked_cooldown" });
        socket.close();
        return;
      }

      // R4-02: 锁房间检查（已在房间内的重连用户不受影响）
      const existingConn = rooms.get(roomId)?.users.has(userId);
      if (socialMeta.isLocked && !existingConn) {
        safeSend(socket, { type: "error", message: "房间已锁定，暂不允许新玩家加入", code: "room_locked" });
        socket.close();
        return;
      }

      // R4-02: 密码校验
      if (socialMeta.hasPassword && !verifyRoomPassword(code, password || undefined)) {
        safeSend(socket, { type: "error", message: "房间密码错误", code: "wrong_password" });
        socket.close();
        return;
      }
    }

    // 获取用户资料（从 SQLite，不存在则用默认值）
    const userProfile = db.getUser(userId);
    const nickname = userProfile?.nickname ?? "匿名用户";
    const avatarType = userProfile?.avatarType ?? "capsule";
    const avatarRef = userProfile?.avatarRef ?? "";

    const room = getOrCreateRoom(roomId);

    // R4-01: 客户端重连时携带 ?sessionToken=，服务端据此恢复会话。
    const sessionToken = url.searchParams.get("sessionToken") ?? "";
    // 向后兼容：本次握手是否由客户端主动携带 token。
    // 不带 token 的旧客户端断开时走原逻辑（立即移除）；带 token 的连接才享受宽限期/消息缓冲。
    const cameWithSessionToken = sessionToken.length > 0;

    // Round3: social 房间人数上限（同 userId 重连替换旧连接不占新名额；宽限期内用户仍在 users map 中）
    // R4-02: 强校验——之前仅 REST 层有上限但 WS 未强校验
    if (socialMeta && !room.users.has(userId) && room.users.size >= socialMeta.maxPlayers) {
      safeSend(socket, { type: "error", message: "房间已满", code: "room_full" });
      socket.close();
      return;
    }

    // R4-02: 获取当前房间房主 ID（用于在用户列表中标记 isOwner）
    const roomOwnerId = socialMeta ? (socialMeta.ownerId || socialMeta.creatorId) : undefined;
    const isRoomOwner = roomOwnerId === userId;

    // ===== R4-01: 会话恢复判定 =====
    // token 必须指向「同一房间 + 同一用户」，否则视为无效 token，走全新入场。
    const sessionRef = sessionToken ? sessionIndex.get(sessionToken) : undefined;
    const resumedRecord =
      sessionRef && sessionRef.roomId === roomId && sessionRef.userId === userId
        ? room.users.get(userId)
        : undefined;

    let roomUser: RoomUser;
    // R4-01: 是否为宽限期内会话恢复（必须在改写 reconnecting 标志前捕获）。
    const isResumedSession = !!(resumedRecord && resumedRecord.reconnecting);

    if (resumedRecord && resumedRecord.reconnecting) {
      // ---- 宽限期内重连成功：恢复位置/旋转/化身，不重新随机 ----
      roomUser = resumedRecord;
      if (roomUser.graceTimer) {
        clearTimeout(roomUser.graceTimer);
        roomUser.graceTimer = undefined;
      }
      // 若该 userId 还挂着另一个活连接（多标签页），先关掉，避免连接泄漏。
      if (roomUser.socket !== socket && roomUser.socket.readyState === roomUser.socket.OPEN) {
        try { roomUser.socket.close(); } catch { /* noop */ }
      }
      roomUser.socket = socket;
      roomUser.reconnecting = false;

      // 在途消息补发：过滤 TTL 过期条目，逐条打 replayed:true
      const now = Date.now();
      const replayed = (roomUser.messageBuffer ?? [])
        .filter((e) => now - e.at <= messageBufferTtlMs)
        .map((e) => ({ ...e.msg, replayed: true }) as import("@balabala/shared").ReplayedMessage);
      roomUser.messageBuffer = [];

      safeSend(socket, {
        type: "session_resumed",
        state: {
          userId,
          x: roomUser.x,
          z: roomUser.z,
          rotation: roomUser.rotation,
          avatarType: roomUser.avatarType,
          avatarRef: roomUser.avatarRef,
          nickname: roomUser.nickname,
        },
        replayed,
      } satisfies WSMessage);
    } else {
      // ---- 全新会话（或 token 失效/过期）：随机位置入场，新签 session token ----
      const freshToken = randomUUID();
      roomUser = {
        userId,
        nickname,
        avatarType,
        avatarRef,
        x: randomPos(),
        z: randomPos(),
        rotation: 0,
        lastMove: 0,
        socket,
        sessionToken: freshToken,
        seq: 0,
        lastSpeedCheck: { x: 0, z: 0, t: 0 },
      };
      sessionIndex.set(freshToken, { roomId, userId });

      // 加入房间。若该 userId 已存在旧连接（同用户多标签），先关闭旧 socket 再替换，避免连接泄漏。
      const existingUser = room.users.get(userId);
      if (existingUser && existingUser.socket !== socket) {
        try { existingUser.socket.close(); } catch { /* noop */ }
      }
      room.users.set(userId, roomUser);
      metrics.wsConnected();

      // 下发会话 token，客户端须持久化供下次重连使用
      safeSend(socket, { type: "session_token", token: freshToken } satisfies WSMessage);

      // 发送 welcome 快照（R4-02: 用户列表标记 isOwner）
      const welcome: WSMessage = {
        type: "welcome",
        roomId,
        users: [...room.users.values()].map((u) => wsUserOf(u, u.userId === roomOwnerId)),
        ...(room.courtState ? { courtState: room.courtState } : {}),
        ...(room.sceneState ? { sceneState: room.sceneState } : {}),
      };
      safeSend(socket, welcome);
    }

    // Round3: social 房间——向连接单发房间元数据（playerCount 取当前在线数）
    // R4-02: 剥离密码哈希等敏感字段
    if (socialMeta) {
      const roomInfo = sanitizeRoom({ ...socialMeta, playerCount: room.users.size });
      try {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "room_info", room: roomInfo }));
        }
      } catch {
        // 忽略发送失败
      }
    }

    // 狼人杀房间：若用户已加入对局，补发该视角的私密快照（断线重连/初始加载）。
    if (roomId.startsWith("werewolf:")) {
      const gameId = roomId.slice("werewolf:".length);
      const snap = werewolfSnapshot(gameId, userId);
      if (snap.players.length > 0) {
        safeSend(socket, { type: "werewolf_snapshot", snapshot: snap } satisfies WSMessage);
      }
    }

    // 健身房房间：发送 gym_state（在线用户 + 最近打卡广播）
    if (roomId.startsWith("gym:")) {
      safeSend(socket, {
        type: "gym_state",
        users: [...room.users.values()].map((u) => ({
          userId: u.userId,
          nickname: u.nickname,
          avatarType: u.avatarType,
          avatarRef: u.avatarRef,
          x: u.x,
          z: u.z,
          rotation: u.rotation,
        })),
        recentCheckins: [...gymRecentCheckins],
      } satisfies WSMessage);
    }

    // M13: 法庭房间——发送视角过滤后的案件快照
    if (roomId.startsWith("court:")) {
      const caseId = roomId.slice("court:".length);
      const courtCase = getCourtCase(caseId);
      if (courtCase) {
        // 默认视角 audience
        const perspective: Perspective = (room.courtState?.perspectives?.[userId] as Perspective) ?? "audience";
        const filtered = filterCaseForPerspective(courtCase, perspective);
        safeSend(socket, { type: "court_snapshot_v2", case: filtered } satisfies WSMessage);
      }
    }

    // ===== R4-07: 全局连接注册表（好友在线状态 / 私聊跨房间投递） =====
    const wasOfflineBefore = !isUserGloballyOnline(userId);
    {
      let set = globalUserSockets.get(userId);
      if (!set) {
        set = new Set();
        globalUserSockets.set(userId, set);
      }
      set.add({ socket, roomId });
    }
    if (wasOfflineBefore) {
      // 首次上线：补发离线私聊 + 离线组队邀请 + 通知好友 online
      flushOfflineMessages(userId);
      flushOfflinePartyInvites(userId);
      friendsNotifyOnline(userId, getUserSocialRoomCode(userId));
    }

    // R4-01: 标记本次是否为宽限期内会话恢复（决定是否需要广播 user_joined / room_player_update）。
    // 通知其他人（仅全新入场；会话恢复期间其他人一直保留着该玩家，勿重复加入）
    if (!isResumedSession) {
      if (roomId.startsWith("gym:")) {
        broadcastToRoom(roomId, {
          type: "gym_user_joined",
          user: { userId, nickname, avatarType, avatarRef, x: roomUser.x, z: roomUser.z, rotation: roomUser.rotation },
        } satisfies WSMessage);
      } else {
        broadcastToRoom(roomId, { type: "user_joined", user: wsUserOf(roomUser, isRoomOwner) } satisfies WSMessage);
      }

      // Round3: social 房间——全员（含自己）广播实时人数
      if (socialMeta) {
        broadcastToRoom(roomId, { type: "room_player_update", roomId, playerCount: room.users.size });
      }
    }

    // ===== R5: WS 心跳超时检测（additive，不影响已有逻辑）=====
    // 每条连接标记 isAlive；全局定时器每隔 30s 对未回应 ping 的僵死连接 terminate。
    // 客户端已有应用层 ping/pong（见下方 case "ping"），这里用 ws 协议层 ping 补充
    // 「半开连接」（TCP 已断但对端不发 FIN）的回收，避免僵尸连接占着房间席位。
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    socket.on("pong", () => {
      (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    // ===== 消息处理 =====
    socket.on("message", (raw: Buffer) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = data.type;
      const now = Date.now();

      switch (type) {
        case "move": {
          const x = Number(data.x ?? 0);
          const z = Number(data.z ?? 0);
          const rotation = Number(data.rotation ?? 0);
          // R4-01: 位置更新节流——距上次 <50ms 丢弃（20Hz 上限）
          if (now - roomUser.lastMove < MOVE_THROTTLE_MS) return;

          // R4-01: 合法性校验——移动速度上限 20 单位/秒，超速按方向向量钳制，
          // 防止客户端作弊/ bug 导致化身瞬移。
          let finalX = x;
          let finalZ = z;
          const prev = roomUser.lastSpeedCheck;
          if (prev) {
            const dt = (now - prev.t) / 1000;
            if (dt > 0) {
              const dx = x - prev.x;
              const dz = z - prev.z;
              const dist = Math.hypot(dx, dz);
              const maxDist = MAX_SPEED_UNITS_PER_SEC * dt;
              if (dist > maxDist && dist > 0) {
                finalX = prev.x + (dx / dist) * maxDist;
                finalZ = prev.z + (dz / dist) * maxDist;
              }
            }
          }
          roomUser.x = finalX;
          roomUser.z = finalZ;
          roomUser.rotation = rotation;
          roomUser.lastMove = now;
          roomUser.lastSpeedCheck = { x: finalX, z: finalZ, t: now };
          // R4-01: 位置序号递增，客户端据此检测丢包并做速度外推。
          roomUser.seq = (roomUser.seq ?? 0) + 1;

          if (roomId.startsWith("gym:")) {
            const gymUsers = [...room.users.values()]
              .filter((u) => u.userId !== userId)
              .map((u) => ({ userId: u.userId, x: u.x, z: u.z, rotation: u.rotation }));
            broadcastToRoom(roomId, { type: "gym_presence", users: gymUsers } satisfies WSMessage);
          } else {
            // R4-01: presence 携带每位玩家自己的 seq（含 mover 自身，修复此前 mover 位置
            // 不进广播导致远端无法同步 mover 的问题）；扩展字段保持向后兼容。
            const all = [...room.users.values()].map((u) => ({
              userId: u.userId,
              x: u.x,
              z: u.z,
              rotation: u.rotation,
              seq: u.seq ?? 0,
              ...(u.talkingIntensity !== undefined ? { talkingIntensity: u.talkingIntensity } : {}),
              ...(u.animation !== undefined ? { animation: u.animation } : {}),
              ...(u.expression !== undefined ? { expression: u.expression } : {}),
              ...(u.headTarget !== undefined ? { headTarget: u.headTarget } : {}),
            }));
            broadcastToRoom(roomId, { type: "presence", users: all } satisfies WSMessage);
          }
          break;
        }
        case "chat": {
          // R4-08: 禁言拒收；文本过敏感词过滤（命中替换为 ***，不改消息 ID/时间戳）
          if (isMuted(userId)) {
            // R5: 禁言期间发消息时回推 mute_status，前端 MuteIndicator 显示倒计时
            const until = getMutedUntil(userId);
            safeSend(socket, { type: "mute_status", muted: true, ...(until ? { mutedUntil: until } : {}), reason: "muted" } satisfies WSMessage);
            return;
          }
          const raw = String(data.text ?? "").slice(0, 500);
          if (!raw) return;
          const mod = moderateText(userId, raw);
          // R5: 命中敏感词累计计数，达阈值自动禁言 5 分钟并通知本人
          if (mod.hit) {
            // R5 嫁接：L1 替换留痕（审计台账 + totalReplaced 统计）
            recordReplaceEvent(userId, listMatchedWords(raw), raw, mod.text);
            const hit = recordProfanityHit(userId);
            if (hit.autoMuted && hit.mutedUntil) {
              safeSend(socket, { type: "mute_status", muted: true, mutedUntil: hit.mutedUntil, reason: "profanity" } satisfies WSMessage);
            }
          }
          broadcastToRoom(roomId, {
            type: "chat",
            userId,
            nickname,
            text: mod.text,
          } satisfies WSMessage);

          // ===== R4-07: 房间内 @提及解析 =====
          // 匹配 @昵称（昵称不含空白），与本房间在线用户昵称做精确匹配。
          const mentionTokens = mod.text.match(/@(\S+)/g) ?? [];
          if (mentionTokens.length > 0) {
            const mentionedUserIds: string[] = [];
            for (const token of mentionTokens) {
              const name = token.slice(1);
              for (const u of room.users.values()) {
                if (u.userId === userId) continue;
                if (u.nickname === name && !mentionedUserIds.includes(u.userId)) {
                  mentionedUserIds.push(u.userId);
                }
              }
            }
            if (mentionedUserIds.length > 0) {
              const mentionEvent = {
                roomId,
                ...(roomId.startsWith("social:") ? { roomCode: roomId.slice("social:".length) } : {}),
                fromUserId: userId,
                fromNickname: nickname,
                text: mod.text,
                mentionedUserIds,
                timestamp: new Date().toISOString(),
              };
              for (const uid of mentionedUserIds) {
                const target = room.users.get(uid);
                if (target) safeSend(target.socket, { type: "mention", mention: mentionEvent } satisfies WSMessage);
              }
            }
          }
          break;
        }
        case "private_message": {
          // ===== R4-07: 私聊 =====
          const toUserId = String(data.toUserId ?? "");
          const text = String(data.text ?? "");
          try {
            const message = sendPrivateMessage(userId, toUserId, text);
            // 回送给发送方确认（含 messageId/timestamp）
            safeSend(socket, { type: "private_message", message } satisfies WSMessage);
          } catch (e) {
            const err = e as ChatError;
            safeSend(socket, {
              type: "private_message_error",
              messageId: typeof data.messageId === "string" ? data.messageId : undefined,
              error: err.message ?? "发送失败",
            } satisfies WSMessage);
          }
          break;
        }
        case "message_read": {
          // ===== R4-07: 已读回执 =====
          const conversationId = String(data.conversationId ?? "");
          const lastReadMessageId = String(data.lastReadMessageId ?? "");
          if (conversationId && lastReadMessageId) {
            markRead(conversationId, userId, lastReadMessageId);
          }
          break;
        }
        // ===== R5: 组队 / 约局（additive 分支；业务逻辑在 party.ts） =====
        case "party_create": {
          try {
            createParty(userId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "创建队伍失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_invite": {
          const toUserId = String(data.toUserId ?? "");
          const message = typeof data.message === "string" ? data.message : undefined;
          try {
            inviteToParty(userId, toUserId, message);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "邀请失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_join_request": {
          const partyId = String(data.partyId ?? "");
          try {
            joinParty(userId, partyId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "加入队伍失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_ready": {
          const partyId = String(data.partyId ?? "");
          const ready = data.ready === true;
          try {
            setReady(userId, partyId, ready);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "操作失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_leave": {
          const partyId = String(data.partyId ?? "");
          try {
            leaveParty(userId, partyId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "离开失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_choose_scene": {
          const partyId = String(data.partyId ?? "");
          const sceneId = String(data.sceneId ?? "") as import("@balabala/shared").SceneId;
          try {
            chooseScene(userId, partyId, sceneId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "选择场景失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_start": {
          const partyId = String(data.partyId ?? "");
          try {
            startGame(userId, partyId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "开局失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "party_disband": {
          const partyId = String(data.partyId ?? "");
          try {
            disbandParty(partyId, userId);
          } catch (e) {
            const err = e as PartyError;
            safeSend(socket, { type: "error", message: err.message ?? "解散失败", code: err.code } satisfies WSMessage);
          }
          break;
        }
        case "user_speech": {
          if (isMuted(userId)) return;
          const raw = String(data.text ?? "").slice(0, 500);
          if (!raw) return;
          const mod = moderateText(userId, raw);
          broadcastToRoom(roomId, {
            type: "user_speech",
            userId,
            nickname,
            text: mod.text,
          } satisfies WSMessage);
          break;
        }
        case "user_vote": {
          const vote = data.vote === "plaintiff" || data.vote === "defendant" ? data.vote : null;
          if (!vote) return;
          // 更新法庭状态中的投票数
          if (room.courtState) {
            room.courtState.votes[vote] += 1;
          }
          broadcastToRoom(roomId, {
            type: "user_vote",
            userId,
            vote,
          } satisfies WSMessage);
          break;
        }
        case "scene_event": {
          // M8: 场景事件透传广播（由各场景后端也可直接调用 broadcastSceneEvent）
          const scene = String(data.scene ?? "") as SceneId;
          const event = (data.event ?? {}) as Record<string, unknown>;
          if (!scene) return;
          broadcastToRoom(roomId, { type: "scene_event", scene, event } satisfies WSMessage);
          break;
        }
        case "werewolf_action": {
          // M9: 狼人杀行动，服务端按身份与阶段校验后推进状态机。
          if (!roomId.startsWith("werewolf:")) return;
          const gameId = roomId.slice("werewolf:".length);
          const action = data.action as import("@balabala/shared").WerewolfClientAction | undefined;
          if (!action || typeof action !== "object" || typeof action.type !== "string") return;
          werewolfHandleAction(gameId, userId, action);
          break;
        }
        case "court_player_speech": {
          // R4-05: 法庭真人玩家当庭发言，纳入多人庭审流程（轮到该真人时上屏，否则缓冲）。
          if (!roomId.startsWith("court:")) return;
          const caseId = roomId.slice("court:".length);
          const text = String(data.text ?? "").slice(0, 400);
          if (!text) return;
          getMultiplayerCourt(caseId)?.submitSpeech(userId, text);
          break;
        }
        case "bar_player_speech": {
          // R4-05: 酒吧真人辩手发言。
          if (!roomId.startsWith("bar:")) return;
          const sessionId = roomId.slice("bar:".length);
          const side = data.side === "pro" || data.side === "con" ? data.side : null;
          const text = String(data.text ?? "").slice(0, 400);
          if (!side || !text) return;
          getMultiplayerBar(sessionId)?.submitSpeech(userId, side, text);
          break;
        }
        case "gym_cheer": {
          // M11: 健身加油广播（R4-08 同样过敏感词/禁言）
          if (!roomId.startsWith("gym:")) return;
          if (isMuted(userId)) return;
          const raw = String(data.text ?? "").slice(0, 200);
          if (!raw) return;
          const mod = moderateText(userId, raw);
          broadcastToRoom(roomId, {
            type: "gym_cheer",
            userId,
            nickname,
            text: mod.text,
          } satisfies WSMessage);
          break;
        }
        case "gym_checkin_notify": {
          // M11: 客户端主动通知打卡，广播给房间其他人
          if (!roomId.startsWith("gym:")) return;
          const exerciseName = String(data.exerciseName ?? "训练").slice(0, 60);
          const entry = { userId, nickname, exerciseName, createdAt: new Date().toISOString() };
          pushGymRecentCheckin(entry);
          broadcastToRoom(roomId, {
            type: "gym_checkin_broadcast",
            userId,
            nickname,
            exerciseName,
            createdAt: entry.createdAt,
          } satisfies WSMessage);
          break;
        }
        case "text_shout": {
          // R4-08: 3D 头顶文字喊话（语音不可用时的回落），过敏感词/禁言
          if (isMuted(userId)) {
            const until = getMutedUntil(userId);
            safeSend(socket, { type: "mute_status", muted: true, ...(until ? { mutedUntil: until } : {}), reason: "muted" } satisfies WSMessage);
            return;
          }
          const raw = String(data.text ?? "").slice(0, 80);
          if (!raw) return;
          const mod = moderateText(userId, raw);
          if (mod.hit) {
            // R5 嫁接：L1 替换留痕（审计台账 + totalReplaced 统计）
            recordReplaceEvent(userId, listMatchedWords(raw), raw, mod.text);
            const hit = recordProfanityHit(userId);
            if (hit.autoMuted && hit.mutedUntil) {
              safeSend(socket, { type: "mute_status", muted: true, mutedUntil: hit.mutedUntil, reason: "profanity" } satisfies WSMessage);
            }
          }
          broadcastToRoom(roomId, {
            type: "text_shout",
            userId,
            nickname,
            text: mod.text,
            at: Date.now(),
          } satisfies WSMessage);
          break;
        }
        case "court_perspective": {
          // M13: 用户切换视角，更新该用户的视角，单发过滤后快照
          if (!roomId.startsWith("court:")) return;
          const perspective = data.perspective === "plaintiff" || data.perspective === "defendant" || data.perspective === "audience"
            ? (data.perspective as Perspective)
            : "audience";
          if (room.courtState) {
            if (!room.courtState.perspectives) room.courtState.perspectives = {};
            room.courtState.perspectives[userId] = perspective;
          }
          // 单发过滤后的快照
          const caseId = roomId.slice("court:".length);
          const full = getCourtCase(caseId);
          if (full) {
            const filtered = filterCaseForPerspective(full, perspective);
            safeSend(socket, { type: "court_snapshot_v2", case: filtered } satisfies WSMessage);
          }
          break;
        }
        case "rtc_sdp": {
          // 社交临场感：WebRTC SDP 信令转发（offer/answer），服务端不解析内容
          const to = String(data.to ?? "");
          const target = room.users.get(to);
          if (!target) return;
          safeSend(target.socket, {
            type: "rtc_sdp",
            from: userId,
            to,
            sdp: data.sdp as { type: "offer" | "answer" | "pranswer" | "rollback"; sdp: string },
          } satisfies WSMessage);
          break;
        }
        case "rtc_ice": {
          // 社交临场感：WebRTC ICE candidate 转发
          const to = String(data.to ?? "");
          const target = room.users.get(to);
          if (!target) return;
          safeSend(target.socket, {
            type: "rtc_ice",
            from: userId,
            to,
            candidate: data.candidate as { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null },
          } satisfies WSMessage);
          break;
        }
        case "rtc_bye": {
          // 社交临场感：通知对方关闭 PeerConnection
          const to = String(data.to ?? "");
          const target = room.users.get(to);
          if (!target) return;
          safeSend(target.socket, { type: "rtc_bye", from: userId, to } satisfies WSMessage);
          break;
        }
        case "emote": {
          // 社交临场感：表情/手势动作，节流后广播给房间其他人
          const emote = String(data.emote ?? "");
          if (!VALID_EMOTES.has(emote)) return;
          if (roomUser.lastEmote && now - roomUser.lastEmote < EMOTE_THROTTLE_MS) return;
          roomUser.lastEmote = now;
          roomUser.animation = emote;
          if (emote === "laugh") roomUser.expression = "happy";
          else if (emote === "surprised") roomUser.expression = "surprised";
          const durationMs = typeof data.durationMs === "number" ? Math.min(Math.max(data.durationMs, 300), 5000) : 1500;
          // 广播给其他人（不含自己）
          for (const u of room.users.values()) {
            if (u.userId === userId) continue;
            safeSend(u.socket, { type: "emote", userId, emote: emote as EmoteType, durationMs } satisfies WSMessage);
          }
          break;
        }
        case "talking": {
          // 社交临场感：说话强度更新，节流后广播给房间其他人
          const intensity = Math.min(Math.max(Number(data.intensity ?? 0), 0), 1);
          roomUser.talkingIntensity = intensity;
          if (intensity > 0.05) roomUser.animation = "talking";
          else if (roomUser.animation === "talking") roomUser.animation = "idle";
          // 节流广播，避免高频刷屏
          if (!roomUser.lastTalkingBroadcast || now - roomUser.lastTalkingBroadcast >= TALKING_BROADCAST_MS) {
            roomUser.lastTalkingBroadcast = now;
            for (const u of room.users.values()) {
              if (u.userId === userId) continue;
              safeSend(u.socket, { type: "talking", userId, intensity } satisfies WSMessage);
            }
          }
          break;
        }
        case "report_user": {
          // Round4 R4-03：安全模块举报 —— 记录到 .data/reports.log（每行 JSON）
          const targetUserId = String(data.targetUserId ?? "").trim();
          if (!targetUserId) {
            safeSend(socket, { type: "report_ack", accepted: false } satisfies WSMessage);
            return;
          }
          const reason = String(data.reason ?? "").slice(0, 500);
          const rawCategory = String(data.category ?? "other");
          const category = (VALID_REPORT_CATEGORIES.has(rawCategory) ? rawCategory : "other") as ReportCategory;
          appendReportLog({
            reportedAt: new Date().toISOString(),
            reporterUserId: userId,
            reporterNickname: nickname,
            targetUserId,
            reason,
            category,
            room: roomId,
          });
          // R5: 同时写结构化 JSON（.data/reports/<id>.json），供 admin 列表/处置
          recordStructuredReport({
            reportedAt: new Date().toISOString(),
            reporterUserId: userId,
            reporterNickname: nickname,
            targetUserId,
            reason,
            category,
            room: roomId,
          });
          // R4-08: 该 target 24h 内被举报达到阈值 → 自动临时禁言 10 分钟
          registerReport(targetUserId);
          safeSend(socket, { type: "report_ack", accepted: true, reportedAt: new Date().toISOString() } satisfies WSMessage);
          break;
        }
        case "request_replay": {
          // R5: 客户端检测到 presence 序号跳变后请求补发。这里重发一次当前房间
          // presence 快照给该连接，使其位置状态自愈（不重播历史聊天，避免重复弹 toast）。
          const r = rooms.get(roomId);
          if (!r) break;
          const all = [...r.users.values()].map((u) => ({
            userId: u.userId,
            x: u.x,
            z: u.z,
            rotation: u.rotation,
            seq: u.seq ?? 0,
          }));
          safeSend(socket, { type: "presence", users: all } satisfies WSMessage);
          break;
        }
        case "ping": {
          safeSend(socket, { type: "pong" } satisfies WSMessage);
          break;
        }
      }
    });

    // ===== 断开清理 =====
    socket.on("close", () => {
      metrics.wsDisconnected();
      // ===== R4-07: 全局连接注册表清理（无论房间守卫是否通过都要执行） =====
      {
        const set = globalUserSockets.get(userId);
        if (set) {
          for (const entry of set) {
            if (entry.socket === socket) set.delete(entry);
          }
          if (set.size === 0) {
            globalUserSockets.delete(userId);
            // 最后一条连接断开：通知好友 offline
            friendsNotifyOffline(userId);
          }
        }
      }

      const r = rooms.get(roomId);
      // 守卫：仅当房间内该 userId 当前指向的仍是本 socket 时才处理，
      // 避免旧连接关闭时误删已被新连接替换的条目。
      const rec = r?.users.get(userId);
      if (!r || !rec || rec.socket !== socket) return;

      if (rec.sessionToken && cameWithSessionToken) {
        // ===== R4-01: 带 token 客户端——进入断线宽限期，不立即移除 =====
        rec.reconnecting = true;
        if (!rec.messageBuffer) rec.messageBuffer = [];
        // 通知其他人：该玩家正在重连，勿立即从场景移除（化身冻结保留）
        broadcastToRoom(roomId, {
          type: "player_reconnecting",
          userId,
          graceMs: reconnectGraceMs,
        } satisfies WSMessage);

        rec.graceTimer = setTimeout(() => {
          // 宽限期超时：仅当记录仍指向自己（期间未被重连/新连接替换）才真正清理。
          if (r.users.get(userId) !== rec) return;
          r.users.delete(userId);
          if (rec.sessionToken) sessionIndex.delete(rec.sessionToken);
          rec.messageBuffer = undefined;
          rec.graceTimer = undefined;
          if (roomId.startsWith("gym:")) {
            broadcastToRoom(roomId, { type: "gym_user_left", userId } satisfies WSMessage);
          } else {
            broadcastToRoom(roomId, { type: "player_left", userId } satisfies WSMessage);
          }
          // Round3: social 房间——全员广播断线后的实时人数
          if (roomId.startsWith("social:")) {
            broadcastToRoom(roomId, { type: "room_player_update", roomId, playerCount: r.users.size });
          }
          // R4-05: 真人永久离开，AI 接管其玩法角色位
          notifyGameplayPlayerLeft(roomId, userId);
          // 房间空了可清理（保留 court 房间状态以便重连）
          if (r.users.size === 0 && roomId === "plaza") {
            rooms.delete(roomId);
          }
        }, reconnectGraceMs);
        // 测试/部署时不希望计时器挂住事件循环
        rec.graceTimer.unref?.();
      } else {
        // ===== 旧客户端（未带 sessionToken 会话）：保持原逻辑，立即移除 =====
        r.users.delete(userId);
        if (roomId.startsWith("gym:")) {
          broadcastToRoom(roomId, { type: "gym_user_left", userId } satisfies WSMessage);
        } else {
          broadcastToRoom(roomId, { type: "user_left", userId } satisfies WSMessage);
        }
        // Round3: social 房间——全员广播断线后的实时人数
        if (roomId.startsWith("social:")) {
          broadcastToRoom(roomId, { type: "room_player_update", roomId, playerCount: r.users.size });
        }
        // R4-05: 真人立即离开，AI 接管其玩法角色位
        notifyGameplayPlayerLeft(roomId, userId);
        // 房间空了可清理（保留 court 房间状态以便重连）
        if (r.users.size === 0 && roomId === "plaza") {
          rooms.delete(roomId);
        }
      }
    });

    socket.on("error", () => {
      metrics.wsError();
      // 忽略，close 会触发
    });
  });
}
