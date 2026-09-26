// ===== Round3: 真人多人社交房间 · REST 管理 =====
// 内存维护社交房间元数据（SocialRoom）；实时在线人数由 WS 层（ws.ts）维护，
// 通过 getRoomPlayerCount 同步。WS 连接入口同样在 ws.ts 中校验 social:<code>。
//
// ===== Round4 R4-02: 房间权限系统 =====
// - 房主踢人 POST /api/rooms/:code/kick（60s 冷却）
// - 转移房主 POST /api/rooms/:code/transfer-owner
// - 锁房间 POST /api/rooms/:code/lock
// - 私密房间密码 SHA-256 哈希存储
import type { FastifyInstance } from "fastify";
import { randomInt, randomBytes, createHash } from "node:crypto";
import {
  type SocialRoom,
  type CreateRoomRequest,
  type RoomScene,
} from "@balabala/shared";
import { getRoomPlayerCount, kickUserFromRoom, broadcastRoomEvent } from "./ws.js";
import * as db from "./db.js";
// R4-08: 房间名过敏感词
import { filterProfanity } from "./moderation.js";

/** 房间码字符表：排除易混字符 0/O/1/I。 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const DEFAULT_MAX_PLAYERS = 16;
/** 空房间存活时长：在线人数为 0 超过该时长后惰性清理。 */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
/** 被踢用户冷却时间（ms）：60 秒内不得重新加入。 */
export const KICK_COOLDOWN_MS = 60 * 1000;

/** code -> 社交房间元数据 */
const socialRooms = new Map<string, SocialRoom>();
/** code -> 房间变为空（在线 0 人）的时间戳；非空房间不留记录。 */
const roomEmptySince = new Map<string, number>();
/** code -> (userId -> 被踢截止时间戳 ms) */
const kickedUntilMap = new Map<string, Map<string, number>>();

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

/** 用 SHA-256(password + salt) 哈希密码。 */
function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(password + salt).digest("hex");
}

/** 生成随机盐（16 字节 hex）。 */
function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 剥离敏感字段（passwordHash / passwordSalt），返回可安全发给客户端的房间副本。
 * hasPassword 始终保留（前端据此显示密码锁图标）。
 */
