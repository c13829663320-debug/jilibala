// ===== 分片5: 屏蔽/静音/举报数据层测试 =====
// 沿用 db.test.ts 的隔离模式：每个 describe 用独立临时 SQLite 文件，
// import 前设置 process.env.DB_PATH + vi.resetModules()，再动态 import。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type ModModule = typeof import("./moderation-db.js");

async function loadMod(): Promise<{ mod: ModModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-moderation-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./moderation-db.js");
  return { mod, dir };
}

describe("moderation-db 屏蔽", () => {
  let ctx: { mod: ModModule; dir: string };

  beforeEach(async () => {
    ctx = await loadMod();
  });

  afterAll(() => {
    try { ctx.mod._resetModerationDbForTest(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.DB_PATH;
  });

  it("blockUser：创建后可回读，幂等重复屏蔽返回同一条", () => {
    const b = ctx.mod.blockUser("u-a", "u-b", "太吵");
    expect(b.blockerId).toBe("u-a");
    expect(b.targetId).toBe("u-b");
    expect(b.reason).toBe("太吵");
    const again = ctx.mod.blockUser("u-a", "u-b");
    expect(again.id).toBe(b.id); // 幂等，不重复插入
  });

  it("getBlockedTargetIds：返回我屏蔽的全部 target", () => {
    ctx.mod.blockUser("u-a", "u-b");
    ctx.mod.blockUser("u-a", "u-c");
    ctx.mod.blockUser("u-other", "u-b"); // 别人屏蔽的不算
    const targets = ctx.mod.getBlockedTargetIds("u-a");
    expect(targets.sort()).toEqual(["u-b", "u-c"]);
  });

  it("unblockUser：取消屏蔽后 getBlock 为 undefined，重复取消返回 false", () => {
    ctx.mod.blockUser("u-a", "u-b");
    expect(ctx.mod.getBlock("u-a", "u-b")).toBeDefined();
    expect(ctx.mod.unblockUser("u-a", "u-b")).toBe(true);
    expect(ctx.mod.getBlock("u-a", "u-b")).toBeUndefined();
    expect(ctx.mod.unblockUser("u-a", "u-b")).toBe(false);
  });

  it("getBlockedUsers：返回完整关系对象列表", () => {
    ctx.mod.blockUser("u-a", "u-b", "理由一");
    const list = ctx.mod.getBlockedUsers("u-a");
    expect(list.length).toBe(1);
    expect(list[0].targetId).toBe("u-b");
    expect(list[0].reason).toBe("理由一");
  });
});

describe("moderation-db 静音", () => {
  let ctx: { mod: ModModule; dir: string };

  beforeEach(async () => {
    ctx = await loadMod();
  });

  afterAll(() => {
    try { ctx.mod._resetModerationDbForTest(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.DB_PATH;
  });

  it("muteUser / unmuteUser 往返", () => {
    const m = ctx.mod.muteUser("u-a", "u-b");
    expect(ctx.mod.getMute("u-a", "u-b")).toBeDefined();
    expect(ctx.mod.getMutedTargetIds("u-a")).toEqual(["u-b"]);
    expect(ctx.mod.unmuteUser("u-a", "u-b")).toBe(true);
    expect(ctx.mod.getMutedTargetIds("u-a")).toEqual([]);
  });

  it("muteUser 幂等", () => {
    const m1 = ctx.mod.muteUser("u-a", "u-b");
    const m2 = ctx.mod.muteUser("u-a", "u-b");
    expect(m1.id).toBe(m2.id);
    expect(ctx.mod.getMutedUsers("u-a").length).toBe(1);
  });
});

describe("moderation-db 举报", () => {
  let ctx: { mod: ModModule; dir: string };

  beforeEach(async () => {
    ctx = await loadMod();
  });

  afterAll(() => {
    try { ctx.mod._resetModerationDbForTest(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.DB_PATH;
  });

  it("createReport：默认 status=pending，可回读", () => {
    const r = ctx.mod.createReport({
      reporterId: "u-a",
      targetType: "user",
      targetId: "u-b",
      reason: "辱骂",
      detail: "对方说了脏话",
    });
    expect(r.id).toMatch(/^report-/);
    expect(r.status).toBe("pending");
    const got = ctx.mod.getReport(r.id);
    expect(got?.reason).toBe("辱骂");
    expect(got?.detail).toBe("对方说了脏话");
  });

  it("listReports：按状态过滤", () => {
    const r1 = ctx.mod.createReport({ reporterId: "u-a", targetType: "user", targetId: "u-b", reason: "r1" });
    ctx.mod.createReport({ reporterId: "u-a", targetType: "content", targetId: "c1", reason: "r2" });
    ctx.mod.updateReportStatus(r1.id, "resolved");
    const pending = ctx.mod.listReports("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].reason).toBe("r2");
    const resolved = ctx.mod.listReports("resolved");
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe(r1.id);
    const all = ctx.mod.listReports();
    expect(all.length).toBe(2);
  });

  it("updateReportStatus：更新状态并刷新 updatedAt；非法状态返回 undefined", () => {
    const r = ctx.mod.createReport({ reporterId: "u-a", targetType: "user", targetId: "u-b", reason: "x" });
    const up = ctx.mod.updateReportStatus(r.id, "reviewing");
    expect(up?.status).toBe("reviewing");
    expect(up?.updatedAt).toBeTruthy();
    expect(new Date(up!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(r.createdAt).getTime());
    // @ts-expect-error 故意传非法状态
    expect(ctx.mod.updateReportStatus(r.id, "bogus")).toBeUndefined();
    expect(ctx.mod.updateReportStatus("no-such-id", "resolved")).toBeUndefined();
  });
});
