// ===== 分片6: 统一人物档案层测试 =====
// 纯函数（搜索/筛选/分页/标签聚合）用手写 list 直接测；
// buildUnifiedProfiles 走 DB 隔离模式（临时 SQLite）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterProfile } from "@balabala/shared";

import {
  searchUnified,
  filterByTag,
  filterBySource,
  paginate,
  collectTags,
  resolveUnifiedProfile,
} from "./character-unified.js";

function makeProfile(over: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: over.id ?? `c-${randomUUID()}`,
    name: over.name ?? "测试人物",
    title: over.title ?? "头衔",
    intro: over.intro ?? "简介",
    tags: over.tags ?? ["科技"],
    portrait: over.portrait ?? "/portraits/x.png",
    source: over.source ?? "celebrity",
    followers: over.followers ?? 0,
    ...over,
  };
}

describe("character-unified 纯函数", () => {
  const list: CharacterProfile[] = [
    makeProfile({ id: "a", name: "马斯克", title: "连续创业者", intro: "火星电动车", tags: ["火星", "颠覆"], source: "celebrity", followers: 10 }),
    makeProfile({ id: "b", name: "我的分身", title: "测试分身", intro: "一个 AI", tags: ["AI"], source: "custom", followers: 2 }),
    makeProfile({ id: "c", name: "李白", title: "诗人", intro: "浪漫主义", tags: ["诗歌", "唐代"], source: "celebrity", followers: 5 }),
  ];

  it("searchUnified：按 name/title/intro/tags 不区分大小写匹配", () => {
    expect(searchUnified(list, "火星").map((c) => c.id)).toEqual(["a"]);
    expect(searchUnified(list, "ai").map((c) => c.id)).toEqual(["b"]);
    expect(searchUnified(list, "诗人").map((c) => c.id)).toEqual(["c"]);
    expect(searchUnified(list, "")).toHaveLength(3);
    expect(searchUnified(list, "不存在")).toHaveLength(0);
  });

  it("filterByTag：按标签精确匹配", () => {
    expect(filterByTag(list, "火星").map((c) => c.id)).toEqual(["a"]);
    expect(filterByTag(list, "唐代").map((c) => c.id)).toEqual(["c"]);
    expect(filterByTag(list, "")).toHaveLength(3);
  });

  it("filterBySource：all/celebrity/custom", () => {
    expect(filterBySource(list, "all")).toHaveLength(3);
    expect(filterBySource(list, "celebrity")).toHaveLength(2);
    expect(filterBySource(list, "custom")).toHaveLength(1);
  });

  it("paginate：分页正确，边界兜底", () => {
    const r1 = paginate(list, 1, 2);
    expect(r1.total).toBe(3);
    expect(r1.items.map((c) => c.id)).toEqual(["a", "b"]);
    const r2 = paginate(list, 2, 2);
    expect(r2.items.map((c) => c.id)).toEqual(["c"]);
    // 非法 page/limit 兜底
    const r0 = paginate(list, 0, -5);
    expect(r0.page).toBe(1);
    expect(r0.limit).toBe(20);
    expect(r0.items.length).toBe(3);
  });

  it("collectTags：标签计数并按热度倒序", () => {
    const tags = collectTags(list);
    expect(tags.find((t) => t.tag === "火星")?.count).toBe(1);
    // 全部标签应出现：火星/颠覆/AI/诗歌/唐代 = 5 个
    expect(tags.length).toBe(5);
  });
});

describe("character-unified DB 集成", () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "balabala-unified-"));
    process.env.DB_PATH = join(dir, "test.db");
    vi.resetModules();
    const db = await import("./db.js");
    const { buildUnifiedProfiles, resolveUnifiedProfile } = await import("./character-unified.js");
    ctx = { db, buildUnifiedProfiles, resolveUnifiedProfile };
  });

  afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.DB_PATH;
  });

  it("buildUnifiedProfiles：包含全部名人 + 公开自定义人物，不含私有", () => {
    // 先建一个公开、一个私有自定义人物
    const now = new Date().toISOString();
    ctx.db.createCustomCharacter({
      id: "custom-pub", userId: "u-owner", name: "公开分身", title: "", intro: "",
      tags: ["公开"], persona: "p", greeting: "", modelPath: "", portraitPath: "",
      visibility: "public", voice: "", skillMd: "", createdAt: now, updatedAt: now,
    });
    ctx.db.createCustomCharacter({
      id: "custom-priv", userId: "u-owner", name: "私有分身", title: "", intro: "",
      tags: ["私有"], persona: "p", greeting: "", modelPath: "", portraitPath: "",
      visibility: "private", voice: "", skillMd: "", createdAt: now, updatedAt: now,
    });

    const list = ctx.buildUnifiedProfiles({ followers: (id: string) => (id === "custom-pub" ? 7 : 0) });
    const ids = list.map((c: CharacterProfile) => c.id);
    // 名人全量（CELEBRITIES 非空）
    expect(ids.length).toBeGreaterThan(10);
    // 公开自定义人物出现
    const pub = list.find((c: CharacterProfile) => c.id === "custom-pub");
    expect(pub).toBeDefined();
    expect(pub.source).toBe("custom");
    expect(pub.followers).toBe(7);
    // 私有不出现
    expect(ids).not.toContain("custom-priv");
  });

  it("resolveUnifiedProfile：名人可解析；私有自定义仅 owner 可见", () => {
    const celeb = ctx.resolveUnifiedProfile("elon-musk");
    expect(celeb).toBeDefined();
    expect(celeb!.source).toBe("celebrity");

    const now = new Date().toISOString();
    ctx.db.createCustomCharacter({
      id: "custom-x", userId: "u-owner", name: "X", title: "", intro: "",
      tags: [], persona: "p", greeting: "", modelPath: "", portraitPath: "",
      visibility: "private", voice: "", skillMd: "", createdAt: now, updatedAt: now,
    });
    // 非 owner 不可见
    expect(ctx.resolveUnifiedProfile("custom-x", { viewerId: "u-stranger" })).toBeUndefined();
    // owner 可见
    expect(ctx.resolveUnifiedProfile("custom-x", { viewerId: "u-owner" })?.name).toBe("X");
    // 不存在的 id
    expect(ctx.resolveUnifiedProfile("nope")).toBeUndefined();
  });
});
