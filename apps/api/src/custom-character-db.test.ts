// ===== M12: custom_characters DAO 测试 =====
// 沿用 db.test.ts 的隔离模式：每个 describe 用独立临时 SQLite 文件，
// import 前设置 process.env.DB_PATH + vi.resetModules()，再动态 import。
// 禁止真实网络，所有数据都落在临时库。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCharacterRecord } from "./db.js";
import { parseSuggestedQuestions } from "./custom-character-routes.js";

type DbModule = typeof import("./db.js");

async function loadDb(): Promise<{ mod: DbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-db-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./db.js");
  return { mod, dir };
}

/** 构造一条合法的自定义人物记录；createdAt 与 updatedAt 默认相同，便于排序断言。 */
function makeRecord(
  userId: string,
  over: Partial<CustomCharacterRecord> = {},
): CustomCharacterRecord {
  const now = over.createdAt ?? over.updatedAt ?? "2026-01-01T00:00:00.000Z";
  return {
    id: `custom-${randomUUID()}`,
    userId,
    name: "我的分身",
    title: "分身标题",
    intro: "一句话简介",
    tags: ["科技", "AI"],
    persona: "你是一个测试用自定义人物。",
    greeting: "你好呀。",
    modelPath: `custom-characters/custom-x/model.glb`,
    portraitPath: `custom-characters/custom-x/portrait.jpg`,
    visibility: "private",
    createdAt: now,
    updatedAt: over.updatedAt ?? now,
    ...over,
  };
}

