// ===== 离线知识包 + 双 LLM 兜底 单测 =====
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { CELEBRITIES, getCelebrity } from "@balabala/shared";
import {
  loadOfflineBrain,
  matchOfflineReply,
  offlineFallbackReply,
  tokenize,
} from "./offline-brain.js";

// 离线脑是「双 LLM 全挂」时的可选兜底知识包，并非每位名人都必须手工编写。
// 这里只校验磁盘上实际存在的 JSON：文件能加载、结构合法、id 与文件名/名人一致。
const brainsDir = path.join(process.cwd(), "data", "offline-brains");
const brainFiles = readdirSync(brainsDir).filter((f) => f.endsWith(".json"));

describe("loadOfflineBrain · 加载", () => {
  it("磁盘上的离线脑 JSON 全部存在且结构合法", () => {
    expect(brainFiles.length).toBeGreaterThanOrEqual(20);
    for (const file of brainFiles) {
      const id = file.replace(/\.json$/, "");
      const brain = loadOfflineBrain(id);
      expect(brain, `离线脑缺失：${id}`).not.toBeNull();
      expect(brain!.id).toBe(id);
      // 脑 id 必须对应一位已注册名人
      expect(getCelebrity(id), `离线脑 ${id} 不在 CELEBRITIES 中`).toBeTruthy();
      expect(brain!.name).toBeTruthy();
      expect(brain!.persona.length).toBeGreaterThan(10);
      expect(Array.isArray(brain!.quotes)).toBe(true);
      expect(brain!.quotes.length).toBeGreaterThan(0);
      expect(Array.isArray(brain!.qa)).toBe(true);
      expect(brain!.qa.length).toBeGreaterThanOrEqual(10);
      for (const item of brain!.qa) {
        expect(typeof item.q).toBe("string");
        expect(typeof item.a).toBe("string");
        expect(item.q.length).toBeGreaterThan(0);
        expect(item.a.length).toBeGreaterThan(0);
      }
    }
  });

  it("没有离线脑 JSON 的名人：loadOfflineBrain 返回 null 而非抛错", () => {
    const noBrain = CELEBRITIES.find((c) => !brainFiles.includes(`${c.id}.json`));
    expect(noBrain, "应当存在未编写离线脑的名人").toBeTruthy();
    expect(loadOfflineBrain(noBrain!.id)).toBeNull();
  });

  it("未知 id 返回 null 而不是抛错", () => {
    expect(loadOfflineBrain("does-not-exist")).toBeNull();
  });

  it("路径穿越被过滤", () => {
    expect(loadOfflineBrain("../../../etc/passwd")).toBeNull();
  });
});

describe("tokenize · 分词", () => {
  it("中文二字组与英文词都能切出", () => {
    const tokens = tokenize("我喜欢月亮 elon");
    expect(tokens).toContain("月亮");
    expect(tokens).toContain("喜欢");
    expect(tokens).toContain("elon");
  });
});

describe("matchOfflineReply · 关键词匹配", () => {
  it("命中相关 QA 时返回该条回答", () => {
    const brain = loadOfflineBrain("li-bai")!;
    const reply = matchOfflineReply(brain, "一个人孤独怎么办");
    // li-bai 的「孤独」QA 答案里有「举杯邀明月」
    expect(reply).toContain("明月");
  });

  it("问巴菲特「复利」应命中复利相关回答", () => {
    const brain = loadOfflineBrain("warren-buffett")!;
    const reply = matchOfflineReply(brain, "什么是复利");
    expect(reply).toContain("复利");
  });

  it("完全无命中时退回 persona + 名言，不抛错", () => {
    const brain = loadOfflineBrain("laozi")!;
    const reply = matchOfflineReply(brain, "zzzqqq nonsense");
    expect(reply.length).toBeGreaterThan(5);
    // 无命中时至少应包含 persona 片段或一句名言
    expect(reply).toBeTruthy();
  });
});

describe("offlineFallbackReply · 降级链路（双 LLM 都挂）", () => {
  it("有名人上下文时回复带「（离线模式）」前缀", () => {
    const reply = offlineFallbackReply("elon-musk", "什么是第一性原理");
    expect(reply.startsWith("（离线模式）")).toBe(true);
  });

  it("离线脑缺失时仍返回友好提示，不抛错、不返回 502", () => {
    const reply = offlineFallbackReply("unknown-celebrity-xyz", "你好");
    expect(reply.startsWith("（离线模式）")).toBe(true);
    expect(reply.length).toBeGreaterThan(0);
  });

  it("所有 20 位名人在双失败时都能产出非空离线回复", () => {
    for (const celeb of CELEBRITIES) {
      const reply = offlineFallbackReply(celeb.id, "聊聊你自己");
      expect(reply, `${celeb.id} 离线回复为空`).toContain("（离线模式）");
      expect(reply.length).toBeGreaterThan(10);
    }
  });
});
