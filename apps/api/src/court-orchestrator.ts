// ===== M13: 趣味法庭编排器 Court Orchestrator =====
// 完整案件状态机：DRAFT -> ANALYZING -> GENERATED -> CONFIRMED -> IN_PROGRESS -> JUDGING -> COMPLETED
// 复用 bench-orchestrator 的 celebritySpeak / ChatFn / withRetry 模式。
import { randomUUID } from "node:crypto";
import type {
  CourtCase,
  CourtEvidence,
  CourtFact,
  CourtKnowledgeBase,
  CourtPlayerInput,
  CourtRecord,
  CourtPartyRole,
  CourtTurn,
  CourtTrialEvent,
  CourtVerdict,
  EvidenceType,
  Perspective,
} from "@balabala/shared";
import { celebritySpeak, type ChatFn } from "./bench-orchestrator.js";
import { resolveCharacter, type ResolvedCharacter } from "./character-resolver.js";
import {
  addCourtFact,
  addCourtPlayerInput,
  addCourtTurn,
  getCourtCase,
  getCourtEvidence,
  getCourtFacts,
  getCourtPlayerInputs,
  getCourtTurns,
  setCourtVerdict,
  updateCourtCaseAnalysis,
  updateCourtCaseStatus,
  updateCourtRecord,
  updateCourtRoundTurn,
} from "./db.js";
import { buildSpeakerContext, transitionStatus } from "./court-state.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 抽取 LLM 返回中的 JSON 对象。 */
const extractJson = (text: string): unknown => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
};

/** 清理发言文本：去除外层引号、控制长度。 */
const tidySpeech = (raw: string): string => {
  let text = raw.trim();
  text = text.replace(/^[""「『]|[""」』]$/g, "").trim();
  text = text.replace(/^[^，。：:]{0,12}说[：:]\s*/, "").trim();
  if (text.length > 400) text = `${text.slice(0, 400)}…`;
  return text;
};

/** 带退避与容错的 LLM 调用：失败重试 1 次（间隔 500ms），再失败返回 fallbackText。 */
const withRetry = async (fn: () => Promise<string>, fallbackText: string): Promise<string> => {
  try {
    return await fn();
  } catch {
    try {
      await sleep(500);
      return await fn();
    } catch {
      return fallbackText;
    }
  }
};

// ===== AI 案件分析 =====
const ANALYZE_SYSTEM =
  "你是趣味法庭的 AI 案件分析师。根据用户输入和证据，生成结构化案件分析。只返回合法 JSON，不要 Markdown。";

interface AnalyzeResult {
  title: string;
  facts: Array<{ content: string; source: string; disputed?: boolean }>;
  dispute_points: string[];
  plaintiff_role: Omit<CourtPartyRole, "id" | "caseId" | "createdAt">;
  defendant_role: Omit<CourtPartyRole, "id" | "caseId" | "createdAt">;
  plaintiff_kb: Omit<CourtKnowledgeBase, "caseId" | "updatedAt">;
  defendant_kb: Omit<CourtKnowledgeBase, "caseId" | "updatedAt">;
  /** 原告起诉状（叙事文书）。 */
  plaintiff_complaint: string;
  /** 被告答辩状（叙事文书）。 */
  defendant_answer: string;
}

function fallbackAnalyze(userInput: string): AnalyzeResult {
  const title = userInput.length > 20 ? userInput.slice(0, 20) + "…" : userInput;
  return {
    title,
    facts: [{ content: userInput, source: "user_input", disputed: true }],
    dispute_points: ["双方对事件责任存在争议"],
    plaintiff_role: {
      side: "plaintiff" as const,
      name: "原告",
      stance: "主张对方应承担责任",
      persona: "你是本案原告，情绪激动但有理有据，坚持自己的诉求。",
    },
    defendant_role: {
      side: "defendant" as const,
      name: "被告",
      stance: "否认责任或主张减轻",
      persona: "你是本案被告，理性冷静，为自己的行为辩护。",
    },
    plaintiff_kb: {
      side: "plaintiff" as const,
      facts: [userInput],
      evidence: [],
      claims: ["对方应对此事负责"],
      arguments: ["事实清楚，对方有过错"],
      assumptions: ["对方知晓相关后果"],
      opponent_arguments: [],
      user_additions: [],
    },
    defendant_kb: {
      side: "defendant" as const,
      facts: [userInput],
      evidence: [],
      claims: ["不应承担责任"],
      arguments: ["存在合理抗辩事由"],
      assumptions: ["原告自身也有责任"],
      opponent_arguments: [],
      user_additions: [],
    },
    plaintiff_complaint: `原告认为，根据上述事实，被告应当对此事负责。恳请法庭查明真相，主持公道。`,
    defendant_answer: `被告认为，事发经过与原告所述并不完全一致，被告并无过错，请求法庭依法驳回原告的诉求。`,
  };
}

