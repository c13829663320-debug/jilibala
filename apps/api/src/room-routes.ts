// ===== Round3: 真人多人社交房间 · REST 管理 =====
// 内存维护社交房间元数据（SocialRoom）；实时在线人数由 WS 层（ws.ts）维护，
// 通过 getRoomPlayerCount 同步。WS 连接入口同样在 ws.ts 中校验 social:<code>。
//
// 房间权限分片：密码仅存于本模块内存（roomSecrets），绝不放进 SocialRoom DTO、
// 绝不广播、绝不写日志。对外只暴露 hasPassword 布尔值。
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
const MIN_MAX_PLAYERS = 1;
const MAX_MAX_PLAYERS = 64;
/** 空房间存活时长：在线人数为 0 超过该时长后惰性清理。 */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

/** code -> 社交房间元数据（对外 DTO，不含明文密码） */
const socialRooms = new Map<string, SocialRoom>();
/** code -> 房间明文密码（服务端内存；不序列化、不广播、不写日志）。无密码则无记录。 */
const roomSecrets = new Map<string, string>();
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

/** 把 maxPlayers 夹到 [1,64]。 */
export function clampMaxPlayers(n: unknown): number {
  const v = Math.round(Number(n) || DEFAULT_MAX_PLAYERS);
  return Math.min(Math.max(v, MIN_MAX_PLAYERS), MAX_MAX_PLAYERS);
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
        roomSecrets.delete(code);
        roomEmptySince.delete(code);
      }
    } else {
      roomEmptySince.delete(code);
    }
  }
}

/** 按 code 查询社交房间 DTO（不做惰性清理，供 WS 连接校验使用）。 */
export function getSocialRoom(code: string): SocialRoom | undefined {
  return socialRooms.get(code);
}

/**
 * 传输层兜底：房主断线且超过重连窗口后，把房主转移给房间内最早加入者。
 * 仅做 creatorId/creatorName 迁移，不触碰锁房/密码/踢人逻辑。
 */
export function transferSocialRoomOwner(code: string, newOwnerId: string, newOwnerName: string): void {
  const room = socialRooms.get(code);
  if (!room) return;
  room.creatorId = newOwnerId;
  room.creatorName = newOwnerName || room.creatorName;
}

/** 按 code 查询房间明文密码（仅供 WS 连接时校验密码；绝不广播/写日志）。 */
export function getSocialRoomPassword(code: string): string | undefined {
  return roomSecrets.get(code);
}

/** 校验房间密码。无密码房间一律放行（返回 true）。 */
export function isPasswordValid(code: string, supplied: string | undefined): boolean {
  const secret = roomSecrets.get(code);
  if (!secret) return true; // 无密码房间不校验
  return typeof supplied === "string" && supplied === secret;
}

/** 全部社交房间（已同步实时人数 + 惰性清理后）。 */
export function getAllSocialRooms(): SocialRoom[] {
  sweepEmptyRooms();
  return [...socialRooms.values()];
}

// ===== 以下为 WS 层（房间权限操作）调用的权威变更函数 =====

/** 设置/修改/清除房间密码。password=null 表示清除。返回设置后是否有密码。 */
export function setRoomPassword(code: string, password: string | null | undefined): boolean {
  const room = socialRooms.get(code);
  if (!room) return false;
  if (password === null || password === undefined || String(password).length === 0) {
    roomSecrets.delete(code);
    room.hasPassword = false;
  } else {
    const secret = String(password);
    roomSecrets.set(code, secret);
    room.hasPassword = true;
  }
  return room.hasPassword;
}

/** 锁房/解锁。 */
export function setRoomLocked(code: string, locked: boolean): void {
  const room = socialRooms.get(code);
  if (room) room.locked = !!locked;
}

/** 修改人数上限（夹到 [1,64]）。 */
export function setRoomMaxPlayers(code: string, maxPlayers: number): number {
  const room = socialRooms.get(code);
  const clamped = clampMaxPlayers(maxPlayers);
  if (room) room.maxPlayers = clamped;
  return clamped;
}

/** 转移房主：更新 creatorId。返回是否成功。 */
export function transferRoomOwner(code: string, newOwnerId: string): boolean {
  const room = socialRooms.get(code);
  if (!room) return false;
  room.creatorId = newOwnerId;
  return true;
}

/** 测试用：清空全部社交房间。 */
export function _resetSocialRoomsForTest(): void {
  socialRooms.clear();
  roomSecrets.clear();
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
    // isPrivate 优先级高于 isPublic；默认公开（向后兼容）。
    const isPublic = body.isPrivate === true ? false : (body.isPublic ?? true);
    const maxPlayers = clampMaxPlayers(body.maxPlayers);

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
      locked: false,
      hasPassword: false,
      createdAt: new Date().toISOString(),
      playerCount: 0,
    };
    // 密码仅入内存 secret 表，不写进 room DTO。
    if (typeof body.password === "string" && body.password.length > 0) {
      roomSecrets.set(code, body.password);
      room.hasPassword = true;
    }
    socialRooms.set(code, room);
    // 返回的 DTO 绝不含明文密码（SocialRoom 类型本身也没有 password 字段）。
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
    // DTO 只有 hasPassword，不泄露密码本身。
    return { room };
  });

  // ===== 私密房密码预检：前端在连接 WS 前可先校验密码是否正确。 =====
  // 返回 { ok: true } 或 403 { error }。无密码房间恒为 ok。
  app.post("/api/rooms/:code/verify-password", async (req, reply) => {
    const { code } = req.params as { code: string };
    const room = socialRooms.get(code);
    if (!room) return reply.code(404).send({ error: "room not found" });
    const body = (req.body ?? {}) as { password?: string };
    const secret = roomSecrets.get(code);
    if (!secret) return { ok: true, hasPassword: false };
    if (body.password === secret) return { ok: true, hasPassword: true };
    return reply.code(403).send({ error: "密码错误", hasPassword: true });
  });
}