describe("custom_characters DAO", () => {
  let ctx: { mod: DbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadDb();
  });

  afterAll(() => {
    try {
      ctx.mod.db.close();
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

  it("createCustomCharacter：创建后可回读，id 以 custom- 开头，默认 visibility=private", () => {
    const rec = makeRecord("user-a");
    rec.visibility = "private";
    ctx.mod.createCustomCharacter(rec);
    const got = ctx.mod.getCustomCharacter(rec.id);
    expect(got).toBeDefined();
    expect(got!.id).toMatch(/^custom-/);
    expect(got!.name).toBe("我的分身");
    expect(got!.persona).toBe("你是一个测试用自定义人物。");
    expect(got!.visibility).toBe("private");
  });

  it("getCustomCharacter：不存在的 id 返回 undefined", () => {
    expect(ctx.mod.getCustomCharacter("custom-no-such")).toBeUndefined();
  });

  it("updateCustomCharacter：更新 name/persona/visibility 后字段变化", () => {
    const rec = makeRecord("user-a");
    ctx.mod.createCustomCharacter(rec);
    const updated = ctx.mod.updateCustomCharacter(rec.id, {
      name: "新名字",
      persona: "新的人格设定",
      visibility: "public",
    });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("新名字");
    expect(updated!.persona).toBe("新的人格设定");
    expect(updated!.visibility).toBe("public");
    // 回读确认落库
    const got = ctx.mod.getCustomCharacter(rec.id);
    expect(got!.name).toBe("新名字");
    expect(got!.visibility).toBe("public");
    // id/createdAt 不被篡改
    expect(got!.id).toBe(rec.id);
    expect(got!.createdAt).toBe(rec.createdAt);
  });

  it("updateCustomCharacter：更新不存在的 id 返回 undefined", () => {
    expect(
      ctx.mod.updateCustomCharacter("custom-no-such", { name: "x" }),
    ).toBeUndefined();
  });

  it("deleteCustomCharacter：删除后 getCustomCharacter 返回 undefined", () => {
    const rec = makeRecord("user-a");
    ctx.mod.createCustomCharacter(rec);
    expect(ctx.mod.getCustomCharacter(rec.id)).toBeDefined();
    ctx.mod.deleteCustomCharacter(rec.id);
    expect(ctx.mod.getCustomCharacter(rec.id)).toBeUndefined();
  });

  it("getCustomCharactersByUser：只返回该用户的人物，按时间倒序", () => {
    const older = makeRecord("user-a", { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeRecord("user-a", { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
    ctx.mod.createCustomCharacter(older);
    ctx.mod.createCustomCharacter(newer);
    const list = ctx.mod.getCustomCharactersByUser("user-a");
    expect(list.length).toBe(2);
    // 倒序：新的在前
    expect(list[0].id).toBe(newer.id);
    expect(list[1].id).toBe(older.id);
  });

  it("getPublicCustomCharacters：只返回 visibility=public 的人物", () => {
    const priv = makeRecord("user-a", { visibility: "private" });
    const pub = makeRecord("user-a", { visibility: "public" });
    ctx.mod.createCustomCharacter(priv);
    ctx.mod.createCustomCharacter(pub);
    const list = ctx.mod.getPublicCustomCharacters();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(pub.id);
    expect(list[0].visibility).toBe("public");
  });

  it("多用户隔离：用户 A 的人物不出现在用户 B 的列表中", () => {
    const a = makeRecord("user-a");
    const b = makeRecord("user-b");
    ctx.mod.createCustomCharacter(a);
    ctx.mod.createCustomCharacter(b);
    const listB = ctx.mod.getCustomCharactersByUser("user-b");
    expect(listB.length).toBe(1);
    expect(listB[0].id).toBe(b.id);
    // 公开列表里 A 的 private 也不该出现
    const onlyA = makeRecord("user-a", { visibility: "private" });
    ctx.mod.createCustomCharacter(onlyA);
    expect(ctx.mod.getPublicCustomCharacters().length).toBe(0);
  });

  it("tags 字段：string[] 正确序列化/反序列化", () => {
    const rec = makeRecord("user-a", { tags: ["第一性原理", "火星", "颠覆"] });
    ctx.mod.createCustomCharacter(rec);
    const got = ctx.mod.getCustomCharacter(rec.id);
    expect(got!.tags).toEqual(["第一性原理", "火星", "颠覆"]);
  });

  it("tags 更新：updateCustomCharacter 传入新 tags 后覆盖", () => {
    const rec = makeRecord("user-a", { tags: ["旧"] });
    ctx.mod.createCustomCharacter(rec);
    ctx.mod.updateCustomCharacter(rec.id, { tags: ["新1", "新2"] });
    const got = ctx.mod.getCustomCharacter(rec.id);
    expect(got!.tags).toEqual(["新1", "新2"]);
  });

  it("可见性过滤：getCustomCharactersByUser 同时包含自己的 private 与 public", () => {
    const priv = makeRecord("user-a", { visibility: "private" });
    const pub = makeRecord("user-a", { visibility: "public" });
    ctx.mod.createCustomCharacter(priv);
    ctx.mod.createCustomCharacter(pub);
    const mine = ctx.mod.getCustomCharactersByUser("user-a");
    expect(mine.length).toBe(2);
    const vis = mine.map((c) => c.visibility).sort();
    expect(vis).toEqual(["private", "public"]);
  });
});

describe("parseSuggestedQuestions 纯函数", () => {
  it("解析 JSON 数组", () => {
    expect(parseSuggestedQuestions('["你如何看待第一性原理？", "为什么要去火星？", "电动车的瓶颈在哪？"]'))
      .toEqual(["你如何看待第一性原理？", "为什么要去火星？", "电动车的瓶颈在哪？"]);
  });

  it("容忍 markdown 代码块包裹", () => {
    const raw = '```json\n["你如何看待第一性原理？", "为什么坚持去火星？", "电动车的瓶颈在哪？"]\n```';
    expect(parseSuggestedQuestions(raw)).toEqual(["你如何看待第一性原理？", "为什么坚持去火星？", "电动车的瓶颈在哪？"]);
  });

  it("解析 {questions:[...]} 对象形态", () => {
    expect(parseSuggestedQuestions('{"questions": ["你最看重的做事原则是什么？", "能分享一个影响你的决定吗？", "对年轻人有什么忠告？"]}')).toEqual(["你最看重的做事原则是什么？", "能分享一个影响你的决定吗？", "对年轻人有什么忠告？"]);
  });

  it("解析编号纯文本行并去掉序号", () => {
    const raw = "1. 你是如何坚持理想的？\n2. 怎样面对人生的贬谪？\n3. 美食与写作有何共通？";
    expect(parseSuggestedQuestions(raw)).toEqual([
      "你是如何坚持理想的？",
      "怎样面对人生的贬谪？",
      "美食与写作有何共通？",
    ]);
  });

  it("去重、过滤过短项、最多取 3 条", () => {
    const raw = '["合适的问题一？", "合适的问题一？", "短", "合适的问题二？", "合适的问题三？", "第四个也该被截断？"]';
    const out = parseSuggestedQuestions(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("合适的问题一？");
    expect(out).not.toContain("短");
    expect(out).not.toContain("第四个也该被截断？");
  });

  it("空字符串返回空数组", () => {
    expect(parseSuggestedQuestions("")).toEqual([]);
    expect(parseSuggestedQuestions("   ")).toEqual([]);
  });
});