// ===== bench-orchestrator 测试：合议庭流程 / 事件序列 / 投票统计，全部 mock LLM =====
import { describe, expect, it, vi } from "vitest";
import type { BenchEvent, BenchInteraction, Verdict } from "@balabala/shared";
import {
  runBenchTrial,
  recommendCelebrities,
  type ChatFn,
  type RunBenchOpts,
} from "./bench-orchestrator.js";

const VERDICT_FIXTURE: Verdict = {
  caseNo: "(2026)Mock刑1号",
  title: "模拟判决",
  charge: "测试罪名",
  sentence: "测试量刑",
  facts: "测试事实",
  plaintiffClaim: "测试诉求",
  defense: "测试答辩",
  judgeNote: "测试寄语",
  quote: "测试金句",
};

function fallbackVerdict(input: string): Verdict {
  return { ...VERDICT_FIXTURE, caseNo: "FALLBACK", title: `兜底-${input.slice(0, 6)}` };
}

/** 按调用上下文返回不同 mock 文本的 chat。 */
function makeMockChat(overrides?: { verdict?: string; throwOn?: RegExp }): ChatFn {
  return vi.fn(async (messages) => {
    const sys = messages[0]?.content ?? "";
    if (overrides?.throwOn && overrides.throwOn.test(sys)) {
      throw new Error("LLM 网络错误");
    }
    if (sys.includes("只返回合法 JSON")) {
      return overrides?.verdict ?? JSON.stringify(VERDICT_FIXTURE);
    }
    if (sys.includes("合议庭调度官")) {
      return JSON.stringify({ ids: ["elon-musk", "steve-jobs", "alan-turing"] });
    }
    if (sys.includes("AI 法官")) {
      return "归纳：双方观点已记录在案。";
    }
    return "这是一段由 mock 模型生成的合议庭发言。";
  });
}

interface Harness {
  events: BenchEvent[];
  opts: RunBenchOpts;
  chat: ChatFn;
}

function makeOpts(partial: Partial<RunBenchOpts> = {}): Harness {
  const events: BenchEvent[] = [];
  const queue: BenchInteraction[] = [];
  const chat = makeMockChat();
  const opts: RunBenchOpts = {
    caseId: "case-1",
    input: "邻居半夜装修扰民",
    celebrityIds: ["elon-musk", "steve-jobs", "alan-turing"],
    perspective: "plaintiff",
    benchSize: 3,
    chat,
    fallbackVerdict,
    onEvent: (e) => events.push(e),
    getPendingInteractions: () => queue,
    markInteractionHandled: vi.fn(),
    ...partial,
  };
  // 允许 partial 覆盖 chat。
  return { events, opts, chat: opts.chat as ChatFn };
}

describe("bench 合议庭流程", () => {
  it("按 forming -> opening -> debate -> summary -> verdict 顺序发射 stage 事件", async () => {
    const h = makeOpts();
    await runBenchTrial(h.opts);
    const stages = h.events.filter((e) => e.type === "stage").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["forming", "opening", "debate", "summary", "verdict"]);
  });

  it("bench_members 事件携带 3 名评委，立场按 plaintiff/defendant/neutral 轮转", async () => {
    const h = makeOpts();
    await runBenchTrial(h.opts);
    const membersEvent = h.events.find((e) => e.type === "bench_members") as
      | { type: "bench_members"; members: Array<{ celebrityId: string; stance: string }> }
      | undefined;
    expect(membersEvent).toBeDefined();
    expect(membersEvent!.members.length).toBe(3);
    expect(membersEvent!.members.map((m) => m.stance)).toEqual(["plaintiff", "defendant", "neutral"]);
  });

  it("发言事件数量：3 开场 + 2 轮辩论×3 + 1 法官归纳 = 10 段", async () => {
    const h = makeOpts();
    await runBenchTrial(h.opts);
    const speeches = h.events.filter((e) => e.type === "speech");
    expect(speeches.length).toBe(10);
  });

  it("verdict 事件与返回值一致，使用 LLM 返回的判决", async () => {
    const h = makeOpts();
    const ret = await runBenchTrial(h.opts);
    const verdictEvent = h.events.find((e) => e.type === "verdict") as
      | { type: "verdict"; verdict: Verdict }
      | undefined;
    expect(verdictEvent).toBeDefined();
    expect(verdictEvent!.verdict.caseNo).toBe(VERDICT_FIXTURE.caseNo);
    expect(ret.verdict.title).toBe(VERDICT_FIXTURE.title);
    expect(ret.members.length).toBe(3);
  });

  it("用户投票互动：2 原告 + 1 被告，票数正确累加并广播 vote_update", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const h = makeOpts();
    // 模拟真实队列：markInteractionHandled 后从队列移除，避免每轮重复消费。
    const queue: BenchInteraction[] = [
      { id: "v1", kind: "vote", vote: "plaintiff", perspective: "plaintiff", createdAt: now },
      { id: "v2", kind: "vote", vote: "plaintiff", perspective: "plaintiff", createdAt: now },
      { id: "v3", kind: "vote", vote: "defendant", perspective: "plaintiff", createdAt: now },
    ];
    h.opts.getPendingInteractions = () => [...queue];
    h.opts.markInteractionHandled = (id: string) => {
      const i = queue.findIndex((x) => x.id === id);
      if (i >= 0) queue.splice(i, 1);
    };
    const ret = await runBenchTrial(h.opts);
    expect(ret.votes).toEqual({ plaintiff: 2, defendant: 1 });
    const updates = h.events.filter((e) => e.type === "vote_update");
    expect(updates.length).toBe(3);
    // 每条投票互动都被标记为已处理。
    expect(h.opts.getPendingInteractions().length).toBe(0);
  });

  it("提问 / 证据互动被消费且不中断庭审流程", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const h = makeOpts();
    h.opts.getPendingInteractions = () => [
      { id: "q1", kind: "question", text: "法官请问装修时间？", perspective: "audience", createdAt: now },
      { id: "e1", kind: "evidence", evidenceName: "噪音录音.mp3", perspective: "audience", createdAt: now },
    ];
    const ret = await runBenchTrial(h.opts);
    expect(ret.verdict.caseNo).toBe(VERDICT_FIXTURE.caseNo);
    expect(h.opts.markInteractionHandled).toHaveBeenCalledWith("q1");
    expect(h.opts.markInteractionHandled).toHaveBeenCalledWith("e1");
  });

  it("判决 LLM 返回非法 JSON 时，兜底为 fallbackVerdict", async () => {
    const h = makeOpts({ chat: makeMockChat({ verdict: "这不是 JSON 哦" }) });
    const ret = await runBenchTrial(h.opts);
    expect(ret.verdict.caseNo).toBe("FALLBACK");
    expect(ret.verdict.title).toContain("兜底");
  });
});

describe("bench 名人推荐", () => {
  it("chat 正常返回 ids 时返回 AI 推荐的评委", async () => {
    const chat = makeMockChat();
    const ids = await recommendCelebrities("测试案件", 3, chat);
    expect(ids).toEqual(["elon-musk", "steve-jobs", "alan-turing"]);
  });

  it("chat 抛错时走领域轮转兜底，仍返回 count 个有效名人 id", async () => {
    const chat = (async () => {
      throw new Error("网络挂了");
    }) as unknown as ChatFn;
    const ids = await recommendCelebrities("测试案件", 3, chat);
    expect(ids.length).toBe(3);
    // 兜底 id 必须都是真实存在的名人。
    const { getCelebrity } = await import("@balabala/shared");
    for (const id of ids) expect(getCelebrity(id)).toBeDefined();
  });
});
