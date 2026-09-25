// ===== talkshow-orchestrator 测试：开放麦主循环 =====
import { describe, expect, it } from "vitest";
import {
  computeOpenMicTier,
  scorePlayerJoke,
  createOpenMicSession,
} from "./talkshow-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

/** 按 system 提示词分发的 mock chat。 */
const makeChat = (handler: (system: string) => string): ChatFn =>
  async (messages) => {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    return handler(sys);
  };

describe("computeOpenMicTier 段位阈值", () => {
  it("平均分 <30 判冷场", () => {
    expect(computeOpenMicTier(10).tier).toBe("冷场");
    expect(computeOpenMicTier(29).tier).toBe("冷场");
  });
  it("平均分 30-60 判尚可", () => {
    expect(computeOpenMicTier(30).tier).toBe("尚可");
    expect(computeOpenMicTier(45).tier).toBe("尚可");
    expect(computeOpenMicTier(59).tier).toBe("尚可");
  });
  it("平均分 60-85 判炸场", () => {
    expect(computeOpenMicTier(60).tier).toBe("炸场");
    expect(computeOpenMicTier(85).tier).toBe("炸场");
  });
  it("平均分 >85 判今日之星", () => {
    expect(computeOpenMicTier(86).tier).toBe("今日之星");
    expect(computeOpenMicTier(100).tier).toBe("今日之星");
  });
});

describe("scorePlayerJoke 观众评分", () => {
  it("解析 LLM 返回的 score/reaction/comment", async () => {
    const chat = makeChat(() =>
      JSON.stringify({ score: 72, reaction: "mixed", comment: "前半段不错" }),
    );
    const r = await scorePlayerJoke("今天去面试，HR 问我最大的缺点，我说太诚实。", chat);
    expect(r.score).toBe(72);
    expect(r.reaction).toBe("mixed");
    expect(r.comment).toBe("前半段不错");
  });

  it("非法 reaction 时按分数回落档位", async () => {
    const chat = makeChat(() => JSON.stringify({ score: 10, reaction: "???" }));
    const r = await scorePlayerJoke("太冷了", chat);
    expect(r.reaction).toBe("silence");
  });

  it("LLM 失败时走兜底评分，流程不中断", async () => {
    const chat = async () => { throw new Error("boom"); };
    const r = await scorePlayerJoke("一个普通段子", chat);
    expect(r.score).toBeGreaterThanOrEqual(20);
    expect(r.score).toBeLessThanOrEqual(96);
    expect(typeof r.comment).toBe("string");
  });
});

describe("OpenMicSession 状态流转", () => {
  it("start → tellJoke×3 → finish：分数累积、段位结算", async () => {
    const chat = makeChat((sys) => {
      if (sys.includes("现场观众")) {
        return JSON.stringify({ score: 80, reaction: "applaud", comment: "响了" });
      }
      return JSON.stringify({ jokes: ["暖场段子一", "暖场段子二"] });
    });
    const session = createOpenMicSession(chat);

    const started = await session.start();
    expect(started.stage).toBe("performance");
    expect(started.warmupJokes.length).toBeGreaterThanOrEqual(1);
    expect(started.currentJokeIndex).toBe(0);

    const j1 = await session.tellJoke("段子一");
    expect(j1.result.score).toBe(80);
    expect(j1.state.currentJokeIndex).toBe(1);
    const j2 = await session.tellJoke("段子二");
    expect(j2.state.currentJokeIndex).toBe(2);
    const j3 = await session.tellJoke("段子三");
    expect(j3.state.currentJokeIndex).toBe(3);
    expect(j3.state.scores.length).toBe(3);

    const done = await session.finish();
    expect(done.average).toBe(80);
    expect(done.tier).toBe("炸场"); // 80 落在 60-85
    expect(done.state.stage).toBe("results");
    expect(done.state.jokes.length).toBe(3);
    expect(done.verdict.length).toBeGreaterThan(0);
  });

  it("未讲完就 finish 抛错；讲完后再讲抛错", async () => {
    const chat = makeChat((sys) =>
      sys.includes("现场观众")
        ? JSON.stringify({ score: 50, reaction: "mixed", comment: "一般" })
        : JSON.stringify({ jokes: ["暖场"] }),
    );
    const session = createOpenMicSession(chat);
    await session.start();
    await expect(session.finish()).rejects.toThrow();
    await session.tellJoke("a");
    await session.tellJoke("b");
    await session.tellJoke("c");
    await expect(session.tellJoke("d")).rejects.toThrow();
  });
});