export function sanitizeRoom(room: SocialRoom): SocialRoom {
  const { passwordHash: _ph, passwordSalt: _ps, ...publicRoom } = room;
  void _ph;
  void _ps;
  return publicRoom;
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
        kickedUntilMap.delete(code);
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

/** 全部社交房间（已同步实时人数 + 惰性清理后，已剥离敏感字段）。 */
export function getAllSocialRooms(): SocialRoom[] {
  sweepEmptyRooms();
  return [...socialRooms.values()].map(sanitizeRoom);
}

/** 测试用：清空全部社交房间。 */
export function _resetSocialRoomsForTest(): void {
  socialRooms.clear();
  roomEmptySince.clear();
  kickedUntilMap.clear();
}

/**
 * R4-08: 由系统（定时任务）创建一个公开主题房间。
 * 不走 HTTP 鉴权，房主为 "system"。房间码自动生成，创建后即出现在大厅列表。
 * 返回创建后的房间（已剥离敏感字段）。
 */
export function createSystemRoom(opts: {
  name: string;
  scene: RoomScene;
  maxPlayers?: number;
}): SocialRoom {
  const code = uniqueRoomCode();
  const room: SocialRoom = {
    id: `social:${code}`,
    code,
    name: opts.name,
    creatorId: "system",
    creatorName: "叽里呱啦官方",
    scene: opts.scene,
    maxPlayers: Math.min(Math.max(Math.round(opts.maxPlayers ?? 16), 2), 64),
    isPublic: true,
    createdAt: new Date().toISOString(),
    playerCount: 0,
    ownerId: "system",
    isLocked: false,
    hasPassword: false,
  };
  socialRooms.set(code, room);
  return sanitizeRoom(room);
}

// ===== R4-02: 供 WS 层调用的辅助函数 =====

/** 校验房间密码（有密码时）。无密码房间始终返回 true。 */
export function verifyRoomPassword(code: string, password: string | undefined): boolean {
  const room = socialRooms.get(code);
  if (!room) return false;
  if (!room.passwordHash) return true; // 无密码房间
  if (!password) return false;
  const salt = room.passwordSalt ?? "";
  return hashPassword(password, salt) === room.passwordHash;
}

/** 检查用户是否在被踢冷却期内。 */
export function isUserKicked(code: string, userId: string): boolean {
  const users = kickedUntilMap.get(code);
  if (!users) return false;
  const until = users.get(userId);
  if (!until) return false;
  if (Date.now() >= until) {
    users.delete(userId);
    return false;
  }
  return true;
}

/** 记录用户被踢冷却。 */
export function setUserKicked(code: string, userId: string, untilMs: number): void {
  let users = kickedUntilMap.get(code);
  if (!users) {
    users = new Map();
    kickedUntilMap.set(code, users);
  }
  users.set(userId, untilMs);
}

/** 获取房间房主 ID（旧房间无 ownerId 时回退到 creatorId）。 */
export function getRoomOwnerId(code: string): string | undefined {
  const room = socialRooms.get(code);
  if (!room) return undefined;
  return room.ownerId || room.creatorId;
}

/** 检查调用者是否为房主。 */
function isOwner(room: SocialRoom, callerId: string): boolean {
  const ownerId = room.ownerId || room.creatorId;
  return !!callerId && callerId === ownerId;
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
    // R4-08: 房间名过敏感词过滤
    const safeName = filterProfanity(name).text.slice(0, 40);

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

    // R4-02: 密码处理
    const plainPassword = body.password?.trim() ?? "";
    let passwordHash: string | undefined;
    let passwordSalt: string | undefined;
    if (plainPassword) {
      passwordSalt = generateSalt();
      passwordHash = hashPassword(plainPassword, passwordSalt);
    }

    const room: SocialRoom = {
      id: `social:${code}`,
      code,
      name: safeName,
      creatorId,
      creatorName,
      scene,
      maxPlayers,
      isPublic,
      createdAt: new Date().toISOString(),
      playerCount: 0,
      // R4-02: 权限字段
      ownerId: creatorId,
      isLocked: false,
      hasPassword: !!plainPassword,
      ...(passwordHash ? { passwordHash } : {}),
      ...(passwordSalt ? { passwordSalt } : {}),
    };
    socialRooms.set(code, room);
    return reply.code(201).send({ room: sanitizeRoom(room) });
  });

  // ===== 房间列表（仅公开，按创建时间倒序，已剥离敏感字段） =====
  app.get("/api/rooms", async () => {
    sweepEmptyRooms();
    const rooms = [...socialRooms.values()]
      .filter((room) => room.isPublic)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const room of rooms) syncRoomPlayerCount(room);
    return { rooms: rooms.map(sanitizeRoom) };
  });

  // ===== 房间详情（已剥离敏感字段） =====
  app.get("/api/rooms/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    sweepEmptyRooms();
    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "room not found" });
    syncRoomPlayerCount(room);
    return { room: sanitizeRoom(room) };
  });

  // ===== R4-02: 房主踢人 =====
  app.post("/api/rooms/:code/kick", async (req, reply) => {
    const { code } = req.params as { code: string };
    const body = (req.body ?? {}) as { callerId?: string; targetUserId?: string; reason?: string };
    const callerId = (body.callerId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();
    const reason = (body.reason ?? "").trim() || "被房主移出房间";

    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "房间不存在" });
    if (!isOwner(room, callerId)) return reply.code(403).send({ error: "仅房主可踢人" });
    if (!targetUserId) return reply.code(400).send({ error: "targetUserId 不能为空" });
    if (targetUserId === (room.ownerId || room.creatorId)) {
      return reply.code(400).send({ error: "不能踢房主自己" });
    }

    // 记录冷却期
    setUserKicked(code, targetUserId, Date.now() + KICK_COOLDOWN_MS);

    // 通过 WS 层踢人（广播 player_kicked + 关闭被踢用户 socket）
    const wasInRoom = kickUserFromRoom(room.id, targetUserId, reason);

    return { ok: true, kicked: targetUserId, wasInRoom, reason };
  });

  // ===== R4-02: 转移房主 =====
  app.post("/api/rooms/:code/transfer-owner", async (req, reply) => {
    const { code } = req.params as { code: string };
    const body = (req.body ?? {}) as { callerId?: string; targetUserId?: string };
    const callerId = (body.callerId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();

    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "房间不存在" });
    if (!isOwner(room, callerId)) return reply.code(403).send({ error: "仅房主可转移房主" });
    if (!targetUserId) return reply.code(400).send({ error: "targetUserId 不能为空" });
    if (targetUserId === (room.ownerId || room.creatorId)) {
      return reply.code(400).send({ error: "目标已是房主" });
    }

    const oldOwnerId = room.ownerId || room.creatorId;
    room.ownerId = targetUserId;

    // WS 广播 room_owner_changed
    broadcastRoomEvent(room.id, {
      type: "room_owner_changed",
      oldOwnerId,
      newOwnerId: targetUserId,
    });

    return { ok: true, oldOwnerId, newOwnerId: targetUserId, room: sanitizeRoom(room) };
  });

  // ===== R4-02: 锁房间 =====
  app.post("/api/rooms/:code/lock", async (req, reply) => {
    const { code } = req.params as { code: string };
    const body = (req.body ?? {}) as { callerId?: string; locked?: boolean };
    const callerId = (body.callerId ?? "").trim();
    const locked = body.locked !== false; // 默认 true

    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "房间不存在" });
    if (!isOwner(room, callerId)) return reply.code(403).send({ error: "仅房主可锁房间" });

    room.isLocked = locked;

    // WS 广播 lock 状态变更（已在房间内的玩家也知道当前状态）
    broadcastRoomEvent(room.id, {
      type: "room_lock_changed",
      isLocked: locked,
    });

    return { ok: true, isLocked: locked, room: sanitizeRoom(room) };
  });
}
