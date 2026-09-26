// ===== M7: WebSocket 实时多人 =====
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
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
  type HeartbeatConfig,
  type SessionToken,
} from "@balabala/shared";
import { getCourtCase } from "./db.js";
import { getSocialRoom, transferSocialRoomOwner } from "./room-routes.js";
import { filterCaseForPerspective } from "./court-state.js";
import * as db from "./db.js";
import { handleAction as werewolfHandleAction, getSnapshotForPlayer as werewolfSnapshot } from "./werewolf-orchestrator.js";
import {
  TransportEngine,
  makeProgress,
  type TransportSession,
} from "./transport.js";

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
  // —— 传输层/断线重连扩展（全部可选，向后兼容） ——
  /** 关联的会话 id（welcome 签发，重连携带）。 */
  sessionId?: string;
  /** active=socket 在线；reconnecting=断线保留窗口，席位不删。 */
  state?: "active" | "reconnecting";
  /** 加入时间戳（房主转移时挑选最早成员）。 */
  joinedAt?: number;
  /** 连续发送失败计数（超过阈值主动断开）。 */
  sendFailures?: number;
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
}

const rooms = new Map<string, Room>();

/** gym:lobby 最近打卡广播缓冲（最多保留 5 条）。 */
const gymRecentCheckins: Array<{ userId: string; nickname: string; exerciseName: string; createdAt: string }> = [];
const GYM_CHECKIN_BUFFER_MAX = 5;

/** 社交临场感：emote 最小间隔（ms），防止刷屏 */
const EMOTE_THROTTLE_MS = 300;
const VALID_EMOTES: ReadonlySet<string> = new Set(["wave", "nod", "shake", "point", "clap", "laugh", "surprised"]);
/** talking 消息最小广播间隔（ms），说话强度变化频繁时节流 */
const TALKING_BROADCAST_MS = 120;

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

function wsUserOf(u: RoomUser): WSUser {
  return {
    userId: u.userId,
    nickname: u.nickname,
    avatarType: u.avatarType,
    avatarRef: u.avatarRef,
    x: u.x,
    z: u.z,
    rotation: u.rotation,
  };
}

function safeSend(socket: WebSocket, msg: WSMessage): void {
  try {
    // 中继稳定性：发送前严格校验 readyState，避免向 CLOSING/CLOSED socket 写入。
    if (socket.readyState !== socket.OPEN) return;
    const data = JSON.stringify(msg);
    if (data.length > transport.config.maxMessageBytes) {
      // 消息过大：拒绝发送（分片由上层规避；presence 本就高频小包）。
      return;
    }
    socket.send(data);
    noteSendSuccess(socket);
  } catch {
    noteSendFailure(socket);
  }
}

