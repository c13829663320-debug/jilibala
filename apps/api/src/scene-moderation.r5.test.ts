// ===== R5 发布域：UGC 内容审核包装测试 =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type StoreMod = typeof import("./scene-store.js");

let store: StoreMod;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-ugc-mod-"));
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

describe("assessSceneModeration", () => {
  it("干净内容 → approved", () => {
    expect(store.assessSceneModeration("我的星空法庭", sceneData)).toBe("approved");
  });

  it("标题含敏感词 → pending_review", () => {
    expect(store.assessSceneModeration("傻逼大战", sceneData)).toBe("pending_review");
  });

  it("sceneData 内嵌描述含敏感词 → pending_review", () => {
    const dirty = { ...sceneData, description: "欢迎来到博彩网站乐园" };
    expect(store.assessSceneModeration("正常标题", dirty)).toBe("pending_review");
  });
});

describe("saveScene 接入审核", () => {
  it("命中敏感词时强制 pending_review 且不公开（即使请求 isPublic=true）", () => {
    const s = store.saveScene({ userId: "u1", name: "加微信约一起玩", sceneData, isPublic: true });
    expect(s.moderationStatus).toBe("pending_review");
    expect(s.isPublic).toBe(false);
  });

  it("干净内容正常公开", () => {
    const s = store.saveScene({ userId: "u1", name: "周末法庭局", sceneData, isPublic: true });
    expect(s.moderationStatus).toBe("approved");
    expect(s.isPublic).toBe(true);
  });
});
