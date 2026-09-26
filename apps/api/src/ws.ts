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
  type IceServerConfig,
  type RtcPairState,
  type RtcSdpJson,
  type RtcIceJson,
  RtcErrorCode,
} from "@balabala/shared";
import { getCourtCase } from "./db.js";
import { getSocialRoom } from "./room-routes.js";
import { filterCaseForPerspective } from "./court-state.js";
import * as db from "./db.js";
import { handleAction as werewolfHandleAction, getSnapshotForPlayer as werewolfSnapshot } from "./werewolf-orchestrator.js";

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
};

export type Room = {
  id: string;
  users: Map<string, RoomUser>;
  courtState?: CourtRoomState;
  sceneState?: SceneRoomState;
  /** 每对用户的 WebRTC 信令状态（按无序对聚合，防止重复 offer / glare 冲突）。 */
  rtcPairs?: Map<string, RtcPairRecord>;
};

/** 一对用户的服务端信令状态记录。 */
export type RtcPairRecord = {
  state: RtcPairState;
  offerer: string;
  answerer: string;
  updatedAt: number;
};

/** 无序对 key（与房间内连接绑定，不跨房间）。 */
function rtcPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 构建下发给客户端的 ICE 服务器列表。
 * - 始终包含公共 STUN；
 * - 若环境变量 WEBRTC_TURN_URL 配置了 TURN，则附带 TURN 凭据。
 * 注意：TURN 凭据属敏感信息，绝不写入日志。
 */
export function buildRtcIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = (process.env.WEBRTC_TURN_URL ?? "").trim();
  if (turnUrl) {
    const entry: IceServerConfig = { urls: turnUrl };
    const username = (process.env.WEBRTC_TURN_USERNAME ?? "").trim();
    const credential = (process.env.WEBRTC_TURN_CREDENTIAL ?? "").trim();
    if (username) entry.username = username;
    if (credential) entry.credential = credential;
    servers.push(entry);
  }
  return servers;
}

