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
  type StateSyncConfig,
  NetErrorCode,
} from "@balabala/shared";
import { getCourtCase } from "./db.js";
import { getSocialRoom } from "./room-routes.js";
import { filterCaseForPerspective } from "./court-state.js";
import * as db from "./db.js";
import { handleAction as werewolfHandleAction, getSnapshotForPlayer as werewolfSnapshot } from "./werewolf-orchestrator.js";
import {
  DEFAULT_STATE_SYNC_CONFIG,
  SeqTracker,
  SlidingWindowRateLimiter,
  RoomPresenceAggregator,
  batchPlayersBySize,
  type BroadcastPlayerState,
} from "./state-sync-server.js";

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
  // —— 实时状态同步：序号去重/乱序检测 + 发送频率限流（每用户） ——
  seqTracker: SeqTracker;
  rateLimiter: SlidingWindowRateLimiter;
};

export type Room = {
  id: string;
  users: Map<string, RoomUser>;
  courtState?: CourtRoomState;
  sceneState?: SceneRoomState;
  /** presence 聚合器：按固定 tick 聚合本房间的高频状态更新。 */
  presence: RoomPresenceAggregator;
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
    room = { id: roomId, users: new Map(), presence: new RoomPresenceAggregator() };
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
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  } catch {
    // 忽略发送失败（可能已断开）
  }
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

// ===== 实时状态同步：presence 聚合广播 / 快照 / 错误下发 =====

/** 把 RoomUser 序列化为带 serverTs + lastKnownSeq 的广播状态。 */
function toBroadcastPlayerState(u: RoomUser, now: number): BroadcastPlayerState {
  return {
    userId: u.userId,
    x: u.x,
    z: u.z,
    rotation: u.rotation,
    ...(u.talkingIntensity !== undefined ? { talkingIntensity: u.talkingIntensity } : {}),
    ...(u.animation !== undefined ? { animation: u.animation } : {}),
    ...(u.expression !== undefined ? { expression: u.expression } : {}),
    ...(u.headTarget !== undefined ? { headTarget: u.headTarget } : {}),
    serverTs: now,
    // 携带服务端已知该用户的最新 seq，供客户端检测 gap 并请求快照。
    ...(u.seqTracker.lastSeq !== undefined ? { lastKnownSeq: u.seqTracker.lastSeq } : {}),
  };
}

/**
 * flush 一个房间的 presence：若本 tick 有状态变化，按 4KB 分批广播聚合后的玩家状态。
 * 返回本 tick 实际发送的批次数（测试观测用）。
 */
export function flushRoomPresence(roomId: string): number {
  const room = rooms.get(roomId);
  if (!room || !room.presence.takeDirty()) return 0;
  const now = Date.now();
  const players = [...room.users.values()].map((u) => toBroadcastPlayerState(u, now));
  const batches = batchPlayersBySize(players, DEFAULT_STATE_SYNC_CONFIG.maxMessageBytes);
  for (const batch of batches) {
    // 保留现有客户端读取的 users 字段，新增 serverTs（向后兼容）。
    broadcastToRoom(roomId, { type: "presence", users: batch, serverTs: now } satisfies Record<string, unknown>);
  }
  return batches.length;
}

/** 服务端权威频率超限 / 协议错误下发。 */
function sendNetError(socket: WebSocket, code: number, message: string, reqSeq?: number): void {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "error", code, message, reqSeq }));
    }
  } catch {
    // 忽略
  }
}

let presenceTicker: NodeJS.Timeout | null = null;

/** 启动全局 presence 聚合 ticker（默认 10Hz）。幂等：重复调用不重复启动。 */
export function startPresenceTicker(): void {
  if (presenceTicker) return;
  const intervalMs = Math.max(1, Math.round(1000 / DEFAULT_STATE_SYNC_CONFIG.serverTickHz));
  presenceTicker = setInterval(() => {
    for (const roomId of rooms.keys()) {
      try {
        flushRoomPresence(roomId);
      } catch {
        // 单房间失败不影响其他房间
      }
    }
  }, intervalMs);
  // 不阻止进程退出
  if (typeof presenceTicker === "object" && presenceTicker && "unref" in presenceTicker) {
    (presenceTicker as unknown as { unref: () => void }).unref();
  }
}

