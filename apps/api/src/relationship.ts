// ============================================================================
// R5 · 名人关系系统 —— 持久化 + REST 路由
//
// 存储：apps/api/.data/relationships/<userId>.json
//   { userId, relationships: Record<celebrityId, CelebrityRelationship> }
// 参照 ServerProfile（.data/profiles/<userId>.json）的 JSON 文件模式。
// 真人好友关系在 friends.ts，本模块只处理「玩家 ↔ 名人」。
// ============================================================================
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CELEBRITIES,
  type CelebrityRelationship,
  type RelationshipChange,
  type RelationshipType,
  clampAffinity,
  getUnlockForType,
  typeFromAffinity,
} from "@balabala/shared";

const DEFAULT_DIR =
  process.env.RELATIONSHIPS_DIR ||
  resolve(process.cwd(), ".data", "relationships");

/** 业务错误：REST 层据 statusCode 返回对应 HTTP 状态。 */
export class RelationshipError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface StoredRelationships {
  userId: string;
  relationships: Record<string, CelebrityRelationship>;
}

function safeUserId(userId: string): string {
  return (userId || "anonymous").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

/** 数据目录：测试可用 configureRelationshipsForTest 覆盖。 */
function dir(): string {
  return (globalThis as { __REL_DIR?: string }).__REL_DIR || DEFAULT_DIR;
}

function fileFor(userId: string): string {
  return resolve(dir(), `${safeUserId(userId)}.json`);
}

function emptyStore(userId: string): StoredRelationships {
  return { userId, relationships: {} };
}

/** 读取某用户全部关系（损坏/不存在返回空，绝不抛错）。 */
function loadStore(userId: string): StoredRelationships {
  if (!userId) return emptyStore("");
  try {
    const file = fileFor(userId);
    if (!existsSync(file)) return emptyStore(userId);
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredRelationships>;
    return {
      userId,
      relationships:
        raw.relationships && typeof raw.relationships === "object"
          ? (raw.relationships as Record<string, CelebrityRelationship>)
          : {},
    };
  } catch (e) {
    console.warn("[relationships] 读取失败，使用空数据:", e);
    return emptyStore(userId);
  }
}

function saveStore(store: StoredRelationships): void {
  try {
    writeFileSync(fileFor(store.userId), JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.warn("[relationships] 写入失败:", e);
  }
}

/** 按 celebrityId 查名人名（找不到回退到 id 本身）。 */
function celebrityNameOf(celebrityId: string): string {
  return CELEBRITIES.find((c) => c.id === celebrityId)?.name ?? celebrityId;
}

/** 测试用：指定目录并创建。 */
export function configureRelationshipsForTest(dirPath: string): void {
  (globalThis as { __REL_DIR?: string }).__REL_DIR = dirPath;
  mkdirSync(dirPath, { recursive: true });
}

// ===== 公开 API =====

/** 列出某用户全部名人关系（按 updatedAt 倒序）。 */
export function getRelationships(userId: string): CelebrityRelationship[] {
  const store = loadStore(userId);
  return Object.values(store.relationships).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** 取单个名人关系档案；从未交手返回 null。 */
export function getRelationship(
  userId: string,
  celebrityId: string,
): CelebrityRelationship | null {
  const store = loadStore(userId);
  return store.relationships[celebrityId] ?? null;
}

/** applyRelationshipChange 的入参（delta/reason 由调用方用 computeAffinityDelta 算好）。 */
export interface RelationshipChangeInput {
  /** 本局好感度变化（已由 computeAffinityDelta 算出，可正可负）。 */
  delta: number;
  /** 人话原因。 */
  reason: string;
  /** 本局胜负（用于更新 wins/losses/streak）。 */
  result?: "win" | "draw" | "loss";
}

/**
 * 把一局结果落到关系档案上，返回完整的 RelationshipChange（含跨档解锁）。
 * - 更新 affinity（夹到 ±100）、type、gamesPlayed、wins/losses、currentStreak、bestStreak。
 * - 跨正向档时自动把新解锁奖励并入 unlockedRewards。
 */
export function applyRelationshipChange(
  userId: string,
  celebrityId: string,
  input: RelationshipChangeInput,
): RelationshipChange {
  if (!userId) throw new RelationshipError(400, "bad_user", "userId 不能为空");
  if (!celebrityId) throw new RelationshipError(400, "bad_celebrity", "celebrityId 不能为空");

  const store = loadStore(userId);
  const now = new Date().toISOString();
  const existing = store.relationships[celebrityId];
  const fromType: RelationshipType = existing?.type ?? "stranger";

  const prevAffinity = existing?.affinity ?? 0;
  const newAffinity = clampAffinity(prevAffinity + input.delta);
  const toType = typeFromAffinity(newAffinity);

  // 战绩 / 连胜更新
  const gamesPlayed = (existing?.gamesPlayed ?? 0) + 1;
  const winsAgainst =
    (existing?.winsAgainst ?? 0) + (input.result === "win" ? 1 : 0);
  const lossesAgainst =
    (existing?.lossesAgainst ?? 0) + (input.result === "loss" ? 1 : 0);

  let currentStreak = existing?.currentStreak ?? 0;
  if (input.result === "win") currentStreak = Math.max(0, currentStreak) + 1;
  else if (input.result === "loss") currentStreak = Math.min(0, currentStreak) - 1;
  else currentStreak = 0;
  const bestStreak = Math.max(existing?.bestStreak ?? 0, currentStreak);

  // 跨正向档解锁：从旧档到新档之间，凡是跨过的正向档奖励都补发。
  const unlocked = new Set<string>(existing?.unlockedRewards ?? []);
  let newUnlock: string | undefined;
  if (toType !== "rival") {
    const order: RelationshipType[] = ["acquaintance", "friend", "close", "soulmate"];
    for (const t of order) {
      const reward = getUnlockForType(t, celebrityId);
      if (!reward) continue;
      // 新档 >= t 且旧档尚未达到 t，则解锁。
      if (order.indexOf(toType) >= order.indexOf(t) && !orderReached(fromType, t)) {
        if (!unlocked.has(reward)) {
          unlocked.add(reward);
          newUnlock = reward; // 最后一个（最高档）作为本次弹窗奖励
        }
      }
    }
  }

  const rel: CelebrityRelationship = {
    celebrityId,
    celebrityName: existing?.celebrityName ?? celebrityNameOf(celebrityId),
    affinity: newAffinity,
    type: toType,
    gamesPlayed,
    winsAgainst,
    lossesAgainst,
    currentStreak,
    bestStreak,
    lastPlayedAt: now,
    unlockedRewards: [...unlocked],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.relationships[celebrityId] = rel;
  saveStore(store);

  return {
    celebrityId,
    delta: input.delta,
    fromType,
    toType,
    reason: input.reason,
    ...(newUnlock ? { newUnlock } : {}),
  };
}

/** 判断旧类型是否已经达到过目标正向档（用于补发解锁）。 */
function orderReached(from: RelationshipType, target: RelationshipType): boolean {
  const order: RelationshipType[] = ["stranger", "acquaintance", "friend", "close", "soulmate"];
  // rival 视为未达到任何正向档
  if (from === "rival") return false;
  return order.indexOf(from) >= order.indexOf(target);
}

/** 重置某用户与某名人的关系（测试用）。 */
export function resetRelationship(userId: string, celebrityId: string): void {
  const store = loadStore(userId);
  delete store.relationships[celebrityId];
  saveStore(store);
}

// ===== REST 路由 =====
export function registerRelationshipRoutes(app: FastifyInstance): void {
  // GET /api/relationships?userId=xxx —— 列出全部名人关系
  app.get("/api/relationships", async (req, reply) => {
    const query = req.query as { userId?: string };
    const userId = query.userId ?? "";
    if (!userId) return reply.code(400).send({ error: "缺少 userId", code: "bad_user" });
    return { relationships: getRelationships(userId) };
  });

  // GET /api/relationships/:celebrityId?userId=xxx —— 单个关系档案
  app.get("/api/relationships/:celebrityId", async (req, reply) => {
    const { celebrityId } = req.params as { celebrityId: string };
    const query = req.query as { userId?: string };
    const userId = query.userId ?? "";
    if (!userId) return reply.code(400).send({ error: "缺少 userId", code: "bad_user" });
    const rel = getRelationship(userId, celebrityId);
    if (!rel) return reply.code(404).send({ error: "尚未与该名人交手", code: "not_found" });
    return { relationship: rel };
  });

  // POST /api/relationships/:celebrityId/reset —— 重置（测试用）
  app.post("/api/relationships/:celebrityId/reset", async (req, reply) => {
    const { celebrityId } = req.params as { celebrityId: string };
    const body = (req.body ?? {}) as { userId?: string };
    const userId = body.userId ?? "";
    if (!userId) return reply.code(400).send({ error: "缺少 userId", code: "bad_user" });
    resetRelationship(userId, celebrityId);
    return { ok: true };
  });
}
