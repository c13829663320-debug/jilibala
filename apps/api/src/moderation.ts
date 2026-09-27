// ===== R4-08: 内容治理 =====
//  - 敏感词过滤：apps/api/data/bad-words.json，命中替换为 ***（不改消息 ID/时间戳）
//  - 临时禁言：被举报 3 次/24h 自动禁言 10 分钟，禁言期间聊天/喊话被拒
//  - 服务端屏蔽：用户维护屏蔽列表，被屏蔽者无法私聊/好友请求
//  - 举报记录：读取 ws.ts 写入的 reports.log，供 GET /api/reports 管理查询
//
// 路径默认相对本文件解析（apps/api/src/ → apps/api/data 与 apps/api/.data），
// 测试通过 configureModerationForTest 注入临时目录。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ModerationAction, ReportCategory } from "@balabala/shared";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(SRC_DIR, "..", "data");
const DEFAULT_RUNTIME_DIR = resolve(SRC_DIR, "..", ".data");

export const MUTE_DURATION_MS = 10 * 60 * 1000; // 临时禁言 10 分钟
export const REPORT_THRESHOLD = 3; // 24h 内被举报 3 次触发禁言
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ===== R5 发布域：敏感词命中累计自动禁言 =====
/** 敏感词命中累计多少次触发自动禁言 */
export const PROFANITY_MUTE_THRESHOLD = 3;
/** 命中累计触发的自动禁言时长：5 分钟 */
export const PROFANITY_MUTE_DURATION_MS = 5 * 60 * 1000;
/** 命中计数的滑动时间窗：30 分钟内累计 */
export const PROFANITY_WINDOW_MS = 30 * 60 * 1000;

let dataDir = DEFAULT_DATA_DIR;
let runtimeDir = DEFAULT_RUNTIME_DIR;
let badWords: string[] = [];

/** 内存态禁言表：userId -> 禁言截止时间戳 ms。 */
const mutes = new Map<string, number>();

/** R5: 敏感词命中时间戳表：userId -> 最近命中时间戳数组（滑动窗口计数）。 */
const profanityHits = new Map<string, number[]>();

/** 服务端屏蔽表：blockerId -> Set<blockedUserId>。持久化到 blocks.json。 */
let blocks = new Map<string, Set<string>>();

// ===== 路径与数据加载 =====

function loadBadWords(): string[] {
  try {
    const raw = readFileSync(resolve(dataDir, "bad-words.json"), "utf8");
    const parsed = JSON.parse(raw) as { words?: unknown };
    if (Array.isArray(parsed.words)) {
      return parsed.words.filter((w): w is string => typeof w === "string" && w.length > 0);
    }
  } catch {
    /* 文件缺失时退化为空表 */
  }
  return [];
}

function blocksFilePath(): string {
  return resolve(runtimeDir, "blocks.json");
}

function loadBlocks(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  try {
    const raw = readFileSync(blocksFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [blocker, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) map.set(blocker, new Set(list.filter((x) => typeof x === "string")));
    }
  } catch {
    /* 首次使用无文件 */
  }
  return map;
}

function persistBlocks(): void {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    const out: Record<string, string[]> = {};
    for (const [blocker, set] of blocks) out[blocker] = [...set];
    writeFileSync(blocksFilePath(), JSON.stringify(out, null, 2), "utf8");
  } catch (e) {
    console.warn("[moderation] 写入 blocks.json 失败:", e);
  }
}

/** R5: 禁言持久化目录：.data/mutes/<userId>.json */
function mutesDir(): string {
  return resolve(runtimeDir, "mutes");
}

function muteFile(userId: string): string {
  return resolve(mutesDir(), `${userId}.json`);
}

/** 启动/切换目录时：从 .data/mutes/ 恢复未过期的禁言；过期记录顺手清理。 */
function loadPersistedMutes(): void {
  mutes.clear();
  profanityHits.clear();
  const dir = mutesDir();
  if (!existsSync(dir)) return;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  const now = Date.now();
  for (const f of files) {
    const userId = f.replace(/\.json$/, "");
    try {
      const parsed = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { until?: number };
      const until = typeof parsed.until === "number" ? parsed.until : 0;
      if (until > now) {
        mutes.set(userId, until);
      } else {
        rmSync(resolve(dir, f), { force: true });
      }
    } catch {
      /* 坏文件跳过 */
    }
  }
}