/** 供测试停止 ticker。 */
export function _stopPresenceTickerForTest(): void {
  if (presenceTicker) {
    clearInterval(presenceTicker);
    presenceTicker = null;
  }
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
  // 启动全局 presence 聚合 ticker（10Hz），把高频 move 聚合成定时广播。
  startPresenceTicker();
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

    // 加入房间。若该 userId 已存在旧连接（同用户多标签/重连），先关闭旧 socket 再替换，避免连接泄漏。
    const existingUser = room.users.get(userId);

    // 新会话：序号跟踪与发送频率限流器。复用旧会话的 seqTracker 可避免重连首包被判乱序，
    // 但旧客户端不带 seq，全新实例也能向后兼容。
    const roomUser: RoomUser = {
      userId,
      nickname,
      avatarType,
      avatarRef,
      x: randomPos(),
      z: randomPos(),
      rotation: 0,
      lastMove: 0,
      socket,
      seqTracker: existingUser?.seqTracker ?? new SeqTracker(),
      rateLimiter: new SlidingWindowRateLimiter(DEFAULT_STATE_SYNC_CONFIG.clientSendMaxHz),
    };

    if (existingUser && existingUser.socket !== socket) {
      try { existingUser.socket.close(); } catch { /* noop */ }
    }
    room.users.set(userId, roomUser);

    // 发送 welcome 快照（携带状态同步配置，供客户端启用插值/外推）
    const welcome: Record<string, unknown> = {
      type: "welcome",
      roomId,
      users: [...room.users.values()].map(wsUserOf),
      stateSync: DEFAULT_STATE_SYNC_CONFIG satisfies StateSyncConfig,
      ...(room.courtState ? { courtState: room.courtState } : {}),
      ...(room.sceneState ? { sceneState: room.sceneState } : {}),
    };
    safeSend(socket, welcome as WSMessage);

    // Round3: social 房间——向新连接单发房间元数据（playerCount 取当前在线数）
    if (socialMeta) {
      const roomInfo: SocialRoom = { ...socialMeta, playerCount: room.users.size };
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

    // 通知其他人
    if (roomId.startsWith("gym:")) {
      broadcastToRoom(roomId, {
        type: "gym_user_joined",
        user: { userId, nickname, avatarType, avatarRef, x: roomUser.x, z: roomUser.z, rotation: roomUser.rotation },
      } satisfies WSMessage);
    } else {
      broadcastToRoom(roomId, { type: "user_joined", user: wsUserOf(roomUser) } satisfies WSMessage);
    }

    // Round3: social 房间——全员（含自己）广播实时人数
    if (socialMeta) {
      broadcastToRoom(roomId, { type: "room_player_update", roomId, playerCount: room.users.size });
    }

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
          // —— 发送频率限流（服务端权威）：滑动窗口 15Hz，超限丢弃并回 RATE_LIMITED ——
          if (!roomUser.rateLimiter.allow(now)) {
            sendNetError(socket, NetErrorCode.RATE_LIMITED, "发送频率超过 15Hz", typeof data.seq === "number" ? data.seq : undefined);
            return;
          }
          // —— 序号去重 / 乱序检测：seq<=lastSeq 的重复/乱序旧包丢弃 ——
          const seq = typeof data.seq === "number" ? data.seq : undefined;
          const obs = roomUser.seqTracker.observe(seq);
          if (obs.dropped) return;
          // obs.gap>0 表示检测到丢包（乱序跳跃），仍应用最新状态，presence 会携带 lastKnownSeq 供客户端补偿。
          roomUser.x = x;
          roomUser.z = z;
          roomUser.rotation = rotation;
          if (typeof data.talkingIntensity === "number") roomUser.talkingIntensity = data.talkingIntensity;
          if (typeof data.animation === "string") roomUser.animation = data.animation;
          if (typeof data.expression === "string") roomUser.expression = data.expression;
          if ("headTarget" in data) roomUser.headTarget = (data.headTarget as { x: number; z: number } | null) ?? null;
          roomUser.lastMove = now;
          if (roomId.startsWith("gym:")) {
            // gym 域保留既有即时广播（不同消息类型，不在本分片聚合范围内）。
            const gymUsers = [...room.users.values()]
              .filter((u) => u.userId !== userId)
              .map((u) => ({ userId: u.userId, x: u.x, z: u.z, rotation: u.rotation }));
            broadcastToRoom(roomId, { type: "gym_presence", users: gymUsers } satisfies WSMessage);
          } else {
            // 社交/广场域：不再收到即广播，仅标记脏，由 10Hz ticker 聚合成一条 presence。
            room.presence.markDirty();
          }
          break;
        }
        case "request_state": {
          // —— 丢包补偿：客户端依据 presence 中 lastKnownSeq 检测到 gap 后，请求完整房间快照 ——
          const nowTs = Date.now();
          const players = [...room.users.values()].map((u) => toBroadcastPlayerState(u, nowTs));
          try {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "state_snapshot", players, serverTs: nowTs }));
            }
          } catch {
            // 忽略
          }
          break;
        }
        case "chat": {
          const text = String(data.text ?? "").slice(0, 500);
          if (!text) return;
          broadcastToRoom(roomId, {
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
          broadcastToRoom(roomId, {
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
        case "gym_cheer": {
          // M11: 健身加油广播
          if (!roomId.startsWith("gym:")) return;
          const text = String(data.text ?? "").slice(0, 200);
          if (!text) return;
          broadcastToRoom(roomId, {
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
          broadcastToRoom(roomId, {
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
          // 序号去重（与 move 共享每用户 lastSeq）
          const obs = roomUser.seqTracker.observe(typeof data.seq === "number" ? data.seq : undefined);
          if (obs.dropped) return;
          if (roomUser.lastEmote && now - roomUser.lastEmote < EMOTE_THROTTLE_MS) return;
          roomUser.lastEmote = now;
          roomUser.animation = emote;
          if (emote === "laugh") roomUser.expression = "happy";
          else if (emote === "surprised") roomUser.expression = "surprised";
          room.presence.markDirty();
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
          const obs = roomUser.seqTracker.observe(typeof data.seq === "number" ? data.seq : undefined);
          if (obs.dropped) return;
          const intensity = Math.min(Math.max(Number(data.intensity ?? 0), 0), 1);
          roomUser.talkingIntensity = intensity;
          if (intensity > 0.05) roomUser.animation = "talking";
          else if (roomUser.animation === "talking") roomUser.animation = "idle";
          room.presence.markDirty();
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
          safeSend(socket, { type: "pong" } satisfies WSMessage);
          break;
        }
      }
    });

    // ===== 断开清理 =====
    socket.on("close", () => {
      const r = rooms.get(roomId);
      // 守卫：仅当房间内该 userId 当前指向的仍是本 socket 时才清理，
      // 避免旧连接关闭时误删已被新连接替换的条目。
      if (r && r.users.get(userId)?.socket === socket) {
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
        // 房间空了可清理（保留 court 房间状态以便重连）
        if (r.users.size === 0 && roomId === "plaza") {
          rooms.delete(roomId);
        }
      }
    });

    socket.on("error", () => {
      // 忽略，close 会触发
    });
  });
}
