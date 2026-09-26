// ===== 分片6: 统一人物档案 REST API 测试 =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("character-profile-routes", () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-charroutes-"));
    process.env.DB_PATH = join(dir, "test.db");
    db = await import("./db.js");
    const { registerCharacterProfileRoutes } = await import("./character-profile-routes.js");
    app = Fastify({ logger: false });
    registerCharacterProfileRoutes(app);
    await app.ready();

    // 准备一个公开自定义人物 + 一个用户
    const now = new Date().toISOString();
    db.upsertUser({ userId: "u-owner", nickname: "房主", avatarType: "capsule", avatarRef: "", createdAt: now });
    db.createCustomCharacter({
      id: "custom-demo", userId: "u-owner", name: "公开分身", title: "Demo", intro: "自我介绍",
      tags: ["示例"], persona: "p", greeting: "hi", modelPath: "", portraitPath: "",
      visibility: "public", voice: "", skillMd: "", createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DB_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("GET /api/characters/unified：返回名人+公开自定义人物，支持分页", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters/unified?page=1&limit=5" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { items: Array<{ id: string; source: string }>; total: number; tags: unknown[] };
    expect(j.items.length).toBeLessThanOrEqual(5);
    expect(j.total).toBeGreaterThan(10); // 名人全量
    expect(Array.isArray(j.tags)).toBe(true);
  });

  it("GET /api/characters/unified?source=custom&q=分身：搜索+来源筛选", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters/unified?source=custom&q=分身" });
    const j = res.json() as { items: Array<{ id: string }> };
    expect(j.items.some((c) => c.id === "custom-demo")).toBe(true);
    // 全部为 custom
    const all = (await app.inject({ method: "GET", url: "/api/characters/unified?source=custom" })).json() as { items: Array<{ source: string }> };
    expect(all.items.every((c) => c.source === "custom")).toBe(true);
  });

  it("GET /api/characters/:id/profile：名人详情", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters/elon-musk/profile" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { profile: { id: string; source: string }; followed: boolean };
    expect(j.profile.id).toBe("elon-musk");
    expect(j.profile.source).toBe("celebrity");
    expect(typeof j.followed).toBe("boolean");
  });

  it("关注 → 列表 → 取消关注 往返", async () => {
    // 关注
    const follow = await app.inject({
      method: "POST", url: "/api/characters/elon-musk/follow",
      payload: { userId: "u-owner" },
    });
    expect(follow.statusCode).toBe(200);
    expect((follow.json() as { ok: boolean }).ok).toBe(true);

    // 我关注的列表包含该人物
    const list = await app.inject({ method: "GET", url: "/api/characters/following?userId=u-owner" });
    expect(list.statusCode).toBe(200);
    const lj = list.json() as { characters: Array<{ id: string }> };
    expect(lj.characters.some((c) => c.id === "elon-musk")).toBe(true);

    // 详情接口显示已关注
    const prof = await app.inject({ method: "GET", url: "/api/characters/elon-musk/profile?userId=u-owner" });
    expect((prof.json() as { followed: boolean }).followed).toBe(true);

    // 取消关注
    const unfollow = await app.inject({
      method: "DELETE", url: "/api/characters/elon-musk/follow",
      payload: { userId: "u-owner" },
    });
    expect(unfollow.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/api/characters/following?userId=u-owner" })).json() as { characters: unknown[] };
    expect(after.characters.length).toBe(0);
  });

  it("关注不存在的人物 → 404；缺 userId → 400", async () => {
    const nf = await app.inject({ method: "POST", url: "/api/characters/no-such/follow", payload: { userId: "u-owner" } });
    expect(nf.statusCode).toBe(404);
    const bad = await app.inject({ method: "POST", url: "/api/characters/elon-musk/follow", payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it("GET /api/players/:userId/profile：玩家公开档案", async () => {
    const res = await app.inject({ method: "GET", url: "/api/players/u-owner/profile" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { profile: { userId: string; nickname: string; customCharacterCount: number; followingCount: number } };
    expect(j.profile.userId).toBe("u-owner");
    expect(j.profile.nickname).toBe("房主");
    expect(j.profile.customCharacterCount).toBe(1);
    expect(typeof j.profile.followingCount).toBe("number");

    const nf = await app.inject({ method: "GET", url: "/api/players/no-such/profile" });
    expect(nf.statusCode).toBe(404);
  });
});
