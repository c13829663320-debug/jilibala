// ===== M13: 趣味法庭纯逻辑模块（可独立测试，无网络/无 IO）=====
import type {
  CourtCardType,
  CourtCase,
  CourtCaseStatus,
  CourtTurn,
  Perspective,
} from "@balabala/shared";

// ===== 天平 / 预制牌（纯函数）=====
export type CourtSide = "plaintiff" | "defendant";

export interface BalanceState { plaintiff: number; defendant: number; }
export const MAX_ROUNDS = 3;
export const PLAYER_AMMO_PER_ROUND = 2;
export const HAND_CARDS: CourtCardType[] = ["attack", "evidence", "mock", "request_record"];
export const CARD_AMMO_COST: Record<CourtCardType, number> = { attack: 1, evidence: 1, mock: 1, request_record: 0 };

export function applyBalance(balance: BalanceState, side: CourtSide, delta: number): BalanceState {
  const nextSide = Math.max(0, Math.min(100, Math.round(balance[side] + delta)));
  return side === "plaintiff"
    ? { plaintiff: nextSide, defendant: 100 - nextSide }
    : { plaintiff: 100 - nextSide, defendant: nextSide };
}

export function decideWinnerFromBalance(balance: BalanceState): "plaintiff" | "defendant" | "mixed" {
  if (balance.plaintiff > balance.defendant) return "plaintiff";
  if (balance.defendant > balance.plaintiff) return "defendant";
  return "mixed";
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s，。、；：？！「」『』"'（）()【】《》·,.!?;:]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) grams.add(t.slice(i, i + 2));
  return grams;
}

export function matchUnresolved(text: string, unresolved: string[]): string | null {
  if (!text.trim() || unresolved.length === 0) return null;
  const grams = bigrams(text);
  for (const point of unresolved) {
    for (const g of bigrams(point)) if (grams.has(g)) return point;
  }
  return null;
}

export interface CardResolutionInput {
  unresolved: string[];
  evidencePool: Array<{ id: string; name: string; content: string }>;
  targetEvidenceId?: string;
  freeText?: string;
  mockOutrageous?: boolean;
}
export interface CardResolution {
  delta: number;
  hit: boolean;
  judgeComment: string;
  resolvedPoint?: string;
  addedFact?: string;
}

export function resolveCard(card: CourtCardType, input: CardResolutionInput): CardResolution {
  switch (card) {
    case "attack": {
      const point = matchUnresolved((input.freeText ?? "").trim(), input.unresolved);
      return point
        ? { delta: 6, hit: true, judgeComment: `此论点直击争议焦点「${point}」，天平向你方倾斜。` }
        : { delta: 1, hit: false, judgeComment: "论点与本案争议关联不强，仅略微占上风。" };
    }
    case "evidence": {
      const ev = input.evidencePool.find((e) => e.id === input.targetEvidenceId);
      if (!ev) return { delta: 0, hit: false, judgeComment: "本席没有可出示的对应证据。" };
      const point = matchUnresolved(`${ev.name} ${ev.content}`, input.unresolved);
      return point
        ? { delta: 8, hit: true, resolvedPoint: point, judgeComment: `证据「${ev.name}」与「${point}」直接相关，此点已查明。` }
        : { delta: 2, hit: false, judgeComment: `证据「${ev.name}」与本案争议关联不强。` };
    }
    case "mock": {
      return input.mockOutrageous
        ? { delta: -3, hit: false, judgeComment: "嘲讽越界、有失法庭体面，法官警告：天平反向。" }
        : { delta: 3, hit: true, judgeComment: "幽默得当，法庭气氛向你方倾斜。" };
    }
    case "request_record": {
      const fact = (input.freeText ?? "").trim();
      return { delta: 0, hit: false, addedFact: fact || "（玩家请求记录在案）", judgeComment: "已将此节记入庭审记录，双方均可援引。" };
    }
    default:
      return { delta: 0, hit: false, judgeComment: "无效的出牌。" };
  }
}

// ===== 状态机 =====
export type CourtTransitionEvent =
  | "analyze"
  | "analysis_done"
  | "analysis_failed"
  | "regenerate"
  | "confirm"
  | "start"
  | "stop_for_verdict"
  | "verdict_done";

/** 合法流转表：current -> event -> next */
const TRANSITIONS: Record<CourtCaseStatus, Partial<Record<CourtTransitionEvent, CourtCaseStatus>>> = {
  DRAFT: {
    analyze: "ANALYZING",
  },
  ANALYZING: {
    analysis_done: "GENERATED",
    analysis_failed: "DRAFT",
    regenerate: "DRAFT",
  },
  GENERATED: {
    confirm: "CONFIRMED",
    regenerate: "ANALYZING",
  },
  CONFIRMED: {
    start: "IN_PROGRESS",
  },
  IN_PROGRESS: {
    stop_for_verdict: "JUDGING",
  },
  JUDGING: {
    verdict_done: "COMPLETED",
  },
  COMPLETED: {},
};