/** 连续发送失败达到阈值即主动断开该连接，避免半写坏连接长期占用席位。 */
const MAX_CONSECUTIVE_SEND_FAILURES = 5;
function noteSendSuccess(socket: WebSocket): void {
  const user = findUserBySocket(socket);
  if (user) user.sendFailures = 0;
}
function noteSendFailure(socket: WebSocket): void {
  const user = findUserBySocket(socket);
  if (!user) return;
  user.sendFailures = (user.sendFailures ?? 0) + 1;
  if (user.sendFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
    try { socket.close(); } catch { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
// 传输层引擎（心跳/会话/在途补发/平滑断开）——模块级单例
// 超时参数可用环境变量覆盖（e2e 压测/CI 缩短窗口用），默认值见 transport.ts。
// ---------------------------------------------------------------------------
function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const transport = new TransportEngine({
  config: {
    heartbeatTimeoutMs: envInt("TRANSPORT_HEARTBEAT_TIMEOUT_MS", 45_000),
    reconnectWindowMs: envInt("TRANSPORT_RECONNECT_WINDOW_MS", 120_000),
    pingIntervalMs: envInt("TRANSPORT_PING_INTERVAL_MS", 15_000),
  },
  hooks: {
    onHeartbeatTimeout: (session) => {
      // half-open：服务端权威判定掉线，强制关闭 socket（随后 close 进入平滑窗口）。
      try { session.socket?.close(); } catch { /* noop */ }
    },
    onGraceExpired: (session) => finalizeRemoval(session),
  },
});

/** 供测试使用：清空传输引擎状态，保证用例隔离。 */
export function _resetTransportForTest(): void {
  transport.reset();
}

/** 按 socket 反查房间内用户（用于发送失败计数）。 */
function findUserBySocket(socket: WebSocket): RoomUser | undefined {
  for (const room of rooms.values()) {
    for (const u of room.users.values()) {
      if (u.socket === socket) return u;
    }
  }
  return undefined;
}

/** 房间当前活跃（active，不含 reconnecting）人数。 */
export function activePlayerCount(roomId: string): number {
  const room = rooms.get(roomId);
  if (!room) return 0;
  let n = 0;
  for (const u of room.users.values()) if ((u.state ?? "active") === "active") n += 1;
  return n;
}

/**
 * 可补发广播：先分配单调 seq 并环形缓冲，再广播给房间。
 * 高频 presence/move 不走这里（状态同步由同步分片负责，不做补发）。
 */
export function broadcastReplayable(roomId: string, message: unknown): void {
  transport.bufferBroadcast(roomId, message);
  broadcastToRoom(roomId, message);
}

/**
 * 平滑窗口到期：真正移除席位、广播 user_left、必要时转移房主。
 */
function finalizeRemoval(session: TransportSession): void {
  const room = rooms.get(session.roomId);
  const userId = session.userId;
  if (room) {
    // 房主转移兜底：掉线者是房主且房间仍有其他人 -> 转给最早加入者。
    maybeTransferOwnerOnRemoval(room, userId);
    room.users.delete(userId);
    if (session.roomId.startsWith("gym:")) {
      broadcastReplayable(room.id, { type: "gym_user_left", userId } satisfies WSMessage);
    } else {
      broadcastReplayable(room.id, { type: "user_left", userId } satisfies WSMessage);
    }
    if (session.roomId.startsWith("social:")) {
      broadcastReplayable(room.id, { type: "room_player_update", roomId: room.id, playerCount: activePlayerCount(room.id) });
    }
  }
  transport.destroySession(session);
}

/** 房主转移兜底：仅 social 房间；掉线者为 creatorId 且房间仍有其他成员时转移给最早加入者。 */
function maybeTransferOwnerOnRemoval(room: Room, leaverUserId: string): void {
  if (!room.id.startsWith("social:")) return;
  const code = room.id.slice("social:".length);
  const meta = getSocialRoom(code);
  if (!meta || meta.creatorId !== leaverUserId) return;
  // 选最早加入的其他成员（按 joinedAt）。
  let earliest: RoomUser | undefined;
  for (const u of room.users.values()) {
    if (u.userId === leaverUserId) continue;
    if ((u.state ?? "active") !== "active") continue;
    if (!earliest || (u.joinedAt ?? 0) < (earliest.joinedAt ?? 0)) earliest = u;
  }
  if (!earliest) return; // 房间空了：保留房主信息等待重连或惰性解散
  transferSocialRoomOwner(code, earliest.userId, earliest.nickname);
  broadcastReplayable(room.id, {
    type: "room_owner_changed",
    oldOwnerId: leaverUserId,
    newOwnerId: earliest.userId,
  } satisfies WSMessage);
}

/** 向房间内所有人广播。 */
export function broadcastToRoom(roomId: string, message: unknown): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const user of room.users.values()) {
    try {
      if (user.socket.readyState === user.socket.OPEN) {
        user.socket.send(payload);
      }
    } catch {
      noteSendFailure(user.socket);
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
  // 仅统计 active（不含 reconnecting 保留窗口中的离线席位）。
  return activePlayerCount(roomId);
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

// ===== 注册 WebSocket 路由 =====
export function registerWebSocket(app: FastifyInstance): void {
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const userId = url.searchParams.get("userId") ?? "";
    const roomId = url.searchParams.get("room") ?? "";

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
        safeSend(socket, { type: "error", message: "房间不存在或已解散" });
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

    // Round3: social 房间人数上限（同 userId 重连替换旧连接不占新名额）
    if (socialMeta && !room.users.has(userId) && room.users.size >= socialMeta.maxPlayers) {
      safeSend(socket, { type: "error", message: "房间已满" });
      socket.close();
      return;
    }

    // ===== 传输层：判断是「断线恢复」还是「全新加入」 =====
    // 恢复信号来自 URL query（sessionId / lastServerSeq），让服务端在握手阶段即分支，
    // 避免先发 fresh welcome 再回滚。旧客户端不带 sessionId -> 全新路径（向后兼容）。
    const sessionIdQuery = url.searchParams.get("sessionId");
    const lastServerSeqQuery = Number(url.searchParams.get("lastServerSeq") ?? 0) || 0;

    let roomUser!: RoomUser;
    let session: TransportSession | undefined;
    let resumed = false;

    if (sessionIdQuery) {
      const outcome = transport.tryResume({ sessionId: sessionIdQuery, newSocket: socket, lastServerSeq: lastServerSeqQuery });
      if (outcome.accepted && outcome.session) {
        resumed = true;
        session = outcome.session;
        const existing = room.users.get(userId);
        if (existing) {
          // 恢复席位：保留原 x/z/rotation/joinedAt，仅换 socket，不重新分配位置。
          existing.socket = socket;
          existing.state = "active";
          existing.sessionId = session.sessionId;
          existing.sendFailures = 0;
          roomUser = existing;
        } else {
          roomUser = {
            userId, nickname, avatarType, avatarRef, x: 0, z: 0, rotation: 0, lastMove: 0, socket,
            sessionId: session.sessionId, state: "active", joinedAt: Date.now(),
          };
          room.users.set(userId, roomUser);
        }
        // 分批推送重连进度：resuming -> replaying -> syncing_state -> done
        safeSend(socket, makeProgress("resuming", 0.1, "恢复会话"));
        safeSend(socket, makeProgress("replaying", 0.3, `补发 ${outcome.missed.length} 条在途消息`));
        for (const b of outcome.missed) safeSend(socket, b.message as WSMessage);
        safeSend(socket, makeProgress("syncing_state", 0.7, "同步房间状态"));
        const users = [...room.users.values()].map(wsUserOf);
        const token: SessionToken = {
          sessionId: session.sessionId, userId, roomId,
          issuedAt: session.issuedAt, expiresAt: session.expiresAt,
        };
        safeSend(socket, {
          type: "welcome", roomId, users, resumed: true,
          heartbeat: outcome.heartbeat, sessionToken: token,
        } satisfies WSMessage);
        safeSend(socket, makeProgress("done", 1, "恢复完成"));
        safeSend(socket, {
          type: "reconnect_response", accepted: true, sessionId: session.sessionId, progress: 1, users,
        } satisfies WSMessage);
        broadcastReplayable(roomId, { type: "player_reconnected", userId } satisfies WSMessage);
        if (socialMeta) {
          broadcastReplayable(roomId, { type: "room_player_update", roomId, playerCount: activePlayerCount(roomId) });
        }
      } else {
        // 恢复被拒（会话过期/无效）：告知客户端，随后按全新连接加入。
        safeSend(socket, {
          type: "reconnect_response", accepted: false, sessionId: sessionIdQuery, reason: outcome.reason,
        } satisfies WSMessage);
      }
    }

    // ===== 全新加入路径 =====
    if (!resumed) {
      const issued = transport.issueSession(userId, roomId, socket);
      session = issued.session;
      roomUser = {
        userId, nickname, avatarType, avatarRef,
        x: randomPos(), z: randomPos(), rotation: 0, lastMove: 0, socket,
        sessionId: session.sessionId, state: "active", joinedAt: Date.now(),
      };

      // 加入房间。若该 userId 已存在旧连接（同用户多标签/重连），先关闭旧 socket 再替换。
      const existingUser = room.users.get(userId);
      if (existingUser && existingUser.socket !== socket) {
        try { existingUser.socket.close(); } catch { /* noop */ }
      }
      room.users.set(userId, roomUser);

      // 发送 welcome 快照（携带心跳配置与会话 Token）
      const welcome: WSMessage = {
        type: "welcome",
        roomId,
        users: [...room.users.values()].map(wsUserOf),
        ...(room.courtState ? { courtState: room.courtState } : {}),
        ...(room.sceneState ? { sceneState: room.sceneState } : {}),
        heartbeat: issued.heartbeat,
        sessionToken: issued.token,
      };
      safeSend(socket, welcome);
    }

    // ===== 以下仅全新加入时执行；恢复路径已在上面完成快照/补发 =====
    if (!resumed) {
      // Round3: social 房间——向新连接单发房间元数据（playerCount 取当前活跃数）
      if (socialMeta) {
        const roomInfo: SocialRoom = { ...socialMeta, playerCount: activePlayerCount(roomId) };
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
          const perspective: Perspective = (room.courtState?.perspectives?.[userId] as Perspective) ?? "audience";
          const filtered = filterCaseForPerspective(courtCase, perspective);
          safeSend(socket, { type: "court_snapshot_v2", case: filtered } satisfies WSMessage);
        }
      }

      // 通知其他人（可补发：重连者能得知离开期间谁加入了）
      if (roomId.startsWith("gym:")) {
        broadcastReplayable(roomId, {
          type: "gym_user_joined",
          user: { userId, nickname, avatarType, avatarRef, x: roomUser.x, z: roomUser.z, rotation: roomUser.rotation },
        } satisfies WSMessage);
      } else {
        broadcastReplayable(roomId, { type: "user_joined", user: wsUserOf(roomUser) } satisfies WSMessage);
      }

      // Round3: social 房间——全员（含自己）广播实时活跃人数
      if (socialMeta) {
        broadcastReplayable(roomId, { type: "room_player_update", roomId, playerCount: activePlayerCount(roomId) });
      }
    }

    // ===== 消息处理 =====
    socket.on("message", (raw: Buffer) => {
      // 中继稳定性：入站消息大小守卫，过大直接丢弃。
      if (raw.length > transport.config.maxMessageBytes) {
        safeSend(socket, { type: "error", message: "MESSAGE_TOO_LARGE" } satisfies WSMessage);
        return;
      }
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
          // 10Hz 节流：距上次 <100ms 丢弃
          if (now - roomUser.lastMove < 100) return;
          roomUser.x = x;
          roomUser.z = z;
          roomUser.rotation = rotation;
          roomUser.lastMove = now;
          if (roomId.startsWith("gym:")) {
            const gymUsers = [...room.users.values()]
              .filter((u) => u.userId !== userId)
              .map((u) => ({ userId: u.userId, x: u.x, z: u.z, rotation: u.rotation }));
            broadcastToRoom(roomId, { type: "gym_presence", users: gymUsers } satisfies WSMessage);
          } else {
            // 广播给房间内其他人（携带社交临场感扩展字段）
            const others = [...room.users.values()]
              .filter((u) => u.userId !== userId)
              .map((u) => ({
                userId: u.userId,
                x: u.x,
                z: u.z,
                rotation: u.rotation,
                ...(u.talkingIntensity !== undefined ? { talkingIntensity: u.talkingIntensity } : {}),
                ...(u.animation !== undefined ? { animation: u.animation } : {}),
                ...(u.expression !== undefined ? { expression: u.expression } : {}),
                ...(u.headTarget !== undefined ? { headTarget: u.headTarget } : {}),
              }));
            broadcastToRoom(roomId, { type: "presence", users: others } satisfies WSMessage);
          }
          break;
        }
        case "chat": {
          const text = String(data.text ?? "").slice(0, 500);
          if (!text) return;
          broadcastReplayable(roomId, {
            type: "chat",
            userId,
            nickname,
            text,
          } satisfies WSMessage);
          break;
        }
        case "user_speech": {
          const text = String(data.text ?? "").slice(0, 500);
          if (!text) return;
          broadcastReplayable(roomId, {
            type: "user_speech",
            userId,
            nickname,
            text,
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
          broadcastReplayable(roomId, {
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
        case "gym_cheer": {
          // M11: 健身加油广播
          if (!roomId.startsWith("gym:")) return;
          const text = String(data.text ?? "").slice(0, 200);
          if (!text) return;
          broadcastReplayable(roomId, {
            type: "gym_cheer",
            userId,
            nickname,
            text,
          } satisfies WSMessage);
          break;
        }
        case "gym_checkin_notify": {
          // M11: 客户端主动通知打卡，广播给房间其他人
          if (!roomId.startsWith("gym:")) return;
          const exerciseName = String(data.exerciseName ?? "训练").slice(0, 60);
          const entry = { userId, nickname, exerciseName, createdAt: new Date().toISOString() };
          pushGymRecentCheckin(entry);
          broadcastReplayable(roomId, {
            type: "gym_checkin_broadcast",
            userId,
            nickname,
            exerciseName,
            createdAt: entry.createdAt,
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
        case "ping": {
          // 心跳：服务端维护每连接最后 ping 时间，pong 回带 clientSeq/serverTs/playerCount。
          if (session && session.socket === socket) {
            const pong = transport.applyPing(session, Number(data.clientSeq), activePlayerCount(roomId));
            safeSend(socket, { type: "pong", ...pong } satisfies WSMessage);
          } else {
            safeSend(socket, { type: "pong" } satisfies WSMessage);
          }
          break;
        }
      }
    });

    // ===== 断开：平滑移除（不立即删席位，进入重连窗口） =====
    socket.on("close", () => {
      const r = rooms.get(roomId);
      // 守卫：仅当房间内该 userId 当前指向的仍是本 socket 时才处理，
      // 避免旧连接关闭时误删已被新连接替换/恢复的条目。
      if (!r || r.users.get(userId)?.socket !== socket) return;
      const u = r.users.get(userId)!;
      u.state = "reconnecting";
      u.sendFailures = 0;

      const sess = transport.getSessionByUser(roomId, userId);
      if (sess && sess.state === "active") {
        transport.beginGraceful(sess);
      }
      // 广播 player_disconnecting（含重连窗口），席位保留；其他人暂不立即移除该玩家。
      broadcastReplayable(roomId, {
        type: "player_disconnecting",
        userId,
        reconnectWindowMs: transport.config.reconnectWindowMs,
      } satisfies WSMessage);
      if (roomId.startsWith("social:")) {
        broadcastReplayable(roomId, { type: "room_player_update", roomId, playerCount: activePlayerCount(roomId) });
      }
      // 真正的 user_left 由看门狗在重连窗口到期后触发（finalizeRemoval）。
    });

    socket.on("error", () => {
      // 忽略，close 会触发
    });
  });
}

// 启动传输层看门狗：周期扫描心跳超时与平滑窗口到期，触发服务端权威判定。
const WATCHDOG_INTERVAL_MS = envInt("TRANSPORT_WATCHDOG_MS", 5_000);
setInterval(() => {
  try { transport.tick(Date.now()); } catch { /* noop */ }
}, WATCHDOG_INTERVAL_MS).unref?.();
