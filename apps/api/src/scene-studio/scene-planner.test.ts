// ===== scene-planner 测试：蓝图校验 / 兜底 / LLM 规划（mock chat）=====
import { describe, expect, it, vi } from "vitest";
import type { ChatFn } from "./bench-orchestrator.js";
import {
  parseAndValidateBlueprint,
  fallbackBlueprint,
  planScene,
  extractJson,
} from "./scene-planner.js";

describe("extractJson", () => {
  it("去掉 Markdown 代码块后解析 JSON", () => {
    const text = "```json\n{\"a\":1}\n```";
    expect(extractJson(text)).toEqual({ a: 1 });
  });
  it("从混杂文本中提取首个花括号对象", () => {
    expect(extractJson('好的，结果如下：{"x":2} 完毕')).toEqual({ x: 2 });
  });
  it("无 JSON 时抛错", () => {
    expect(() => extractJson("没有json")).toThrow();
  });
});

describe("parseAndValidateBlueprint — 合法输入", () => {
  it("完整 LLM 输出正确映射", () => {
    const raw = {
      terrain: { theme: "forest", size: 80, heightSeed: 12345, waterLevel: 0.5, weather: "rain", light: "sunset", params: { amplitude: 2 } },
      scatter: [{ kind: "tree", variant: 1, count: 20, zones: [[-10, -10, 10, 10]] }],
      structures: [{ kind: "house", label: "小屋", position: [5, 0, 5], rotation: [0, 1, 0], scale: [2, 2, 2] }],
      npcs: [{ characterId: "elon-musk", label: "马斯克", role: "guide", defaultPrompt: "你好" }],
      gameplay: { template: "collect", config: { objective: "收集星星", collectTargets: ["star1", "star2"] } },
      spawnPoint: [0, 0, 5],
      bounds: [-40, -40, 40, 40],
    };
    const bp = parseAndValidateBlueprint(raw);
    expect(bp.terrain.theme).toBe("forest");
    expect(bp.terrain.size).toBe(80);
    expect(bp.terrain.heightSeed).toBe(12345);
    expect(bp.terrain.waterLevel).toBe(0.5);
    expect(bp.terrain.weather).toBe("rain");
    expect(bp.terrain.light).toBe("sunset");
    expect(bp.terrain.params.amplitude).toBe(2);
    expect(bp.scatter).toHaveLength(1);
    expect(bp.scatter[0].kind).toBe("tree");
    expect(bp.scatter[0].count).toBe(20);
    expect(bp.structures).toHaveLength(1);
    expect(bp.structures[0].kind).toBe("house");
    expect(bp.structures[0].id).toBeTruthy();
    expect(bp.structures[0].position).toEqual([5, 0, 5]);
    expect(bp.npcs).toHaveLength(1);
    expect(bp.npcs[0].characterId).toBe("elon-musk");
    expect(bp.npcs[0].id).toBeTruthy();
    expect(bp.gameplay.template).toBe("collect");
    expect(bp.gameplay.config.collectTargets).toEqual(["star1", "star2"]);
    expect(bp.spawnPoint).toEqual([0, 0, 5]);
    expect(bp.bounds).toEqual([-40, -40, 40, 40]);
    expect(bp.version).toBe(1);
  });
});

describe("parseAndValidateBlueprint — 缺失字段补默认值", () => {
  it("空对象返回完整默认蓝图，不抛错", () => {
    const bp = parseAndValidateBlueprint({});
    expect(bp.terrain.theme).toBe("forest");
    expect(bp.terrain.size).toBe(60);
    expect(bp.terrain.heightSeed).toBeGreaterThanOrEqual(0);
    expect(bp.terrain.waterLevel).toBe(-1);
    expect(bp.terrain.weather).toBe("clear");
    expect(bp.terrain.light).toBe("day");
    expect(bp.scatter).toEqual([]);
    expect(bp.structures).toEqual([]);
    expect(bp.npcs).toEqual([]);
    expect(bp.gameplay.template).toBe("explore");
    expect(bp.spawnPoint).toEqual([0, 0, 0]);
    expect(bp.bounds).toEqual([-30, -30, 30, 30]);
    expect(bp.version).toBe(1);
  });

  it("terrain 部分缺失时补默认值", () => {
    const bp = parseAndValidateBlueprint({ terrain: { theme: "desert" } });
    expect(bp.terrain.theme).toBe("desert");
    expect(bp.terrain.size).toBe(60);
    expect(bp.terrain.waterLevel).toBe(-1);
    expect(bp.terrain.weather).toBe("clear");
    expect(bp.terrain.light).toBe("day");
  });

  it("size 为非法值时回退默认 60 并限制最小 20", () => {
    const bp = parseAndValidateBlueprint({ terrain: { theme: "city", size: "abc" } });
    expect(bp.terrain.size).toBe(60);
    const small = parseAndValidateBlueprint({ terrain: { theme: "city", size: 5 } });
    expect(small.terrain.size).toBe(20); // Math.max(20, 5)
  });

  it("非法 theme/weather/light/gameplay 回退默认", () => {
    const bp = parseAndValidateBlueprint({
      terrain: { theme: "Mars", weather: "hurricane", light: "neon" },
      gameplay: { template: "racing", config: {} },
    });
    expect(bp.terrain.theme).toBe("forest");
    expect(bp.terrain.weather).toBe("clear");
    expect(bp.terrain.light).toBe("day");
    expect(bp.gameplay.template).toBe("explore");
  });

  it("scatter 中非法 kind 被过滤", () => {
    const bp = parseAndValidateBlueprint({
      scatter: [{ kind: "tree", count: 10 }, { kind: "ufo", count: 5 }, { kind: "rock" }],
    });
    expect(bp.scatter).toHaveLength(2);
    expect(bp.scatter[0].kind).toBe("tree");
    expect(bp.scatter[0].count).toBe(10);
    expect(bp.scatter[1].kind).toBe("rock");
    expect(bp.scatter[1].count).toBe(5); // 默认 count
  });

  it("structures/npcs 缺关键字段被跳过", () => {
    const bp = parseAndValidateBlueprint({
      structures: [{ position: [1, 2, 3] }, { kind: "tower", label: "塔" }],
      npcs: [{ label: "无名" }, { characterId: "steve-jobs", label: "乔布斯" }],
    });
    expect(bp.structures).toHaveLength(1);
    expect(bp.structures[0].kind).toBe("tower");
    expect(bp.structures[0].id).toBeTruthy();
    expect(bp.npcs).toHaveLength(1);
    expect(bp.npcs[0].characterId).toBe("steve-jobs");
  });
});

