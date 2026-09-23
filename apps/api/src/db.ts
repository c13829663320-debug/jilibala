// ===== M7: SQLite 持久化层 (node:sqlite, Node 22 内置) =====
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Verdict,
  BenchMember,
  BenchSpeech,
  Perspective,
  PlazaContent,
  ContentComment,
  User,
  CertRecord,
  MsgRecord,
} from "@balabala/shared";

// ===== StoredCase 本地类型（与 storage.ts 保持一致）=====
export type StoredCase = {
  id: string;
  input: string;
  verdict?: Verdict;
  shareToken?: string;
  createdAt?: string;
  updatedAt?: string;
  benchMembers?: BenchMember[];
  benchTranscript?: BenchSpeech[];
  benchVotes?: { plaintiff: number; defendant: number };
  perspective?: Perspective;
  userId?: string;
};

/** 广场内容 + 归属用户（不进入共享 PlazaContent 类型，仅服务端持久化用） */
export type StoredContent = PlazaContent & { userId?: string };

const DB_PATH = resolve(process.cwd(), ".data", "app.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// ===== 建表 =====
function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL DEFAULT '我',
      avatar_type TEXT NOT NULL DEFAULT 'capsule',
      avatar_ref TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      input TEXT NOT NULL,
      verdict TEXT DEFAULT '',
      share_token TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT DEFAULT '',
      bench_members TEXT DEFAULT '',
      bench_transcript TEXT DEFAULT '',
      bench_votes TEXT DEFAULT '',
      perspective TEXT DEFAULT 'audience'
    );

    CREATE TABLE IF NOT EXISTS contents (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      type TEXT NOT NULL,
      scene TEXT NOT NULL DEFAULT 'all',
      author TEXT NOT NULL DEFAULT '我',
      created_at TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      case_id TEXT DEFAULT '',
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      court TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      author TEXT NOT NULL DEFAULT '我',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(content_id, user_id, reaction)
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      case_title TEXT NOT NULL,
      verdict TEXT NOT NULL,
      charge TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id);
    CREATE INDEX IF NOT EXISTS idx_contents_user ON contents(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
    CREATE INDEX IF NOT EXISTS idx_certs_user ON certificates(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
  `);
}

// ===== JSON 辅助 =====
function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return ""; }
}

// ===== 行 → 领域对象映射 =====
type CaseRow = {
  id: string; user_id: string; input: string;
  verdict: string; share_token: string;
  created_at: string; updated_at: string;
  bench_members: string; bench_transcript: string; bench_votes: string;
  perspective: string;
};
function rowToCase(row: CaseRow): StoredCase {
  return {
    id: row.id,
    input: row.input,
    verdict: safeParse<Verdict | undefined>(row.verdict, undefined),
    shareToken: row.share_token || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    benchMembers: safeParse<BenchMember[] | undefined>(row.bench_members, undefined),
    benchTranscript: safeParse<BenchSpeech[] | undefined>(row.bench_transcript, undefined),
    benchVotes: safeParse<{ plaintiff: number; defendant: number } | undefined>(row.bench_votes, undefined),
    perspective: (row.perspective || "audience") as Perspective,
    userId: row.user_id || undefined,
  };
}

type ContentRow = {
  id: string; user_id: string; type: string; scene: string;
  author: string; created_at: string; topics: string;
  title: string; body: string; case_id: string;
  likes: number; dislikes: number; views: number; court: string;
};
function rowToContent(row: ContentRow): StoredContent {
  const content: StoredContent = {
    id: row.id,
    type: row.type as PlazaContent["type"],
    scene: row.scene as PlazaContent["scene"],
    author: row.author,
    createdAt: row.created_at,
    topics: safeParse<string[]>(row.topics, []),
    title: row.title,
    likes: row.likes,
    dislikes: row.dislikes,
    views: row.views,
    comments: getComments(row.id),
    userId: row.user_id || undefined,
  };
  if (row.body) content.body = row.body;
  if (row.case_id) content.caseId = row.case_id;
  const court = safeParse<PlazaContent["court"]>(row.court, undefined);
  if (court) content.court = court;
  return content;
}

// ===== 种子数据 =====
let seedContentsFn: (() => PlazaContent[]) | null = null;
export function registerSeedContents(fn: () => PlazaContent[]): void {
  seedContentsFn = fn;
}

function seedIfEmpty(): void {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM contents").get() as { cnt: number };
  if (row.cnt > 0) return;
  if (!seedContentsFn) return;
  const seeds = seedContentsFn();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO contents
      (id, user_id, type, scene, author, created_at, topics, title, body, case_id, likes, dislikes, views, court)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of seeds) {
    insert.run(
      c.id, c.type, c.scene, c.author, c.createdAt,
      safeStringify(c.topics), c.title, c.body ?? "", c.caseId ?? "",
      c.likes, c.dislikes, c.views, safeStringify(c.court ?? ""),
    );
    // 种子评论写入 comments 表
    if (c.comments?.length) {
      const insertComment = db.prepare(
        "INSERT OR REPLACE INTO comments (id, content_id, user_id, author, text, created_at) VALUES (?, ?, '', ?, ?, ?)",
      );
      for (const cm of c.comments) {
        insertComment.run(cm.id, c.id, cm.author, cm.text, cm.createdAt);
      }
    }
  }
}

// ===== 初始化 =====
let initialized = false;
export function initDb(): void {
  if (initialized) return;
  createTables();
  seedIfEmpty();
  initialized = true;
}

// ===== 案件 DAO =====
export function getAllCases(): StoredCase[] {
  initDb();
  const rows = db.prepare("SELECT * FROM cases ORDER BY created_at DESC").all() as CaseRow[];
  return rows.map(rowToCase);
}

export function getCase(id: string): StoredCase | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as CaseRow | undefined;
  return row ? rowToCase(row) : undefined;
}

export function upsertCase(c: StoredCase & { userId?: string }): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO cases
      (id, user_id, input, verdict, share_token, created_at, updated_at, bench_members, bench_transcript, bench_votes, perspective)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.id, c.userId ?? "", c.input,
    safeStringify(c.verdict ?? ""),
    c.shareToken ?? "",
    c.createdAt ?? new Date().toISOString(),
    c.updatedAt ?? "",
    safeStringify(c.benchMembers ?? ""),
    safeStringify(c.benchTranscript ?? ""),
    safeStringify(c.benchVotes ?? ""),
    c.perspective ?? "audience",
  );
}

export function deleteCase(id: string): void {
  initDb();
  db.prepare("DELETE FROM cases WHERE id = ?").run(id);
}

export function getCasesByUser(userId: string): StoredCase[] {
  initDb();
  const rows = db.prepare("SELECT * FROM cases WHERE user_id = ? ORDER BY created_at DESC").all(userId) as CaseRow[];
  return rows.map(rowToCase);
}

// ===== 内容 DAO =====
export function getAllContents(): StoredContent[] {
  initDb();
  const rows = db.prepare("SELECT * FROM contents ORDER BY created_at DESC").all() as ContentRow[];
  return rows.map(rowToContent);
}

export function getContent(id: string): StoredContent | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM contents WHERE id = ?").get(id) as ContentRow | undefined;
  return row ? rowToContent(row) : undefined;
}

export function upsertContent(c: StoredContent): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO contents
      (id, user_id, type, scene, author, created_at, topics, title, body, case_id, likes, dislikes, views, court)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.id, c.userId ?? "", c.type, c.scene, c.author, c.createdAt,
    safeStringify(c.topics), c.title, c.body ?? "", c.caseId ?? "",
    c.likes, c.dislikes, c.views, safeStringify(c.court ?? ""),
  );
}

export function getContentsByUser(userId: string): StoredContent[] {
  initDb();
  const rows = db.prepare("SELECT * FROM contents WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ContentRow[];
  return rows.map(rowToContent);
}

/** 清空 contents + comments + reactions（用于 saveContents 全量覆盖）。 */
export function clearContents(): void {
  initDb();
  db.exec("DELETE FROM contents; DELETE FROM comments; DELETE FROM reactions;");
}

// ===== 评论 DAO =====
export function getComments(contentId: string): ContentComment[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM comments WHERE content_id = ? ORDER BY created_at ASC",
  ).all(contentId) as Array<{ id: string; author: string; text: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, author: r.author, text: r.text, createdAt: r.created_at }));
}

export function addComment(contentId: string, comment: ContentComment & { userId?: string }): void {
  initDb();
  db.prepare(
    "INSERT OR REPLACE INTO comments (id, content_id, user_id, author, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(comment.id, contentId, comment.userId ?? "", comment.author, comment.text, comment.createdAt);
}

// ===== 反应 DAO =====
export function addReaction(
  contentId: string,
  userId: string,
  reaction: "like" | "dislike",
): { likes: number; dislikes: number } {
  initDb();
  // 去重：同一用户对同一内容同一反应只计一次
  db.prepare(
    "INSERT OR IGNORE INTO reactions (id, content_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), contentId, userId || "anonymous", reaction, new Date().toISOString());

  const likesRow = db.prepare("SELECT COUNT(*) AS cnt FROM reactions WHERE content_id = ? AND reaction = 'like'").get(contentId) as { cnt: number };
  const dislikesRow = db.prepare("SELECT COUNT(*) AS cnt FROM reactions WHERE content_id = ? AND reaction = 'dislike'").get(contentId) as { cnt: number };

  // 同步 contents 表计数
  db.prepare("UPDATE contents SET likes = ?, dislikes = ? WHERE id = ?").run(likesRow.cnt, dislikesRow.cnt, contentId);
  return { likes: likesRow.cnt, dislikes: dislikesRow.cnt };
}

// ===== 用户 DAO =====
export function getUser(id: string): User | undefined {
  initDb();
  const row = db.prepare(
    "SELECT * FROM users WHERE id = ?",
  ).get(id) as { id: string; nickname: string; avatar_type: string; avatar_ref: string; created_at: string } | undefined;
  if (!row) return undefined;
  return {
    userId: row.id,
    nickname: row.nickname,
    avatarType: row.avatar_type as User["avatarType"],
    avatarRef: row.avatar_ref,
    createdAt: row.created_at,
  };
}

export function upsertUser(u: User): void {
  initDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO users (id, nickname, avatar_type, avatar_ref, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(u.userId, u.nickname, u.avatarType, u.avatarRef, u.createdAt, now);
}

// ===== 证书 DAO =====
export function getCertificates(userId: string): CertRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM certificates WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as Array<{ id: string; user_id: string; case_id: string; case_title: string; verdict: string; charge: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, caseId: r.case_id,
    caseTitle: r.case_title, verdict: r.verdict,
    charge: r.charge || undefined, createdAt: r.created_at,
  }));
}

export function addCertificate(cert: CertRecord): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO certificates (id, user_id, case_id, case_title, verdict, charge, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cert.id, cert.userId, cert.caseId, cert.caseTitle, cert.verdict, cert.charge ?? "", cert.createdAt);
}

// ===== 消息 DAO =====
export function getMessages(userId: string): MsgRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as Array<{ id: string; user_id: string; kind: string; title: string; summary: string; read: number; created_at: string }>;
  return rows.map((r) => ({
    id: r.id, userId: r.user_id,
    kind: r.kind as MsgRecord["kind"],
    title: r.title, summary: r.summary,
    read: r.read === 1, createdAt: r.created_at,
  }));
}

export function addMessage(msg: MsgRecord): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO messages (id, user_id, kind, title, summary, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.userId, msg.kind, msg.title, msg.summary, msg.read ? 1 : 0, msg.createdAt);
}

export function markMessageRead(userId: string, msgId: string): void {
  initDb();
  db.prepare("UPDATE messages SET read = 1 WHERE user_id = ? AND id = ?").run(userId, msgId);
}

export function markAllMessagesRead(userId: string): void {
  initDb();
  db.prepare("UPDATE messages SET read = 1 WHERE user_id = ?").run(userId);
}
