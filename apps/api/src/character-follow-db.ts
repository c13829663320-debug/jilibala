// ===== 分片6: 人物关注关系数据层 =====
// 复用 db.ts 的 node:sqlite 连接，新建 follows 表：
//   (user_id, character_id) 唯一，记录某玩家关注了某个人物（名人或自定义）。
// 所有 DAO 幂等、可单测；测试时通过 process.env.DB_PATH 指向临时库隔离。
import { randomUUID } from "node:crypto";
import type { FollowRelation } from "@balabala/shared";
import { db, initDb } from "./db.js";

let followReady = false;

export function initFollowDb(): void {
  if (followReady) return;
  initDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_follows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_user ON character_follows(user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_char ON character_follows(character_id);
  `);
  followReady = true;
}

export function _resetFollowDbForTest(): void {
  followReady = false;
}

type FollowRow = { id: string; user_id: string; character_id: string; created_at: string };
function rowToFollow(row: FollowRow): FollowRelation {
  return { id: row.id, userId: row.user_id, characterId: row.character_id, createdAt: row.created_at };
}

/** 关注人物。幂等：重复关注返回已有记录。 */
export function followCharacter(userId: string, characterId: string): FollowRelation {
  initFollowDb();
  const existing = getFollow(userId, characterId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = `follow-${randomUUID()}`;
  db.prepare(
    "INSERT INTO character_follows (id, user_id, character_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, userId, characterId, now);
  return { id, userId, characterId, createdAt: now };
}

/** 取消关注；不存在返回 false。 */
export function unfollowCharacter(userId: string, characterId: string): boolean {
  initFollowDb();
  const res = db
    .prepare("DELETE FROM character_follows WHERE user_id = ? AND character_id = ?")
    .run(userId, characterId);
  return res.changes > 0;
}

export function getFollow(userId: string, characterId: string): FollowRelation | undefined {
  initFollowDb();
  const row = db
    .prepare("SELECT * FROM character_follows WHERE user_id = ? AND character_id = ?")
    .get(userId, characterId) as FollowRow | undefined;
  return row ? rowToFollow(row) : undefined;
}

/** 我关注的全部人物 id 列表（按关注时间倒序）。 */
export function getFollowingCharacterIds(userId: string): string[] {
  initFollowDb();
  const rows = db
    .prepare("SELECT character_id FROM character_follows WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Array<{ character_id: string }>;
  return rows.map((r) => r.character_id);
}

/** 我关注的完整关系列表。 */
export function getFollowing(userId: string): FollowRelation[] {
  initFollowDb();
  const rows = db
    .prepare("SELECT * FROM character_follows WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as FollowRow[];
  return rows.map(rowToFollow);
}

/** 某人物被多少人关注（followers 计数）。 */
export function getFollowerCount(characterId: string): number {
  initFollowDb();
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM character_follows WHERE character_id = ?")
    .get(characterId) as { cnt: number };
  return row?.cnt ?? 0;
}

/** 某用户关注了多少人物。 */
export function getFollowingCount(userId: string): number {
  initFollowDb();
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM character_follows WHERE user_id = ?")
    .get(userId) as { cnt: number };
  return row?.cnt ?? 0;
}
