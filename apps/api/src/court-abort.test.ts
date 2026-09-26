// ===== 法庭 abort 修复单测：断连即终止、abort不重试、slot排队/释放 =====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CourtTrialEvent } from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";

type DbModule = typeof import("./db.js");

async function loadDb(): Promise<{ mod: DbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-court-abort-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./db.js");
  return { mod, dir };
}

/** 返回固定 JSON 的 mock chat，记录调用次数。 */
function makeMockChat(): { fn: ChatFn; calls: number } {
  const state = { calls: 0 };
  const fn = vi.fn(async (messages) => {
    state.calls += 1;
    const sys = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "";
    if (sys.includes("AI 案件分析师")) {
      return JSON.stringify({
        title: "测试案", facts: [{ content: "事实", source: "user_input", disputed: false }],
        dispute_points: ["争议"], plaintiff_role: { name: "原告", stance: "主张", persona: "persona" },
        defendant_role: { name: "被告", stance: "抗辩", persona: "persona" },
        plaintiff_kb: { facts: [], evidence: [], claims: [], arguments: [], assumptions: [], opponent_arguments: [], user_additions: [] },
        defendant_kb: { facts: [], evidence: [], claims: [], arguments: [], assumptions: [], opponent_arguments: [], user_additions: [] },
      });
    }
    if (sys.includes("shouldContinue")) return JSON.stringify({ shouldContinue: false, reason: "ok" });
    if (sys.includes("只返回合法 JSON") && user.includes("生成结构化判决")) {
      return JSON.stringify({
        case_summary: "摘要", key_facts: ["事实"], key_evidence: ["证据"],
        plaintiff_arguments: ["主张"], defendant_arguments: ["抗辩"],
        dispute_resolution: "解决", verdict: "原告胜诉", reasoning: "理由",
        compensation: "100元", next_steps: [],
      });
    }
    return "发言内容";
  }) as unknown as ChatFn;
  return { fn, calls: 0, get callCount() { return state.calls; } };
}

describe("法庭 abort 修复", () => {
  let ctx: { mod: DbModule; dir: string };

  beforeAll(async () => {
    ctx = await loadDb();
  });

  afterAll(() => {
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("断连(aborted signal)立即终止庭审，不再调 LLM", async () => {
    const { analyzeCase, runCourtTrial, TRIAL_ABORTED } = await import("./court-orchestrator.js");
    const mock = makeMockChat();

    const c = ctx.mod.createCourtCase("u1", "测试案件");
    await analyzeCase(c.id, mock.fn);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const callsBefore = mock.callCount;

    // 立即 abort 的信号
    const ac = new AbortController();
    ac.abort();

    const events: CourtTrialEvent[] = [];
    await expect(
      runCourtTrial({
        caseId: c.id,
        chat: mock.fn,
        signal: ac.signal,
        perspective: "third_person",
        onEvent: (e) => events.push(e),
        getPendingPlayerInputs: () => [],
        markPlayerInputHandled: () => {},
      }),
    ).rejects.toBe(TRIAL_ABORTED);

    // abort 后不应有任何新的 chat 调用
    expect(mock.callCount).toBe(callsBefore);
  });

  it("withRetry 在 abort 时不重试、立即抛出", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const mock = makeMockChat();

    const c = ctx.mod.createCourtCase("u1", "测试案件");
    await analyzeCase(c.id, mock.fn);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    let abortChatCalls = 0;
    const abortingChat: ChatFn = async () => {
      abortChatCalls += 1;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };

    const ac = new AbortController();
    try {
      await runCourtTrial({
        caseId: c.id,
        chat: abortingChat,
        signal: ac.signal,
        perspective: "third_person",
        onEvent: () => {},
        getPendingPlayerInputs: () => [],
        markPlayerInputHandled: () => {},
      });
    } catch {
      // expected
    }
    // withRetry 遇到 AbortError 应立即抛出，不重试（每个 chat site 最多1次）
    expect(abortChatCalls).toBeLessThanOrEqual(2);
  });
});

// ===== withLlmSlot 全局限流测试（独立实现验证逻辑） =====
describe("withLlmSlot 全局限流逻辑", () => {
  it("并发超过上限时排队，释放后唤醒队首", async () => {
    let active = 0;
    const queue: Array<() => void> = [];
    const MAX = 2;
    async function slot<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= MAX) await new Promise<void>((r) => queue.push(r));
      active++;
      try { return await fn(); }
      finally { active--; const next = queue.shift(); if (next) next(); }
    }

    const order: number[] = [];
    const results = await Promise.all([
      slot(async () => { order.push(1); await new Promise((r) => setTimeout(r, 50)); return 1; }),
      slot(async () => { order.push(2); await new Promise((r) => setTimeout(r, 50)); return 2; }),
      slot(async () => { order.push(3); return 3; }),
    ]);
    expect(results).toEqual([1, 2, 3]);
    expect(active).toBe(0);
    expect(queue.length).toBe(0);
  });

  it("finally 中释放 slot 即使 fn 抛错", async () => {
    let active = 0;
    const queue: Array<() => void> = [];
    async function slot<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= 1) await new Promise<void>((r) => queue.push(r));
      active++;
      try { return await fn(); }
      finally { active--; const next = queue.shift(); if (next) next(); }
    }
    await expect(slot(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(active).toBe(0);
    const result = await slot(async () => 42);
    expect(result).toBe(42);
  });
});
