// ===== R5-UGC: 一句话造场景 · 发布/分享闭环 测试 =====
// 每个测试用独立临时目录（BALABALA_TEST_DATA_DIR），避免污染真实 .data。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { SceneDraft, UgcSceneMeta } from "@balabala/shared";

type StoreMod = typeof import("./ugc-store.js");

let store: StoreMod;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-ugc-"));
  process.env.BALABALA_TEST_DATA_DIR = tmpDir;
  store = await import("./ugc-store.js");
});

beforeEach(() => {
  store._resetUgcStoreForTest();
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.BALABALA_TEST_DATA_DIR;
});

const draft: SceneDraft = {
  title: "赛博茶馆辩论",
  rawPrompt: "一个赛博朋克茶馆，苏轼和马斯克在辩论",
  theme: "cyberpunk-teahouse",
  style: "赛博朋克",
  celebrityIds: ["su-shi", "elon-musk"],
  gameType: "debate",
  props: [
    { kind: "cylinder", label: "茶桌", color: "#3a2a1a", position: [0, 0, 0] },
  ],
  lightPreset: "night",
};

describe("发布场景", () => {
  it("发布后返回 ugc_ 前缀 id 与分享链接", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "赛博茶馆", draft });
    expect(r.sceneId).toMatch(/^ugc_/);
    expect(r.shareLink).toBe(`/studio?scene=${r.sceneId}`);
    expect(r.status).toBe("published");
    expect(r.isPublic).toBe(true);
  });

  it("默认公开（isPublic 缺省 true）", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "默认公开", draft });
    expect(r.isPublic).toBe(true);
  });

  it("缺少 userId 抛 400", () => {
    expect(() => store.publishUgcScene({ userId: "", name: "x", draft })).toThrowError(/userId/);
  });

  it("缺少名称抛 400", () => {
    expect(() => store.publishUgcScene({ userId: "u1", name: "  ", draft })).toThrowError(/名称/);
  });

  it("草稿缺少 theme 抛 400 invalid_draft", () => {
    const bad = { ...draft, theme: "" };
    expect(() => store.publishUgcScene({ userId: "u1", name: "bad", draft: bad })).toThrowError(/主题/);
  });

  it("同时落盘为单场景 JSON 文件", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "落盘", draft });
    expect(existsSync(join(tmpDir, "ugc", "scenes", `${r.sceneId}.json`))).toBe(true);
  });
});

describe("权限：公开已发布 / 私有", () => {
  it("公开已发布场景任何人可读取", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "公开馆", draft, isPublic: true });
    const res = store.getUgcScene(r.sceneId, "stranger");
    expect(res.found).toBe(true);
    expect(res.allowed).toBe(true);
    expect(res.record?.name).toBe("公开馆");
  });

  it("私有场景非创建者读取被拒", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "私房", draft, isPublic: false });
    const res = store.getUgcScene(r.sceneId, "stranger");
    expect(res.found).toBe(true);
    expect(res.allowed).toBe(false);
  });

  it("私有场景创建者本人可读", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "私房", draft, isPublic: false });
    const res = store.getUgcScene(r.sceneId, "u1");
    expect(res.allowed).toBe(true);
    expect(res.record?.draft.theme).toBe("cyberpunk-teahouse");
  });

  it("不存在的场景 found=false", () => {
    expect(store.getUgcScene("ugc_nope").found).toBe(false);
  });

  it("他人进入公开场景 playCount 递增", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "热门", draft, isPublic: true });
    const before = store.getUgcScene(r.sceneId, "p1").record?.playCount ?? 0;
    const after = store.getUgcScene(r.sceneId, "p2").record?.playCount ?? 0;
    expect(after).toBe(before + 1);
  });
});

