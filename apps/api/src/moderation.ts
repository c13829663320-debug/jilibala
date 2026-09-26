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
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModerationAction, ReportCategory } from "@balabala/shared";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(SRC_DIR, "..", "data");
const DEFAULT_RUNTIME_DIR = resolve(SRC_DIR, "..", ".data");

export const MUTE_DURATION_MS = 10 * 60 * 1000; // 临时禁言 10 分钟
export const REPORT_THRESHOLD = 3; // 24h 内被举报 3 次触发禁言
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

let dataDir = DEFAULT_DATA_DIR;
let runtimeDir = DEFAULT_RUNTIME_DIR;
let badWords: string[] = [];

/** 内存态禁言表：userId -> 禁言截止时间戳 ms。 */
const mutes = new Map<string, number>();

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

/** 测试用：切换数据/运行目录并重置内存态。 */
export function configureModerationForTest(opts: { dataDir: string; runtimeDir: string }): void {
  dataDir = opts.dataDir;
  runtimeDir = opts.runtimeDir;
  badWords = loadBadWords();
  mutes.clear();
  blocks = loadBlocks();
}

/** 测试用：重置为生产路径。 */
export function resetModerationForTest(): void {
  dataDir = DEFAULT_DATA_DIR;
  runtimeDir = DEFAULT_RUNTIME_DIR;
  badWords = loadBadWords();
  mutes.clear();
  blocks = loadBlocks();
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

/** 手动/自动禁言。返回新的禁言截止时间。 */
export function muteUser(userId: string, durationMs: number = MUTE_DURATION_MS, reason = "auto"): number {
  const until = Date.now() + Math.max(1, Math.floor(durationMs));
  mutes.set(userId, until);
  appendModerationLog({
    at: new Date().toISOString(),
    action: "mute",
    userId,
    until: new Date(until).toISOString(),
    reason,
  });
  return until;
}

/** 提前解禁。 */
export function unmuteUser(userId: string): void {
  mutes.delete(userId);
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

// ===== 供 ws 层测试用 =====
export function _resetModerationInMemoryForTest(): void {
  mutes.clear();
}
