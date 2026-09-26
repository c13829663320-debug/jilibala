// ===== R4-08: 排行榜聚合测试 =====
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureLeaderboardForTest,
  resetLeaderboardForTest,
  getLeaderboard,
  getPlayerRank,
  _clearLeaderboardCacheForTest,
  LEADERBOARD_CACHE_TTL_MS,
} from "./leaderboard.js";
import type { ServerProfile } from "@balabala/shared";

function writeProfile(dir: string, p: ServerProfile): void {
  const safe = p.userId.replace(/[^a-zA-Z0-9_\-]/g, "_");
  writeFileSync(join(dir, `${safe}.json`), JSON.stringify(p), "utf8");
}

function makeProfile(partial: Partial<ServerProfile> & { userId: string }): ServerProfile {
  return {
    xp: 0,
    rank: "rookie",
    achievements: [],
    dailyChallenge: {},
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("leaderboard (R4-08)", () => {
  let dir: string;
  const resolver = (uid: string) => ({
    nickname: `玩家${uid}`,
    avatarType: "capsule",
    avatarRef: `avatar-${uid}`,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lb-"));
    mkdirSync(dir, { recursive: true });
    configureLeaderboardForTest(dir, resolver);
  });

  afterEach(() => {
    resetLeaderboardForTest();
    vi.useRealTimers();
  });

  it("global 榜按 XP 降序排列，名次从 1 开始", () => {
    writeProfile(dir, makeProfile({ userId: "a", xp: 50 }));
    writeProfile(dir, makeProfile({ userId: "b", xp: 900 }));
    writeProfile(dir, makeProfile({ userId: "c", xp: 300 }));
    const list = getLeaderboard("global", 20);
    expect(list.map((e) => e.userId)).toEqual(["b", "c", "a"]);
    expect(list[0].rank).toBe(1);
    expect(list[1].rank).toBe(2);
    expect(list[2].rank).toBe(3);
  });

  it("global 榜带出段位/XP/头像等字段", () => {
    writeProfile(dir, makeProfile({ userId: "x", xp: 2000, rank: "platinum" }));
    const [top] = getLeaderboard("global", 1);
    expect(top.tier).toBe("platinum");
    expect(top.xp).toBe(2000);
    expect(top.nickname).toBe("玩家x");
    expect(top.avatarRef).toBe("avatar-x");
  });

  it("court 分榜按玩法胜场降序（而非 XP）", () => {
    writeProfile(dir, makeProfile({ userId: "low-xp", xp: 10, stats: { court: { played: 10, wins: 8, bestStreak: 5, currentStreak: 2 } } }));
    writeProfile(dir, makeProfile({ userId: "high-xp", xp: 5000, stats: { court: { played: 5, wins: 1, bestStreak: 1, currentStreak: 0 } } }));
    const list = getLeaderboard("court", 20);
    expect(list.map((e) => e.userId)).toEqual(["low-xp", "high-xp"]);
    expect(list[0].score).toBe(8);
  });

  it("胜场相同时按胜率排序", () => {
    writeProfile(dir, makeProfile({ userId: "high-rate", stats: { court: { played: 10, wins: 5, bestStreak: 3, currentStreak: 0 } } }));
    writeProfile(dir, makeProfile({ userId: "low-rate", stats: { court: { played: 20, wins: 5, bestStreak: 2, currentStreak: 0 } } }));
    const list = getLeaderboard("court", 20);
    expect(list[0].userId).toBe("high-rate");
    expect(list[0].stats?.court?.wins).toBe(5);
  });

  it("limit 截断返回前 N 名", () => {
    for (let i = 0; i < 10; i += 1) {
      writeProfile(dir, makeProfile({ userId: `u${i}`, xp: i * 100 }));
    }
    expect(getLeaderboard("global", 3)).toHaveLength(3);
    expect(getLeaderboard("global", 3)[0].userId).toBe("u9");
  });

  it("缓存：60 秒内修改档案不影响结果", () => {
    vi.useFakeTimers();
    writeProfile(dir, makeProfile({ userId: "one", xp: 100 }));
    const first = getLeaderboard("global", 20);
    expect(first).toHaveLength(1);
    // 写入第二个玩家，但缓存未过期 → 仍只看到 1 个
    writeProfile(dir, makeProfile({ userId: "two", xp: 999 }));
    const second = getLeaderboard("global", 20);
    expect(second).toHaveLength(1);
  });

  it("缓存过期后重新聚合（推进 60s）", () => {
    vi.useFakeTimers();
    writeProfile(dir, makeProfile({ userId: "one", xp: 100 }));
    getLeaderboard("global", 20);
    writeProfile(dir, makeProfile({ userId: "two", xp: 999 }));
    vi.advanceTimersByTime(LEADERBOARD_CACHE_TTL_MS + 1);
    const list = getLeaderboard("global", 20);
    expect(list.map((e) => e.userId)).toEqual(["two", "one"]);
  });

  it("损坏的档案 JSON 被跳过，不抛错", () => {
    writeFileSync(join(dir, "broken.json"), "{{{not json", "utf8");
    writeProfile(dir, makeProfile({ userId: "ok", xp: 1 }));
    const list = getLeaderboard("global", 20);
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe("ok");
  });

  it("getPlayerRank 返回玩家名次，不在榜返回 null", () => {
    writeProfile(dir, makeProfile({ userId: "a", xp: 500 }));
    writeProfile(dir, makeProfile({ userId: "b", xp: 100 }));
    expect(getPlayerRank("global", "a")).toBe(1);
    expect(getPlayerRank("global", "b")).toBe(2);
    expect(getPlayerRank("global", "ghost")).toBeNull();
  });

  it("目录不存在时返回空榜而非崩溃", () => {
    const empty = mkdtempSync(join(tmpdir(), "lb-empty-"));
    configureLeaderboardForTest(empty, resolver);
    expect(getLeaderboard("global", 20)).toEqual([]);
  });

  it("_clearLeaderboardCacheForTest 强制刷新", () => {
    writeProfile(dir, makeProfile({ userId: "a", xp: 1 }));
    getLeaderboard("global", 20);
    writeProfile(dir, makeProfile({ userId: "b", xp: 2 }));
    _clearLeaderboardCacheForTest();
    expect(getLeaderboard("global", 20)).toHaveLength(2);
  });
});
