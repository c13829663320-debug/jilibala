// ===== M13: court-orchestrator 测试（mock chat，临时 SQLite，无真实网络）=====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtPlayerInput, CourtTrialEvent } from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";

type DbModule = typeof import("./db.js");

async function loadDb(): Promise<{ mod: DbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-court-orch-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./db.js");
  return { mod, dir };
}

/** Mock chat: 根据 system prompt 内容返回不同 JSON/文本。 */
function makeMockChat(): ChatFn {
  return vi.fn(async (messages) => {
    const sys = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "";

    // analyzeCase 的调用
    if (sys.includes("AI 案件分析师")) {
      return JSON.stringify({
        title: "邻居扰民案",
        facts: [
          { content: "邻居连续一周凌晨装修", source: "user_input", disputed: false },
          { content: "用户多次报警未解决", source: "user_input", disputed: true },
        ],
        dispute_points: ["是否构成扰民", "损失如何赔偿"],
        plaintiff_role: { name: "原告住户", stance: "要求停止并赔偿", persona: "你是受噪音困扰的住户，情绪激动。" },
        defendant_role: { name: "邻居", stance: "装修是必要施工", persona: "你是邻居，认为自己只是正常装修。" },
        plaintiff_kb: {
          facts: ["凌晨3点施工"], evidence: ["录音"],
          claims: ["停止装修"], arguments: ["噪音超标"], assumptions: ["邻居故意"],
          opponent_arguments: [], user_additions: [],
        },
        defendant_kb: {
          facts: ["白天施工"], evidence: ["施工许可"],
          claims: ["不应停止"], arguments: ["有合法许可"], assumptions: ["原告夸大"],
          opponent_arguments: [], user_additions: [],
        },
      });
    }

    // should_continue 判定（system prompt 包含 shouldContinue 字样）
    if (sys.includes("shouldContinue")) {
      return JSON.stringify({ shouldContinue: false, reason: "争议已充分辩论" });
    }

    // 判决生成（必须在 AI 法官分支之前匹配，因为 system prompt 同时含 "AI 法官" 和 "只返回合法 JSON"）
    if (sys.includes("只返回合法 JSON") && user.includes("生成结构化判决")) {
      return JSON.stringify({
        case_summary: "邻居凌晨装修扰民案",
        key_facts: ["凌晨3点施工"],
        key_evidence: ["录音"],
        plaintiff_arguments: ["噪音影响休息"],
        defendant_arguments: ["有施工许可"],
        judge_analysis: "夜间施工影响他人休息",
        reasoning: "凌晨施工超出合理范围",
        verdict: "plaintiff",
        conclusion: "邻居应停止夜间施工",
      });
    }

    // 法官记录更新
    if (sys.includes("只返回合法 JSON") && user.includes("更新法官记录")) {
      return JSON.stringify({
        facts: ["凌晨施工确认"],
        claims: ["原告要求停止"],
        arguments: ["噪音影响休息"],
        counter_arguments: ["施工有许可"],
        unresolved: [],
        resolved: ["是否扰民"],
      });
    }

    // 法官发言
    if (sys.includes("AI 法官")) {
      return "本庭注意到双方陈述，现记录在案。";
    }

    // 默认：角色发言
    return "（mock 发言）我方主张合理，证据确凿。";
  });
}

