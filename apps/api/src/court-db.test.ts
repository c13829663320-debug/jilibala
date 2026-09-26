// ===== M13: court-db DAO 测试（临时 SQLite，禁止真实网络）=====
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type DbModule = typeof import("./db.js");

async function loadDb(): Promise<{ mod: DbModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-court-db-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./db.js");
  return { mod, dir };
}

describe("court DAO", () => {
  let ctx: { mod: DbModule; dir: string };

  beforeEach(async () => {
    ctx = await loadDb();
  });

  afterAll(() => {
    try { ctx.mod.db.close(); } catch { /* ignore */ }
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("createCourtCase -> getCourtCase 回读", () => {
    const c = ctx.mod.createCourtCase("user1", "邻居半夜装修扰民", [
      { name: "录音", type: "TEXT", content: "凌晨3点噪音", submittedBy: "user" },
    ]);
    expect(c.id).toMatch(/^court-/);
    expect(c.status).toBe("DRAFT");
    expect(c.userId).toBe("user1");
    expect(c.user_input).toBe("邻居半夜装修扰民");
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0].name).toBe("录音");

    const read = ctx.mod.getCourtCase(c.id);
    expect(read).toBeDefined();
    expect(read!.id).toBe(c.id);
    expect(read!.evidence).toHaveLength(1);
  });

  it("updateCourtCaseAnalysis 写入后字段正确", () => {
    const c = ctx.mod.createCourtCase("u1", "测试案情");
    const now = new Date().toISOString();
    ctx.mod.updateCourtCaseAnalysis(c.id, {
      title: "测试案件",
      facts: [
        { content: "事实A", source: "user_input", disputed: true },
        { content: "事实B", source: "user_input", disputed: false },
      ],
      disputePoints: ["争议1", "争议2"],
      plaintiffRole: { side: "plaintiff", name: "张三", stance: "主张赔偿", persona: "你是张三" },
      defendantRole: { side: "defendant", name: "李四", stance: "拒绝赔偿", persona: "你是李四" },
      plaintiffKb: { side: "plaintiff", facts: ["f1"], evidence: [], claims: ["c1"], arguments: ["a1"], assumptions: [], opponent_arguments: [], user_additions: [] },
      defendantKb: { side: "defendant", facts: ["f2"], evidence: [], claims: ["c2"], arguments: ["a2"], assumptions: [], opponent_arguments: [], user_additions: [] },
    });

    const read = ctx.mod.getCourtCase(c.id)!;
    expect(read.title).toBe("测试案件");
    expect(read.dispute_points).toEqual(["争议1", "争议2"]);
    expect(read.plaintiff?.name).toBe("张三");
    expect(read.defendant?.name).toBe("李四");
    expect(read.plaintiff_kb?.claims).toEqual(["c1"]);
    expect(read.defendant_kb?.arguments).toEqual(["a2"]);
    expect(read.facts).toHaveLength(2);
  });

  it("updateCourtCaseStatus 状态持久化", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    ctx.mod.updateCourtCaseStatus(c.id, "GENERATED");
    expect(ctx.mod.getCourtCase(c.id)!.status).toBe("GENERATED");
    ctx.mod.updateCourtCaseStatus(c.id, "CONFIRMED");
    expect(ctx.mod.getCourtCase(c.id)!.status).toBe("CONFIRMED");
  });

  it("addCourtTurn -> getCourtTurns 按 round/turn 排序", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    ctx.mod.addCourtTurn({
      caseId: c.id, round: 2, turn: 2, speaker: "defendant",
      speakerId: "d1", speakerName: "被告", content: "被告第二轮",
      referenced_evidence: [], response_to_turn_id: null,
    });
    ctx.mod.addCourtTurn({
      caseId: c.id, round: 1, turn: 1, speaker: "plaintiff",
      speakerId: "p1", speakerName: "原告", content: "原告第一轮",
      referenced_evidence: [], response_to_turn_id: null,
    });
    ctx.mod.addCourtTurn({
      caseId: c.id, round: 1, turn: 2, speaker: "defendant",
      speakerId: "d1", speakerName: "被告", content: "被告第一轮",
      referenced_evidence: [], response_to_turn_id: null,
    });

    const turns = ctx.mod.getCourtTurns(c.id);
    expect(turns).toHaveLength(3);
    expect(turns[0].round).toBe(1);
    expect(turns[0].turn).toBe(1);
    expect(turns[1].round).toBe(1);
    expect(turns[1].turn).toBe(2);
    expect(turns[2].round).toBe(2);
    expect(turns[2].turn).toBe(2);
  });

  it("addCourtPlayerInput -> getCourtPlayerInputs", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    const input = ctx.mod.addCourtPlayerInput({
      caseId: c.id, userId: "u1", player_role: "plaintiff",
      type: "argument", content: "玩家补充论点", evidenceName: undefined,
    });
    expect(input.id).toMatch(/^ctp-/);
    const list = ctx.mod.getCourtPlayerInputs(c.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("玩家补充论点");
    expect(list[0].player_role).toBe("plaintiff");
  });

  it("setCourtVerdict -> getCourtVerdict", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    const verdict = {
      id: "ctv-test",
      caseId: c.id,
      case_summary: "摘要",
      key_facts: ["事实1"],
      key_evidence: ["证据1"],
      plaintiff_arguments: ["原告诉求"],
      defendant_arguments: ["被告答辩"],
      judge_analysis: "分析",
      reasoning: "理由",
      verdict: "plaintiff" as const,
      conclusion: "原告胜诉",
      createdAt: new Date().toISOString(),
    };
    ctx.mod.setCourtVerdict(c.id, verdict);
    const read = ctx.mod.getCourtVerdict(c.id);
    expect(read).toBeDefined();
    expect(read!.verdict).toBe("plaintiff");
    expect(read!.conclusion).toBe("原告胜诉");

    const caseRead = ctx.mod.getCourtCase(c.id)!;
    expect(caseRead.final_verdict).not.toBeNull();
    expect(caseRead.final_verdict!.verdict).toBe("plaintiff");
  });

  it("证据 CRUD", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    const ev = ctx.mod.addCourtEvidence(c.id, {
      type: "IMAGE", name: "照片", content: "现场照片", submittedBy: "user",
    });
    expect(ev.id).toMatch(/^cte-/);
    const list = ctx.mod.getCourtEvidence(c.id);
    expect(list).toHaveLength(1); // 新增1条
    expect(list[0].name).toBe("照片");
    expect(list[0].type).toBe("IMAGE");
  });

  it("事实 CRUD", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    const f = ctx.mod.addCourtFact(c.id, {
      content: "新事实", source: "evidence-1", disputed: false,
    });
    expect(f.id).toMatch(/^ctf-/);
    const list = ctx.mod.getCourtFacts(c.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("新事实");
  });

  it("updateCourtRecord 写回", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    const record = {
      caseId: c.id, facts: ["f1"], claims: ["c1"], arguments: [],
      counter_arguments: [], evidence_relations: [], unresolved: ["q1"], resolved: [],
      updatedAt: new Date().toISOString(),
    };
    ctx.mod.updateCourtRecord(c.id, record);
    const read = ctx.mod.getCourtCase(c.id)!;
    expect(read.court_record).not.toBeNull();
    expect(read.court_record!.facts).toEqual(["f1"]);
  });

  it("updateCourtCaseDocs 持久化起诉状/答辩状", () => {
    const c = ctx.mod.createCourtCase("u1", "案情");
    ctx.mod.updateCourtCaseDocs(c.id, {
      plaintiffComplaint: "原告主张对方赔偿",
      defendantAnswer: "被告不同意",
    });
    const read = ctx.mod.getCourtCase(c.id)!;
    expect((read as { plaintiff_complaint?: string }).plaintiff_complaint).toBe("原告主张对方赔偿");
    expect((read as { defendant_answer?: string }).defendant_answer).toBe("被告不同意");
  });

  it("listCourtCasesByUser 按用户列出并按更新时间倒序", () => {
    const a = ctx.mod.createCourtCase("alice", "案件甲");
    ctx.mod.updateCourtCaseStatus(a.id, "COMPLETED");
    const b = ctx.mod.createCourtCase("alice", "案件乙");
    ctx.mod.updateCourtCaseStatus(b.id, "GENERATED");
    ctx.mod.createCourtCase("bob", "只属于 bob");

    const mine = ctx.mod.listCourtCasesByUser("alice");
    expect(mine).toHaveLength(2);
    expect(mine.map((x) => x.user_input)).toContain("案件甲");
    expect(mine.map((x) => x.user_input)).toContain("案件乙");
    // 倒序：后建的 b 在前
    expect(mine[0].id).toBe(b.id);
    const bob = ctx.mod.listCourtCasesByUser("bob");
    expect(bob).toHaveLength(1);
  });

  it("deleteCourtCase 级联删除案件及子表数据", () => {
    const c = ctx.mod.createCourtCase("u1", "待删除案件");
    ctx.mod.addCourtEvidence(c.id, { type: "TEXT", name: "证", content: "x", submittedBy: "user" });
    ctx.mod.addCourtFact(c.id, { content: "f", source: "user_input", disputed: false });
    ctx.mod.addCourtTurn({
      caseId: c.id, round: 1, turn: 1, speaker: "judge", speakerId: "judge",
      speakerName: "法官", content: "开庭", referenced_evidence: [], response_to_turn_id: null,
    });
    ctx.mod.addCourtPlayerInput({ caseId: c.id, userId: "u1", player_role: "plaintiff", type: "argument", content: "y" });
    ctx.mod.setCourtVerdict(c.id, {
      id: "ctv-x", caseId: c.id, case_summary: "s", key_facts: [], key_evidence: [],
      plaintiff_arguments: [], defendant_arguments: [], judge_analysis: "", reasoning: "",
      verdict: "mixed", conclusion: "", createdAt: new Date().toISOString(),
    });

    ctx.mod.deleteCourtCase(c.id);
    expect(ctx.mod.getCourtCase(c.id)).toBeUndefined();
    expect(ctx.mod.getCourtTurns(c.id)).toHaveLength(0);
    expect(ctx.mod.getCourtEvidence(c.id)).toHaveLength(0);
    expect(ctx.mod.getCourtFacts(c.id)).toHaveLength(0);
    expect(ctx.mod.getCourtPlayerInputs(c.id)).toHaveLength(0);
    expect(ctx.mod.getCourtVerdict(c.id)).toBeUndefined();
  });

  it("setCourtShareToken / getCourtCaseByShareToken", () => {
    const c = ctx.mod.createCourtCase("u1", "可分享案件");
    ctx.mod.setCourtShareToken(c.id, "tok123");
    const found = ctx.mod.getCourtCaseByShareToken("tok123");
    expect(found?.id).toBe(c.id);
    expect(ctx.mod.getCourtCaseByShareToken("nope")).toBeUndefined();
  });
});