/** 测试用：切换数据/运行目录并重置内存态。 */
export function configureModerationForTest(opts: { dataDir: string; runtimeDir: string }): void {
  dataDir = opts.dataDir;
  runtimeDir = opts.runtimeDir;
  badWords = loadBadWords();
  loadPersistedMutes();
  blocks = loadBlocks();
  bans = loadBans();
  counters = loadCounters();
}

/** 测试用：重置为生产路径。 */
export function resetModerationForTest(): void {
  dataDir = DEFAULT_DATA_DIR;
  runtimeDir = DEFAULT_RUNTIME_DIR;
  badWords = loadBadWords();
  loadPersistedMutes();
  blocks = loadBlocks();
  bans = loadBans();
  counters = loadCounters();
}

// ===== 敏感词过滤 =====

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 过滤文本：命中敏感词片段替换为 ***。返回是否命中。 */
export function filterProfanity(raw: string): { text: string; hit: boolean } {
  if (!raw || badWords.length === 0) return { text: raw, hit: false };
  let hit = false;
  let out = raw;
  for (const word of badWords) {
    if (!word) continue;
    const re = new RegExp(escapeRegExp(word), "gi");
    if (re.test(out)) {
      hit = true;
      out = out.replace(re, "***");
    }
  }
  return { text: out, hit };
}

/**
 * 聊天/喊话统一入口：先查禁言，再过敏感词。
 * 未命中敏感词时 text 与原文一致；禁言时 muted=true 由调用方拒收。
 */
export function moderateText(userId: string, raw: string): ModerationAction {
  const muted = isMuted(userId);
  const filtered = filterProfanity(raw);
  return {
    hit: filtered.hit,
    text: filtered.text,
    muted,
    ...(muted ? { mutedUntil: mutes.get(userId) } : {}),
  };
}

// ===== 临时禁言 =====

/** 是否正在禁言中（惰性过期清理）。 */
export function isMuted(userId: string): boolean {
  if (!userId) return false;
  const until = mutes.get(userId);
  if (!until) return false;
  if (Date.now() >= until) {
    mutes.delete(userId);
    return false;
  }
  return true;
}

/** R5: 返回当前禁言截止时间戳 ms（未禁言/已过期返回 undefined）。 */
export function getMutedUntil(userId: string): number | undefined {
  if (!userId) return undefined;
  const until = mutes.get(userId);
  if (!until) return undefined;
  if (Date.now() >= until) {
    mutes.delete(userId);
    return undefined;
  }
  return until;
}

/** 手动/自动禁言。返回新的禁言截止时间。R5: 持久化到 .data/mutes/。 */
export function muteUser(userId: string, durationMs: number = MUTE_DURATION_MS, reason = "auto"): number {
  const until = Date.now() + Math.max(1, Math.floor(durationMs));
  mutes.set(userId, until);
  persistMute(userId, until, reason);
  appendModerationLog({
    at: new Date().toISOString(),
    action: "mute",
    userId,
    until: new Date(until).toISOString(),
    reason,
  });
  return until;
}

/** 提前解禁。R5: 删除 .data/mutes/<userId>.json。 */
export function unmuteUser(userId: string): void {
  mutes.delete(userId);
  rmSync(muteFile(userId), { force: true });
}

/** R5: 写单条禁言记录到 .data/mutes/<userId>.json。 */
function persistMute(userId: string, until: number, reason: string): void {
  try {
    mkdirSync(mutesDir(), { recursive: true });
    writeFileSync(
      muteFile(userId),
      JSON.stringify({ userId, until, reason, createdAt: new Date().toISOString() }),
      "utf8",
    );
  } catch (e) {
    console.warn("[moderation] 写入 mutes 失败:", e);
  }
}

// ===== 举报统计与自动禁言 =====

export interface ReportRecord {
  reportedAt: string;
  reporterUserId: string;
  reporterNickname: string;
  targetUserId: string;
  reason: string;
  category: ReportCategory;
  room: string;
}

function reportsLogPath(): string {
  return resolve(runtimeDir, "reports.log");
}

/** 读取全部举报记录（每行一个 JSON），损坏行跳过。 */
export function readReports(limit = 100): ReportRecord[] {
  const p = reportsLogPath();
  if (!existsSync(p)) return [];
  let lines: string[] = [];
  try {
    lines = readFileSync(p, "utf8").split("\n");
  } catch {
    return [];
  }
  const out: ReportRecord[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as ReportRecord);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out.slice(-limit).reverse();
}

