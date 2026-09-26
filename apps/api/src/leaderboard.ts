// ===== R4-08: 全服/场景段位排行榜 =====
// 数据来源：R4-06 服务端档案 .data/profiles/<userId>.json（XP/段位/战绩快照），
// 不重复存储。内存缓存 + 60 秒过期刷新，避免每次请求都扫盘。
//
// 分榜口径：
//  - global    ：按 XP 降序
//  - court     ：按 court 战绩胜场降序（胜场相同比胜率，再比 XP）
//  - werewolf  ：按 werewolf 战绩胜场降序
//  - bar       ：按 bar 战绩胜场降序
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type LeaderboardEntry,
  type LeaderboardScope,
  type MatchStats,
  type ServerProfile,
} from "@balabala/shared";

const DEFAULT_PROFILES_DIR =
  process.env.PROFILES_DIR || resolve(process.cwd(), ".data", "profiles");

/** 缓存 TTL：60 秒。 */
export const LEADERBOARD_CACHE_TTL_MS = 60_000;

/** 分榜对应的战绩 key。 */
const SCOPE_STATS_KEY: Partial<Record<Exclude<LeaderboardScope, "global">, 'court' | 'werewolf' | 'bar'>> = {
  court: "court",
  werewolf: "werewolf",
  bar: "bar",
};

/** 用户展示信息解析器（默认走 DB；测试可注入桩）。 */
export type UserResolver = (userId: string) => { nickname?: string; avatarType?: string; avatarRef?: string } | undefined;

let profilesDir = DEFAULT_PROFILES_DIR;
let userResolver: UserResolver | undefined;

/** 测试用：指定档案目录与用户解析器，并清缓存。 */
export function configureLeaderboardForTest(dir: string, resolver?: UserResolver): void {
  profilesDir = dir;
  userResolver = resolver;
  cache = new Map();
}

/** 测试用：恢复默认。 */
export function resetLeaderboardForTest(): void {
  profilesDir = DEFAULT_PROFILES_DIR;
  userResolver = undefined;
  cache = new Map();
}

interface CacheEntry {
  at: number;
  entries: LeaderboardEntry[];
}
let cache = new Map<string, CacheEntry>();

function winRate(s: MatchStats | undefined): number {
  if (!s || s.played <= 0) return 0;
  return s.wins / s.played;
}

/** 读取某个分榜依据的 score（用于排序）。 */
function scoreForScope(scope: LeaderboardScope, p: ServerProfile): number {
  if (scope === "global") return p.xp;
  const key = SCOPE_STATS_KEY[scope];
  const s = key ? p.stats?.[key] : undefined;
  return s ? s.wins : 0;
}

/** 扫描档案目录，返回全部原始档案（容错：坏文件跳过）。 */
function readAllProfiles(): ServerProfile[] {
  if (!existsSync(profilesDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(profilesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ServerProfile[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(resolve(profilesDir, file), "utf8");
      out.push(JSON.parse(raw) as ServerProfile);
    } catch {
      /* 坏档案跳过 */
    }
  }
  return out;
}

/**
 * 生成排行榜。scope 决定排序口径；limit 截断（默认 20）。
 * 60 秒内同 scope 命中缓存，不重新扫盘。
 */
export function getLeaderboard(scope: LeaderboardScope = "global", limit = 20): LeaderboardEntry[] {
  const now = Date.now();
  const cached = cache.get(scope);
  if (cached && now - cached.at < LEADERBOARD_CACHE_TTL_MS) {
    return cached.entries.slice(0, Math.max(1, limit));
  }

  const profiles = readAllProfiles();
  const key = scope === "global" ? undefined : SCOPE_STATS_KEY[scope];

  const entries: LeaderboardEntry[] = profiles
    .map((p) => {
      const u = userResolver?.(p.userId);
      return {
        userId: p.userId,
        nickname: u?.nickname || p.userId,
        xp: p.xp,
        tier: p.rank,
        avatarType: u?.avatarType || "capsule",
        avatarRef: u?.avatarRef || "",
        score: scoreForScope(scope, p),
        stats: p.stats,
        rank: 0,
      } as LeaderboardEntry;
    })
    .sort((a, b) => {
      // 主排序：score 降序
      if (b.score !== a.score) return b.score - a.score;
      // 分榜次排序：胜率
      if (key) {
        const sa = a.stats?.[key];
        const sb = b.stats?.[key];
        const wa = winRate(sa);
        const wb = winRate(sb);
        if (wb !== wa) return wb - wa;
      }
      // 再次排序：XP
      if (b.xp !== a.xp) return b.xp - a.xp;
      // 稳定：昵称字典序
      return a.nickname.localeCompare(b.nickname);
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));

  cache.set(scope, { at: now, entries });
  return entries.slice(0, Math.max(1, limit));
}

/** 查询某玩家在某个分榜中的排名（不在榜上返回 null）。 */
export function getPlayerRank(scope: LeaderboardScope, userId: string): number | null {
  const all = getLeaderboard(scope, Number.MAX_SAFE_INTEGER);
  const hit = all.find((e) => e.userId === userId);
  return hit ? hit.rank : null;
}

/** 测试用：强制清缓存（不切换目录）。 */
export function _clearLeaderboardCacheForTest(): void {
  cache = new Map();
}