/**
 * AI 分析案件：一次 LLM 调用生成 title/facts/dispute_points/roles/KBs。
 * 写库并 status -> GENERATED。
 */
/** 给 Promise 加硬超时；超时 reject（用于有本地兜底、不应长时间阻塞用户的调用）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function analyzeCase(caseId: string, chat: ChatFn): Promise<CourtCase> {
  const full = getCourtCase(caseId);
  if (!full) throw new Error(`案件不存在: ${caseId}`);

  updateCourtCaseStatus(caseId, transitionStatus(full.status, "analyze"));

  const evidenceList = getCourtEvidence(caseId);
  const evidenceText = evidenceList.length
    ? `\n证据：\n${evidenceList.map((e) => `- [${e.type}] ${e.name}: ${e.content}`).join("\n")}`
    : "";

  const userPrompt = `用户输入的案情：${full.user_input}${evidenceText}

请分析并返回 JSON，字段：
- title: 案件标题（10字以内）
- facts: 3-5条结构化事实，每条 {content, source, disputed}
- dispute_points: 2-3个争议点
- plaintiff_role: {name, stance, persona}（原告方角色，persona 是一段简短人设）
- defendant_role: {name, stance, persona}（被告方角色）
- plaintiff_kb: {facts:[], evidence:[], claims:[], arguments:[], assumptions:[], opponent_arguments:[], user_additions:[]}，每个数组最多 2-3 条、每条 20 字以内，没有内容就留空数组
- defendant_kb: 同上结构，同样精简
- plaintiff_complaint: 原告起诉状正文（一段，80-150字，以第一人称原告口吻陈述事实与诉求，语气可以活泼但要讲清主张）
- defendant_answer: 被告答辩状正文（一段，80-150字，以第一人称被告口吻回应、提出辩解）`;

  let result: AnalyzeResult;
  try {
    const raw = await withTimeout(
      chat(
        [
          { role: "system", content: ANALYZE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        3000,
      ),
      38_000,
      "analyze",
    );
    const parsed = extractJson(raw) as Partial<AnalyzeResult>;
    result = {
      title: String(parsed.title ?? fallbackAnalyze(full.user_input).title),
      facts: Array.isArray(parsed.facts) ? parsed.facts : fallbackAnalyze(full.user_input).facts,
      dispute_points: Array.isArray(parsed.dispute_points) ? parsed.dispute_points : fallbackAnalyze(full.user_input).dispute_points,
      plaintiff_role: (parsed.plaintiff_role ?? fallbackAnalyze(full.user_input).plaintiff_role) as AnalyzeResult["plaintiff_role"],
      defendant_role: (parsed.defendant_role ?? fallbackAnalyze(full.user_input).defendant_role) as AnalyzeResult["defendant_role"],
      plaintiff_kb: (parsed.plaintiff_kb ?? fallbackAnalyze(full.user_input).plaintiff_kb) as AnalyzeResult["plaintiff_kb"],
      defendant_kb: (parsed.defendant_kb ?? fallbackAnalyze(full.user_input).defendant_kb) as AnalyzeResult["defendant_kb"],
      plaintiff_complaint: typeof parsed.plaintiff_complaint === "string" && parsed.plaintiff_complaint.trim()
        ? tidySpeech(parsed.plaintiff_complaint)
        : fallbackAnalyze(full.user_input).plaintiff_complaint,
      defendant_answer: typeof parsed.defendant_answer === "string" && parsed.defendant_answer.trim()
        ? tidySpeech(parsed.defendant_answer)
        : fallbackAnalyze(full.user_input).defendant_answer,
    };
  } catch {
    result = fallbackAnalyze(full.user_input);
  }

  updateCourtCaseAnalysis(caseId, {
    title: result.title,
    facts: result.facts,
    disputePoints: result.dispute_points,
    plaintiffRole: result.plaintiff_role,
    defendantRole: result.defendant_role,
    plaintiffKb: result.plaintiff_kb,
    defendantKb: result.defendant_kb,
    plaintiffComplaint: result.plaintiff_complaint,
    defendantAnswer: result.defendant_answer,
  });

  const updated = getCourtCase(caseId)!;
  updateCourtCaseStatus(caseId, transitionStatus(updated.status, "analysis_done"));
  return getCourtCase(caseId)!;
}

// ===== AI 帮写案情（CreateCase 页「AI 帮我写」按钮）=====
const DRAFT_SYSTEM =
  "你是趣味法庭的点子编剧。把用户随口一句话或一个主题，扩写成一件轻松、友善、适合开庭的生活小事。只返回合法 JSON，不要 Markdown。不要辱骂、不涉及真实法律纠纷、不碰隐私/家暴/自残。";

interface DraftStoryResult {
  description: string;
  stance: string;
}

const DRAFT_FALLBACKS: DraftStoryResult[] = [
  {
    description: "泡泡借走了阿布的彩虹伞，说好下雨用完就还。结果一连晴了三天，泡泡却把伞借给了楼下的小松鼠，伞上还被画了一个笑脸。",
    stance: "我觉得泡泡至少应该把伞擦干净再还我。",
  },
  {
    description: "合租室友阿白每天凌晨两点在厨房叮叮当当做夜宵，抽油烟机响得像直升机，我第三天终于在冰箱上贴了纸条，结果被回贴了一张「这是生活的气息」。",
    stance: "我认为凌晨两点的生活气息应该小声一点。",
  },
  {
    description: "班长在群里发了接龙说 AA 聚餐，我转了钱，结果吃完没人提账单，三天后我发现自己一个人付了八个人的钱。",
    stance: "我要求大家按接龙把钱补回来。",
  },
];

/** AI 帮写一段趣味案情：返回 { description, stance }。LLM 失败时用本地兜底。 */
export async function draftStory(chat: ChatFn, seed?: string): Promise<DraftStoryResult> {
  const prompt = seed?.trim()
    ? `用户给的主题：「${seed.trim()}」。围绕它编一件具体、有画面感、双方都能吵起来的生活小事。`
    : `随便给一个有趣的生活小冲突主题，编一件具体、有画面感、双方都能吵起来的小事。`;
  try {
    const raw = await withTimeout(
      chat([
        { role: "system", content: DRAFT_SYSTEM },
        {
          role: "user",
          content: `${prompt}\n\n返回 JSON：{ "description": "60-120字案情", "stance": "一句玩家可能的立场，20字以内" }`,
        },
      ], 1500),
      20_000,
      "draftStory",
    );
    const parsed = extractJson(raw) as Partial<DraftStoryResult>;
    if (typeof parsed.description === "string" && parsed.description.trim().length >= 10) {
      return {
        description: tidySpeech(parsed.description),
        stance: typeof parsed.stance === "string" ? tidySpeech(parsed.stance) : "",
      };
    }
  } catch {
    // 落到本地兜底
  }
  return DRAFT_FALLBACKS[Math.floor(Math.random() * DRAFT_FALLBACKS.length)];
}

