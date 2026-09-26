// ===== Round3: 真人多人社交房间 · REST 管理 =====
// 内存维护社交房间元数据（SocialRoom）；实时在线人数由 WS 层（ws.ts）维护，
// 通过 getRoomPlayerCount 同步。WS 连接入口同样在 ws.ts 中校验 social:<code>。
import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import {
  type SocialRoom,
  type CreateRoomRequest,
  type RoomScene,
} from "@balabala/shared";
import { getRoomPlayerCount } from "./ws.js";
import * as db from "./db.js";

/** 房间码字符表：排除易混字符 0/O/1/I。 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const DEFAULT_MAX_PLAYERS = 16;
/** 空房间存活时长：在线人数为 0 超过该时长后惰性清理。 */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

/** code -> 社交房间元数据 */
const socialRooms = new Map<string, SocialRoom>();
/** code -> 房间变为空（在线 0 人）的时间戳；非空房间不留记录。 */
const roomEmptySince = new Map<string, number>();

/** 生成 6 位大写字母数字房间码（排除易混字符）。 */
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** 生成不与现有房间冲突的房间码。 */
function uniqueRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = generateRoomCode();
    if (!socialRooms.has(code)) return code;
  }
  // 32^6 ≈ 10.7 亿种组合，几乎不可能走到这里。
  throw new Error("无法生成唯一房间码，请重试");
}

/** 从 WS 层同步某房间实时在线人数，并惰性清理超时空房间。 */
function syncRoomPlayerCount(room: SocialRoom): number {
  const count = getRoomPlayerCount(room.id);
  room.playerCount = count;
  const now = Date.now();
  if (count === 0) {
    if (!roomEmptySince.has(room.code)) roomEmptySince.set(room.code, now);
  } else {
    roomEmptySince.delete(room.code);
  }
  return count;
}

/** 惰性清理：删除在线人数为 0 且超过 TTL 的房间。 */
function sweepEmptyRooms(): void {
  const now = Date.now();
  for (const [code, room] of socialRooms) {
    const count = getRoomPlayerCount(room.id);
    room.playerCount = count;
    if (count === 0) {
      const since = roomEmptySince.get(code) ?? now;
      roomEmptySince.set(code, since);
      if (now - since > EMPTY_ROOM_TTL_MS) {
        socialRooms.delete(code);
        roomEmptySince.delete(code);
      }
    } else {
      roomEmptySince.delete(code);
    }
  }
}

/** 按 code 查询社交房间（不做惰性清理，供 WS 连接校验使用）。 */
export function getSocialRoom(code: string): SocialRoom | undefined {
  return socialRooms.get(code);
}

/** 全部社交房间（已同步实时人数 + 惰性清理后）。 */
export function getAllSocialRooms(): SocialRoom[] {
  sweepEmptyRooms();
  return [...socialRooms.values()];
}

/** 测试用：清空全部社交房间。 */
export function _resetSocialRoomsForTest(): void {
  socialRooms.clear();
  roomEmptySince.clear();
}

export function registerRoomRoutes(app: FastifyInstance): void {
  // ===== 创建房间 =====
  app.post("/api/rooms", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<CreateRoomRequest> & {
      creatorId?: string;
      creatorName?: string;
    };
    const name = (body.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "房间名称不能为空" });

    const scene: RoomScene = body.scene ?? "plaza";
    const isPublic = body.isPublic ?? true;
    const maxPlayers = Math.min(Math.max(Math.round(body.maxPlayers ?? DEFAULT_MAX_PLAYERS), 1), 64);

    const creatorId = (body.creatorId ?? "").trim();
    let creatorName = (body.creatorName ?? "").trim();
    if (!creatorName && creatorId) {
      creatorName = db.getUser(creatorId)?.nickname ?? "";
    }
    if (!creatorName) creatorName = "匿名房主";

    const code = uniqueRoomCode();
    const room: SocialRoom = {
      id: `social:${code}`,
      code,
      name,
      creatorId,
      creatorName,
      scene,
      maxPlayers,
      isPublic,
      createdAt: new Date().toISOString(),
      playerCount: 0,
    };
    socialRooms.set(code, room);
    return reply.code(201).send({ room });
  });

  // ===== 房间列表（仅公开，按创建时间倒序） =====
  app.get("/api/rooms", async () => {
    sweepEmptyRooms();
    const rooms = [...socialRooms.values()]
      .filter((room) => room.isPublic)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const room of rooms) syncRoomPlayerCount(room);
    return { rooms };
  });

  // ===== 房间详情 =====
  app.get("/api/rooms/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    sweepEmptyRooms();
    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "room not found" });
    syncRoomPlayerCount(room);
    return { room };
  });
}
