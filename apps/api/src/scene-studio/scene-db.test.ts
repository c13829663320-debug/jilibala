// ===== scene-db DAO 测试（临时 SQLite，禁止真实网络）=====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type SceneDbModule = typeof import("./scene-db.js");

async function loadSceneDb(): Promise<{ mod: SceneDbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-scene-db-"));
  process.env.DB_PATH = join(dir, "scene-test.db");
  vi.resetModules();
  const mod = await import("./scene-db.js");
  return { mod, dir };
}

describe("scene-db DAO", () => {
  let ctx: { mod: SceneDbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadSceneDb();
  });

  afterAll(() => {
    try { ctx.mod.sceneDb.close(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("createScene -> getScene 回读，默认字段正确", () => {
    const rec = ctx.mod.createScene({
      name: "森林营地",
      description: "一个林间营地场景",
      theme: "forest",
      owner_id: "user1",
    });
    expect(rec.id).toBeTruthy();
    expect(rec.name).toBe("森林营地");
    expect(rec.theme).toBe("forest");
    expect(rec.status).toBe("draft");
    expect(rec.play_count).toBe(0);
    expect(rec.blueprint_json).toBe("{}");
    expect(rec.created_at).toBeTruthy();
    expect(rec.updated_at).toBeTruthy();

    const read = ctx.mod.getScene(rec.id);
    expect(read).toBeDefined();
    expect(read!.id).toBe(rec.id);
    expect(read!.description).toBe("一个林间营地场景");
  });

  it("createScene 带 blueprint 时 blueprint_json 可解析", () => {
    const rec = ctx.mod.createScene({
      name: "测试",
      description: "desc",
      theme: "desert",
      blueprint: {
        terrain: { theme: "desert", size: 60, heightSeed: 1, waterLevel: -1, weather: "clear", light: "day", params: {} },
        scatter: [],
        structures: [],
        npcs: [],
        gameplay: { template: "explore", config: {} },
        spawnPoint: [0, 0, 0],
        bounds: [-30, -30, 30, 30],
        version: 1,
      },
    });
    const parsed = ctx.mod.parseBlueprint(rec);
    expect(parsed.terrain.theme).toBe("desert");
    expect(parsed.version).toBe(1);
  });

  it("listScenes 按 ownerId 过滤", () => {
    ctx.mod.createScene({ name: "A", description: "a", theme: "forest", owner_id: "u1" });
    ctx.mod.createScene({ name: "B", description: "b", theme: "snow", owner_id: "u2" });
    ctx.mod.createScene({ name: "C", description: "c", theme: "city", owner_id: "u1" });

    const all = ctx.mod.listScenes();
    expect(all.length).toBe(3);

    const u1 = ctx.mod.listScenes({ ownerId: "u1" });
    expect(u1.length).toBe(2);
    expect(u1.every((s) => s.owner_id === "u1")).toBe(true);

    const u2 = ctx.mod.listScenes({ ownerId: "u2" });
    expect(u2.length).toBe(1);
    expect(u2[0].name).toBe("B");
  });

  it("updateScene 局部更新字段与 blueprint", () => {
    const rec = ctx.mod.createScene({ name: "旧名", description: "旧描述", theme: "forest" });
    const updated = ctx.mod.updateScene(rec.id, {
      name: "新名",
      status: "ready",
      blueprint: {
        terrain: { theme: "mountain", size: 80, heightSeed: 42, waterLevel: -1, weather: "cloudy", light: "sunset", params: {} },
        scatter: [], structures: [], npcs: [],
        gameplay: { template: "reach", config: { goalPosition: [5, 0, 5] } },
        spawnPoint: [0, 0, 0], bounds: [-40, -40, 40, 40], version: 1,
      },
    });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("新名");
    expect(updated!.status).toBe("ready");
    expect(updated!.description).toBe("旧描述"); // 未传则不变
    const parsed = ctx.mod.parseBlueprint(updated!);
    expect(parsed.terrain.theme).toBe("mountain");
    expect(parsed.gameplay.template).toBe("reach");
  });

  it("updateScene 返回 undefined 当 id 不存在", () => {
    expect(ctx.mod.updateScene("nonexistent", { name: "x" })).toBeUndefined();
  });

  it("incrementPlayCount 累加播放次数", () => {
    const rec = ctx.mod.createScene({ name: "播放测试", description: "", theme: "plains" });
    expect(ctx.mod.getScene(rec.id)!.play_count).toBe(0);
    const n1 = ctx.mod.incrementPlayCount(rec.id);
    expect(n1).toBe(1);
    const n2 = ctx.mod.incrementPlayCount(rec.id);
    expect(n2).toBe(2);
    expect(ctx.mod.getScene(rec.id)!.play_count).toBe(2);
  });

  it("deleteScene 删除场景", () => {
    const rec = ctx.mod.createScene({ name: "待删", description: "", theme: "cave" });
    expect(ctx.mod.getScene(rec.id)).toBeDefined();
    expect(ctx.mod.deleteScene(rec.id)).toBe(true);
    expect(ctx.mod.getScene(rec.id)).toBeUndefined();
    expect(ctx.mod.deleteScene(rec.id)).toBe(false);
  });

  it("addAsset / getAssetsByScene / deleteAssetsByScene", () => {
    const scene = ctx.mod.createScene({ name: "资产场景", description: "", theme: "beach" });
    const a1 = ctx.mod.addAsset({
      scene_id: scene.id, type: "structure", source: "library",
      url: "/models/props/tent.glb", tripo_task_id: "", meta: "{}",
    });
    const a2 = ctx.mod.addAsset({
      scene_id: scene.id, type: "structure", source: "tripo",
      url: "/models/scenes/x.glb", tripo_task_id: "task-123",
      meta: JSON.stringify({ structureId: "s1" }),
    });
    expect(a1.id).toBeTruthy();
    expect(a2.tripo_task_id).toBe("task-123");

    const list = ctx.mod.getAssetsByScene(scene.id);
    expect(list.length).toBe(2);
    expect(list.map((a) => a.source)).toContain("tripo");

    ctx.mod.deleteAssetsByScene(scene.id);
    expect(ctx.mod.getAssetsByScene(scene.id).length).toBe(0);
  });
});
