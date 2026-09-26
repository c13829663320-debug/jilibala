// ===== R4-08: 内容治理测试 =====
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureModerationForTest,
  resetModerationForTest,
  filterProfanity,
  moderateText,
  isMuted,
  muteUser,
  unmuteUser,
  registerReport,
  readReports,
  isBlocked,
  addBlock,
  removeBlock,
  getBlockList,
  MUTE_DURATION_MS,
} from "./moderation.js";
import type { ReportCategory } from "@balabala/shared";

function makeDirs(): { dataDir: string; runtimeDir: string } {
  const root = mkdtempSync(join(tmpdir(), "mod-"));
  const dataDir = join(root, "data");
  const runtimeDir = join(root, ".data");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(dataDir, "bad-words.json"),
    JSON.stringify({ words: ["傻逼", "操你妈", "fuck", "赌博网站"] }),
    "utf8",
  );
  return { dataDir, runtimeDir };
}

function writeReport(runtimeDir: string, r: Partial<{ reportedAt: string; reporterUserId: string; targetUserId: string; reason: string; category: ReportCategory }>): void {
  const line = JSON.stringify({
    reportedAt: r.reportedAt ?? new Date().toISOString(),
    reporterUserId: r.reporterUserId ?? "reporter",
    reporterNickname: "举报人",
    targetUserId: r.targetUserId ?? "baduser",
    reason: r.reason ?? "垃圾",
    category: r.category ?? "abuse",
    room: "plaza",
  });
  appendFileSync(join(runtimeDir, "reports.log"), line + "\n", "utf8");
}

describe("moderation (R4-08)", () => {
  let runtimeDir: string;
  let dataDir: string;

  beforeEach(() => {
    const d = makeDirs();
    dataDir = d.dataDir;
    runtimeDir = d.runtimeDir;
    configureModerationForTest({ dataDir, runtimeDir });
  });

  afterEach(() => {
    resetModerationForTest();
    vi.useRealTimers();
  });

  it("命中敏感词替换为 ***", () => {
    const { text, hit } = filterProfanity("你这个傻逼玩意儿");
    expect(hit).toBe(true);
    expect(text).toBe("你这个***玩意儿");
  });

  it("未命中时原文返回且 hit=false", () => {
    const r = filterProfanity("今天天气真好");
    expect(r.hit).toBe(false);
    expect(r.text).toBe("今天天气真好");
  });

  it("英文敏感词大小写不敏感", () => {
    expect(filterProfanity("Fuck you").text).toBe("*** you");
    expect(filterProfanity("what the FUCK").text).toBe("what the ***");
  });

  it("一句话多处命中全部替换", () => {
    const { text, hit } = filterProfanity("操你妈 傻逼 赌博网站");
    expect(hit).toBe(true);
    expect(text).toBe("*** *** ***");
  });

  it("空字符串不崩", () => {
    expect(filterProfanity("")).toEqual({ text: "", hit: false });
  });

  it("muteUser 后 isMuted 返回 true", () => {
    expect(isMuted("u1")).toBe(false);
    muteUser("u1", MUTE_DURATION_MS, "test");
    expect(isMuted("u1")).toBe(true);
  });

  it("禁言到期后自动解除", () => {
    vi.useFakeTimers();
    muteUser("u2", 1000, "test");
    expect(isMuted("u2")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(isMuted("u2")).toBe(false);
  });

  it("unmuteUser 提前解禁", () => {
    muteUser("u3", MUTE_DURATION_MS, "test");
    expect(isMuted("u3")).toBe(true);
    unmuteUser("u3");
    expect(isMuted("u3")).toBe(false);
  });

  it("被举报 3 次/24h 自动禁言", () => {
    writeReport(runtimeDir, { targetUserId: "spammer" });
    writeReport(runtimeDir, { targetUserId: "spammer" });
    expect(isMuted("spammer")).toBe(false);
    writeReport(runtimeDir, { targetUserId: "spammer" });
    const res = registerReport("spammer");
    expect(res.reportedCount).toBe(3);
    expect(res.autoMuted).toBe(true);
    expect(isMuted("spammer")).toBe(true);
  });

  it("举报不足 3 次不触发禁言", () => {
    writeReport(runtimeDir, { targetUserId: "mild" });
    writeReport(runtimeDir, { targetUserId: "mild" });
    const res = registerReport("mild");
    expect(res.reportedCount).toBe(2);
    expect(res.autoMuted).toBe(false);
    expect(isMuted("mild")).toBe(false);
  });

  it("超过 24h 的旧举报不计入阈值", () => {
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeReport(runtimeDir, { targetUserId: "old", reportedAt: old });
    writeReport(runtimeDir, { targetUserId: "old" });
    writeReport(runtimeDir, { targetUserId: "old" });
    const res = registerReport("old");
    // 旧的那 1 条 + 新的 2 条，但 registerReport 又追加？不——registerReport 只统计 reports.log 里已有记录
    // 这里已有 3 行（1 旧 + 2 新），窗口内 = 2
    expect(res.reportedCount).toBe(2);
    expect(res.autoMuted).toBe(false);
  });

  it("readReports 返回举报列表（最近在前）", () => {
    writeReport(runtimeDir, { targetUserId: "a" });
    writeReport(runtimeDir, { targetUserId: "b" });
    const list = readReports(10);
    expect(list.length).toBe(2);
    expect(list[0].targetUserId).toBe("b");
  });

  it("服务端屏蔽：addBlock 后 isBlocked=true", () => {
    expect(isBlocked("alice", "bob")).toBe(false);
    addBlock("alice", "bob");
    expect(isBlocked("alice", "bob")).toBe(true);
    expect(getBlockList("alice")).toContain("bob");
  });

  it("解除屏蔽后 isBlocked=false", () => {
    addBlock("alice", "bob");
    removeBlock("alice", "bob");
    expect(isBlocked("alice", "bob")).toBe(false);
  });

  it("不能屏蔽自己", () => {
    addBlock("self", "self");
    expect(isBlocked("self", "self")).toBe(false);
  });

  it("屏蔽列表持久化：重新加载后仍在", () => {
    addBlock("alice", "bob");
    // 模拟重启：重新加载 blocks
    configureModerationForTest({ dataDir, runtimeDir });
    expect(isBlocked("alice", "bob")).toBe(true);
  });

  it("moderateText：禁言用户 muted=true，文本仍过滤", () => {
    muteUser("g", MUTE_DURATION_MS, "test");
    const r = moderateText("g", "你这个傻逼");
    expect(r.muted).toBe(true);
    expect(r.text).toBe("你这个***");
    expect(r.hit).toBe(true);
  });

  it("moderateText：正常用户 muted=false", () => {
    const r = moderateText("clean", "你好呀");
    expect(r.muted).toBe(false);
    expect(r.text).toBe("你好呀");
  });
});