// ===== 编排器 opts =====
export interface RunCourtTrialOpts {
  caseId: string;
  chat: ChatFn;
  onEvent: (e: CourtTrialEvent) => void;
  getPendingPlayerInputs: () => CourtPlayerInput[];
  markPlayerInputHandled: (id: string) => void;
  defenderAssignments?: { plaintiff?: string[]; defendant?: string[] };
  perspective: Perspective;
}

const MAX_ROUNDS = 5;

const JUDGE_SYSTEM =
  "你是叽里呱啦趣味法庭的 AI 法官，友善、幽默、公正。负责主持庭审、归纳记录、决定是否继续辩论并作出判决。判决不具有真实法律效力。";

/**
 * 主庭审流程：加载案件 -> 开庭循环（最多5轮） -> 判决。
 */
export async function runCourtTrial(opts: RunCourtTrialOpts): Promise<{ verdict: CourtVerdict; turns: CourtTurn[] }> {
  const { caseId, chat, onEvent, getPendingPlayerInputs, markPlayerInputHandled, defenderAssignments, perspective } = opts;

  let full = getCourtCase(caseId);
  if (!full) throw new Error(`案件不存在: ${caseId}`);
  if (full.status !== "CONFIRMED") {
    throw new Error(`案件状态非 CONFIRMED，当前: ${full.status}`);
  }

  updateCourtCaseStatus(caseId, transitionStatus(full.status, "start"));
  full = getCourtCase(caseId)!;

  // 把用户确认过的起诉状/答辩状注入对应方知识库，作为辩论的正式主张依据。
  const docs = full as typeof full & { plaintiff_complaint?: string; defendant_answer?: string };
  if (docs.plaintiff_complaint?.trim() && full.plaintiff_kb) {
    full.plaintiff_kb.arguments = [`起诉状：${docs.plaintiff_complaint.trim()}`, ...full.plaintiff_kb.arguments];
  }
  if (docs.defendant_answer?.trim() && full.defendant_kb) {
    full.defendant_kb.arguments = [`答辩状：${docs.defendant_answer.trim()}`, ...full.defendant_kb.arguments];
  }

  let turnCounter = 0;
  const allTurns: CourtTurn[] = getCourtTurns(caseId);

  // 初始法官记录
  let record: CourtRecord = {
    caseId,
    facts: full.facts.filter((f) => !f.disputed).map((f) => f.content),
    claims: [],
    arguments: [],
    counter_arguments: [],
    evidence_relations: [],
    unresolved: [...full.dispute_points],
    resolved: [],
    updatedAt: new Date().toISOString(),
  };

  const pushTurn = (
    round: number,
    speaker: CourtTurn["speaker"],
    speakerId: string,
    speakerName: string,
    content: string,
  ): CourtTurn => {
    turnCounter += 1;
    const turn: CourtTurn = {
      id: `ctt-${randomUUID()}`,
      caseId,
      round,
      turn: turnCounter,
      speaker,
      speakerId,
      speakerName,
      content,
      referenced_evidence: [],
      response_to_turn_id: null,
      createdAt: new Date().toISOString(),
    };
    const saved = addCourtTurn(turn);
    allTurns.push(saved);
    onEvent({ type: "court_turn", turn: saved });
    updateCourtRoundTurn(caseId, round, turnCounter);
    return saved;
  };

  // 构造某方发言 context
  const buildSideContext = (
    side: "plaintiff" | "defendant",
    round: number,
    priorTurns: CourtTurn[],
  ): string => {
    const kb = side === "plaintiff" ? full!.plaintiff_kb : full!.defendant_kb;
    const role = side === "plaintiff" ? full!.plaintiff : full!.defendant;
    return buildSpeakerContext({
      caseTitle: full!.title || "未命名案件",
      userInput: full!.user_input,
      disputePoints: full!.dispute_points,
      publicFacts: record.facts,
      evidenceNames: full!.evidence.map((e) => e.name),
      priorTurns,
      kbFacts: kb?.facts ?? [],
      kbClaims: kb?.claims ?? [],
      kbArguments: kb?.arguments ?? [],
      kbAssumptions: kb?.assumptions ?? [],
      kbUserAdditions: kb?.user_additions ?? [],
      opponentArguments: kb?.opponent_arguments ?? [],
      unresolvedPoints: record.unresolved,
      round,
      speakerSide: side,
    }) + `\n\n你的名字是「${role?.name ?? (side === "plaintiff" ? "原告" : "被告")}」，请用第一人称发言。`;
  };

  // 让某方角色发言
  const speakAsSide = async (
    side: "plaintiff" | "defendant",
    round: number,
    priorTurns: CourtTurn[],
  ): Promise<void> => {
    const role = side === "plaintiff" ? full!.plaintiff : full!.defendant;
    const persona = role?.persona ?? (side === "plaintiff" ? "你是原告。" : "你是被告。");
    const context = buildSideContext(side, round, priorTurns);
    const speakerName = role?.name ?? (side === "plaintiff" ? "原告" : "被告");

    const text = await withRetry(
      async () => {
        const raw = await chat([
          { role: "system", content: `${persona}\n保持你的角色，用第一人称发言，100-300字，有观点。` },
          { role: "user", content: context },
        ], 800);
        return tidySpeech(raw) || `${speakerName}: （兜底发言）`;
      },
      `${speakerName}: （兜底发言）`,
    );
    pushTurn(round, side, role?.id ?? side, speakerName, text);
    await sleep(200);
  };

  // 让辩护人（名人/自定义人物）发言
  const speakAsDefender = async (
    defenderId: string,
    side: "plaintiff" | "defendant",
    round: number,
    priorTurns: CourtTurn[],
  ): Promise<void> => {
    const character = resolveCharacter(defenderId);
    if (!character) return;
    const kb = side === "plaintiff" ? full!.plaintiff_kb : full!.defendant_kb;
    const context = buildSpeakerContext({
      caseTitle: full!.title || "未命名案件",
      userInput: full!.user_input,
      disputePoints: full!.dispute_points,
      publicFacts: record.facts,
      evidenceNames: full!.evidence.map((e) => e.name),
      priorTurns,
      kbFacts: kb?.facts ?? [],
      kbClaims: kb?.claims ?? [],
      kbArguments: kb?.arguments ?? [],
      kbAssumptions: kb?.assumptions ?? [],
      kbUserAdditions: kb?.user_additions ?? [],
      opponentArguments: kb?.opponent_arguments ?? [],
      unresolvedPoints: record.unresolved,
      round,
      speakerSide: side,
    }) + `\n\n你是${side === "plaintiff" ? "原告方" : "被告方"}的辩护人，请用第一人称发言。`;

    const text = await withRetry(
      () => celebritySpeak(character, context, chat, 800),
      character.greeting || `${character.name}: （兜底）`,
    );
    pushTurn(round, "defender", character.id, character.name, text);
    await sleep(200);
  };

  // 法官发言
  const judgeSpeak = async (round: number, promptSuffix: string): Promise<void> => {
    const recentTurns = allTurns.slice(-8);
    const context = buildSpeakerContext({
      caseTitle: full!.title || "未命名案件",
      userInput: full!.user_input,
      disputePoints: full!.dispute_points,
      publicFacts: record.facts,
      evidenceNames: full!.evidence.map((e) => e.name),
      priorTurns: recentTurns,
      kbFacts: [],
      kbClaims: [],
      kbArguments: [],
      kbAssumptions: [],
      kbUserAdditions: [],
      opponentArguments: [],
      unresolvedPoints: record.unresolved,
      round,
      speakerSide: "judge",
    }) + promptSuffix;

    const text = await withRetry(
      async () => {
        const raw = await chat([
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: context },
        ], 600);
        return tidySpeech(raw) || "本庭记录在案。";
      },
      "本庭记录在案。",
    );
    pushTurn(round, "judge", "judge", "AI 法官", text);
  };

  // 消费玩家输入，加入对应方 KB 的 user_additions
  const drainPlayerInputs = (): void => {
    const pending = getPendingPlayerInputs();
    for (const input of pending) {
      onEvent({ type: "player_input_ack", inputId: input.id });
      markPlayerInputHandled(input.id);
      // 加入对应方 KB
      if (input.player_role === "plaintiff" && full!.plaintiff_kb) {
        full!.plaintiff_kb.user_additions.push(`[玩家] ${input.content}`);
      } else if (input.player_role === "defendant" && full!.defendant_kb) {
        full!.defendant_kb.user_additions.push(`[玩家] ${input.content}`);
      }
    }
  };

  // 更新法官记录
  const updateRecord = async (round: number): Promise<void> => {
    const recentTurns = allTurns.filter((t) => t.round === round);
    const turnText = recentTurns.map((t) => `[${t.speakerName}] ${t.content}`).join("\n");

    const prompt = `当前案件：${full!.title}\n争议点：${full!.dispute_points.join("；")}\n\n本轮发言：\n${turnText}\n\n请更新法官记录，返回 JSON：
- facts: 本轮确认的新事实数组
- claims: 双方主张数组
- arguments: 原告论点数组
- counter_arguments: 被告反驳数组
- unresolved: 仍未解决的问题数组
- resolved: 本轮已解决的问题数组
只返回 JSON。`;

    try {
      const raw = await chat([
        { role: "system", content: `${JUDGE_SYSTEM} 只返回合法 JSON。` },
        { role: "user", content: prompt },
      ], 1000);
      const parsed = extractJson(raw) as Partial<CourtRecord>;
      record = {
        ...record,
        facts: parsed.facts ? [...new Set([...record.facts, ...parsed.facts])] : record.facts,
        claims: parsed.claims ? [...new Set([...record.claims, ...parsed.claims])] : record.claims,
        arguments: parsed.arguments ? [...new Set([...record.arguments, ...parsed.arguments])] : record.arguments,
        counter_arguments: parsed.counter_arguments ? [...new Set([...record.counter_arguments, ...parsed.counter_arguments])] : record.counter_arguments,
        unresolved: parsed.unresolved ?? record.unresolved,
        resolved: parsed.resolved ? [...new Set([...record.resolved, ...parsed.resolved])] : record.resolved,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // 保持现有记录
    }
    updateCourtRecord(caseId, record);
    onEvent({ type: "court_record", record });
  };

  // 决定是否继续
  const shouldContinue = async (round: number): Promise<{ shouldContinue: boolean; unresolvedPoints: string[]; reason: string }> => {
    if (round >= MAX_ROUNDS) {
      return { shouldContinue: false, unresolvedPoints: record.unresolved, reason: `已达最大轮次 ${MAX_ROUNDS}` };
    }
    if (record.unresolved.length === 0) {
      return { shouldContinue: false, unresolvedPoints: [], reason: "所有争议点已解决" };
    }
    // 询问法官是否继续
    try {
      const raw = await chat([
        { role: "system", content: `${JUDGE_SYSTEM} 根据未决问题数量和辩论充分性，决定是否继续。只返回 JSON {"shouldContinue": bool, "reason": "..."}。` },
        { role: "user", content: `第 ${round} 轮结束。未决问题：${record.unresolved.join("；")}。已解决：${record.resolved.join("；")}。最多 ${MAX_ROUNDS} 轮。` },
      ], 300);
      const parsed = extractJson(raw) as { shouldContinue?: boolean; reason?: string };
      if (typeof parsed.shouldContinue === "boolean") {
        return {
          shouldContinue: parsed.shouldContinue,
          unresolvedPoints: record.unresolved,
          reason: parsed.reason ?? (parsed.shouldContinue ? "继续辩论" : "结束辩论"),
        };
      }
    } catch {
      // fallback
    }
    return { shouldContinue: record.unresolved.length > 0 && round < MAX_ROUNDS, unresolvedPoints: record.unresolved, reason: "默认继续" };
  };

  // ===== 开庭循环 =====
  onEvent({ type: "court_status", status: "IN_PROGRESS", round: 1, turn: 0 });

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const priorTurns = allTurns.slice(-10);

    // a. 法官开场/总结
    await judgeSpeak(round, round === 1 ? "\n请宣布开庭，简述案件争议焦点。" : "\n请总结上一轮要点并宣布本轮开始。");

    // b. 原告发言
    await speakAsSide("plaintiff", round, priorTurns);

    // c. 原告辩护人
    if (defenderAssignments?.plaintiff?.length) {
      for (const defenderId of defenderAssignments.plaintiff) {
        await speakAsDefender(defenderId, "plaintiff", round, priorTurns);
      }
    }

    // d. 被告发言
    await speakAsSide("defendant", round, allTurns.slice(-10));

    // e. 被告辩护人
    if (defenderAssignments?.defendant?.length) {
      for (const defenderId of defenderAssignments.defendant) {
        await speakAsDefender(defenderId, "defendant", round, allTurns.slice(-10));
      }
    }

    // f. 消费玩家输入
    drainPlayerInputs();

    // g. 更新法官记录
    await updateRecord(round);

    // h. should_continue 判断
    const cont = await shouldContinue(round);
    onEvent({ type: "should_continue", shouldContinue: cont.shouldContinue, unresolvedPoints: cont.unresolvedPoints, reason: cont.reason });

    if (!cont.shouldContinue) {
      break;
    }
    onEvent({ type: "court_status", status: "IN_PROGRESS", round: round + 1, turn: turnCounter });
  }

  // ===== 判决 =====
  updateCourtCaseStatus(caseId, transitionStatus("IN_PROGRESS", "stop_for_verdict"));
  onEvent({ type: "court_status", status: "JUDGING", round: 0, turn: turnCounter });

  const verdict = await generateVerdict(caseId, chat, full, allTurns, record);
  setCourtVerdict(caseId, verdict);
  updateCourtCaseStatus(caseId, transitionStatus("JUDGING", "verdict_done"));
  onEvent({ type: "court_verdict", verdict });

  return { verdict, turns: allTurns };
}