describe("我的作品 / 热门 / 编辑 / 删除", () => {
  it("listMine 返回该用户全部状态作品", () => {
    store.publishUgcScene({ userId: "u1", name: "u1作品A", draft });
    store.publishUgcScene({ userId: "u2", name: "u2作品", draft });
    const mine = store.listMine("u1");
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("u1作品A");
  });

  it("listHot 只含公开已发布并按 playCount 排序", () => {
    const a = store.publishUgcScene({ userId: "u1", name: "公开A", draft, isPublic: true });
    const b = store.publishUgcScene({ userId: "u1", name: "私有B", draft, isPublic: false });
    // 给 a 制造一次他人访问以增加 playCount
    store.getUgcScene(a.sceneId, "v1");
    store.getUgcScene(a.sceneId, "v2");
    const hot = store.listHot(10) as UgcSceneMeta[];
    expect(hot.find((h) => h.sceneId === b.sceneId)).toBeUndefined();
    expect(hot[0].sceneId).toBe(a.sceneId);
  });

  it("创建者可重新发布（更新 draft）", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "旧名", draft });
    const nd = { ...draft, theme: "ancient-study", style: "古风" };
    const updated = store.updateUgcScene(r.sceneId, "u1", { draft: nd });
    expect(updated.theme).toBe("ancient-study");
  });

  it("非创建者编辑抛 403", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "别人改我", draft });
    expect(() => store.updateUgcScene(r.sceneId, "intruder", { name: "hack" })).toThrowError(/只能修改/);
  });

  it("创建者可删除自己的作品", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "待删", draft });
    store.removeUgcScene(r.sceneId, "u1");
    expect(store.getUgcScene(r.sceneId).found).toBe(false);
  });

  it("非创建者删除抛 403", () => {
    const r = store.publishUgcScene({ userId: "u1", name: "别人删我", draft });
    expect(() => store.removeUgcScene(r.sceneId, "intruder")).toThrowError(/只能删除/);
  });
});

describe("REST 路由端到端", () => {
  it("POST 发布 → GET 详情 → GET templates → GET mine → DELETE", async () => {
    const app = Fastify();
    store.registerUgcRoutes(app);
    await app.ready();

    const post = await app.inject({
      method: "POST", url: "/api/ugc/scenes",
      payload: { userId: "u1", name: "REST 茶馆", draft },
    });
    expect(post.statusCode).toBe(201);
    const { sceneId, shareLink } = post.json<{ sceneId: string; shareLink: string }>();
    expect(shareLink).toContain("/studio?scene=");

    // 公开：陌生人 200
    const pub = await app.inject({ method: "GET", url: `/api/ugc/scenes/${sceneId}` });
    expect(pub.statusCode).toBe(200);

    // templates 返回官方模板 + 热门
    const tpl = await app.inject({ method: "GET", url: "/api/ugc/templates" });
    expect(tpl.statusCode).toBe(200);
    const body = tpl.json<{ official: unknown[]; hot: UgcSceneMeta[] }>();
    expect(body.official.length).toBeGreaterThan(0);
    expect(body.hot.find((h) => h.sceneId === sceneId)).toBeTruthy();

    // mine
    const mine = await app.inject({ method: "GET", url: "/api/ugc/mine?userId=u1" });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ scenes: UgcSceneMeta[] }>().scenes.length).toBe(1);

    // 404
    const nf = await app.inject({ method: "GET", url: "/api/ugc/scenes/ugc_missing" });
    expect(nf.statusCode).toBe(404);

    // DELETE
    const del = await app.inject({ method: "DELETE", url: `/api/ugc/scenes/${sceneId}?userId=u1` });
    expect(del.statusCode).toBe(204);

    await app.close();
  });

  it("POST 非法草稿返回 400", async () => {
    const app = Fastify();
    store.registerUgcRoutes(app);
    await app.ready();
    const bad = { ...draft, gameType: undefined as unknown as SceneDraft["gameType"] };
    const res = await app.inject({
      method: "POST", url: "/api/ugc/scenes",
      payload: { userId: "u1", name: "非法", draft: bad },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