function appendModerationLog(entry: Record<string, unknown>): void {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    appendFileSync(resolve(runtimeDir, "moderation.log"), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* 吞掉 */
  }
}

/**
 * 登记一次对 targetUserId 的举报（ws 层写 reports.log 后调用）。
 * 若该 target 在 24h 内被举报达到阈值且当前未禁言，则自动禁言 10 分钟。
 * 返回 { reportedCount, autoMuted }。
 */
export function registerReport(targetUserId: string): { reportedCount: number; autoMuted: boolean; mutedUntil?: number } {
  const now = Date.now();
  const windowStart = new Date(now - REPORT_WINDOW_MS).toISOString();
  const recent = readReports(10_000).filter(
    (r) => r.targetUserId === targetUserId && r.reportedAt >= windowStart,
  );
  const reportedCount = recent.length;
  if (reportedCount >= REPORT_THRESHOLD && !isMuted(targetUserId)) {
    const mutedUntil = muteUser(targetUserId, MUTE_DURATION_MS, `report_threshold:${reportedCount}`);
    return { reportedCount, autoMuted: true, mutedUntil };
  }
  return { reportedCount, autoMuted: false };
}

// ===== 服务端屏蔽 =====

/** blocker 是否屏蔽了 blocked。 */
export function isBlocked(blockerId: string, blockedId: string): boolean {
  if (!blockerId || !blockedId) return false;
  return blocks.get(blockerId)?.has(blockedId) ?? false;
}

/** 屏蔽：blockerId 屏蔽 blockedUserId。幂等。 */
export function addBlock(blockerId: string, blockedUserId: string): void {
  if (!blockerId || !blockedUserId || blockerId === blockedUserId) return;
  let set = blocks.get(blockerId);
  if (!set) {
    set = new Set();
    blocks.set(blockerId, set);
  }
  if (!set.has(blockedUserId)) {
    set.add(blockedUserId);
    persistBlocks();
  }
}

/** 解除屏蔽。 */
export function removeBlock(blockerId: string, blockedUserId: string): void {
  const set = blocks.get(blockerId);
  if (!set) return;
  if (set.delete(blockedUserId)) persistBlocks();
  if (set.size === 0) blocks.delete(blockerId);
}

/** 查询某用户的屏蔽列表。 */
export function getBlockList(blockerId: string): string[] {
  return [...(blocks.get(blockerId) ?? [])];
}

// ===== R5: 敏感词命中累计自动禁言 =====

export interface ProfanityHitResult {
  /** 当前滑动窗口内累计命中次数 */
  hitCount: number;
  /** 本次是否触发了自动禁言 */
  autoMuted: boolean;
  /** 若触发禁言，禁言截止时间戳 ms */
  mutedUntil?: number;
}

/**
 * 登记一次敏感词命中（聊天/喊话文本被 filterProfanity 命中后调用）。
 * 滑动窗口（默认 30 分钟）内累计达到 PROFANITY_MUTE_THRESHOLD(3) 次且当前未禁言，
 * 自动禁言 PROFANITY_MUTE_DURATION_MS(5 分钟)。
 */
export function recordProfanityHit(userId: string): ProfanityHitResult {
  if (!userId) return { hitCount: 0, autoMuted: false };
  const now = Date.now();
  const windowStart = now - PROFANITY_WINDOW_MS;
  const list = (profanityHits.get(userId) ?? []).filter((t) => t >= windowStart);
  list.push(now);
  profanityHits.set(userId, list);

  if (list.length >= PROFANITY_MUTE_THRESHOLD && !isMuted(userId)) {
    const mutedUntil = muteUser(userId, PROFANITY_MUTE_DURATION_MS, `profanity_threshold:${list.length}`);
    // 触发后清空计数，避免到期后立即再次累积
    profanityHits.set(userId, []);
    return { hitCount: list.length, autoMuted: true, mutedUntil };
  }
  return { hitCount: list.length, autoMuted: false };
}

/** 当前用户在滑动窗口内的命中次数（测试/调试用）。 */
export function getProfanityHitCount(userId: string): number {
  const now = Date.now();
  return (profanityHits.get(userId) ?? []).filter((t) => t >= now - PROFANITY_WINDOW_MS).length;
}