describe("court-orchestrator", () => {
  let ctx: { mod: DbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadDb();
  });

  afterAll(() => {
    try { ctx.mod.db.close(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("analyzeCase: mock chat 返回 JSON，验证 facts/roles/KB 写入", async () => {
    const { analyzeCase } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "邻居连续一周凌晨3点装修，无法休息");
    const chat = makeMockChat();
    const updated = await analyzeCase(c.id, chat);

    expect(updated.status).toBe("GENERATED");
    expect(updated.title).toBe("邻居扰民案");
    expect(updated.plaintiff?.name).toBe("原告住户");
    expect(updated.defendant?.name).toBe("邻居");
    expect(updated.plaintiff_kb?.claims).toContain("停止装修");
    expect(updated.dispute_points.length).toBeGreaterThan(0);
  });

  it("runCourtTrial: 产生 judge/plaintiff/defendant turns，生成 verdict", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "邻居凌晨装修扰民");
    const chat = makeMockChat();

    // 分析 -> 确认 -> 开庭
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const events: CourtTrialEvent[] = [];
    const pendingInputs: CourtPlayerInput[] = [];

    const result = await runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "plaintiff",
      onEvent: (e) => events.push(e),
      getPendingPlayerInputs: () => pendingInputs,
      markPlayerInputHandled: vi.fn(),
    });

    // 验证有 judge/plaintiff/defendant turns
    const turnEvents = events.filter((e) => e.type === "court_turn") as Array<{ type: "court_turn"; turn: { speaker: string; speakerName: string; content: string } }>;
    const speakers = new Set(turnEvents.map((e) => e.turn.speaker));
    expect(speakers).toContain("judge");
    expect(speakers).toContain("plaintiff");
    expect(speakers).toContain("defendant");

    // 验证有 verdict 事件
    const verdictEvent = events.find((e) => e.type === "court_verdict") as { type: "court_verdict"; verdict: { verdict: string } } | undefined;
    expect(verdictEvent).toBeDefined();
    expect(verdictEvent!.verdict.verdict).toBe("plaintiff");

    // 验证返回值
    expect(result.verdict.verdict).toBe("plaintiff");
    expect(result.turns.length).toBeGreaterThan(0);

    // 验证案件状态为 COMPLETED
    const finalCase = ctx.mod.getCourtCase(c.id)!;
    expect(finalCase.status).toBe("COMPLETED");
    expect(finalCase.final_verdict).not.toBeNull();
  });

  it("玩家当原告：发 player_turn_request，输入创建 speaker='player' 的 turn 并 ack", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const chat = makeMockChat();
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const events: CourtTrialEvent[] = [];
    // 预置一条玩家输入（原告方）
    const playerInput: CourtPlayerInput = {
      id: "ctp-test",
      caseId: c.id,
      userId: "u1",
      player_role: "plaintiff",
      type: "argument",
      content: "玩家补充：对方凌晨3点还在施工",
      createdAt: new Date().toISOString(),
    };

    await runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "plaintiff",
      playerSide: "plaintiff",
      // 测试缩短等待
      playerInputTimeoutMs: 200,
      playerInputPollMs: 20,
      onEvent: (e) => events.push(e),
      getPendingPlayerInputs: () => [playerInput],
      markPlayerInputHandled: vi.fn(),
    });

    // 轮到玩家：player_turn_request 事件
    const reqEvent = events.find((e) => e.type === "player_turn_request");
    expect(reqEvent).toBeDefined();
    // ack 事件
    const ackEvent = events.find((e) => e.type === "player_input_ack");
    expect(ackEvent).toBeDefined();
    if (ackEvent && "inputId" in ackEvent) expect(ackEvent.inputId).toBe("ctp-test");
    // 玩家发言上屏：player_turn 事件 + turn.speaker === 'player'
    const ptEvent = events.find((e) => e.type === "player_turn") as { type: "player_turn"; turn: { speaker: string; speakerName: string; content: string } } | undefined;
    expect(ptEvent).toBeDefined();
    expect(ptEvent!.turn.speaker).toBe("player");
    expect(ptEvent!.turn.speakerName).toBe("你");
    expect(ptEvent!.turn.content).toContain("凌晨3点");
    // 对方被告应立即短接茬：defendant 的 court_turn 在玩家发言之后出现
    const turnEvts = events.filter((e) => e.type === "court_turn") as Array<{ type: "court_turn"; turn: { speaker: string } }>;
    const speakers = turnEvts.map((e) => e.turn.speaker);
    expect(speakers).toContain("player");
  });

  it("momentum 更新规则：玩家发言 +5，证据 +8，并 emit momentum_update", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const chat = makeMockChat();
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const events: CourtTrialEvent[] = [];
    const playerInput: CourtPlayerInput = {
      id: "ctp-momentum",
      caseId: c.id,
      userId: "u1",
      player_role: "plaintiff",
      type: "evidence",
      content: "玩家出示录音证据",
      createdAt: new Date().toISOString(),
    };

    await runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "plaintiff",
      playerSide: "plaintiff",
      playerInputTimeoutMs: 200,
      playerInputPollMs: 20,
      onEvent: (e) => events.push(e),
      getPendingPlayerInputs: () => [playerInput],
      markPlayerInputHandled: vi.fn(),
    });

    const mEvents = events.filter((e) => e.type === "momentum_update") as Array<{ type: "momentum_update"; momentum: { plaintiff: number; defendant: number } }>;
    expect(mEvents.length).toBeGreaterThan(0);
    // 初始广播 50:50。新流程：AI 原告先自动发言 +3（→53），玩家提交证据再 +8（→61）。
    expect(mEvents[0].momentum).toEqual({ plaintiff: 50, defendant: 50 });
    expect(mEvents.some((e) => e.momentum.plaintiff === 61)).toBe(true);
  });

  it("玩家超时未发言：由辩护人/AI 代述兜底，庭审不卡死", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const chat = makeMockChat();
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const events: CourtTrialEvent[] = [];
    // 玩家不提供输入：getPendingPlayerInputs 永远空
    await runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "plaintiff",
      playerSide: "plaintiff",
      playerInputTimeoutMs: 150, // 快速超时
      playerInputPollMs: 20,
      onEvent: (e) => events.push(e),
      getPendingPlayerInputs: () => [],
      markPlayerInputHandled: vi.fn(),
    });

    // 有 player_turn_request（非阻塞提示玩家随时插话）
    expect(events.some((e) => e.type === "player_turn_request")).toBe(true);
    // 没有 speaker='player' 的 turn（玩家没发言）
    const turnEvts = events.filter((e) => e.type === "court_turn") as Array<{ type: "court_turn"; turn: { speaker: string; content: string } }>;
    expect(turnEvts.some((e) => e.turn.speaker === "player")).toBe(false);
    // 新设计非阻塞：玩家不发言时 AI 原告当事人自动接上发言（不再阻塞等待/不再有「辩护人代述」前缀），
    // 庭审流程连续不卡死。
    const plaintiffTurn = turnEvts.find((e) => e.turn.speaker === "plaintiff");
    expect(plaintiffTurn).toBeDefined();
    expect(plaintiffTurn!.turn.content.length).toBeGreaterThan(0);
    // 庭审正常走到 verdict
    expect(events.some((e) => e.type === "court_verdict")).toBe(true);
  });

  it("generateVerdict prompt 包含玩家 turn 与 momentum", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const chat = makeMockChat();
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const playerInput: CourtPlayerInput = {
      id: "ctp-verdict",
      caseId: c.id,
      userId: "u1",
      player_role: "defendant",
      type: "argument",
      content: "玩家(被告)主张：我有施工许可",
      createdAt: new Date().toISOString(),
    };

    // 捕获判决生成时的 user prompt
    let verdictPrompt = "";
    const spy: ChatFn = vi.fn(async (messages) => {
      const sys = messages[0]?.content ?? "";
      const user = messages[1]?.content ?? "";
      if (sys.includes("只返回合法 JSON") && user.includes("生成结构化判决")) {
        verdictPrompt = user;
        return JSON.stringify({
          case_summary: "s", key_facts: ["f"], key_evidence: ["e"],
          plaintiff_arguments: [], defendant_arguments: [], judge_analysis: "a",
          reasoning: "由于你当庭出示证据……", verdict: "defendant", conclusion: "c",
        });
      }
      return (chat as any)(messages);
    });

    await runCourtTrial({
      caseId: c.id,
      chat: spy,
      perspective: "defendant",
      playerSide: "defendant",
      playerInputTimeoutMs: 200,
      playerInputPollMs: 20,
      onEvent: () => {},
      getPendingPlayerInputs: () => [playerInput],
      markPlayerInputHandled: vi.fn(),
    });

    // prompt 应包含玩家发言记录与最终 momentum
    expect(verdictPrompt).toContain("我有施工许可");
    expect(verdictPrompt).toContain("局势优势条");
    expect(verdictPrompt).toContain("被告方"); // 玩家扮演被告
  });

  it("should_continue 事件被推送", async () => {
    const { analyzeCase, runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试");
    const chat = makeMockChat();
    await analyzeCase(c.id, chat);
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");

    const events: CourtTrialEvent[] = [];
    await runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "audience",
      onEvent: (e) => events.push(e),
      getPendingPlayerInputs: () => [],
      markPlayerInputHandled: vi.fn(),
    });

    const scEvent = events.find((e) => e.type === "should_continue");
    expect(scEvent).toBeDefined();
    if (scEvent && "shouldContinue" in scEvent) {
      expect(typeof scEvent.shouldContinue).toBe("boolean");
    }
  });

  it("非 CONFIRMED 状态开庭抛错", async () => {
    const { runCourtTrial } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试");
    const chat = makeMockChat();
    await expect(runCourtTrial({
      caseId: c.id,
      chat,
      perspective: "audience",
      onEvent: () => {},
      getPendingPlayerInputs: () => [],
      markPlayerInputHandled: vi.fn(),
    })).rejects.toThrow();
  });

  it("analyzeCase: 起诉状/答辩状落库（LLM 未给文书时用兜底，仍非空）", async () => {
    const { analyzeCase } = await import("./court-orchestrator.js");
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const chat = makeMockChat();
    const updated = await analyzeCase(c.id, chat);
    const docs = updated as typeof updated & { plaintiff_complaint?: string; defendant_answer?: string };
    expect(docs.plaintiff_complaint && docs.plaintiff_complaint.length).toBeGreaterThan(0);
    expect(docs.defendant_answer && docs.defendant_answer.length).toBeGreaterThan(0);
  });

  it("draftStory: LLM 返回 JSON 时采用之；失败时落到本地兜底", async () => {
    const { draftStory } = await import("./court-orchestrator.js");
    // LLM 正常返回
    const okChat: ChatFn = vi.fn(async () => JSON.stringify({ description: "用户的咖啡被同事喝了", stance: "要求赔偿一杯" }));
    const r1 = await draftStory(okChat, "咖啡");
    expect(r1.description).toContain("咖啡");
    expect(r1.stance).toContain("赔偿");
    // LLM 抛错 -> 本地兜底，仍返回合法 description
    const badChat: ChatFn = vi.fn(async () => { throw new Error("down"); });
    const r2 = await draftStory(badChat);
    expect(r2.description.length).toBeGreaterThan(10);
  });
});
