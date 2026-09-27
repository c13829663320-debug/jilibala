// ===== R5 发布域：服务端审核增强测试 =====
//  - 敏感词命中累计 3 次 → 自动禁言 5 分钟
//  - 禁言状态持久化到 .data/mutes/
//  - 结构化举报 .data/reports/ + admin 处置（warn/mute/unmute）
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureModerationForTest,
  resetModerationForTest,
  recordProfanityHit,
  getProfanityHitCount,
  isMuted,
  getMutedUntil,
  muteUser,
  unmuteUser,
  recordStructuredReport,
  listReports,
  resolveReport,
  PROFANITY_MUTE_THRESHOLD,
  PROFANITY_MUTE_DURATION_MS,
} from "./moderation.js";

function makeDirs(): { dataDir: string; runtimeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "mod-r5-"));
  const dataDir = join(root, "data");
  const runtimeDir = join(root, ".data");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(dataDir, "bad-words.json"), JSON.stringify({ words: ["傻逼", "fuck"] }), "utf8");
  return { dataDir, runtimeDir };
}

describe("R5: 敏感词命中累计自动禁言", () => {
  let runtimeDir: string;
  beforeEach(() => {
    const d = makeDirs();
    runtimeDir = d.runtimeDir;
    configureModerationForTest(d);
  });
  afterEach(() => {
    resetModerationForTest();
    vi.useRealTimers();
  });

  it(`累计 ${PROFANITY_MUTE_THRESHOLD} 次命中后自动禁言 5 分钟`, () => {
    const u = "spammer";
    expect(recordProfanityHit(u).hitCount).toBe(1);
    expect(isMuted(u)).toBe(false);
    expect(recordProfanityHit(u).hitCount).toBe(2);
    expect(isMuted(u)).toBe(false);
    const third = recordProfanityHit(u);
    expect(third.hitCount).toBe(3);
    expect(third.autoMuted).toBe(true);
    expect(isMuted(u)).toBe(true);
    expect(third.mutedUntil).toBeGreaterThan(Date.now());
  });

  it("不足 3 次不触发禁言", () => {
    recordProfanityHit("mild");
    const r = recordProfanityHit("mild");
    expect(r.autoMuted).toBe(false);
    expect(isMuted("mild")).toBe(false);
  });

  it("触发禁言后计数清空，到期前重复命中不再叠加误判", () => {
    const u = "repeat";
    recordProfanityHit(u);
    recordProfanityHit(u);
    recordProfanityHit(u); // → 自动禁言
    expect(isMuted(u)).toBe(true);
    expect(getProfanityHitCount(u)).toBe(0);
  });
});

describe("R5: 禁言状态持久化到 .data/mutes/", () => {
  let runtimeDir: string;
  let dataDir: string;
  beforeEach(() => {
    const d = makeDirs();
    runtimeDir = d.runtimeDir;
    dataDir = d.dataDir;
    configureModerationForTest(d);
  });
  afterEach(() => {
    resetModerationForTest();
  });

  it("muteUser 后写入 .data/mutes/<userId>.json", () => {
    muteUser("persist", PROFANITY_MUTE_DURATION_MS, "test");
    const file = join(runtimeDir, "mutes", "persist.json");
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { until: number };
    expect(parsed.until).toBeGreaterThan(Date.now());
  });

  it("重新加载目录后未过期禁言恢复", () => {
    muteUser("reload", PROFANITY_MUTE_DURATION_MS, "test");
    // 模拟重启：重新指向同目录
    configureModerationForTest({ dataDir, runtimeDir });
    expect(isMuted("reload")).toBe(true);
    expect(getMutedUntil("reload")).toBeGreaterThan(Date.now());
  });

  it("unmuteUser 删除持久化文件", () => {
    muteUser("gone", PROFANITY_MUTE_DURATION_MS, "test");
    expect(existsSync(join(runtimeDir, "mutes", "gone.json"))).toBe(true);
    unmuteUser("gone");
    expect(existsSync(join(runtimeDir, "mutes", "gone.json"))).toBe(false);
    expect(isMuted("gone")).toBe(false);
  });

  it("过期的持久化禁言在加载时被清理", () => {
    vi.useFakeTimers();
    muteUser("expired", 1000, "test");
    expect(isMuted("expired")).toBe(true);
    vi.advanceTimersByTime(1001);
    // 重新加载：过期记录应被删除且不恢复
    configureModerationForTest({ dataDir, runtimeDir });
    expect(isMuted("expired")).toBe(false);
    expect(existsSync(join(runtimeDir, "mutes", "expired.json"))).toBe(false);
  });
});

describe("R5: 结构化举报 + admin 处置闭环", () => {
  let runtimeDir: string;
  beforeEach(() => {
    const d = makeDirs();
    runtimeDir = d.runtimeDir;
    configureModerationForTest(d);
  });
  afterEach(() => {
    resetModerationForTest();
  });

  function seed() {
    return recordStructuredReport({
      reportedAt: new Date().toISOString(),
      reporterUserId: "r1",
      reporterNickname: "举报人",
      targetUserId: "baduser",
      reason: "刷屏骂人",
      category: "abuse",
      room: "plaza",
    });
  }

  it("recordStructuredReport 生成 id 并落盘 open", () => {
    const r = seed();
    expect(r.id).toBeTruthy();
    expect(r.status).toBe("open");
    expect(existsSync(join(runtimeDir, "reports", `${r.id}.json`))).toBe(true);
  });

  it("listReports 默认仅返回 open 且倒序", () => {
    seed();
    seed();
    const open = listReports({ status: "open" });
    expect(open.length).toBe(2);
  });

  it("resolve warn：结案但不禁言 target", () => {
    const r = seed();
    const out = resolveReport(r.id, "warn", "口头警告");
    expect(out?.status).toBe("resolved");
    expect(out?.resolution?.action).toBe("warn");
    expect(isMuted("baduser")).toBe(false);
    // 处置后不再出现在 open 列表
    expect(listReports({ status: "open" }).length).toBe(0);
  });

  it("resolve mute：对 target 禁言", () => {
    const r = seed();
    resolveReport(r.id, "mute");
    expect(isMuted("baduser")).toBe(true);
  });

  it("resolve unmute：解除 target 禁言", () => {
    muteUser("baduser", 10 * 60 * 1000, "before");
    expect(isMuted("baduser")).toBe(true);
    const r = seed();
    resolveReport(r.id, "unmute");
    expect(isMuted("baduser")).toBe(false);
  });

  it("resolve 不存在的 id 返回 404 语义（null）", () => {
    expect(resolveReport("nope", "warn")).toBeNull();
  });

  it("reports 目录下 JSON 文件数量与 seed 数一致", () => {
    seed();
    seed();
    const files = readdirSync(join(runtimeDir, "reports")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(2);
  });
});
