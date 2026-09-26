// ===== M13: 趣味法庭编排器 Court Orchestrator =====
// 完整案件状态机：DRAFT -> ANALYZING -> GENERATED -> CONFIRMED -> IN_PROGRESS -> JUDGING -> COMPLETED
// 复用 bench-orchestrator 的 celebritySpeak / ChatFn / withRetry 模式。
import { randomUUID } from "node:crypto";
import type {
  CourtCardPlay,
  CourtCardType,
  CourtCase,
  CourtEvidence,
  CourtFact,
  CourtKnowledgeBase,
  CourtPlayerInput,
  CourtPlayerMove,
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
  createCourtCase,
  getCourtCase,
  getCourtEvidence,
  getCourtFacts,
  getCourtPlayerInputs,
  getCourtTurns,
  setCourtVerdict,
  updateCourtCaseAnalysis,
  updateCourtCasePlayerSide,
  updateCourtCaseStatus,
  updateCourtRecord,
  updateCourtRoundTurn,
} from "./db.js";
import {
  applyBalance,
  buildSpeakerContext,
  CARD_AMMO_COST,
  decideWinnerFromBalance,
  HAND_CARDS,
  MAX_ROUNDS,
  PLAYER_AMMO_PER_ROUND,
  resolveCard,
  transitionStatus,
  type BalanceState,
  type CourtSide,
} from "./court-state.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 客户端断连/abort 时抛出，路由层静默处理。 */
export class TrialAbortedError extends Error {
  constructor() { super("trial aborted"); this.name = "TrialAbortedError"; }
}
export const TRIAL_ABORTED = new TrialAbortedError();

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
const withRetry = async (fn: () => Promise<string>, fallbackText: string, signal?: AbortSignal): Promise<string> => {
  try {
    return await fn();
  } catch (err) {
    // abort 立即抛出，不重试、不兜底
    if (signal?.aborted || (err as Error)?.name === "AbortError" || err instanceof TrialAbortedError) throw err;
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

/** 供前端「快速开庭」展示的 3 个预置生活小案。 */
export const COURT_PRESETS: Array<{ description: string; stance: string }> = DRAFT_FALLBACKS;

/**
 * 快速开庭：用预置故事直接建案 + 本地（无 LLM）分析，跳过 38 秒 analyze 等待。
 * 玩家选好身份后一键开庭，立即进入 review。
 */
export function quickStartCase(
  userId: string,
  storyIndex: number,
  playerSide: "plaintiff" | "defendant",
): CourtCase {
  const preset = COURT_PRESETS[((storyIndex % COURT_PRESETS.length) + COURT_PRESETS.length) % COURT_PRESETS.length];
  const c = createCourtCase(userId, preset.description);
  // 本地兜底分析（不调 LLM）：直接落角色/KB/起诉状。
  const result = fallbackAnalyze(preset.description);
  updateCourtCaseAnalysis(c.id, {
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
  // 保存玩家身份
  updateCourtCasePlayerSide(c.id, playerSide);
  updateCourtCaseStatus(c.id, transitionStatus("ANALYZING", "analysis_done"));
  return getCourtCase(c.id)!;
}


// ===== 编排器 opts =====
export interface RunCourtTrialOpts {
  caseId: string;
  chat: ChatFn;
  /** 客户端断连信号：abort 后庭审立即终止，不再调 LLM。 */
  signal?: AbortSignal;
  onEvent: (e: CourtTrialEvent) => void;
  getPendingPlayerInputs: () => CourtPlayerInput[];
  markPlayerInputHandled: (id: string) => void;
  /** 玩家通过 play-card 动作提交的待出牌队列。 */
  getPendingCardPlays?: () => CourtCardPlay[];
  markCardPlayHandled?: (id: string) => void;
  defenderAssignments?: { plaintiff?: string[]; defendant?: string[] };
  perspective: Perspective;
  /** 玩家扮演的一方：该方当事人席位由玩家本人当庭出牌。 */
  playerSide?: "plaintiff" | "defendant";
  /** 测试可调：玩家回合等待出牌总时长（默认 15s，超时自动 pass）。 */
  playerTurnTimeoutMs?: number;
  /** 测试可调：轮询出牌队列的间隔（默认 200ms）。 */
  playerTurnPollMs?: number;
  /** 兼容旧测试选项名：玩家回合超时 / 轮询间隔。 */
  playerInputTimeoutMs?: number;
  playerInputPollMs?: number;
}

/** 局势天平初始值（原告:被告，0-100 互补）。 */
const INITIAL_BALANCE: BalanceState = { plaintiff: 50, defendant: 50 };

/** mock 牌越界启发式词表（无 LLM、确定性）。 */
const MOCK_OUTRAGEOUS_WORDS = ["笨蛋", "蠢货", "白痴", "滚", "垃圾", "不要脸", "废物", "神经病"];

const JUDGE_SYSTEM =
  "你是叽里呱啦趣味法庭的 AI 法官，友善、幽默、公正。负责主持庭审、归纳记录并作出判决。判决不具有真实法律效力；胜方由双方庭审天平决定，你只负责写情理与高光。";

/**
 * 主庭审流程（3 轮 · 预制牌 + 天平）：
 * 每轮固定：法官开场 → 对手 AI 发言 → 玩家回合（出牌，15s 超时自动 pass）→ 对手反驳 → 回合小结。
 * 胜方由终局天平决定，LLM 只写 reasoning / keyMoments。
 */
export async function runCourtTrial(opts: RunCourtTrialOpts): Promise<{ verdict: CourtVerdict; turns: CourtTurn[] }> {
  const {
    caseId, chat, onEvent, getPendingPlayerInputs, markPlayerInputHandled,
    getPendingCardPlays, markCardPlayHandled, defenderAssignments, perspective, playerSide, signal,
  } = opts;
  const checkAbort = (): void => { if (signal?.aborted) throw TRIAL_ABORTED; };
  const signalChat: ChatFn = (messages, maxTokens, chatOpts) => {
    checkAbort();
    return chat(messages, maxTokens, { ...chatOpts, signal });
  };

  let full = getCourtCase(caseId);
  if (!full) throw new Error(`案件不存在: ${caseId}`);
  if (full.status !== "CONFIRMED") {
    throw new Error(`案件状态非 CONFIRMED，当前: ${full.status}`);
  }
  const effectivePlayerSide = playerSide ?? full.player_side;
  const opponentSide: CourtSide | null = effectivePlayerSide
    ? effectivePlayerSide === "plaintiff" ? "defendant" : "plaintiff"
    : null;

  updateCourtCaseStatus(caseId, transitionStatus(full.status, "start"));
  full = getCourtCase(caseId)!;

  // 起诉状/答辩状注入对应方知识库。
  const docs = full as typeof full & { plaintiff_complaint?: string; defendant_answer?: string };
  if (docs.plaintiff_complaint?.trim() && full.plaintiff_kb) {
    full.plaintiff_kb.arguments = [`起诉状：${docs.plaintiff_complaint.trim()}`, ...full.plaintiff_kb.arguments];
  }
  if (docs.defendant_answer?.trim() && full.defendant_kb) {
    full.defendant_kb.arguments = [`答辩状：${docs.defendant_answer.trim()}`, ...full.defendant_kb.arguments];
  }

  let turnCounter = 0;
  const allTurns: CourtTurn[] = getCourtTurns(caseId);

  let record: CourtRecord = {
    caseId,
    facts: full.facts.filter((f) => !f.disputed).map((f) => f.content),
    claims: [],
    arguments: [],
    counter_arguments: [],
    evidence_relations: [],
    unresolved: [...full.dispute_points],
    resolved: [],
    momentum: { ...INITIAL_BALANCE },
    updatedAt: new Date().toISOString(),
  };

  // ===== 天平（0-100 互补）=====
  let balance: BalanceState = { ...INITIAL_BALANCE };
  const playerMoves: CourtPlayerMove[] = [];
  const handledInputIds = new Set<string>();
  const handledPlayIds = new Set<string>();

  const bumpBalance = (side: CourtSide, delta: number, reason: string): void => {
    balance = applyBalance(balance, side, delta);
    record = { ...record, momentum: { ...balance }, updatedAt: new Date().toISOString() };
    updateCourtRecord(caseId, record);
    onEvent({ type: "momentum_update", momentum: { ...balance } });
    onEvent({ type: "court_balance_update", balance: { ...balance }, lastDelta: delta, reason });
  };
  // 开庭即广播初始天平。
  onEvent({ type: "momentum_update", momentum: { ...INITIAL_BALANCE } });
  onEvent({ type: "court_balance_update", balance: { ...INITIAL_BALANCE }, lastDelta: 0, reason: "开庭，天平居中。" });

  const pushTurn = (
    round: number,
    speaker: CourtTurn["speaker"],
    speakerId: string,
    speakerName: string,
    content: string,
  ): CourtTurn => {
    checkAbort();
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

  const buildSideContext = (side: CourtSide, round: number, priorTurns: CourtTurn[]): string => {
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

  const speakAsSide = async (side: CourtSide, round: number, priorTurns: CourtTurn[], prefix?: string): Promise<void> => {
    const role = side === "plaintiff" ? full!.plaintiff : full!.defendant;
    const persona = role?.persona ?? (side === "plaintiff" ? "你是原告。" : "你是被告。");
    const speakerName = role?.name ?? (side === "plaintiff" ? "原告" : "被告");
    const text = await withRetry(
      async () => {
        const raw = await signalChat([
          { role: "system", content: `${persona}\n保持你的角色，用第一人称发言，100-300字，有观点。` },
          { role: "user", content: buildSideContext(side, round, priorTurns) },
        ], 800);
        return tidySpeech(raw) || `${speakerName}: （兜底发言）`;
      },
      `${speakerName}: （兜底发言）`,
    );
    pushTurn(round, side, role?.id ?? side, speakerName, prefix ? `${prefix}${text}` : text);
    bumpBalance(side, 3, `${speakerName} 当庭陈述，天平 +3。`);
    await sleep(150);
  };

  const judgeOpenRound = (round: number): void => {
    const title = full!.title || "本案";
    let text: string;
    if (round === 1) {
      const focus = full!.dispute_points.length ? full!.dispute_points.join("；") : full!.user_input.slice(0, 60);
      text = `现在开庭。本案「${title}」的争议焦点是：${focus}。每回合你有 2 点弹药，尽量把天平推向你方。`;
    } else {
      const unresolved = record.unresolved.length ? record.unresolved.join("；") : "双方的核心分歧";
      text = `进入第 ${round} 轮辩论。目前仍需查明：${unresolved}。你的弹药已补满，请出牌。`;
    }
    pushTurn(round, "judge", "judge", "AI 法官", text);
  };

  // 己方证据池：玩家这一方已上传的证据。
  const playerEvidencePool = (side: CourtSide) =>
    full!.evidence.filter((e) => e.submittedBy === side || e.submittedBy === "user");

  // ---- 结算一张牌并上屏 ----
  const playOneCard = async (
    round: number,
    side: CourtSide,
    card: CourtCardType,
    opts2: { targetEvidenceId?: string; freeText?: string; label?: string },
  ): Promise<CourtTurn | null> => {
    const evPool = playerEvidencePool(side).map((e) => ({ id: e.id, name: e.name, content: e.content }));
    // 兼容旧自由输入/未命中证据 id：把文本包装成临时证据参与命中判定。
    let targetEvidenceId = opts2.targetEvidenceId;
    if (card === "evidence" && !evPool.some((e) => e.id === targetEvidenceId)) {
      const synthId = targetEvidenceId || "legacy-evidence";
      evPool.push({ id: synthId, name: synthId, content: opts2.freeText ?? synthId });
      targetEvidenceId = synthId;
    }
    const resolution = resolveCard(card, {
      unresolved: record.unresolved,
      evidencePool: evPool,
      targetEvidenceId,
      freeText: opts2.freeText,
      mockOutrageous: MOCK_OUTRAGEOUS_WORDS.some((w) => (opts2.freeText ?? "").includes(w)),
    });

    const label = opts2.label ?? opts2.freeText ?? "";
    const cardNameMap: Record<CourtCardType, string> = {
      attack: "攻击论点", evidence: "出示证据", mock: "嘲讽对方", request_record: "要求记录",
    };
    const content = label || `（${cardNameMap[card]}）`;
    const turn = pushTurn(round, "player", "player", "你", content);

    if (resolution.delta !== 0) bumpBalance(side, resolution.delta, resolution.judgeComment);

    if (resolution.resolvedPoint) {
      record = {
        ...record,
        unresolved: record.unresolved.filter((u) => u !== resolution.resolvedPoint),
        resolved: [...new Set([...record.resolved, resolution.resolvedPoint])],
        updatedAt: new Date().toISOString(),
      };
    }
    if (resolution.addedFact) {
      record = { ...record, facts: [...new Set([...record.facts, resolution.addedFact])], updatedAt: new Date().toISOString() };
    }
    updateCourtRecord(caseId, record);

    playerMoves.push({
      round, card, targetEvidenceId, freeText: opts2.freeText,
      delta: resolution.delta, hit: resolution.hit, judgeComment: resolution.judgeComment,
    });
    onEvent({ type: "court_card_resolved", card, hit: resolution.hit, delta: resolution.delta, judgeComment: resolution.judgeComment });
    onEvent({ type: "player_turn", turn });
    return turn;
  };

  // ---- 玩家回合：阻塞等待出牌（15s 超时自动 pass），最多打空 2 点弹药 ----
  const runPlayerTurn = async (round: number, side: CourtSide): Promise<CourtTurn | null> => {
    const deadline = Date.now() + (opts.playerTurnTimeoutMs ?? opts.playerInputTimeoutMs ?? 15_000);
    const pollMs = opts.playerTurnPollMs ?? opts.playerInputPollMs ?? 200;
    let ammoLeft = PLAYER_AMMO_PER_ROUND;
    let lastTurn: CourtTurn | null = null;

    onEvent({ type: "court_player_turn", round, ammo: ammoLeft, handCards: [...HAND_CARDS], unresolved: [...record.unresolved] });
    onEvent({ type: "player_turn_request", round, side });

    while (ammoLeft > 0 && Date.now() < deadline) {
      checkAbort();
      // 1) 结构化出牌
      const plays = (getPendingCardPlays?.() ?? []).filter((p) => !handledPlayIds.has(p.id));
      // 2) 兼容旧自由打字输入（映射成牌）
      const legacy = getPendingPlayerInputs().filter((i) => i.player_role === side && !handledInputIds.has(i.id));

      let played = false;
      if (plays.length) {
        const play = plays[0];
        handledPlayIds.add(play.id);
        markCardPlayHandled?.(play.id);
        const cost = CARD_AMMO_COST[play.card];
        if (cost <= ammoLeft) {
          ammoLeft -= cost;
          lastTurn = await playOneCard(round, side, play.card, {
            targetEvidenceId: play.targetEvidenceId, freeText: play.freeText,
          });
          played = true;
        }
      } else if (legacy.length) {
        const input = legacy[0];
        handledInputIds.add(input.id);
        onEvent({ type: "player_input_ack", inputId: input.id });
        markPlayerInputHandled(input.id);
        const card: CourtCardType = input.type === "evidence" ? "evidence" : "attack";
        const cost = CARD_AMMO_COST[card];
        if (cost <= ammoLeft) {
          ammoLeft -= cost;
          lastTurn = await playOneCard(round, side, card, {
            targetEvidenceId: input.evidenceName, freeText: input.content, label: input.content,
          });
          played = true;
        }
      }
      if (!played) {
        await sleep(pollMs);
      }
    }
    return lastTurn;
  };

  // 对手针对玩家刚出的牌短接茬（天平再向对手 +4）。
  const respondToPlayer = async (playerTurn: CourtTurn, opponent: CourtSide, round: number): Promise<void> => {
    const role = opponent === "plaintiff" ? full!.plaintiff : full!.defendant;
    const persona = role?.persona ?? (opponent === "plaintiff" ? "你是原告。" : "你是被告。");
    const kb = opponent === "plaintiff" ? full!.plaintiff_kb : full!.defendant_kb;
    const speakerName = role?.name ?? (opponent === "plaintiff" ? "原告" : "被告");
    const context = buildSpeakerContext({
      caseTitle: full!.title || "未命名案件",
      userInput: full!.user_input,
      disputePoints: full!.dispute_points,
      publicFacts: record.facts,
      evidenceNames: full!.evidence.map((e) => e.name),
      priorTurns: allTurns.slice(-10),
      kbFacts: kb?.facts ?? [],
      kbClaims: kb?.claims ?? [],
      kbArguments: kb?.arguments ?? [],
      kbAssumptions: kb?.assumptions ?? [],
      kbUserAdditions: kb?.user_additions ?? [],
      opponentArguments: kb?.opponent_arguments ?? [],
      unresolvedPoints: record.unresolved,
      round,
      speakerSide: opponent,
    }) + `\n\n对方刚刚当庭说：「${playerTurn.content}」。请第一人称、30-80字直接针对这句话反驳，简短有力。`;

    const text = await withRetry(
      async () => {
        const raw = await signalChat([
          { role: "system", content: `${persona}\n保持你的角色，第一人称短反驳。` },
          { role: "user", content: context },
        ], 300);
        return tidySpeech(raw) || `${speakerName}: （反驳）`;
      },
      `${speakerName}: （反驳）`,
    );
    pushTurn(round, opponent, role?.id ?? opponent, speakerName, text);
    bumpBalance(opponent, 4, `${speakerName} 反驳你的出牌，天平 -4。`);
    await sleep(150);
  };

  // 更新法官记录（保留：LLM 归纳 unresolved/resolved）。
  const updateRecord = async (round: number): Promise<void> => {
    const recentTurns = allTurns.filter((t) => t.round === round);
    const turnText = recentTurns.map((t) => `[${t.speakerName}] ${t.content}`).join("\n");
    const prompt = `当前案件：${full!.title}\n争议点：${full!.dispute_points.join("；")}\n\n本轮发言：\n${turnText}\n\n请更新法官记录，返回 JSON：\n- facts: 本轮确认的新事实数组\n- claims: 双方主张数组\n- arguments: 原告论点数组\n- counter_arguments: 被告反驳数组\n- unresolved: 仍未解决的问题数组\n- resolved: 本轮已解决的问题数组\n只返回 JSON。`;
    try {
      const raw = await signalChat([
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
    } catch { /* 保持现有记录 */ }
    updateCourtRecord(caseId, record);
    onEvent({ type: "court_record", record });
  };

  onEvent({ type: "court_status", status: "IN_PROGRESS", round: 1, turn: 0 });

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    checkAbort();
    judgeOpenRound(round);

    if (effectivePlayerSide && opponentSide) {
      // 对手 AI 先发言
      await speakAsSide(opponentSide, round, allTurns.slice(-10));
      // 玩家回合（出牌 / 超时 pass）
      const lastPlayerTurn = await runPlayerTurn(round, effectivePlayerSide);
      if (!lastPlayerTurn) {
        // 玩家 pass：由玩家这一方 AI/辩护人兜底代述，避免天平一边倒。
        await speakAsSide(effectivePlayerSide, round, allTurns.slice(-10), "（你未出牌，你的席位代为陈述）");
      } else {
        // 对手针对玩家出牌反驳
        await respondToPlayer(lastPlayerTurn, opponentSide, round);
      }
    } else {
      // 观众席/无人认领：双方 AI 各自发言。
      await speakAsSide("plaintiff", round, allTurns.slice(-10));
      await speakAsSide("defendant", round, allTurns.slice(-10));
    }

    await updateRecord(round);
    onEvent({ type: "court_round_recap", round, unresolved: [...record.unresolved], balance: { ...balance } });

    const done = round >= MAX_ROUNDS || record.unresolved.length === 0;
    onEvent({ type: "should_continue", shouldContinue: !done, unresolvedPoints: record.unresolved, reason: done ? "庭审结束" : "继续下一轮" });
    if (done) break;
    onEvent({ type: "court_status", status: "IN_PROGRESS", round: round + 1, turn: turnCounter });
  }

  // ===== 判决（胜方由天平决定，LLM 只写文案）=====
  updateCourtCaseStatus(caseId, transitionStatus("IN_PROGRESS", "stop_for_verdict"));
  onEvent({ type: "court_status", status: "JUDGING", round: 0, turn: turnCounter });

  const winner = decideWinnerFromBalance(balance);
  const playerTurns = allTurns.filter((t) => t.speaker === "player");
  checkAbort();
  const verdict = await generateVerdict(caseId, signalChat, full, allTurns, record, playerTurns, effectivePlayerSide, signal, balance, playerMoves, winner);
  setCourtVerdict(caseId, verdict);
  updateCourtCaseStatus(caseId, transitionStatus("JUDGING", "verdict_done"));
  onEvent({ type: "court_verdict", verdict });

  return { verdict, turns: allTurns };
}

// ===== 判决生成（winner 天平驱动，LLM 只写 reasoning / keyMoments）=====
async function generateVerdict(
  caseId: string,
  chat: ChatFn,
  full: CourtCase,
  turns: CourtTurn[],
  record: CourtRecord,
  playerTurns: CourtTurn[],
  playerSide: "plaintiff" | "defendant" | undefined,
  signal: AbortSignal | undefined,
  balance: BalanceState,
  playerMoves: CourtPlayerMove[],
  winner: "plaintiff" | "defendant" | "mixed",
): Promise<CourtVerdict> {
  if (signal?.aborted) throw TRIAL_ABORTED;
  const turnSummary = turns.slice(-30).map((t) => `[R${t.round} ${t.speakerName}] ${t.content}`).join("\n");
  const evidenceList = getCourtEvidence(caseId);
  const factsList = getCourtFacts(caseId);
  const playerSideName = playerSide === "plaintiff" ? "原告" : playerSide === "defendant" ? "被告" : null;
  const playerTurnText = playerTurns.length
    ? playerTurns.map((t) => `[R${t.round}] ${t.content}`).join("\n")
    : "（玩家本轮未出牌）";

  // 高光时刻：玩家打出的最大正 delta 那张牌。
  const highlight = playerMoves.length
    ? playerMoves.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a))
    : null;
  const highlightText = highlight
    ? `玩家高光：R${highlight.round} 打出【${highlight.card}】，天平变化 ${highlight.delta > 0 ? "+" : ""}${highlight.delta}（${highlight.hit ? "命中" : "未命中"}）。`
    : "";

  const prompt = `案件：${full.title}\n案情：${full.user_input}\n\n结构化事实：\n${factsList.map((f) => `- ${f.content}${f.disputed ? "（有争议）" : ""}`).join("\n")}\n\n证据：\n${evidenceList.map((e) => `- [${e.type}] ${e.name}: ${e.content}`).join("\n")}\n\n庭审发言摘要：\n${turnSummary}\n\n法官记录：\n未决：${record.unresolved.join("；")}\n已决：${record.resolved.join("；")}\n\n终局天平（原告:被告）：${balance.plaintiff}:${balance.defendant}。本庭已据此判定胜方为「${winner}」，你不要改判。\n\n${playerSideName ? `玩家扮演的是${playerSideName}方。玩家出牌记录：\n${playerTurnText}\n${highlightText}\n\n` : ""}请生成结构化判决，返回 JSON：\n- case_summary: 案件摘要\n- key_facts: 关键事实数组\n- key_evidence: 关键证据数组\n- plaintiff_arguments: 原告核心论点数组\n- defendant_arguments: 被告核心论点数组\n- judge_analysis: 法官分析\n- reasoning: 判决理由（必须显式把结果归因到天平与玩家当庭表现，例如"由于你当庭出示……把天平推到${balance.plaintiff}:${balance.defendant}"；不要自己决定胜方）\n- conclusion: 结论（一句，符合天平判定的胜方）\n- key_moments: 高光时刻文案数组（1-3 条，围绕玩家打出的关键牌）`;

  try {
    const raw = await chat([
      { role: "system", content: `${JUDGE_SYSTEM} 只返回合法 JSON，不要 Markdown。` },
      { role: "user", content: prompt },
    ], 2000, { signal });
    const parsed = extractJson(raw) as Partial<CourtVerdict> & { key_moments?: string[] };
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
      verdict: winner,
      conclusion: String(parsed.conclusion ?? ""),
      createdAt: new Date().toISOString(),
      key_moments: Array.isArray(parsed.key_moments) ? parsed.key_moments : (highlightText ? [highlightText] : []),
      player_moves: playerMoves,
      final_balance: { ...balance },
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
      judge_analysis: "法官综合双方陈述与终局天平，作出判决。",
      reasoning: `终局天平 ${balance.plaintiff}:${balance.defendant}，据此判定胜方。`,
      verdict: winner,
      conclusion: winner === "mixed" ? "双方势均力敌，折中处理。" : winner === "plaintiff" ? "原告方胜诉。" : "被告方胜诉。",
      createdAt: new Date().toISOString(),
      key_moments: highlightText ? [highlightText] : [],
      player_moves: playerMoves,
      final_balance: { ...balance },
    };
  }
}