// ===== 判决生成 =====
async function generateVerdict(
  caseId: string,
  chat: ChatFn,
  full: CourtCase,
  turns: CourtTurn[],
  record: CourtRecord,
): Promise<CourtVerdict> {
  const turnSummary = turns.slice(-30).map((t) => `[R${t.round} ${t.speakerName}] ${t.content}`).join("\n");
  const evidenceList = getCourtEvidence(caseId);
  const factsList = getCourtFacts(caseId);

  const prompt = `案件：${full.title}\n案情：${full.user_input}\n\n结构化事实：\n${factsList.map((f) => `- ${f.content}${f.disputed ? "（有争议）" : ""}`).join("\n")}\n\n证据：\n${evidenceList.map((e) => `- [${e.type}] ${e.name}: ${e.content}`).join("\n")}\n\n庭审发言摘要：\n${turnSummary}\n\n法官记录：\n未决：${record.unresolved.join("；")}\n已决：${record.resolved.join("；")}\n\n请生成结构化判决，返回 JSON：
- case_summary: 案件摘要
- key_facts: 关键事实数组
- key_evidence: 关键证据数组
- plaintiff_arguments: 原告核心论点数组
- defendant_arguments: 被告核心论点数组
- judge_analysis: 法官分析
- reasoning: 判决理由
- verdict: "plaintiff" | "defendant" | "mixed" | "dismissed"（按事实权重/证据/逻辑/反驳有效性判定，不是谁先没话说）
- conclusion: 结论`;

  try {
    const raw = await chat([
      { role: "system", content: `${JUDGE_SYSTEM} 只返回合法 JSON，不要 Markdown。` },
      { role: "user", content: prompt },
    ], 2000);
    const parsed = extractJson(raw) as Partial<CourtVerdict>;
    return {
      id: `ctv-${randomUUID()}`,
      caseId,
      case_summary: String(parsed.case_summary ?? "案件摘要"),
      key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts : [],
      key_evidence: Array.isArray(parsed.key_evidence) ? parsed.key_evidence : [],
      plaintiff_arguments: Array.isArray(parsed.plaintiff_arguments) ? parsed.plaintiff_arguments : [],
      defendant_arguments: Array.isArray(parsed.defendant_arguments) ? parsed.defendant_arguments : [],
      judge_analysis: String(parsed.judge_analysis ?? ""),
      reasoning: String(parsed.reasoning ?? ""),
      verdict: (parsed.verdict as CourtVerdict["verdict"]) ?? "mixed",
      conclusion: String(parsed.conclusion ?? ""),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return {
      id: `ctv-${randomUUID()}`,
      caseId,
      case_summary: full.user_input,
      key_facts: factsList.map((f) => f.content),
      key_evidence: evidenceList.map((e) => e.name),
      plaintiff_arguments: [],
      defendant_arguments: [],
      judge_analysis: "法官综合双方陈述，作出判决。",
      reasoning: "基于现有证据和辩论记录。",
      verdict: "mixed",
      conclusion: "双方各有道理，折中处理。",
      createdAt: new Date().toISOString(),
    };
  }
}