/**
 * 状态机合法流转。非法流转抛 Error。
 */
export function transitionStatus(current: CourtCaseStatus, event: CourtTransitionEvent): CourtCaseStatus {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    throw new Error(`非法状态流转: ${current} --${event}--> ?`);
  }
  return next;
}

// ===== 视角过滤 =====
/**
 * 按视角过滤案件对象：
 * - audience：双方 KB 都设为 null（只看公开 turns/record），facts/evidence 保留
 * - plaintiff：plaintiff_kb 保留，defendant_kb 设为 null
 * - defendant：defendant_kb 保留，plaintiff_kb 设为 null
 * - final_verdict 所有人可见
 */
export function filterCaseForPerspective(fullCase: CourtCase, perspective: Perspective): CourtCase {
  const filtered: CourtCase = { ...fullCase };
  switch (perspective) {
    case "plaintiff":
      filtered.defendant_kb = null;
      break;
    case "defendant":
      filtered.plaintiff_kb = null;
      break;
    case "audience":
    default:
      filtered.plaintiff_kb = null;
      filtered.defendant_kb = null;
      break;
  }
  return filtered;
}

// ===== 发言上下文构造（纯函数，测试用）=====
export interface SpeakerContextInput {
  caseTitle: string;
  userInput: string;
  disputePoints: string[];
  publicFacts: string[];
  evidenceNames: string[];
  priorTurns: CourtTurn[];
  kbFacts: string[];
  kbClaims: string[];
  kbArguments: string[];
  kbAssumptions: string[];
  kbUserAdditions: string[];
  opponentArguments: string[];
  unresolvedPoints: string[];
  round: number;
  speakerSide: "plaintiff" | "defendant" | "judge";
}

/** 把已发言记录压成简短摘要（控制长度）。 */
function summarizeTurns(turns: CourtTurn[], maxChars = 1500): string {
  const lines = turns.map((t) => `[R${t.round}#${t.turn} ${t.speakerName}] ${t.content}`);
  let s = lines.join("\n");
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}\n…(后略)`;
  return s;
}

/**
 * 构造发言上下文（纯函数）。根据发言方、知识库、公开事实、历史发言等拼装 prompt context。
 */
export function buildSpeakerContext(input: SpeakerContextInput): string {
  const parts: string[] = [
    `案件：${input.caseTitle}`,
    `案情：${input.userInput}`,
  ];
  if (input.disputePoints.length) {
    parts.push(`争议焦点：${input.disputePoints.join("；")}`);
  }
  if (input.publicFacts.length) {
    parts.push(`已确认事实：${input.publicFacts.join("；")}`);
  }
  if (input.evidenceNames.length) {
    parts.push(`已提交证据：${input.evidenceNames.join("；")}`);
  }

  // 该方内部知识库（法官不获取私有 KB；不会泄漏给对方视角）
  if (input.speakerSide !== "judge") {
    const kbSections: string[] = [];
    if (input.kbFacts.length) kbSections.push(`你方掌握的事实：${input.kbFacts.join("；")}`);
    if (input.kbClaims.length) kbSections.push(`你方主张：${input.kbClaims.join("；")}`);
    if (input.kbArguments.length) kbSections.push(`你方论点：${input.kbArguments.join("；")}`);
    if (input.kbAssumptions.length) kbSections.push(`你方假设/前提：${input.kbAssumptions.join("；")}`);
    if (input.opponentArguments.length) kbSections.push(`对方可能的论点：${input.opponentArguments.join("；")}`);
    if (input.kbUserAdditions.length) kbSections.push(`玩家补充：${input.kbUserAdditions.join("；")}`);
    if (kbSections.length) parts.push(`【你方内部信息】\n${kbSections.join("\n")}`);
  }

  if (input.unresolvedPoints.length) {
    parts.push(`当前未决问题：${input.unresolvedPoints.join("；")}`);
  }

  if (input.priorTurns.length) {
    parts.push(`此前庭审发言：\n${summarizeTurns(input.priorTurns)}`);
  }

  const roleHint =
    input.speakerSide === "judge"
      ? "你是法官，请客观总结本轮要点或决定是否继续。"
      : input.speakerSide === "plaintiff"
        ? "你代表原告，请基于你方知识库陈述论点。"
        : "你代表被告，请基于你方知识库陈述论点。";
  parts.push(roleHint);
  parts.push(`当前第 ${input.round} 轮。发言 100-300 字，简短有力。`);

  return parts.join("\n\n");
}
