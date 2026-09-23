// ===== M13: court-state 纯逻辑测试（无网络、无 IO）=====
import { describe, expect, it } from "vitest";
import {
  transitionStatus,
  filterCaseForPerspective,
  buildSpeakerContext,
  type CourtTransitionEvent,
} from "./court-state.js";
import type { CourtCase, CourtKnowledgeBase, CourtPartyRole, CourtRecord, CourtTurn } from "@balabala/shared";

describe("court-state 状态机", () => {
  it("DRAFT --analyze--> ANALYZING", () => {
    expect(transitionStatus("DRAFT", "analyze")).toBe("ANALYZING");
  });

  it("ANALYZING --analysis_done--> GENERATED", () => {
    expect(transitionStatus("ANALYZING", "analysis_done")).toBe("GENERATED");
  });

  it("ANALYZING --analysis_failed--> DRAFT", () => {
    expect(transitionStatus("ANALYZING", "analysis_failed")).toBe("DRAFT");
  });

  it("ANALYZING --regenerate--> DRAFT", () => {
    expect(transitionStatus("ANALYZING", "regenerate")).toBe("DRAFT");
  });

  it("GENERATED --confirm--> CONFIRMED", () => {
    expect(transitionStatus("GENERATED", "confirm")).toBe("CONFIRMED");
  });

  it("GENERATED --regenerate--> ANALYZING", () => {
    expect(transitionStatus("GENERATED", "regenerate")).toBe("ANALYZING");
  });

  it("CONFIRMED --start--> IN_PROGRESS", () => {
    expect(transitionStatus("CONFIRMED", "start")).toBe("IN_PROGRESS");
  });

  it("IN_PROGRESS --stop_for_verdict--> JUDGING", () => {
    expect(transitionStatus("IN_PROGRESS", "stop_for_verdict")).toBe("JUDGING");
  });

  it("JUDGING --verdict_done--> COMPLETED", () => {
    expect(transitionStatus("JUDGING", "verdict_done")).toBe("COMPLETED");
  });

  it("非法流转抛错", () => {
    expect(() => transitionStatus("DRAFT", "confirm")).toThrow();
    expect(() => transitionStatus("COMPLETED", "analyze")).toThrow();
    expect(() => transitionStatus("CONFIRMED", "analysis_done")).toThrow();
  });
});

// ===== 视角过滤 =====
function makeCase(over: Partial<CourtCase> = {}): CourtCase {
  const plaintiffKb: CourtKnowledgeBase = {
    caseId: "c1",
    side: "plaintiff",
    facts: ["原告事实"],
    evidence: [],
    claims: ["原告主张"],
    arguments: ["原告论点"],
    assumptions: [],
    opponent_arguments: [],
    user_additions: [],
    updatedAt: new Date().toISOString(),
  };
  const defendantKb: CourtKnowledgeBase = {
    caseId: "c1",
    side: "defendant",
    facts: ["被告事实"],
    evidence: [],
    claims: ["被告主张"],
    arguments: ["被告论点"],
    assumptions: [],
    opponent_arguments: [],
    user_additions: [],
    updatedAt: new Date().toISOString(),
  };
  return {
    id: "c1",
    userId: "u1",
    status: "COMPLETED",
    title: "测试案",
    user_input: "测试案情",
    evidence: [],
    facts: [],
    dispute_points: [],
    plaintiff: null,
    defendant: null,
    plaintiff_kb: plaintiffKb,
    defendant_kb: defendantKb,
    court_record: null,
    current_round: 1,
    current_turn: 1,
    final_verdict: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("court-state 视角过滤", () => {
  it("audience 看不到双方 KB", () => {
    const c = makeCase();
    const f = filterCaseForPerspective(c, "audience");
    expect(f.plaintiff_kb).toBeNull();
    expect(f.defendant_kb).toBeNull();
  });

  it("plaintiff 视角看不到被告 KB", () => {
    const c = makeCase();
    const f = filterCaseForPerspective(c, "plaintiff");
    expect(f.plaintiff_kb).not.toBeNull();
    expect(f.defendant_kb).toBeNull();
  });

  it("defendant 视角看不到原告 KB", () => {
    const c = makeCase();
    const f = filterCaseForPerspective(c, "defendant");
    expect(f.plaintiff_kb).toBeNull();
    expect(f.defendant_kb).not.toBeNull();
  });

  it("final_verdict 所有人可见", () => {
    const c = makeCase({
      final_verdict: {
        id: "v1",
        caseId: "c1",
        case_summary: "摘要",
        key_facts: [],
        key_evidence: [],
        plaintiff_arguments: [],
        defendant_arguments: [],
        judge_analysis: "",
        reasoning: "",
        verdict: "plaintiff",
        conclusion: "",
        createdAt: new Date().toISOString(),
      },
    });
    expect(filterCaseForPerspective(c, "audience").final_verdict).not.toBeNull();
    expect(filterCaseForPerspective(c, "plaintiff").final_verdict).not.toBeNull();
  });
});

// ===== buildSpeakerContext =====
describe("court-state buildSpeakerContext", () => {
  it("构造包含案件标题和争议点", () => {
    const ctx = buildSpeakerContext({
      caseTitle: "邻居扰民案",
      userInput: "邻居半夜装修",
      disputePoints: ["是否扰民"],
      publicFacts: ["凌晨施工"],
      evidenceNames: ["录音"],
      priorTurns: [],
      kbFacts: ["原告事实"],
      kbClaims: ["原告主张"],
      kbArguments: ["原告论点"],
      kbAssumptions: [],
      kbUserAdditions: [],
      opponentArguments: [],
      unresolvedPoints: ["责任认定"],
      round: 1,
      speakerSide: "plaintiff",
    });
    expect(ctx).toContain("邻居扰民案");
    expect(ctx).toContain("是否扰民");
    expect(ctx).toContain("原告事实");
    expect(ctx).toContain("凌晨施工");
  });

  it("法官发言不包含私有 KB", () => {
    const ctx = buildSpeakerContext({
      caseTitle: "案",
      userInput: "案情",
      disputePoints: [],
      publicFacts: [],
      evidenceNames: [],
      priorTurns: [],
      kbFacts: ["秘密"],
      kbClaims: [],
      kbArguments: [],
      kbAssumptions: [],
      kbUserAdditions: [],
      opponentArguments: [],
      unresolvedPoints: [],
      round: 1,
      speakerSide: "judge",
    });
    expect(ctx).not.toContain("秘密");
  });
});
