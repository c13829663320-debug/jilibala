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
  SceneId,
  GymGoal,
  GymPlan,
  GymCheckinRecord,
  GymStats,
  GymAchievement,
  GymAchievementId,
  CourtCase,
  CourtCaseStatus,
  CourtEvidence,
  CourtFact,
  CourtPartyRole,
  CourtKnowledgeBase,
  CourtTurn,
  CourtRecord,
  CourtPlayerInput,
  CourtVerdict,
  EvidenceType,
} from "@balabala/shared";
import { calculateStreak } from "./gym-orchestrator.js";

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

// DB_PATH 支持环境变量覆盖（测试时指向临时文件），默认落在工程 .data/app.db。
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), ".data", "app.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// ===== 建表 =====
function tableHasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function migrateContentsTable(): void {
  for (const col of ["talkshow", "bar", "library", "werewolf", "gym", "custom_character", "court_verdict"]) {
    if (!tableHasColumn("contents", col)) {
      db.exec(`ALTER TABLE contents ADD COLUMN ${col} TEXT DEFAULT ''`);
    }
  }
}

/** M13: 在现有 cases 表上 ALTER TABLE 加列（列已存在则跳过）。 */
function migrateCourtCasesTable(): void {  const cols: Array<[string, string]> = [
    ["status", "TEXT DEFAULT 'DRAFT'"],
    ["title", "TEXT DEFAULT ''"],
    ["facts", "TEXT DEFAULT '[]'"],
    ["dispute_points", "TEXT DEFAULT '[]'"],
    ["plaintiff_role", "TEXT DEFAULT ''"],
    ["defendant_role", "TEXT DEFAULT ''"],
    ["plaintiff_kb", "TEXT DEFAULT ''"],
    ["defendant_kb", "TEXT DEFAULT ''"],
    ["court_record", "TEXT DEFAULT ''"],
    ["current_round", "INTEGER DEFAULT 0"],
    ["current_turn", "INTEGER DEFAULT 0"],
    ["final_verdict", "TEXT DEFAULT ''"],
    ["plaintiff_complaint", "TEXT DEFAULT ''"],
    ["defendant_answer", "TEXT DEFAULT ''"],
  ];
  for (const [col, def] of cols) {
    if (!tableHasColumn("cases", col)) {
      db.exec(`ALTER TABLE cases ADD COLUMN ${col} ${def}`);
    }
  }
}

