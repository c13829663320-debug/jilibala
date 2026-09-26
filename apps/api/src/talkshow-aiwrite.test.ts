// ===== 功能闭环：脱口秀 AI 帮写段子 =====
// 后端 /api/talkshow/ai-write 对应的纯逻辑：成功返回 LLM 文本，失败用兜底段子，永不 reject。
import { describe, expect, it } from "vitest";
import { aiWriteJoke } from "./talkshow-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

describe("aiWriteJoke", () => {
  it("LLM 可用时返回清洗后的段子文本", async () => {
    const chat: ChatFn = async () => "「周一早会比周一早上的地铁还挤，老板一开口我就开始怀念周末。」";
    const joke = await aiWriteJoke("职场吐槽", "轻松自嘲", chat);
    expect(joke.length).toBeGreaterThan(0);
    // 剥掉了首尾引号。
    expect(joke.startsWith("「")).toBe(false);
  });

  it("LLM 抛错时回退到本地兜底段子（包含主题，不 reject）", async () => {
    const chat: ChatFn = async () => { throw new Error("LLM down"); };
    const joke = await aiWriteJoke("相亲现场", "尴尬自嘲", chat);
    expect(typeof joke).toBe("string");
    expect(joke.length).toBeGreaterThan(5);
    // 兜底段子回显主题。
    expect(joke).toContain("相亲现场");
  });

  it("主题/风格缺失时使用默认值，仍能产出非空段子", async () => {
    const chat: ChatFn = async () => "默认主题下的一段兜底。";
    const joke = await aiWriteJoke("", "", chat);
    expect(joke.length).toBeGreaterThan(0);
  });
});