// ===== R5: 结构化举报（.data/reports/ JSON + admin 处置） =====

export type ReportStatus = "open" | "resolved";
export type ReportResolutionAction = "warn" | "mute" | "unmute";

/** 一条结构化举报（.data/reports/<id>.json）。 */
export interface AdminReport {
  id: string;
  reportedAt: string;
  reporterUserId: string;
  reporterNickname: string;
  targetUserId: string;
  reason: string;
  category: ReportCategory;
  room: string;
  status: ReportStatus;
  resolution?: {
    action: ReportResolutionAction;
    note?: string;
    resolvedAt: string;
  };
}

function reportsDir(): string {
  return resolve(runtimeDir, "reports");
}

function reportFile(id: string): string {
  return resolve(reportsDir(), `${id}.json`);
}

/**
 * 登记一条结构化举报（ws 层写 reports.log 后调用）。
 * 生成 id、状态置 open、写入 .data/reports/<id>.json。
 */
export function recordStructuredReport(entry: Omit<AdminReport, "id" | "status">): AdminReport {
  const report: AdminReport = { ...entry, id: randomUUID(), status: "open" };
  try {
    mkdirSync(reportsDir(), { recursive: true });
    writeFileSync(reportFile(report.id), JSON.stringify(report, null, 2), "utf8");
  } catch (e) {
    console.warn("[moderation] 写入 reports/ 失败:", e);
  }
  return report;
}

/** 列出举报（默认仅 open，按时间倒序）。 */
export function listReports(opts: { status?: ReportStatus; limit?: number } = {}): AdminReport[] {
  const dir = reportsDir();
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: AdminReport[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(resolve(dir, f), "utf8")) as AdminReport);
    } catch {
      /* 坏文件跳过 */
    }
  }
  const filtered = opts.status ? out.filter((r) => r.status === opts.status) : out;
  filtered.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  return filtered.slice(0, opts.limit ?? 200);
}

/**
 * 处置一条举报：warn=警告并结案；mute=对 target 禁言 10 分钟并结案；unmute=解除 target 禁言并结案。
 * 找不到记录返回 null。
 */
export function resolveReport(
  id: string,
  action: ReportResolutionAction,
  note?: string,
): AdminReport | null {
  const file = reportFile(id);
  if (!existsSync(file)) return null;
  let report: AdminReport;
  try {
    report = JSON.parse(readFileSync(file, "utf8")) as AdminReport;
  } catch {
    return null;
  }
  if (action === "mute") {
    muteUser(report.targetUserId, MUTE_DURATION_MS, `admin_resolve:${id}`);
  } else if (action === "unmute") {
    unmuteUser(report.targetUserId);
  }
  report.status = "resolved";
  report.resolution = { action, resolvedAt: new Date().toISOString(), ...(note ? { note } : {}) };
  try {
    writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  } catch (e) {
    console.warn("[moderation] 更新 report 失败:", e);
  }
  return report;
}

// ===== 供 ws 层测试用 =====
export function _resetModerationInMemoryForTest(): void {
  mutes.clear();
  profanityHits.clear();
  bans.clear();
}

// ===== R5 嫁接：L1 替换留痕 + 封禁 + 审核统计（JSON 文件持久化，非 SQLite） =====
// 设计：复用本文件已有的 runtimeDir（.data/）模式。
//   - bans.json        ：当前生效中的封禁列表（JSON 数组）
//   - moderation-stats.json：累计计数器（totalBlocked / totalReplaced）
//   - moderation.log   ：追加式审计日志（复用 appendModerationLog）

/** 一条封禁记录。 */
export interface BanRecord {
  userId: string;
  reason: string;
  bannedAt: string;
}

/** 当前生效中的封禁表：userId -> BanRecord。持久化到 .data/bans.json。 */
let bans = new Map<string, BanRecord>();

function bansFilePath(): string {
  return resolve(runtimeDir, "bans.json");
}

function loadBans(): Map<string, BanRecord> {
  const map = new Map<string, BanRecord>();
  try {
    const parsed = JSON.parse(readFileSync(bansFilePath(), "utf8")) as BanRecord[];
    if (Array.isArray(parsed)) {
      for (const b of parsed) if (b && typeof b.userId === "string" && b.userId) map.set(b.userId, b);
    }
  } catch {
    /* 首次使用无文件 */
  }
  return map;
}

