// ===== 分片5: 屏蔽 / 静音 / 举报数据层 =====
// 复用 db.ts 的 node:sqlite 连接，新建三张表：
//   blocked_users (谁屏蔽了谁)
//   muted_users   (谁静音了谁的语音)
//   reports       (举报记录)
// 所有 DAO 函数幂等、可单测；测试时通过 process.env.DB_PATH 指向临时库隔离。
import { randomUUID } from "node:crypto";
import type { BlockRelation, MuteRelation, Report, ReportStatus, ReportTargetType } from "@balabala/shared";
import { db, initDb } from "./db.js";

let moderationReady = false;

/** 建表（幂等）。首次 DAO 调用时自动执行。 */
export function initModerationDb(): void {
  if (moderationReady) return;
  // 确保 db.ts 的表已建（含迁移）
  initDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(blocker_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS muted_users (
      id TEXT PRIMARY KEY,
      muter_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(muter_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_muted_muter ON muted_users(muter_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
  `);
  moderationReady = true;
}

/** 测试用：重置建表标记（配合 vi.resetModules 使用）。 */
export function _resetModerationDbForTest(): void {
  moderationReady = false;
}

// ===== 屏蔽 =====
type BlockRow = {
  id: string; blocker_id: string; target_id: string; reason: string; created_at: string;
};
function rowToBlock(row: BlockRow): BlockRelation {
  return {
    id: row.id,
    blockerId: row.blocker_id,
    targetId: row.target_id,
    reason: row.reason || undefined,
    createdAt: row.created_at,
  };
}

/** 屏蔽用户。幂等：同一对 (blocker, target) 重复屏蔽不会报错，返回现有记录。 */
export function blockUser(blockerId: string, targetId: string, reason?: string): BlockRelation {
  initModerationDb();
  const existing = getBlock(blockerId, targetId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = `block-${randomUUID()}`;
  db.prepare(
    "INSERT INTO blocked_users (id, blocker_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, blockerId, targetId, reason ?? "", now);
  return { id, blockerId, targetId, reason, createdAt: now };
}

/** 取消屏蔽；不存在时返回 false。 */
export function unblockUser(blockerId: string, targetId: string): boolean {
  initModerationDb();
  const res = db
    .prepare("DELETE FROM blocked_users WHERE blocker_id = ? AND target_id = ?")
    .run(blockerId, targetId);
  return res.changes > 0;
}

/** 查询某对屏蔽关系是否存在。 */
export function getBlock(blockerId: string, targetId: string): BlockRelation | undefined {
  initModerationDb();
  const row = db
    .prepare("SELECT * FROM blocked_users WHERE blocker_id = ? AND target_id = ?")
    .get(blockerId, targetId) as BlockRow | undefined;
  return row ? rowToBlock(row) : undefined;
}

/** 我屏蔽的全部目标 id 列表。 */
export function getBlockedTargetIds(blockerId: string): string[] {
  initModerationDb();
  const rows = db
    .prepare("SELECT target_id FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC")
    .all(blockerId) as Array<{ target_id: string }>;
  return rows.map((r) => r.target_id);
}

/** 我屏蔽的完整关系列表。 */
export function getBlockedUsers(blockerId: string): BlockRelation[] {
  initModerationDb();
  const rows = db
    .prepare("SELECT * FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC")
    .all(blockerId) as BlockRow[];
  return rows.map(rowToBlock);
}

// ===== 静音 =====
type MuteRow = {
  id: string; muter_id: string; target_id: string; reason: string; created_at: string;
};
function rowToMute(row: MuteRow): MuteRelation {
  return {
    id: row.id,
    muterId: row.muter_id,
    targetId: row.target_id,
    reason: row.reason || undefined,
    createdAt: row.created_at,
  };
}

/** 静音某用户的语音。幂等。 */
export function muteUser(muterId: string, targetId: string, reason?: string): MuteRelation {
  initModerationDb();
  const existing = getMute(muterId, targetId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = `mute-${randomUUID()}`;
  db.prepare(
    "INSERT INTO muted_users (id, muter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, muterId, targetId, reason ?? "", now);
  return { id, muterId, targetId, reason, createdAt: now };
}

/** 取消静音；不存在返回 false。 */
export function unmuteUser(muterId: string, targetId: string): boolean {
  initModerationDb();
  const res = db
    .prepare("DELETE FROM muted_users WHERE muter_id = ? AND target_id = ?")
    .run(muterId, targetId);
  return res.changes > 0;
}

export function getMute(muterId: string, targetId: string): MuteRelation | undefined {
  initModerationDb();
  const row = db
    .prepare("SELECT * FROM muted_users WHERE muter_id = ? AND target_id = ?")
    .get(muterId, targetId) as MuteRow | undefined;
  return row ? rowToMute(row) : undefined;
}

/** 我静音的全部目标 id 列表。 */
export function getMutedTargetIds(muterId: string): string[] {
  initModerationDb();
  const rows = db
    .prepare("SELECT target_id FROM muted_users WHERE muter_id = ? ORDER BY created_at DESC")
    .all(muterId) as Array<{ target_id: string }>;
  return rows.map((r) => r.target_id);
}

export function getMutedUsers(muterId: string): MuteRelation[] {
  initModerationDb();
  const rows = db
    .prepare("SELECT * FROM muted_users WHERE muter_id = ? ORDER BY created_at DESC")
    .all(muterId) as MuteRow[];
  return rows.map(rowToMute);
}

// ===== 举报 =====
type ReportRow = {
  id: string; reporter_id: string; target_type: string; target_id: string;
  reason: string; detail: string; status: string; created_at: string; updated_at: string;
};
function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type as ReportTargetType,
    targetId: row.target_id,
    reason: row.reason,
    detail: row.detail || undefined,
    status: row.status as ReportStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REPORT_STATUSES: ReadonlySet<string> = new Set(["pending", "reviewing", "resolved", "dismissed"]);

/** 创建举报。reason 必填。 */
export function createReport(input: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail?: string;
}): Report {
  initModerationDb();
  const now = new Date().toISOString();
  const id = `report-${randomUUID()}`;
  db.prepare(`
    INSERT INTO reports (id, reporter_id, target_type, target_id, reason, detail, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, input.reporterId, input.targetType, input.targetId, input.reason, input.detail ?? "", now, now);
  return {
    id,
    reporterId: input.reporterId,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    detail: input.detail,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

export function getReport(id: string): Report | undefined {
  initModerationDb();
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
  return row ? rowToReport(row) : undefined;
}

/**
 * 列出举报。
 * @param status 可选：按状态过滤（pending/reviewing/resolved/dismissed）。
 * @param limit  最多返回条数。
 */
export function listReports(status?: ReportStatus, limit = 100): Report[] {
  initModerationDb();
  const clamped = Math.min(Math.max(Math.round(limit), 1), 500);
  let rows: ReportRow[];
  if (status && REPORT_STATUSES.has(status)) {
    rows = db
      .prepare("SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT ?")
      .all(status, clamped) as ReportRow[];
  } else {
    rows = db
      .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ?")
      .all(clamped) as ReportRow[];
  }
  return rows.map(rowToReport);
}

/** 更新举报状态；非法状态返回 undefined。 */
export function updateReportStatus(id: string, status: ReportStatus): Report | undefined {
  initModerationDb();
  if (!REPORT_STATUSES.has(status)) return undefined;
  const existing = getReport(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  db.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  return { ...existing, status, updatedAt: now };
}
