// ===== R4-09: 场景模板市场测试 =====
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  SCENE_TEMPLATES,
  getTemplateById,
  isTemplateValid,
  registerSceneTemplateRoutes,
} from "./scene-templates.js";

describe("场景模板注册表", () => {
  it("内置至少 6 个场景模板", () => {
    expect(SCENE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it("包含任务要求的全部 6 个主题模板", () => {
    const names = SCENE_TEMPLATES.map((t) => t.name);
    for (const want of ["星空法庭", "赛博酒吧", "古风书院", "未来健身房", "童话广场", "深海图书馆"]) {
      expect(names).toContain(want);
    }
  });

  it("每个模板 id 唯一", () => {
    const ids = SCENE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个模板都有 emoji 缩略图与占位主色", () => {
    for (const t of SCENE_TEMPLATES) {
      expect(t.thumbnail.length).toBeGreaterThan(0);
      expect(t.color).toMatch(/^#/);
    }
  });

  it("每个模板参数完整且通过校验", () => {
    for (const t of SCENE_TEMPLATES) {
      expect(isTemplateValid(t)).toBe(true);
    }
  });

  it("模板场景参数含光照/雾/地面颜色/物体列表", () => {
    for (const t of SCENE_TEMPLATES) {
      expect(t.params.lightPreset).toBeTruthy();
      expect(t.params.fogColor).toMatch(/^#/);
      expect(t.params.groundColor).toMatch(/^#/);
      expect(typeof t.params.fogNear).toBe("number");
      expect(typeof t.params.fogFar).toBe("number");
      expect(Array.isArray(t.params.objects)).toBe(true);
    }
  });

  it("getTemplateById 命中/未命中", () => {
    expect(getTemplateById("starlight-court")?.name).toBe("星空法庭");
    expect(getTemplateById("no-such-template")).toBeUndefined();
  });
});

describe("GET /api/scene-templates 路由", () => {
  it("返回模板列表", async () => {
    const app = Fastify();
    registerSceneTemplateRoutes(app);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/scene-templates" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ templates: unknown[] }>();
    expect(body.templates.length).toBeGreaterThanOrEqual(6);
    await app.close();
  });

  it("GET /api/scene-templates/:id 返回单个模板，未知 id 返回 404", async () => {
    const app = Fastify();
    registerSceneTemplateRoutes(app);
    await app.ready();
    const ok = await app.inject({ method: "GET", url: "/api/scene-templates/deepsea-library" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ name: string }>().name).toBe("深海图书馆");
    const miss = await app.inject({ method: "GET", url: "/api/scene-templates/nope" });
    expect(miss.statusCode).toBe(404);
    await app.close();
  });
});