/** 供测试使用：清空所有房间与信令状态，保证用例隔离。 */
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
    };

    // 加入房间。若该 userId 已存在旧连接（同用户多标签/重连），先关闭旧 socket 再替换，避免连接泄漏。
    const existingUser = room.users.get(userId);
    if (existingUser && existingUser.socket !== socket) {
      try { existingUser.socket.close(); } catch { /* noop */ }
    }
    room.users.set(userId, roomUser);

    // 发送 welcome 快照
    const welcome: WSMessage = {
      type: "welcome",
      roomId,
      users: [...room.users.values()].map(wsUserOf),
      ...(room.courtState ? { courtState: room.courtState } : {}),
      ...(room.sceneState ? { sceneState: room.sceneState } : {}),
    };
    safeSend(socket, welcome);

    // WebRTC 健壮性：welcome 后单发 ICE 服务器配置（STUN + 可选 TURN）。
    // 旧客户端不处理该 type，直接忽略即可，向后兼容。
    safeSend(socket, { type: "rtc_config", iceServers: buildRtcIceServers() } satisfies WSMessage);

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
          // WebRTC 健壮性：SDP 信令转发 + 目标在线校验 + 每对用户信令状态机。
          const to = String(data.to ?? "");
          const sdp = data.sdp as RtcSdpJson | undefined;
          const reqSeq = typeof data.seq === "number" ? data.seq : undefined;
          if (!to || !sdp) return;
          const target = room.users.get(to);
          // 目标不在线：回复 rtc_error 给发起方，而非静默丢弃。
          if (!target) {
            safeSend(socket, {
              type: "rtc_error",
              from: to,
              to: userId,
              code: RtcErrorCode.TARGET_OFFLINE,
              message: `目标用户 ${to} 不在线或已离开房间`,
              ...(reqSeq !== undefined ? { reqSeq } : {}),
            } satisfies WSMessage);
            break;
          }
          if (!room.rtcPairs) room.rtcPairs = new Map();
          const key = rtcPairKey(userId, to);
          const existing = room.rtcPairs.get(key);

          if (sdp.type === "offer") {
            // glare 冲突：对方已向我发 offer 且在等我 answer，我却又发新 offer → 拒绝后到者。
            if (existing && existing.state === "answering" && existing.offerer === to) {
              safeSend(socket, {
                type: "rtc_error",
                from: to,
                to: userId,
                code: RtcErrorCode.OFFER_CONFLICT,
                message: "双方同时发起 offer（glare），请等待对方 answer 后重试",
                ...(reqSeq !== undefined ? { reqSeq } : {}),
              } satisfies WSMessage);
              break;
            }
            // 同一 offerer 在等待 answer 期间重发 offer（重试/重协商）：允许刷新，转发并更新状态。
            room.rtcPairs.set(key, { state: "answering", offerer: userId, answerer: to, updatedAt: now });
          } else if (sdp.type === "answer") {
            // answer 到达：与等待中的 offer 配对成功 → connected；配对不上也照常转发（向后兼容）。
            if (existing && existing.state === "answering") {
              room.rtcPairs.set(key, {
                state: "connected",
                offerer: existing.offerer,
                answerer: userId,
                updatedAt: now,
              });
            }
          }

          safeSend(target.socket, {
            type: "rtc_sdp",
            from: userId,
            to,
            sdp,
            ...(reqSeq !== undefined ? { seq: reqSeq } : {}),
          } satisfies WSMessage);
          break;
        }
        case "rtc_ice": {
          // WebRTC 健壮性：ICE candidate 转发 + 目标在线校验。
          const to = String(data.to ?? "");
          const candidate = data.candidate as RtcIceJson | undefined;
          const reqSeq = typeof data.seq === "number" ? data.seq : undefined;
          if (!to || !candidate) return;
          const target = room.users.get(to);
          if (!target) {
            safeSend(socket, {
              type: "rtc_error",
              from: to,
              to: userId,
              code: RtcErrorCode.TARGET_OFFLINE,
              message: `目标用户 ${to} 不在线或已离开房间`,
              ...(reqSeq !== undefined ? { reqSeq } : {}),
            } satisfies WSMessage);
            break;
          }
          safeSend(target.socket, {
            type: "rtc_ice",
            from: userId,
            to,
            candidate,
            ...(reqSeq !== undefined ? { seq: reqSeq } : {}),
          } satisfies WSMessage);
          break;
        }
        case "rtc_retry": {
          // 重试通知透传（ICE 失败重试时通知对端）：在线校验后转发，不解析内容。
          const to = String(data.to ?? "");
          const attempt = Number(data.attempt ?? 0);
          const reason = String(data.reason ?? "");
          if (!to) return;
          const target = room.users.get(to);
          if (!target) {
            safeSend(socket, {
              type: "rtc_error",
              from: to,
              to: userId,
              code: RtcErrorCode.TARGET_OFFLINE,
              message: `重试目标用户 ${to} 不在线`,
            } satisfies WSMessage);
            break;
          }
          safeSend(target.socket, { type: "rtc_retry", from: userId, to, attempt, reason } satisfies WSMessage);
          break;
        }
        case "rtc_fallback": {
          // 语音降级透传（回落文字）：在线校验后转发，并标记该对信令为 failed。
          const to = String(data.to ?? "");
          const reason = String(data.reason ?? "");
          const suggestText = data.suggestText !== false;
          if (!to) return;
          const target = room.users.get(to);
          if (!target) break; // 对端已离线：无需通知，静默即可
          if (room.rtcPairs) {
            const key = rtcPairKey(userId, to);
            const rec = room.rtcPairs.get(key);
            if (rec) room.rtcPairs.set(key, { ...rec, state: "failed", updatedAt: now });
          }
          safeSend(target.socket, { type: "rtc_fallback", from: userId, to, reason, suggestText } satisfies WSMessage);
          break;
        }
        case "rtc_bye": {
          // 通知对方关闭 PeerConnection；对端在线则转发并标记信令 failed，离线则无需通知。
          const to = String(data.to ?? "");
          const target = room.users.get(to);
          if (!target) break;
          if (room.rtcPairs) {
            const key = rtcPairKey(userId, to);
            const rec = room.rtcPairs.get(key);
            if (rec) room.rtcPairs.set(key, { ...rec, state: "failed", updatedAt: now });
          }
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
        // 清理涉及本用户的 WebRTC 信令状态，避免残留 offering 状态阻塞后续新对
        if (r.rtcPairs) {
          for (const [key, rec] of r.rtcPairs) {
            if (rec.offerer === userId || rec.answerer === userId) r.rtcPairs.delete(key);
          }
        }
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
