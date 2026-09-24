// ===== M12: character-resolver 测试 =====
// 预置名人走 getCelebrity 静态库；custom- 开头走临时 SQLite 表。
// 沿用隔离模式：设置 DB_PATH + vi.resetModules() 后动态 import，
// 让 character-resolver 与 db 共享同一个临时库实例。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCharacterRecord } from "./db.js";

type ResolverModule = typeof import("./character-resolver.js");
type DbModule = typeof import("./db.js");

async function loadResolver(): Promise<{
  resolver: ResolverModule;
  dbmod: DbModule;
  dir: string;
}> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-resolver-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  // 先 import resolver，其内部会拉起全新的 db 模块；再 import db 拿到同一实例用于造数。
  const resolver = await import("./character-resolver.js");
  const dbmod = await import("./db.js");
  return { resolver, dbmod, dir };
}

/** 往临时库写一条自定义人物记录。 */
function seedCustom(
  dbmod: DbModule,
  over: Partial<CustomCharacterRecord> = {},
): string {
  const id = over.id ?? `custom-seed-${Math.random().toString(36).slice(2, 10)}`;
  const rec: CustomCharacterRecord = {
    id,
    userId: over.userId ?? "user-a",
    name: over.name ?? "自定义分身",
    title: over.title ?? "分身标题",
    intro: over.intro ?? "简介",
    tags: over.tags ?? ["测试"],
    persona: over.persona ?? "你是一个测试分身。",
    greeting: over.greeting ?? "你好。",
    modelPath: over.modelPath ?? `custom-characters/${id}/model.glb`,
    portraitPath: over.portraitPath ?? `custom-characters/${id}/portrait.jpg`,
    visibility: over.visibility ?? "private",
    createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
  dbmod.createCustomCharacter(rec);
  return id;
}

describe("character-resolver", () => {
  let ctx: { resolver: ResolverModule; dbmod: DbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadResolver();
  });

  afterAll(() => {
    try {
      ctx.dbmod.db.close();
    } catch {
      // 已关闭可忽略
    }
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 下偶发句柄延迟释放，忽略
    }
    delete process.env.DB_PATH;
  });

  it("预置名人：elon-musk 解析为 isCustom=false，name=马斯克，资源为原路径", () => {
    const r = ctx.resolver.resolveCharacter("elon-musk");
    expect(r).toBeDefined();
    expect(r!.isCustom).toBe(false);
    expect(r!.id).toBe("elon-musk");
    expect(r!.name).toBe("马斯克");
    // 名人路径原样返回，不做 /api/custom-characters/assets/ 转换
    expect(r!.portrait).toBe("/portraits/elon-musk.png");
    expect(r!.model).toBe("/models/celebrities/elon-musk.glb");
    expect(r!.field).toBe("科技");
    expect(r!.era).toBeTruthy();
  });

  it("自定义人物：custom- 前缀命中临时库，isCustom=true，资源路径被改写为 /api/custom-characters/assets/", () => {
    const id = seedCustom(ctx.dbmod, {
      id: "custom-xxx",
      name: "我的分身",
      modelPath: "custom-characters/custom-xxx/model.glb",
      portraitPath: "custom-characters/custom-xxx/portrait.jpg",
    });
    const r = ctx.resolver.resolveCharacter(id);
    expect(r).toBeDefined();
    expect(r!.isCustom).toBe(true);
    expect(r!.id).toBe("custom-xxx");
    expect(r!.name).toBe("我的分身");
    expect(r!.persona).toBe("你是一个测试分身。");
    // 相对存储路径 → 可直接访问的静态资源 URL（basename 取文件名）
    expect(r!.portrait).toBe("/api/custom-characters/assets/custom-xxx/portrait.jpg");
    expect(r!.model).toBe("/api/custom-characters/assets/custom-xxx/model.glb");
    // 自定义人物没有 field/era
    expect(r!.field).toBeUndefined();
    expect(r!.era).toBeUndefined();
  });

  it("未知 ref：既非预置名人也不存在于自定义表，返回 undefined", () => {
    expect(ctx.resolver.resolveCharacter("no-such-celeb")).toBeUndefined();
  });

  it("空字符串 ref：返回 undefined", () => {
    expect(ctx.resolver.resolveCharacter("")).toBeUndefined();
  });

  it("custom- 前缀但库里不存在：返回 undefined（不抛错）", () => {
    expect(ctx.resolver.resolveCharacter("custom-not-in-db")).toBeUndefined();
  });

  it("resolveCharacters：批量解析，过滤 undefined，保持原顺序", () => {
    const c1 = seedCustom(ctx.dbmod, { id: "custom-a" });
    const c2 = seedCustom(ctx.dbmod, { id: "custom-b" });
    const list = ctx.resolver.resolveCharacters([
      "elon-musk",
      c1,
      "totally-bogus",
      "steve-jobs",
      c2,
    ]);
    // 过滤掉 totally-bogus，共 4 个，顺序与输入中非 undefined 项一致
    expect(list.length).toBe(4);
    expect(list.map((c) => c.id)).toEqual(["elon-musk", c1, "steve-jobs", c2]);
    expect(list.every((c) => Boolean(c.name))).toBe(true);
  });

  it("resolveCharacters：全为空/未知输入返回空数组", () => {
    expect(ctx.resolver.resolveCharacters([])).toEqual([]);
    expect(ctx.resolver.resolveCharacters(["nope", "custom-missing"])).toEqual([]);
  });
});
