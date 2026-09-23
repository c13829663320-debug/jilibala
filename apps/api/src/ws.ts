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
} from "@balabala/shared";
import * as db from "./db.js";

// ===== 房间数据结构 =====
type RoomUser = {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  x: number;
  z: number;
  rotation: number;
  lastMove: number;
  socket: WebSocket;
};

type Room = {
  id: string;
  users: Map<string, RoomUser>;
  courtState?: CourtRoomState;
  sceneState?: SceneRoomState;
};

const rooms = new Map<string, Room>();

/** M8: 合法房间前缀。plaza 为全局广场，其余为按场景/案件的房间。 */
const VALID_ROOM_PREFIXES = ["plaza", "court:", "talkshow:", "bar:", "library:"];

function isValidRoom(roomId: string): boolean {
  return VALID_ROOM_PREFIXES.some((p) => (p.endsWith(":") ? roomId.startsWith(p) : roomId === p));
}

const randomPos = () => (Math.random() * 20 - 10);

function getOrCreateRoom(roomId: string): Room {
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
      };
    }
    // M8: 场景房间初始化 sceneState
    for (const prefix of ["talkshow:", "bar:", "library:"] as const) {
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
      safeSend(socket, { type: "error", message: "room 必须是 plaza 或 court:<id>/talkshow:<id>/bar:<id>/library:<id>" });
      socket.close();
      return;
    }

    // 获取用户资料（从 SQLite，不存在则用默认值）
    const userProfile = db.getUser(userId);
    const nickname = userProfile?.nickname ?? "匿名用户";
    const avatarType = userProfile?.avatarType ?? "capsule";
    const avatarRef = userProfile?.avatarRef ?? "";

    const room = getOrCreateRoom(roomId);
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

    // 加入房间
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

    // 通知其他人
    broadcastToRoom(roomId, { type: "user_joined", user: wsUserOf(roomUser) } satisfies WSMessage);

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
          // 广播给房间内其他人
          const others = [...room.users.values()]
            .filter((u) => u.userId !== userId)
            .map((u) => ({ userId: u.userId, x: u.x, z: u.z, rotation: u.rotation }));
          broadcastToRoom(roomId, { type: "presence", users: others } satisfies WSMessage);
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
        case "ping": {
          safeSend(socket, { type: "pong" } satisfies WSMessage);
          break;
        }
      }
    });

    // ===== 断开清理 =====
    socket.on("close", () => {
      const r = rooms.get(roomId);
      if (r) {
        r.users.delete(userId);
        broadcastToRoom(roomId, { type: "user_left", userId } satisfies WSMessage);
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
