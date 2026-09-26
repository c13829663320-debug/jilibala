// ===== 分片5: 屏蔽/静音/举报 REST API 测试 =====
// 用独立临时 SQLite 库 + fastify inject 做接口级验证。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("moderation-routes", () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-modroutes-"));
    process.env.DB_PATH = join(dir, "test.db");
    const { registerModerationRoutes } = await import("./moderation-routes.js");
    app = Fastify({ logger: false });
    registerModerationRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("屏蔽：POST 创建 → GET 列表 → DELETE 取消", async () => {
    const post = await app.inject({
      method: "POST", url: "/api/moderation/block",
      payload: { userId: "u-a", targetUserId: "u-b", reason: "测试屏蔽" },
    });
    expect(post.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/moderation/blocked?userId=u-a" });
    expect(list.statusCode).toBe(200);
    const j = list.json() as { blocked: Array<{ targetId: string }> };
    expect(j.blocked.some((b) => b.targetId === "u-b")).toBe(true);

    const del = await app.inject({
      method: "DELETE", url: "/api/moderation/block",
      payload: { userId: "u-a", targetUserId: "u-b" },
    });
    expect(del.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/api/moderation/blocked?userId=u-a" })).json() as { blocked: unknown[] };
    expect(after.blocked.length).toBe(0);
  });

  it("屏蔽参数校验：缺字段 400，屏蔽自己 400", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/moderation/block", payload: { userId: "u-a" } });
    expect(bad.statusCode).toBe(400);
    const self = await app.inject({ method: "POST", url: "/api/moderation/block", payload: { userId: "u-a", targetUserId: "u-a" } });
    expect(self.statusCode).toBe(400);
  });

  it("静音：POST → GET → DELETE", async () => {
    await app.inject({ method: "POST", url: "/api/moderation/mute", payload: { userId: "u-a", targetUserId: "u-b" } });
    const list = (await app.inject({ method: "GET", url: "/api/moderation/muted?userId=u-a" })).json() as { muted: Array<{ targetId: string }> };
    expect(list.muted.some((m) => m.targetId === "u-b")).toBe(true);
    await app.inject({ method: "DELETE", url: "/api/moderation/mute", payload: { userId: "u-a", targetUserId: "u-b" } });
    const after = (await app.inject({ method: "GET", url: "/api/moderation/muted?userId=u-a" })).json() as { muted: unknown[] };
    expect(after.muted.length).toBe(0);
  });

  it("举报：POST 创建，GET 列表按状态过滤，PUT 更新状态", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/moderation/report",
      payload: { reporterId: "u-a", targetType: "user", targetId: "u-b", reason: "辱骂", detail: "脏话" },
    });
    expect(create.statusCode).toBe(201);
    const { report } = create.json() as { report: { id: string; status: string } };
    expect(report.status).toBe("pending");

    // 无 token 环境下放行（dev）
    const list = (await app.inject({ method: "GET", url: "/api/moderation/reports?status=pending" })).json() as { reports: Array<{ id: string }> };
    expect(list.reports.some((r) => r.id === report.id)).toBe(true);

    const upd = await app.inject({
      method: "PUT", url: `/api/moderation/reports/${report.id}/status`,
      payload: { status: "resolved" },
    });
    expect(upd.statusCode).toBe(200);
    const pending = (await app.inject({ method: "GET", url: "/api/moderation/reports?status=pending" })).json() as { reports: unknown[] };
    expect(pending.reports.length).toBe(0);
  });

  it("举报参数校验：缺 reason / 非法 targetType → 400", async () => {
    const noReason = await app.inject({
      method: "POST", url: "/api/moderation/report",
      payload: { reporterId: "u-a", targetType: "user", targetId: "u-b" },
    });
    expect(noReason.statusCode).toBe(400);
    const badType = await app.inject({
      method: "POST", url: "/api/moderation/report",
      payload: { reporterId: "u-a", targetType: "hack", targetId: "u-b", reason: "x" },
    });
    expect(badType.statusCode).toBe(400);
  });

  it("更新举报状态：非法 status → 400，不存在的 id → 404", async () => {
    const bad = await app.inject({
      method: "PUT", url: "/api/moderation/reports/whatever/status",
      payload: { status: "nope" },
    });
    expect(bad.statusCode).toBe(400);
    const notFound = await app.inject({
      method: "PUT", url: "/api/moderation/reports/no-such/status",
      payload: { status: "resolved" },
    });
    expect(notFound.statusCode).toBe(404);
  });
});