function persistBans(): void {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(bansFilePath(), JSON.stringify([...bans.values()], null, 2), "utf8");
  } catch (e) {
    console.warn("[moderation] 写入 bans.json 失败:", e);
  }
}

/** 累计审核计数器（跨重启保留）。 */
interface ModerationCounters {
  totalBlocked: number;
  totalReplaced: number;
}

let counters: ModerationCounters = { totalBlocked: 0, totalReplaced: 0 };

function statsFilePath(): string {
  return resolve(runtimeDir, "moderation-stats.json");
}

function loadCounters(): ModerationCounters {
  try {
    const parsed = JSON.parse(readFileSync(statsFilePath(), "utf8")) as Partial<ModerationCounters>;
    return {
      totalBlocked: typeof parsed.totalBlocked === "number" ? parsed.totalBlocked : 0,
      totalReplaced: typeof parsed.totalReplaced === "number" ? parsed.totalReplaced : 0,
    };
  } catch {
    return { totalBlocked: 0, totalReplaced: 0 };
  }
}

function persistCounters(): void {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(statsFilePath(), JSON.stringify(counters, null, 2), "utf8");
  } catch (e) {
    console.warn("[moderation] 写入 moderation-stats.json 失败:", e);
  }
}

/**
 * L1 替换留痕：当一条消息命中敏感词被自动替换为 *** 放行时调用。
 *  - 累计 totalReplaced 计数（持久化）
 *  - 追加一条结构化审计事件到 moderation.log
 * 不触发任何自动处置（自动禁言由 recordProfanityHit 负责）。
 */
export function recordReplaceEvent(
  userId: string,
  matchedWords: string[],
  originalText: string,
  replacedText: string,
): void {
  counters.totalReplaced += 1;
  persistCounters();
  appendModerationLog({
    at: new Date().toISOString(),
    action: "replace",
    userId,
    matchedWords,
    originalText,
    replacedText,
  });
}

/**
 * 扫描原文，返回命中的敏感词列表（不修改文本）。
 * 供 ws 层在替换留痕时传入 recordReplaceEvent。
 */
export function listMatchedWords(raw: string): string[] {
  if (!raw || badWords.length === 0) return [];
  const lower = raw.toLowerCase();
  const out: string[] = [];
  for (const w of badWords) {
    if (w && lower.includes(w.toLowerCase())) out.push(w);
  }
  return out;
}

/** 永久封禁用户（拒绝一切连接/发言）。幂等。持久化到 bans.json。 */
export function banUser(userId: string, reason: string): void {
  if (!userId) return;
  bans.set(userId, { userId, reason: reason || "", bannedAt: new Date().toISOString() });
  persistBans();
  appendModerationLog({ at: new Date().toISOString(), action: "ban", userId, reason: reason || "" });
}

/** 解除封禁。 */
export function unbanUser(userId: string): void {
  if (!userId) return;
  if (bans.delete(userId)) persistBans();
}

/** 用户是否处于封禁中。 */
export function isBanned(userId: string): boolean {
  if (!userId) return false;
  return bans.has(userId);
}

/** 审核运营统计快照。 */
export interface ModerationStats {
  totalBlocked: number;
  totalReplaced: number;
  totalMuted: number;
  totalBanned: number;
  openReports: number;
}

/** 当前生效中的禁言数量（惰性过期）。 */
function activeMuteCount(): number {
  const now = Date.now();
  let n = 0;
  for (const until of mutes.values()) {
    if (until > now) n += 1;
  }
  return n;
}

/** 审核统计：累计拦截/替换 + 当前生效禁言/封禁 + 待处理举报数。 */
export function getModerationStats(): ModerationStats {
  let open = 0;
  try {
    open = listReports({ status: "open" }).length;
  } catch {
    open = 0;
  }
  return {
    totalBlocked: counters.totalBlocked,
    totalReplaced: counters.totalReplaced,
    totalMuted: activeMuteCount(),
    totalBanned: bans.size,
    openReports: open,
  };
}

// ===== 生产启动：加载默认路径下的敏感词/禁言/屏蔽/封禁/统计 =====
// 测试通过 configureModerationForTest 切换到临时目录后会重新加载，覆盖此处。
badWords = loadBadWords();
loadPersistedMutes();
blocks = loadBlocks();
bans = loadBans();
counters = loadCounters();