describe("parseAndValidateBlueprint — 非法输入", () => {
  it("null / undefined / 非对象不抛错", () => {
    expect(() => parseAndValidateBlueprint(null)).not.toThrow();
    expect(() => parseAndValidateBlueprint(undefined)).not.toThrow();
    expect(() => parseAndValidateBlueprint("hello")).not.toThrow();
    expect(() => parseAndValidateBlueprint(42)).not.toThrow();
    const bp = parseAndValidateBlueprint(null);
    expect(bp.terrain.theme).toBe("forest");
    expect(bp.version).toBe(1);
  });
});

describe("fallbackBlueprint", () => {
  it("返回森林主题 + 基础 scatter + 2 结构 + explore", () => {
    const bp = fallbackBlueprint("测试场景");
    expect(bp.terrain.theme).toBe("forest");
    expect(bp.terrain.size).toBe(60);
    expect(bp.terrain.waterLevel).toBe(-1);
    expect(bp.terrain.weather).toBe("clear");
    expect(bp.terrain.light).toBe("day");
    expect(bp.scatter.length).toBeGreaterThanOrEqual(3);
    expect(bp.structures).toHaveLength(2);
    expect(bp.structures.every((s) => s.id)).toBe(true);
    expect(bp.gameplay.template).toBe("explore");
    expect(bp.gameplay.config.objective).toContain("测试场景");
    expect(bp.version).toBe(1);
  });
});

describe("planScene — mock chat", () => {
  it("LLM 返回合法 JSON 时正确解析", async () => {
    const mockChat: ChatFn = vi.fn(async () =>
      JSON.stringify({
        terrain: { theme: "snow", size: 70, heightSeed: 99, waterLevel: -1, weather: "snow", light: "day", params: {} },
        scatter: [{ kind: "tree", count: 15 }],
        structures: [{ kind: "tent", label: "雪山帐篷", position: [3, 0, 3], rotation: [0, 0, 0], scale: [1, 1, 1] }],
        npcs: [{ characterId: "alan-turing", label: "图灵", role: "guide", defaultPrompt: "你好" }],
        gameplay: { template: "explore", config: { objective: "雪山探险" } },
        spawnPoint: [0, 0, 0],
        bounds: [-35, -35, 35, 35],
      }),
    );
    const result = await planScene({ description: "雪山探险" }, mockChat);
    expect(result.blueprint.terrain.theme).toBe("snow");
    expect(result.blueprint.structures).toHaveLength(1);
    expect(result.npcRecommendations[0].characterId).toBe("alan-turing");
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("用户指定 theme/gameplay 覆盖 LLM 结果", async () => {
    const mockChat: ChatFn = vi.fn(async () =>
      JSON.stringify({
        terrain: { theme: "forest" },
        scatter: [], structures: [], npcs: [],
        gameplay: { template: "explore", config: {} },
      }),
    );
    const result = await planScene(
      { description: "城市", theme: "city", gameplay: "quest" },
      mockChat,
    );
    expect(result.blueprint.terrain.theme).toBe("city");
    expect(result.blueprint.gameplay.template).toBe("quest");
  });

  it("LLM 抛错时返回 fallbackBlueprint + NPC 推荐", async () => {
    const mockChat: ChatFn = vi.fn(async () => { throw new Error("network down"); });
    const result = await planScene({ description: "神秘森林" }, mockChat);
    expect(result.blueprint.terrain.theme).toBe("forest");
    expect(result.blueprint.structures.length).toBe(2);
    expect(result.npcRecommendations.length).toBeGreaterThan(0);
  });

  it("LLM 返回非法 JSON 时走兜底", async () => {
    const mockChat: ChatFn = vi.fn(async () => "这不是JSON");
    const result = await planScene({ description: "沙漠" }, mockChat);
    expect(result.blueprint.terrain.theme).toBe("forest"); // fallback
  });
});
