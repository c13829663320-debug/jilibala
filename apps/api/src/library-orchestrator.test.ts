// ===== 知识擂台 · 后端测试：题目生成 / 计分 / AI 抢答模拟 =====
import { describe, expect, it } from "vitest";
import {
  type QuizDomain,
  playerScoreDelta,
  nextCombo,
  celebBuzzAccuracy,
  planBuzzes,
  rankPlayers,
  tierForRank,
  validateQuizQuestion,
  QUIZ_DOMAINS,
} from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";
import { generateQuizQuestions } from "./library-orchestrator.js";
import { QUIZ_FALLBACK_BANK } from "./library-quiz-fallback.js";

const okChatReturning = (obj: unknown): ChatFn => async () => JSON.stringify(obj);
const throwChat: ChatFn = async () => { throw new Error("LLM 挂了"); };

const makeLlmQuestions = (count: number) => ({
  questions: Array.from({ length: count }, (_, i) => ({
    prompt: `测试题 ${i + 1}`,
    options: ["甲", "乙", "丙", "丁"],
    correctIndex: i % 4,
    explanation: `解析 ${i + 1}`,
  })),
});

describe("本地兜底题库", () => {
  it("每个领域都至少 15 道合法题（4 选项、correctIndex 在 0-3）", () => {
    for (const { id } of QUIZ_DOMAINS) {
      const bank = QUIZ_FALLBACK_BANK[id as QuizDomain];
      expect(bank.length, `${id} 题库数量`).toBeGreaterThanOrEqual(15);
      for (const q of bank) {
        expect(q.prompt.length).toBeGreaterThan(0);
        expect(q.options.length).toBe(4);
        expect(q.options.every((o) => o.length > 0)).toBe(true);
        expect(q.correctIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex).toBeLessThanOrEqual(3);
      }
    }
  });

  it("validateQuizQuestion 拒绝非法结构", () => {
    expect(validateQuizQuestion({ prompt: "x", options: ["a", "b", "c"], correctIndex: 0 })).toBeNull();
    expect(validateQuizQuestion({ prompt: "x", options: ["a", "b", "c", "d"], correctIndex: 9 })).toBeNull();
    expect(validateQuizQuestion({ options: ["a", "b", "c", "d"], correctIndex: 0 })).toBeNull();
    expect(validateQuizQuestion({ prompt: "x", options: ["a", "b", "c", "d"], correctIndex: 1 })).not.toBeNull();
  });
});

describe("generateQuizQuestions", () => {
  it("LLM 返回合法 JSON 时直接采用，source=llm", async () => {
    const res = await generateQuizQuestions("literature", 8, okChatReturning(makeLlmQuestions(8)));
    expect(res.source).toBe("llm");
    expect(res.questions.length).toBe(8);
    expect(res.questions[0].prompt).toBe("测试题 1");
  });

  it("LLM 抛错时回退本地题库，source=fallback", async () => {
    const res = await generateQuizQuestions("science", 8, throwChat);
    expect(res.source).toBe("fallback");
    expect(res.questions.length).toBe(8);
    expect(QUIZ_FALLBACK_BANK.science.map((q) => q.prompt)).toContain(res.questions[0].prompt);
  });

  it("LLM 返回乱码 JSON 时回退兜底", async () => {
    const res = await generateQuizQuestions("history", 8, okChatReturning("完全不是JSON哈"));
    expect(res.source).toBe("fallback");
    expect(res.questions.length).toBe(8);
  });

  it("LLM 题目数量不足时回退兜底", async () => {
    const res = await generateQuizQuestions("art", 8, okChatReturning(makeLlmQuestions(2)));
    expect(res.source).toBe("fallback");
    expect(res.questions.length).toBe(8);
  });
});

describe("计分规则", () => {
  it("combo<3 答对得 100；combo>=3 答对翻倍得 200", () => {
    expect(playerScoreDelta(0)).toBe(100);
    expect(playerScoreDelta(1)).toBe(100);
    expect(playerScoreDelta(2)).toBe(100);
    expect(playerScoreDelta(3)).toBe(200);
    expect(playerScoreDelta(5)).toBe(200);
  });

  it("nextCombo：答对累加，答错归零", () => {
    expect(nextCombo(2, true)).toBe(3);
    expect(nextCombo(3, true)).toBe(4);
    expect(nextCombo(4, false)).toBe(0);
  });
});

describe("AI 抢答模拟", () => {
  it("主场名人正确率 0.85，客场 0.55", () => {
    expect(celebBuzzAccuracy("文学", "literature")).toBe(0.85);
    expect(celebBuzzAccuracy("科学", "literature")).toBe(0.55);
    expect(celebBuzzAccuracy(undefined, "literature")).toBe(0.55);
  });

  it("planBuzzes：rand 偏小时 AI 答对 +50，atMs 在 2-8 秒", () => {
    const buzzes = planBuzzes(
      "literature",
      [
        { id: "lu-xun", field: "文学" },
        { id: "einstein", field: "科学" },
      ],
      () => 0.1,
    );
    expect(buzzes.length).toBeGreaterThanOrEqual(1);
    expect(buzzes.length).toBeLessThanOrEqual(2);
    for (const b of buzzes) {
      expect(b.atMs).toBeGreaterThanOrEqual(2000);
      expect(b.atMs).toBeLessThanOrEqual(8000);
      expect(b.correct).toBe(true);
      expect(b.delta).toBe(50);
    }
  });

  it("planBuzzes：rand 恒大时 AI 答错，delta=-20", () => {
    const buzzes = planBuzzes(
      "science",
      [{ id: "newton", field: "科学" }],
      () => 0.99,
    );
    expect(buzzes.length).toBe(1);
    expect(buzzes[0].correct).toBe(false);
    expect(buzzes[0].delta).toBe(-20);
  });
});

describe("排名与段位", () => {
  it("rankPlayers 按分数降序并赋名次", () => {
    const ranked = rankPlayers([
      { id: "you", name: "我", score: 300, isCeleb: false },
      { id: "lu", name: "鲁迅", score: 500, isCeleb: true },
      { id: "li", name: "李白", score: 400, isCeleb: true },
    ]);
    expect(ranked[0].id).toBe("lu");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[2].id).toBe("you");
    expect(ranked[2].rank).toBe(3);
  });

  it("段位：第1名宗师，第2名学霸，其余门外汉", () => {
    expect(tierForRank(1)).toBe("宗师");
    expect(tierForRank(2)).toBe("学霸");
    expect(tierForRank(3)).toBe("门外汉");
    expect(tierForRank(4)).toBe("门外汉");
  });
});
