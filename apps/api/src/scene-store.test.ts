// ===== R4-09: 场景保存/分享/权限 测试 =====
// 每个测试文件用独立临时目录（BALABALA_TEST_DATA_DIR），避免污染真实 .data。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

type StoreMod = typeof import("./scene-store.js");

let store: StoreMod;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-scenes-"));
  process.env.BALABALA_TEST_DATA_DIR = tmpDir;
  store = await import("./scene-store.js");
});

beforeEach(() => {
  store._resetSceneStoreForTest();
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.BALABALA_TEST_DATA_DIR;
});

const sceneData = { terrain: { groundColor: "#141a2e" }, props: [] };

describe("保存场景", () => {
  it("保存后返回 sceneId 与分享链接", () => {
    const s = store.saveScene({ userId: "u1", name: "我的星空", sceneData, isPublic: true });
    expect(s.sceneId).toBeTruthy();
    expect(s.shareLink).toBe(`/studio?scene=${s.sceneId}`);
    expect(s.isPublic).toBe(true);
    expect(s.userId).toBe("u1");
  });

  it("默认私有（isPublic 缺省 false）", () => {
    const s = store.saveScene({ userId: "u1", name: "草稿", sceneData });
    expect(s.isPublic).toBe(false);
  });

  it("缺少 userId 返回 400", () => {
    expect(() => store.saveScene({ userId: "", name: "x", sceneData })).toThrowError(/userId/);
  });

  it("缺少名称返回 400", () => {
    expect(() => store.saveScene({ userId: "u1", name: "  ", sceneData })).toThrowError(/名称/);
  });

  it("缺少 sceneData 返回 400", () => {
    expect(() => store.saveScene({ userId: "u1", name: "x", sceneData: undefined as never })).toThrowError(/sceneData/);
  });

  it("同时落盘为单场景 JSON 文件", () => {
    const s = store.saveScene({ userId: "u1", name: "落盘检查", sceneData: { a: 1 } });
    expect(existsSync(join(tmpDir, "scenes", `${s.sceneId}.json`))).toBe(true);
  });
});

describe("权限：公开 / 私有", () => {
  it("公开场景任何人可读取", () => {
    const s = store.saveScene({ userId: "u1", name: "公开馆", sceneData, isPublic: true });
    const r = store.getSharedScene(s.sceneId, "someone-else");
    expect(r.found).toBe(true);
    expect(r.allowed).toBe(true);
    expect(r.scene?.name).toBe("公开馆");
  });

  it("私有场景非创建者读取被拒（403 语义）", () => {
    const s = store.saveScene({ userId: "u1", name: "私房", sceneData, isPublic: false });
    const r = store.getSharedScene(s.sceneId, "stranger");
    expect(r.found).toBe(true);
    expect(r.allowed).toBe(false);
    expect(r.scene).toBeNull();
  });

  it("私有场景创建者本人可读", () => {
    const s = store.saveScene({ userId: "u1", name: "私房", sceneData, isPublic: false });
    const r = store.getSharedScene(s.sceneId, "u1");
    expect(r.allowed).toBe(true);
    expect(r.scene?.sceneData).toEqual(sceneData);
  });

  it("不存在的场景 found=false", () => {
    expect(store.getSharedScene("nope-id").found).toBe(false);
  });
});

describe("列表 / 改权限 / 删除", () => {
  it("listScenes 按用户过滤公开场景", () => {
    store.saveScene({ userId: "u1", name: "u1公开", sceneData, isPublic: true });
    store.saveScene({ userId: "u1", name: "u1私有", sceneData, isPublic: false });
    store.saveScene({ userId: "u2", name: "u2公开", sceneData, isPublic: true });
    const onlyU1Public = store.listScenes({ userId: "u1", publicOnly: true });
    expect(onlyU1Public).toHaveLength(1);
    expect(onlyU1Public[0].name).toBe("u1公开");
    const allPublic = store.listScenes({ publicOnly: true });
    expect(allPublic).toHaveLength(2);
  });

  it("创建者可 PATCH 修改可见性", () => {
    const s = store.saveScene({ userId: "u1", name: "转公开", sceneData, isPublic: false });
    const updated = store.setVisibility(s.sceneId, { userId: "u1", isPublic: true });
    expect(updated.isPublic).toBe(true);
    // 之后陌生人可读
    expect(store.getSharedScene(s.sceneId, "stranger").allowed).toBe(true);
  });

  it("非创建者 PATCH 返回 403", () => {
    const s = store.saveScene({ userId: "u1", name: "别人改我", sceneData, isPublic: true });
    expect(() => store.setVisibility(s.sceneId, { userId: "intruder", isPublic: false })).toThrowError(/只能修改/);
  });

  it("创建者可删除自己的场景", () => {
    const s = store.saveScene({ userId: "u1", name: "待删", sceneData, isPublic: true });
    store.deleteSharedScene(s.sceneId, "u1");
    expect(store.getSharedScene(s.sceneId).found).toBe(false);
  });

  it("非创建者删除返回 403", () => {
    const s = store.saveScene({ userId: "u1", name: "别人删我", sceneData });
    expect(() => store.deleteSharedScene(s.sceneId, "intruder")).toThrowError(/只能删除/);
  });
});

describe("REST 路由端到端", () => {
  it("POST 保存 → GET 详情 → PATCH 公开 → 列表", async () => {
    const app = Fastify();
    store.registerSceneStoreRoutes(app);
    await app.ready();

    const save = await app.inject({
      method: "POST", url: "/api/scenes",
      payload: { userId: "u1", name: "REST 场景", sceneData, isPublic: false },
    });
    expect(save.statusCode).toBe(201);
    const { sceneId, shareLink } = save.json<{ sceneId: string; shareLink: string }>();
    expect(shareLink).toContain("/studio?scene=");

    // 私有：陌生人 403
    const priv = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/data?viewer=stranger` });
    expect(priv.statusCode).toBe(403);

    // 本人可读
    const mine = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/data?viewer=u1` });
    expect(mine.statusCode).toBe(200);

    // 改公开
    const patch = await app.inject({
      method: "PATCH", url: `/api/scenes/${sceneId}`,
      payload: { userId: "u1", isPublic: true },
    });
    expect(patch.statusCode).toBe(200);

    // 列表命中
    const list = await app.inject({ method: "GET", url: "/api/scenes?userId=u1&public=true" });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ scenes: unknown[] }>().scenes.length).toBe(1);

    await app.close();
  });
});