/** M13 第五轮：在现有 custom_characters 表上 ALTER TABLE 加 voice 列（列已存在则跳过）。 */
function migrateCustomCharactersTable(): void {
  if (!tableHasColumn("custom_characters", "voice")) {
    db.exec("ALTER TABLE custom_characters ADD COLUMN voice TEXT DEFAULT ''");
  }
  // 人物 skill 绑定：skill_md 存自定义人物的 skill markdown 原文；NULL/空串表示用默认。
  if (!tableHasColumn("custom_characters", "skill_md")) {
    db.exec("ALTER TABLE custom_characters ADD COLUMN skill_md TEXT DEFAULT ''");
  }
}

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
      court TEXT DEFAULT '',
      talkshow TEXT DEFAULT '',
      bar TEXT DEFAULT '',
      library TEXT DEFAULT '',
      werewolf TEXT DEFAULT '',
      gym TEXT DEFAULT '',
      custom_character TEXT DEFAULT ''
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

    CREATE TABLE IF NOT EXISTS scene_records (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      scene TEXT NOT NULL,
      session_id TEXT DEFAULT '',
      title TEXT DEFAULT '',
      payload TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS werewolf_games (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      game_id TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gym_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      goal TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      exercises TEXT DEFAULT '[]',
      estimated_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gym_checkins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT DEFAULT '',
      exercise_id TEXT DEFAULT '',
      exercise_name TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      sets_completed INTEGER NOT NULL DEFAULT 0,
      reps_completed INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gym_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      UNIQUE(user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS custom_characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      title TEXT DEFAULT '',
      intro TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      persona TEXT NOT NULL DEFAULT '',
      greeting TEXT DEFAULT '',
      model_path TEXT DEFAULT '',
      portrait_path TEXT DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      voice TEXT DEFAULT '',
      skill_md TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS court_evidence (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, content TEXT NOT NULL, submitted_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_court_evidence_case ON court_evidence(case_id);

    CREATE TABLE IF NOT EXISTS court_facts (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, content TEXT NOT NULL,
      source TEXT NOT NULL, disputed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_court_facts_case ON court_facts(case_id);

    CREATE TABLE IF NOT EXISTS court_turns (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, round INTEGER NOT NULL,
      turn INTEGER NOT NULL, speaker TEXT NOT NULL, speaker_id TEXT NOT NULL,
      speaker_name TEXT NOT NULL, content TEXT NOT NULL,
      referenced_evidence TEXT NOT NULL DEFAULT '[]',
      response_to_turn_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_court_turns_case ON court_turns(case_id);

    CREATE TABLE IF NOT EXISTS court_player_inputs (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, user_id TEXT NOT NULL,
      player_role TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
      evidence_name TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_court_player_inputs_case ON court_player_inputs(case_id);

    CREATE TABLE IF NOT EXISTS court_verdicts (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE,
      case_summary TEXT NOT NULL, key_facts TEXT NOT NULL,
      key_evidence TEXT NOT NULL, plaintiff_arguments TEXT NOT NULL,
      defendant_arguments TEXT NOT NULL, judge_analysis TEXT NOT NULL,
      reasoning TEXT NOT NULL, verdict TEXT NOT NULL, conclusion TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id);
    CREATE INDEX IF NOT EXISTS idx_contents_user ON contents(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
    CREATE INDEX IF NOT EXISTS idx_certs_user ON certificates(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_scene_records_user ON scene_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_scene_records_scene ON scene_records(scene);
    CREATE INDEX IF NOT EXISTS idx_werewolf_games_user ON werewolf_games(user_id);
    CREATE INDEX IF NOT EXISTS idx_gym_plans_user ON gym_plans(user_id);
    CREATE INDEX IF NOT EXISTS idx_gym_checkins_user ON gym_checkins(user_id);
    CREATE INDEX IF NOT EXISTS idx_gym_achievements_user ON gym_achievements(user_id);
    CREATE INDEX IF NOT EXISTS idx_custom_chars_user ON custom_characters(user_id);
    CREATE INDEX IF NOT EXISTS idx_custom_chars_visibility ON custom_characters(visibility);
  `);
  migrateContentsTable();
  migrateCourtCasesTable();
  migrateCustomCharactersTable();
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
  title: string; facts: string; dispute_points: string;
  plaintiff_role: string; defendant_role: string;
  plaintiff_kb: string; defendant_kb: string; court_record: string;
  current_round: number; current_turn: number; final_verdict: string;
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
  talkshow: string; bar: string; library: string; werewolf: string; gym: string; custom_character: string;
  court_verdict: string;
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
  const talkshow = safeParse<PlazaContent["talkshow"]>(row.talkshow, undefined);
  if (talkshow) content.talkshow = talkshow;
  const bar = safeParse<PlazaContent["bar"]>(row.bar, undefined);
  if (bar) content.bar = bar;
  const library = safeParse<PlazaContent["library"]>(row.library, undefined);
  if (library) content.library = library;
  const werewolf = safeParse<PlazaContent["werewolf"]>(row.werewolf, undefined);
  if (werewolf) content.werewolf = werewolf;
  const gym = safeParse<PlazaContent["gym"]>(row.gym, undefined);
  if (gym) content.gym = gym;
  const customCharacter = safeParse<PlazaContent["customCharacter"]>(row.custom_character, undefined);
  if (customCharacter) content.customCharacter = customCharacter;
  const courtVerdict = safeParse<PlazaContent["courtVerdict"]>(row.court_verdict, undefined);
  if (courtVerdict) content.courtVerdict = courtVerdict;
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
      (id, user_id, type, scene, author, created_at, topics, title, body, case_id, likes, dislikes, views, court, talkshow, bar, library, werewolf, gym, custom_character, court_verdict)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of seeds) {
    insert.run(
      c.id, c.type, c.scene, c.author, c.createdAt,
      safeStringify(c.topics), c.title, c.body ?? "", c.caseId ?? "",
      c.likes, c.dislikes, c.views,
      safeStringify(c.court ?? ""),
      safeStringify(c.talkshow ?? ""),
      safeStringify(c.bar ?? ""),
      safeStringify(c.library ?? ""),
      safeStringify(c.werewolf ?? ""),
      safeStringify(c.gym ?? ""),
      safeStringify(c.customCharacter ?? ""),
      safeStringify(c.courtVerdict ?? ""),
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
      (id, user_id, type, scene, author, created_at, topics, title, body, case_id, likes, dislikes, views, court, talkshow, bar, library, werewolf, gym, custom_character, court_verdict)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.id, c.userId ?? "", c.type, c.scene, c.author, c.createdAt,
    safeStringify(c.topics), c.title, c.body ?? "", c.caseId ?? "",
    c.likes, c.dislikes, c.views,
    safeStringify(c.court ?? ""),
    safeStringify(c.talkshow ?? ""),
    safeStringify(c.bar ?? ""),
    safeStringify(c.library ?? ""),
    safeStringify(c.werewolf ?? ""),
    safeStringify(c.gym ?? ""),
    safeStringify(c.customCharacter ?? ""),
    safeStringify(c.courtVerdict ?? ""),
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

// ===== M8: 场景记录 DAO =====
export type SceneRecord = {
  id: string;
  userId?: string;
  scene: SceneId;
  sessionId: string;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type SceneRecordRow = {
  id: string; user_id: string; scene: string; session_id: string;
  title: string; payload: string; created_at: string;
};

function rowToSceneRecord(row: SceneRecordRow): SceneRecord {
  return {
    id: row.id,
    userId: row.user_id || undefined,
    scene: row.scene as SceneId,
    sessionId: row.session_id,
    title: row.title,
    payload: safeParse<Record<string, unknown>>(row.payload, {}),
    createdAt: row.created_at,
  };
}

export function addSceneRecord(rec: Omit<SceneRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): SceneRecord {
  initDb();
  const record: SceneRecord = {
    id: rec.id ?? randomUUID(),
    userId: rec.userId,
    scene: rec.scene,
    sessionId: rec.sessionId,
    title: rec.title,
    payload: rec.payload,
    createdAt: rec.createdAt ?? new Date().toISOString(),
  };
  db.prepare(`
    INSERT OR REPLACE INTO scene_records (id, user_id, scene, session_id, title, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.userId ?? "", record.scene, record.sessionId,
    record.title, safeStringify(record.payload), record.createdAt,
  );
  return record;
}

export function getSceneRecordsByUser(userId: string): SceneRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM scene_records WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as SceneRecordRow[];
  return rows.map(rowToSceneRecord);
}

export function getSceneRecordsByScene(scene: SceneId, limit = 50): SceneRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM scene_records WHERE scene = ? ORDER BY created_at DESC LIMIT ?",
  ).all(scene, limit) as SceneRecordRow[];
  return rows.map(rowToSceneRecord);
}

export function getSceneRecord(id: string): SceneRecord | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM scene_records WHERE id = ?").get(id) as SceneRecordRow | undefined;
  return row ? rowToSceneRecord(row) : undefined;
}

// ===== M9: 狼人杀对局记录 DAO =====
export type WerewolfGameRecord = {
  id: string;
  userId: string;
  gameId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type WerewolfGameRow = {
  id: string; user_id: string; game_id: string; payload: string; created_at: string;
};

function rowToWerewolfGame(row: WerewolfGameRow): WerewolfGameRecord {
  return {
    id: row.id,
    userId: row.user_id || "",
    gameId: row.game_id,
    payload: safeParse<Record<string, unknown>>(row.payload, {}),
    createdAt: row.created_at,
  };
}

export function addWerewolfGame(
  rec: Omit<WerewolfGameRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
): WerewolfGameRecord {
  initDb();
  const record: WerewolfGameRecord = {
    id: rec.id ?? randomUUID(),
    userId: rec.userId,
    gameId: rec.gameId,
    payload: rec.payload,
    createdAt: rec.createdAt ?? new Date().toISOString(),
  };
  db.prepare(`
    INSERT OR REPLACE INTO werewolf_games (id, user_id, game_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(record.id, record.userId, record.gameId, safeStringify(record.payload), record.createdAt);
  return record;
}

export function getWerewolfGamesByUser(userId: string): WerewolfGameRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM werewolf_games WHERE user_id = ? ORDER BY created_at DESC",
  ).all(userId) as WerewolfGameRow[];
  return rows.map(rowToWerewolfGame);
}

// ===== M11: 健身房 Gym DAO =====

/** 成就定义表（内置常量，与 checkAchievements 判定对应）。 */
export const ACHIEVEMENT_DEFS: Array<{
  id: GymAchievementId;
  name: string;
  description: string;
  emoji: string;
}> = [
  { id: "first_checkin", name: "首次打卡", description: "完成第一次健身打卡", emoji: "🥇" },
  { id: "streak_3", name: "连续3天", description: "连续打卡 3 天", emoji: "🔥" },
  { id: "streak_7", name: "连续7天", description: "连续打卡 7 天", emoji: "💪" },
  { id: "streak_30", name: "连续30天", description: "连续打卡 30 天", emoji: "🏆" },
  { id: "checkin_10", name: "累计10次", description: "累计打卡 10 次", emoji: "⭐" },
  { id: "checkin_50", name: "累计50次", description: "累计打卡 50 次", emoji: "🌟" },
  { id: "checkin_100", name: "累计100次", description: "累计打卡 100 次", emoji: "👑" },
  { id: "muscle_master", name: "增肌达人", description: "使用哑铃/卧推器械打卡 5 次以上", emoji: "💪" },
  { id: "cardio_king", name: "有氧之王", description: "使用跑步机/单车/划船机打卡 5 次以上", emoji: "🏃" },
  { id: "flexibility_guru", name: "柔韧大师", description: "瑜伽垫或拉伸类打卡 5 次以上", emoji: "🧘" },
];

type GymPlanRow = {
  id: string; user_id: string; goal: string; title: string;
  description: string; exercises: string; estimated_minutes: number; created_at: string;
};

function rowToGymPlan(row: GymPlanRow): GymPlan {
  return {
    id: row.id,
    goal: row.goal as GymGoal,
    title: row.title,
    description: row.description,
    exercises: safeParse<GymPlan["exercises"]>(row.exercises, []),
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
  };
}

export function saveGymPlan(plan: GymPlan & { userId?: string }): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO gym_plans
      (id, user_id, goal, title, description, exercises, estimated_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plan.id, plan.userId ?? "", plan.goal, plan.title, plan.description,
    safeStringify(plan.exercises), plan.estimatedMinutes, plan.createdAt,
  );
}

export function getGymPlansByUser(userId: string, limit = 10): GymPlan[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM gym_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  ).all(userId, limit) as GymPlanRow[];
  return rows.map(rowToGymPlan);
}

type GymCheckinRow = {
  id: string; user_id: string; plan_id: string; exercise_id: string;
  exercise_name: string; equipment: string; sets_completed: number;
  reps_completed: number; duration_seconds: number; note: string; created_at: string;
};

function rowToGymCheckin(row: GymCheckinRow): GymCheckinRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id || undefined,
    exerciseId: row.exercise_id || undefined,
    exerciseName: row.exercise_name || undefined,
    equipment: (row.equipment || undefined) as GymCheckinRecord["equipment"],
    setsCompleted: row.sets_completed,
    repsCompleted: row.reps_completed,
    durationSeconds: row.duration_seconds,
    note: row.note || undefined,
    createdAt: row.created_at,
  };
}

export function addGymCheckin(checkin: GymCheckinRecord): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO gym_checkins
      (id, user_id, plan_id, exercise_id, exercise_name, equipment,
       sets_completed, reps_completed, duration_seconds, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkin.id, checkin.userId, checkin.planId ?? "", checkin.exerciseId ?? "",
    checkin.exerciseName ?? "", checkin.equipment ?? "",
    checkin.setsCompleted, checkin.repsCompleted, checkin.durationSeconds,
    checkin.note ?? "", checkin.createdAt,
  );
}

export function getGymCheckinsByUser(userId: string, limit = 50): GymCheckinRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM gym_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  ).all(userId, limit) as GymCheckinRow[];
  return rows.map(rowToGymCheckin);
}

export function getGymCheckinById(id: string): GymCheckinRecord | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM gym_checkins WHERE id = ?").get(id) as GymCheckinRow | undefined;
  return row ? rowToGymCheckin(row) : undefined;
}

export function getGymStats(userId: string): GymStats {
  initDb();
  const rows = db.prepare(
    "SELECT created_at, duration_seconds FROM gym_checkins WHERE user_id = ? ORDER BY created_at ASC",
  ).all(userId) as Array<{ created_at: string; duration_seconds: number }>;

  const totalCheckins = rows.length;
  const totalSeconds = rows.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  const lastCheckinDate = totalCheckins > 0 ? rows[rows.length - 1].created_at : "";

  const streak = calculateStreak(rows.map((r) => r.created_at));

  return {
    userId,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    totalCheckins,
    totalMinutes,
    lastCheckinDate,
  };
}

export function getGymAchievements(userId: string): GymAchievement[] {
  initDb();
  const unlockedRows = db.prepare(
    "SELECT achievement_id, unlocked_at FROM gym_achievements WHERE user_id = ?",
  ).all(userId) as Array<{ achievement_id: string; unlocked_at: string }>;
  const unlockedMap = new Map(unlockedRows.map((r) => [r.achievement_id, r.unlocked_at]));

  return ACHIEVEMENT_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    emoji: def.emoji,
    ...(unlockedMap.has(def.id) ? { unlockedAt: unlockedMap.get(def.id) } : {}),
  }));
}

export function unlockGymAchievement(
  userId: string,
  achievementId: GymAchievementId,
): GymAchievement | null {
  initDb();
  const def = ACHIEVEMENT_DEFS.find((d) => d.id === achievementId);
  if (!def) return null;

  // 幂等：已解锁则返回已有记录
  const existing = db.prepare(
    "SELECT unlocked_at FROM gym_achievements WHERE user_id = ? AND achievement_id = ?",
  ).get(userId, achievementId) as { unlocked_at: string } | undefined;
  if (existing) {
    return { id: def.id, name: def.name, description: def.description, emoji: def.emoji, unlockedAt: existing.unlocked_at };
  }

  const unlockedAt = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO gym_achievements (id, user_id, achievement_id, unlocked_at)
    VALUES (?, ?, ?, ?)
  `).run(`${userId}:${achievementId}`, userId, achievementId, unlockedAt);

  return { id: def.id, name: def.name, description: def.description, emoji: def.emoji, unlockedAt };
}

// ===== M12: 自定义人物 Custom Character DAO =====

/** 自定义人物持久化记录（persona 仅服务端使用，绝不下发前端）。 */
export type CustomCharacterRecord = {
  id: string;
  userId: string;
  name: string;
  title: string;
  intro: string;
  tags: string[];
  persona: string;
  greeting: string;
  modelPath: string;
  portraitPath: string;
  visibility: "private" | "public";
  /** StepFun 官方预置音色 id（M13 第五轮），空串表示未设置→默认音色。 */
  voice: string;
  /** 人物 skill markdown 原文（空串表示用默认 skill）。 */
  skillMd: string;
  createdAt: string;
  updatedAt: string;
};

type CustomCharacterRow = {
  id: string; user_id: string; name: string; title: string; intro: string;
  tags: string; persona: string; greeting: string;
  model_path: string; portrait_path: string; visibility: string;
  voice?: string; skill_md?: string;
  created_at: string; updated_at: string;
};

function rowToCustomCharacter(row: CustomCharacterRow): CustomCharacterRecord {
  return {
    id: row.id,
    userId: row.user_id || "",
    name: row.name,
    title: row.title || "",
    intro: row.intro || "",
    tags: safeParse<string[]>(row.tags, []),
    persona: row.persona || "",
    greeting: row.greeting || "",
    modelPath: row.model_path || "",
    portraitPath: row.portrait_path || "",
    visibility: (row.visibility === "public" ? "public" : "private") as "private" | "public",
    voice: row.voice || "",
    skillMd: row.skill_md || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCustomCharacter(c: CustomCharacterRecord): CustomCharacterRecord {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO custom_characters
      (id, user_id, name, title, intro, tags, persona, greeting, model_path, portrait_path, visibility, voice, skill_md, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.id, c.userId, c.name, c.title, c.intro,
    safeStringify(c.tags), c.persona, c.greeting,
    c.modelPath, c.portraitPath, c.visibility, c.voice ?? "", c.skillMd ?? "",
    c.createdAt, c.updatedAt,
  );
  return c;
}

export function getCustomCharacter(id: string): CustomCharacterRecord | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM custom_characters WHERE id = ?").get(id) as CustomCharacterRow | undefined;
  return row ? rowToCustomCharacter(row) : undefined;
}

export function updateCustomCharacter(
  id: string,
  patch: Partial<Omit<CustomCharacterRecord, "id" | "createdAt">>,
): CustomCharacterRecord | undefined {
  initDb();
  const existing = getCustomCharacter(id);
  if (!existing) return undefined;
  const next: CustomCharacterRecord = {
    ...existing,
    ...patch,
    tags: Array.isArray(patch.tags) ? patch.tags : existing.tags,
    visibility: patch.visibility === "public" ? "public" : (patch.visibility === "private" ? "private" : existing.visibility),
    updatedAt: new Date().toISOString(),
    id: existing.id,
    createdAt: existing.createdAt,
  };
  db.prepare(`
    UPDATE custom_characters SET
      user_id = ?, name = ?, title = ?, intro = ?, tags = ?, persona = ?,
      greeting = ?, model_path = ?, portrait_path = ?, visibility = ?, voice = ?, skill_md = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.userId, next.name, next.title, next.intro,
    safeStringify(next.tags), next.persona, next.greeting,
    next.modelPath, next.portraitPath, next.visibility, next.voice ?? "", next.skillMd ?? "", next.updatedAt,
    next.id,
  );
  return next;
}

export function deleteCustomCharacter(id: string): void {
  initDb();
  db.prepare("DELETE FROM custom_characters WHERE id = ?").run(id);
}

export function getCustomCharactersByUser(userId: string): CustomCharacterRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM custom_characters WHERE user_id = ? ORDER BY updated_at DESC",
  ).all(userId) as CustomCharacterRow[];
  return rows.map(rowToCustomCharacter);
}

export function getPublicCustomCharacters(limit = 50): CustomCharacterRecord[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM custom_characters WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT ?",
  ).all(limit) as CustomCharacterRow[];
  return rows.map(rowToCustomCharacter);
}

// ===== M13: 趣味法庭 Court DAO =====

type CourtCaseRow = {
  id: string; user_id: string; input: string;
  status: string;
  title: string; facts: string; dispute_points: string;
  plaintiff_role: string; defendant_role: string;
  plaintiff_kb: string; defendant_kb: string; court_record: string;
  current_round: number; current_turn: number; final_verdict: string;
  created_at: string; updated_at: string;
  perspective: string;
  plaintiff_complaint?: string;
  defendant_answer?: string;
};

/** CourtCase + 前端展示用扩展（起诉状/答辩状文书，非 shared 字段）。 */
export type CourtCaseWithDocs = CourtCase & {
  plaintiff_complaint?: string;
  defendant_answer?: string;
};

export function rowToCourtCase(row: CourtCaseRow): CourtCaseWithDocs {
  const evidence = getCourtEvidence(row.id);
  const facts = getCourtFacts(row.id);
  const verdict = getCourtVerdict(row.id);
  const plaintiff = safeParse<CourtPartyRole | null>(row.plaintiff_role, null);
  const defendant = safeParse<CourtPartyRole | null>(row.defendant_role, null);
  const plaintiffKb = safeParse<CourtKnowledgeBase | null>(row.plaintiff_kb, null);
  const defendantKb = safeParse<CourtKnowledgeBase | null>(row.defendant_kb, null);
  const courtRecord = safeParse<CourtRecord | null>(row.court_record, null);
  return {
    id: row.id,
    userId: row.user_id || "",
    status: (row.status || "DRAFT") as CourtCaseStatus,
    title: row.title || "",
    user_input: row.input || "",
    evidence,
    facts,
    dispute_points: safeParse<string[]>(row.dispute_points, []),
    plaintiff,
    defendant,
    plaintiff_kb: plaintiffKb,
    defendant_kb: defendantKb,
    court_record: courtRecord,
    current_round: row.current_round || 0,
    current_turn: row.current_turn || 0,
    final_verdict: verdict ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    plaintiff_complaint: row.plaintiff_complaint || "",
    defendant_answer: row.defendant_answer || "",
  };
}

export function createCourtCase(
  userId: string,
  userInput: string,
  evidence?: Array<{ name: string; type: EvidenceType; content: string; submittedBy?: "plaintiff" | "defendant" | "user" | "system" }>,
): CourtCase {
  initDb();
  const id = `court-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cases (id, user_id, input, title, facts, dispute_points,
      plaintiff_role, defendant_role, plaintiff_kb, defendant_kb, court_record,
      current_round, current_turn, final_verdict, created_at, updated_at, perspective)
    VALUES (?, ?, ?, '', '[]', '[]', '', '', '', '', '', 0, 0, '', ?, ?, 'audience')
  `).run(id, userId, userInput, now, now);
  // 写入初始证据
  if (evidence && evidence.length) {
    for (const ev of evidence) {
      addCourtEvidence(id, {
        type: ev.type,
        name: ev.name,
        content: ev.content,
        submittedBy: ev.submittedBy ?? "user",
      });
    }
  }
  return getCourtCase(id)!;
}

export function getCourtCase(id: string): CourtCase | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as CourtCaseRow | undefined;
  if (!row) return undefined;
  return rowToCourtCase(row);
}

export function updateCourtCaseStatus(id: string, status: CourtCaseStatus): void {
  initDb();
  db.prepare("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
}

export function updateCourtCaseAnalysis(
  id: string,
  data: {
    title: string;
    facts: Array<{ content: string; source: string; disputed?: boolean }>;
    disputePoints: string[];
    plaintiffRole: Omit<CourtPartyRole, "id" | "caseId" | "createdAt">;
    defendantRole: Omit<CourtPartyRole, "id" | "caseId" | "createdAt">;
    plaintiffKb: Omit<CourtKnowledgeBase, "caseId" | "updatedAt">;
    defendantKb: Omit<CourtKnowledgeBase, "caseId" | "updatedAt">;
    plaintiffComplaint?: string;
    defendantAnswer?: string;
  },
): void {
  initDb();
  const now = new Date().toISOString();
  // 写入 facts 到 court_facts 表
  db.prepare("DELETE FROM court_facts WHERE case_id = ?").run(id);
  for (const f of data.facts) {
    addCourtFact(id, { content: f.content, source: f.source, disputed: f.disputed ?? false });
  }
  db.prepare(`
    UPDATE cases SET
      title = ?, facts = ?, dispute_points = ?,
      plaintiff_role = ?, defendant_role = ?,
      plaintiff_kb = ?, defendant_kb = ?,
      plaintiff_complaint = ?, defendant_answer = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    data.title,
    safeStringify(data.facts.map((f) => f.content)),
    safeStringify(data.disputePoints),
    safeStringify({ ...data.plaintiffRole, id: `cr-pl-${id}`, caseId: id, createdAt: now }),
    safeStringify({ ...data.defendantRole, id: `cr-de-${id}`, caseId: id, createdAt: now }),
    safeStringify({ ...data.plaintiffKb, caseId: id, updatedAt: now }),
    safeStringify({ ...data.defendantKb, caseId: id, updatedAt: now }),
    data.plaintiffComplaint ?? "",
    data.defendantAnswer ?? "",
    now,
    id,
  );
}

/** 仅更新两份诉讼文书（用户在确认前编辑过起诉状/答辩状）。 */
export function updateCourtCaseDocs(
  id: string,
  docs: { plaintiffComplaint?: string; defendantAnswer?: string },
): void {
  initDb();
  db.prepare("UPDATE cases SET plaintiff_complaint = ?, defendant_answer = ?, updated_at = ? WHERE id = ?").run(
    docs.plaintiffComplaint ?? "", docs.defendantAnswer ?? "", new Date().toISOString(), id,
  );
}

/** 案卷库：列出某用户的全部法庭案件（按更新时间倒序，含判决摘要）。 */
export function listCourtCasesByUser(userId: string): CourtCaseWithDocs[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM cases WHERE user_id = ? ORDER BY updated_at DESC",
  ).all(userId) as CourtCaseRow[];
  return rows.map((r) => rowToCourtCase(r));
}

/** 案卷库：删除案件及其全部子表数据（证据/事实/发言/玩家输入/判决）。 */
export function deleteCourtCase(id: string): void {
  initDb();
  db.prepare("DELETE FROM court_evidence WHERE case_id = ?").run(id);
  db.prepare("DELETE FROM court_facts WHERE case_id = ?").run(id);
  db.prepare("DELETE FROM court_turns WHERE case_id = ?").run(id);
  db.prepare("DELETE FROM court_player_inputs WHERE case_id = ?").run(id);
  db.prepare("DELETE FROM court_verdicts WHERE case_id = ?").run(id);
  db.prepare("DELETE FROM cases WHERE id = ?").run(id);
}

/** 按 share_token 查找已结案案件（公开分享用）。 */
export function getCourtCaseByShareToken(shareToken: string): CourtCaseWithDocs | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM cases WHERE share_token = ?").get(shareToken) as CourtCaseRow | undefined;
  if (!row) return undefined;
  return rowToCourtCase(row);
}

/** 写入 share_token（生成分享链接时调用）。 */
export function setCourtShareToken(id: string, token: string): void {
  initDb();
  db.prepare("UPDATE cases SET share_token = ?, updated_at = ? WHERE id = ?").run(token, new Date().toISOString(), id);
}

export function updateCourtRecord(id: string, record: CourtRecord): void {
  initDb();
  db.prepare("UPDATE cases SET court_record = ?, updated_at = ? WHERE id = ?").run(
    safeStringify(record), new Date().toISOString(), id,
  );
}

export function updateCourtRoundTurn(id: string, round: number, turn: number): void {
  initDb();
  db.prepare("UPDATE cases SET current_round = ?, current_turn = ?, updated_at = ? WHERE id = ?").run(
    round, turn, new Date().toISOString(), id,
  );
}

export function setCourtVerdict(id: string, verdict: CourtVerdict): void {
  initDb();
  db.prepare(`
    INSERT OR REPLACE INTO court_verdicts
      (id, case_id, case_summary, key_facts, key_evidence, plaintiff_arguments,
       defendant_arguments, judge_analysis, reasoning, verdict, conclusion, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    verdict.id, id, verdict.case_summary,
    safeStringify(verdict.key_facts), safeStringify(verdict.key_evidence),
    safeStringify(verdict.plaintiff_arguments), safeStringify(verdict.defendant_arguments),
    verdict.judge_analysis, verdict.reasoning, verdict.verdict, verdict.conclusion,
    verdict.createdAt,
  );
  db.prepare("UPDATE cases SET final_verdict = ?, updated_at = ? WHERE id = ?").run(
    safeStringify(verdict), new Date().toISOString(), id,
  );
}

export function getCourtVerdict(caseId: string): CourtVerdict | undefined {
  initDb();
  const row = db.prepare("SELECT * FROM court_verdicts WHERE case_id = ?").get(caseId) as {
    id: string; case_id: string; case_summary: string; key_facts: string;
    key_evidence: string; plaintiff_arguments: string; defendant_arguments: string;
    judge_analysis: string; reasoning: string; verdict: string; conclusion: string; created_at: string;
  } | undefined;
  if (!row) return undefined;
  return {
    id: row.id, caseId: row.case_id, case_summary: row.case_summary,
    key_facts: safeParse<string[]>(row.key_facts, []),
    key_evidence: safeParse<string[]>(row.key_evidence, []),
    plaintiff_arguments: safeParse<string[]>(row.plaintiff_arguments, []),
    defendant_arguments: safeParse<string[]>(row.defendant_arguments, []),
    judge_analysis: row.judge_analysis, reasoning: row.reasoning,
    verdict: row.verdict as CourtVerdict["verdict"],
    conclusion: row.conclusion, createdAt: row.created_at,
  };
}

export function addCourtEvidence(
  caseId: string,
  evidence: Omit<CourtEvidence, "id" | "caseId" | "createdAt">,
): CourtEvidence {
  initDb();
  const id = `cte-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO court_evidence (id, case_id, type, name, content, submitted_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, caseId, evidence.type, evidence.name, evidence.content, evidence.submittedBy, now);
  return { id, caseId, ...evidence, createdAt: now };
}

export function getCourtEvidence(caseId: string): CourtEvidence[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM court_evidence WHERE case_id = ? ORDER BY created_at ASC",
  ).all(caseId) as Array<{
    id: string; case_id: string; type: string; name: string; content: string;
    submitted_by: string; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id, caseId: r.case_id, type: r.type as EvidenceType,
    name: r.name, content: r.content,
    submittedBy: r.submitted_by as CourtEvidence["submittedBy"],
    createdAt: r.created_at,
  }));
}

export function addCourtFact(
  caseId: string,
  fact: Omit<CourtFact, "id" | "caseId" | "createdAt">,
): CourtFact {
  initDb();
  const id = `ctf-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO court_facts (id, case_id, content, source, disputed, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, caseId, fact.content, fact.source, fact.disputed ? 1 : 0, now);
  return { id, caseId, ...fact, createdAt: now };
}

export function getCourtFacts(caseId: string): CourtFact[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM court_facts WHERE case_id = ? ORDER BY created_at ASC",
  ).all(caseId) as Array<{
    id: string; case_id: string; content: string; source: string;
    disputed: number; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id, caseId: r.case_id, content: r.content,
    source: r.source, disputed: r.disputed === 1, createdAt: r.created_at,
  }));
}

export function addCourtTurn(turn: Omit<CourtTurn, "id" | "createdAt">): CourtTurn {
  initDb();
  const id = `ctt-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO court_turns (id, case_id, round, turn, speaker, speaker_id,
      speaker_name, content, referenced_evidence, response_to_turn_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, turn.caseId, turn.round, turn.turn, turn.speaker, turn.speakerId,
    turn.speakerName, turn.content,
    safeStringify(turn.referenced_evidence), turn.response_to_turn_id, now,
  );
  return { id, ...turn, createdAt: now };
}

export function getCourtTurns(caseId: string): CourtTurn[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM court_turns WHERE case_id = ? ORDER BY round ASC, turn ASC",
  ).all(caseId) as Array<{
    id: string; case_id: string; round: number; turn: number;
    speaker: string; speaker_id: string; speaker_name: string; content: string;
    referenced_evidence: string; response_to_turn_id: string | null; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id, caseId: r.case_id, round: r.round, turn: r.turn,
    speaker: r.speaker as CourtTurn["speaker"],
    speakerId: r.speaker_id, speakerName: r.speaker_name, content: r.content,
    referenced_evidence: safeParse<string[]>(r.referenced_evidence, []),
    response_to_turn_id: r.response_to_turn_id,
    createdAt: r.created_at,
  }));
}

export function addCourtPlayerInput(
  input: Omit<CourtPlayerInput, "id" | "createdAt">,
): CourtPlayerInput {
  initDb();
  const id = `ctp-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO court_player_inputs (id, case_id, user_id, player_role, type, content, evidence_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.caseId, input.userId, input.player_role, input.type, input.content, input.evidenceName ?? null, now);
  return { id, ...input, createdAt: now };
}

export function getCourtPlayerInputs(caseId: string): CourtPlayerInput[] {
  initDb();
  const rows = db.prepare(
    "SELECT * FROM court_player_inputs WHERE case_id = ? ORDER BY created_at ASC",
  ).all(caseId) as Array<{
    id: string; case_id: string; user_id: string; player_role: string;
    type: string; content: string; evidence_name: string | null; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id, caseId: r.case_id, userId: r.user_id,
    player_role: r.player_role as CourtPlayerInput["player_role"],
    type: r.type as CourtPlayerInput["type"],
    content: r.content, evidenceName: r.evidence_name || undefined,
    createdAt: r.created_at,
  }));
}
