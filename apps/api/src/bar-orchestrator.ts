// ===== M8: 酒吧辩论编排器 Bar Orchestrator =====
// 纯 AI 逻辑层：选辩手 / 名人发言 / 酒保总结。所有 LLM 调用串行，失败有兜底。
import { CELEBRITIES } from "@balabala/shared";
import { resolveCharacter, type ResolvedCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";

export type DebateSide = "pro" | "con";

/** 带立场的辩手（在 ResolvedCharacter 上扩展 side）。 */
export interface Debater extends ResolvedCharacter {
  side: DebateSide;
}

export interface BarSpeechResult {
  text: string;
  quote?: string;
}

export interface BartenderQuote {
  speaker: string;
  text: string;
  side: DebateSide;
}

export interface BartenderSummaryResult {
  consensus: string;
  quotes: BartenderQuote[];
}

/** 内置轻松辩论话题库。 */
export const TOPIC_LIBRARY: string[] = [
  "外卖迟到，该不该给差评？",
  "AI 会不会取代人类的工作？",
  "恋爱里，该不该看对方手机？",
  "年轻人该先攒钱还是先享受？",
  "朋友借钱不还，要不要撕破脸？",
  "加班到底是奋斗还是摸鱼？",
  "手机该不该进课堂？",
  "过年该回婆家还是回娘家？",
  "朋友圈该不该屏蔽父母？",
  "年轻人该去大城市还是留在家乡？",
  "外卖小哥闯红灯，该不该同情？",
  "结婚一定要买房吗？",
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 抽取 LLM 返回中的 JSON 对象。 */
const extractJson = (text: string): unknown => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
};

/** 清理发言文本并限制长度（酒吧发言口语化、不超过约 150 字）。 */
const tidy = (raw: string, max = 150): string => {
  let t = raw.trim();
  t = t.replace(/^["「『]|["」』]$/g, "").trim();
  t = t.replace(/^[^，。：:]{0,12}说[：:]\s*/, "").trim();
  if (t.length > max) {
    t = t.slice(0, max).replace(/[，。、；,;.!?！？\s]+$/, "") + "…";
  }
  return t;
};

// ===== 1. 选辩手 =====
/**
 * AI 根据话题从 20 位名人中推荐正反方辩手（各 1-2 位）。
 * 失败或结果不合法时按领域轮转兜底，保证至少正反各 1 位。
 */
export const selectDebaters = async (
  topic: string,
  count: number,
  chat: ChatFn,
): Promise<Debater[]> => {
  const want = Math.min(4, Math.max(2, count));
  const catalog = CELEBRITIES.map((c) => `${c.id}（${c.name}，${c.field}）`).join("；");
  const system =
    "你是一家酒吧辩论的主持人。请根据给定话题，从候选名人名单中挑选最适合的辩手：正方 1-2 位、反方 1-2 位，双方风格要互补（如一位理性派 + 一位感性派）。只返回 JSON {\"pro\":[\"id\"],\"con\":[\"id\"]}，id 必须严格来自候选名单，不要解释。";
  const user = `话题：${topic}\n候选名人：${catalog}`;

  /** 兜底：按领域轮转取名人，前一半正方、后一半反方。 */
  const fallbackPick = (): Debater[] => {
    const byField = new Map<string, string[]>();
    for (const c of CELEBRITIES) {
      const list = byField.get(c.field) ?? [];
      list.push(c.id);
      byField.set(c.field, list);
    }
    const fields = [...byField.keys()];
    const picked: string[] = [];
    let i = 0;
    while (picked.length < want) {
      const pool = byField.get(fields[i % fields.length])!;
      const candidate = pool[Math.floor(i / fields.length) % pool.length];
      if (!picked.includes(candidate)) picked.push(candidate);
      i += 1;
    }
    const celebs = picked.map((id) => resolveCharacter(id)).filter((c): c is ResolvedCharacter => Boolean(c));
    const half = Math.max(1, Math.ceil(celebs.length / 2));
    const pro = celebs.slice(0, half).map((c) => ({ ...c, side: "pro" as const }));
    const con = celebs.slice(half).map((c) => ({ ...c, side: "con" as const }));
    return [...pro, ...con];
  };

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      400,
    );
    const parsed = extractJson(raw) as { pro?: unknown; con?: unknown };
    const toIds = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const proIds = toIds(parsed.pro).filter((id) => resolveCharacter(id));
    const conIds = toIds(parsed.con).filter((id) => resolveCharacter(id));
    if (proIds.length === 0 || conIds.length === 0) return fallbackPick();
    const pro = proIds.slice(0, 2).map((id) => ({ ...resolveCharacter(id)!, side: "pro" as const }));
    const con = conIds.slice(0, 2).map((id) => ({ ...resolveCharacter(id)!, side: "con" as const }));
    return [...pro, ...con];
  } catch {
    return fallbackPick();
  }
};

// ===== 2. 名人发言 =====
const SIDE_LABEL: Record<DebateSide, string> = {
  pro: "正方（支持这一方 / 站边赞成）",
  con: "反方（反对这一方 / 站边质疑）",
};

/**
 * 让某位名人按 persona + 立场在酒吧发言（< 150 字），同时从发言里挑一句金句。
 */
export const debateSpeech = async (
  celebrity: ResolvedCharacter,
  topic: string,
  side: DebateSide,
  context: string[],
  chat: ChatFn,
): Promise<BarSpeechResult> => {
  const system =
    `${celebrity.persona}\n` +
    `你现在在一家灯光暖黄的酒吧里参加一场轻松的话题辩论，你是${SIDE_LABEL[side]}。` +
    "用第一人称、保持你一贯的说话风格，口语化、有梗、有观点，100-150 字，像酒过三巡后聊出来的那种妙语。" +
    '只返回 JSON：{"text":"你的发言内容","quote":"从发言里挑一句最 punchy、最适合印在酒杯垫上的金句，不超过 30 字"}。' +
    "不要 Markdown，不要解释，不要自我介绍。";
  const recent = context.slice(-6).join("\n");
  const user =
    `话题：${topic}\n` +
    (recent
      ? `此前双方的发言：\n${recent}\n\n你可以反驳、补充或换个角度。`
      : "这是你的第一次发言，先亮明你的立场。");
  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      600,
    );
    const parsed = extractJson(raw) as { text?: unknown; quote?: unknown };
    const text = tidy(String(parsed.text ?? ""));
    if (!text) throw new Error("empty speech");
    const quoteRaw = String(parsed.quote ?? "").trim();
    const quote = quoteRaw ? tidy(quoteRaw, 40) : undefined;
    await sleep(200); // 限流：串行调用间留一点间隔
    return { text, quote };
  } catch {
    await sleep(200);
    return { text: tidy(celebrity.greeting, 120) };
  }
};

// ===== 3. 酒保总结 =====
/**
 * 酒保/和事佬角色：不站队，提炼双方共识 + 精选最有趣的金句。
 */
export const bartenderSummary = async (
  topic: string,
  proPoints: string[],
  conPoints: string[],
  chat: ChatFn,
): Promise<BartenderSummaryResult> => {
  const system =
    "你是这家酒吧的酒保，见多识广、幽默圆场，从不站队。刚听完一场轻松辩论，" +
    "请用 80-150 字提炼双方真正的共识（不是判决，而是两边其实都对的那部分），" +
    "并从全场发言里挑出最有趣、最适合下酒的 2-3 句金句。" +
    '只返回 JSON：{"consensus":"共识小结","quotes":[{"speaker":"谁说的","text":"金句内容","side":"pro"或"con"}]}。' +
    "不要 Markdown，不要长篇大论。";
  const user =
    `话题：${topic}\n` +
    `正方观点：\n${proPoints.slice(-8).join("\n") || "（无）"}\n` +
    `反方观点：\n${conPoints.slice(-8).join("\n") || "（无）"}`;

  const fallback: BartenderSummaryResult = {
    consensus: "其实两边都有道理——这正是酒吧聊到天亮也没结论的原因。来，干杯。",
    quotes: [],
  };

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      900,
    );
    const parsed = extractJson(raw) as { consensus?: unknown; quotes?: unknown };
    const consensus = tidy(String(parsed.consensus ?? ""), 160);
    const rawQuotes = Array.isArray(parsed.quotes) ? parsed.quotes : [];
    const quotes: BartenderQuote[] = rawQuotes
      .map((q) => q as Partial<BartenderQuote>)
      .filter((q) => typeof q?.text === "string" && q.text.trim().length > 0)
      .slice(0, 3)
      .map((q) => ({
        speaker: String(q.speaker ?? "某位客人"),
        text: tidy(String(q.text), 60),
        side: q.side === "con" ? "con" : "pro",
      }));
    if (!consensus) return fallback;
    return { consensus, quotes };
  } catch {
    return fallback;
  }
};

// ===== 4. 玩家作为正式辩手的 3 回合辩论 + 裁判裁决 =====
// 现状是两位 AI 自动吵架、玩家围观投票。重构后：玩家选边加入完整 3 回合
// （立论 → 对方 AI 针对性反驳 → 论据强度条变化），结束由「苏格拉底」裁判裁决胜负。
export type DebateStage = "prepare" | "debating" | "verdict";

export interface DebateTurn {
  round: number;
  side: DebateSide | "player";
  speaker: string;
  text: string;
  /** 这一轮发言用的攻击角度（玩家与 AI 对称记录）。 */
  angle?: ArgumentAngle;
}

export interface DebateState {
  stage: DebateStage;
  topic: string;
  /** 玩家站的边。 */
  playerSide: DebateSide;
  /** 下一回合（1 起）；等于 totalRounds+1 表示已打满可裁决。 */
  round: number;
  totalRounds: number;
  /** 双向论据强度，0-100，二者之和恒为 100。 */
  argumentStrength: { pro: number; con: number };
  transcript: DebateTurn[];
  /** 对方 AI 辩手（名人 persona）。 */
  aiOpponent: ResolvedCharacter;
  /** 本回合玩家已选的攻击角度。 */
  playerAngle?: ArgumentAngle;
  /** AI 当前这一回合的防御倾向（开局随机，每回合结束揭示下回合的）。 */
  aiTendency: StanceTendency;
  /** 上一回合角度克制结算结果（供前端飘字）。 */
  lastEffectiveness?: AngleEffectiveness;
}

export interface DebateVerdict {
  winner: DebateSide | "tie";
  reasoning: string;
  keyMoments: string[];
}

/** playerSpeak 的完整结算结果：双维度评分 + 双方对称 delta + 下回合揭示的 AI 倾向。 */
export interface PlayerSpeakResult {
  playerTurn: DebateTurn;
  aiTurn: DebateTurn;
  playerScore: ArgumentScore;
  aiScore: ArgumentScore;
  playerEffectiveness: AngleEffectiveness;
  aiEffectiveness: AngleEffectiveness;
  playerDelta: number;
  aiDelta: number;
  /** 刚揭示的、下一回合 AI 的防御倾向。 */
  nextAiTendency: StanceTendency;
  state: DebateState;
}

export interface DebateSession {
  start(topic: string, playerSide: DebateSide): Promise<DebateState>;
  /** 玩家点选角度卡时预览克制结果（纯查询，不改状态）。 */
  previewAngle(angle: ArgumentAngle): AngleCounterResult;
  playerSpeak(round: number, angle: ArgumentAngle, content: string): Promise<PlayerSpeakResult>;
  aiSpeak(side: DebateSide, round: number): Promise<DebateTurn>;
  judgeVerdict(): Promise<{ verdict: DebateVerdict; state: DebateState }>;
  getState(): DebateState;
}

const TOTAL_ROUNDS = 3;

/**
 * 把一方论据强度变化映射到双向条（纯函数）：修改 side 方并 clamp 0-100，另一方取 100 补数。
 */
export const applyStrengthDelta = (
  strength: { pro: number; con: number },
  side: DebateSide,
  delta: number,
): { pro: number; con: number } => {
  const nextSide = Math.max(0, Math.min(100, Math.round(strength[side] + delta)));
  return side === "pro"
    ? { pro: nextSide, con: 100 - nextSide }
    : { pro: 100 - nextSide, con: nextSide };
};

/** 根据最终强度判定胜方（纯函数）：任一方领先 ≥3 分胜，否则平局。 */
export const decideWinner = (strength: { pro: number; con: number }): DebateSide | "tie" => {
  if (strength.pro - strength.con >= 3) return "pro";
  if (strength.con - strength.pro >= 3) return "con";
  return "tie";
};

// ===== 角度克制三角（规格 4.5，全部为纯函数，可单测）=====
/** 玩家每回合选的攻击角度。 */
export type ArgumentAngle = "data" | "emotion" | "logic";
/** AI 对手的防御倾向，每回合随机切换。 */
export type StanceTendency = "rational" | "emotional" | "mixed";
/** 角度克制关系：counter=克制(+8) neutral=中性(+5) same=同属性(+2)。 */
export type AngleEffectiveness = "counter" | "neutral" | "same";

export interface AngleCounterResult {
  delta: number;
  effectiveness: AngleEffectiveness;
}

/** LLM 双维度评分：内容质量 + 切题度，各 0-10。 */
export interface ArgumentScore {
  content_quality: number;
  relevance: number;
}

/**
 * 克制关系表（规格 4.5，定死）：
 *  data    vs rational → same(+2)；vs emotional → counter(+8)；vs mixed → neutral(+5)
 *  emotion vs emotional → same(+2)；vs rational → counter(+8)；vs mixed → neutral(+5)
 *  logic   vs mixed → counter(+8)；vs rational/emotional → neutral(+5)
 */
const COUNTER_TABLE: Record<ArgumentAngle, Record<StanceTendency, AngleCounterResult>> = {
  data: {
    rational: { delta: 2, effectiveness: "same" },
    emotional: { delta: 8, effectiveness: "counter" },
    mixed: { delta: 5, effectiveness: "neutral" },
  },
  emotion: {
    rational: { delta: 8, effectiveness: "counter" },
    emotional: { delta: 2, effectiveness: "same" },
    mixed: { delta: 5, effectiveness: "neutral" },
  },
  logic: {
    rational: { delta: 5, effectiveness: "neutral" },
    emotional: { delta: 5, effectiveness: "neutral" },
    mixed: { delta: 8, effectiveness: "counter" },
  },
};

/** 纯函数：给定玩家攻击角度与 AI 防御倾向，返回克制分值与效果标签。 */
export const resolveAngleCounter = (
  angle: ArgumentAngle,
  tendency: StanceTendency,
): AngleCounterResult => COUNTER_TABLE[angle][tendency];

/** 角度 ↔ 倾向互转：把对方的"角度"视作它的"倾向"，用于 AI 对称结算。 */
export const tendencyFromAngle = (angle: ArgumentAngle): StanceTendency =>
  angle === "data" ? "rational" : angle === "emotion" ? "emotional" : "mixed";

export const angleFromTendency = (tendency: StanceTendency): ArgumentAngle =>
  tendency === "rational" ? "data" : tendency === "emotional" ? "emotion" : "logic";

/** 随机摇一个 AI 防御倾向（可注入 rand 便于测试）。 */
export const rollStanceTendency = (rand: () => number = Math.random): StanceTendency => {
  const pool: StanceTendency[] = ["rational", "emotional", "mixed"];
  return pool[Math.floor(rand() * pool.length)];
};

/** 随机摇一个 AI 反驳角度（可注入 rand 便于测试）。 */
export const rollArgumentAngle = (rand: () => number = Math.random): ArgumentAngle => {
  const pool: ArgumentAngle[] = ["data", "emotion", "logic"];
  return pool[Math.floor(rand() * pool.length)];
};

/** 最终强度 delta = 角度克制分 + (content_quality-5) + (relevance-5)*0.5（规格 4.5）。 */
export const computeTurnDelta = (angleDelta: number, score: ArgumentScore): number =>
  angleDelta + (score.content_quality - 5) + (score.relevance - 5) * 0.5;

export const isArgumentAngle = (v: unknown): v is ArgumentAngle =>
  v === "data" || v === "emotion" || v === "logic";

/** bar-orchestrator 自带的轻量重试（本文件未导出 withRetry）。 */
const withRetryChat = async (fn: () => Promise<string>): Promise<string> => {
  try {
    return await fn();
  } catch {
    await sleep(1000);
    return await fn();
  }
};

/** 各角度的中文释义，喂给评委与前端共用。 */
export const ANGLE_LABEL: Record<ArgumentAngle, string> = {
  data: "摆事实/数据（用具体数字、统计、真实案例说话）",
  emotion: "打情感/故事（用亲身经历、共情、画面感打动人）",
  logic: "戳对方逻辑漏洞（指出前提谬误、自相矛盾、以偏概全）",
};

/**
 * 让 LLM 给一轮发言打双维度分（0-10 整数）：
 *  content_quality = 论证本身质量；relevance = 是否真的在所选角度上发力。
 * 玩家与 AI 对称使用，失败时中庸 5/5。
 */
const scoreArgument = async (
  topic: string,
  side: DebateSide,
  angle: ArgumentAngle,
  content: string,
  chat: ChatFn,
): Promise<ArgumentScore> => {
  const system =
    "你是酒吧辩论的场外技术评委，只看论证，从两个维度独立打 0-10 的整数分（10=极强，0=完全没说到点上）：\n" +
    "1) content_quality：论据是否扎实、逻辑是否自洽、表达是否有说服力。\n" +
    `2) relevance：这轮发言有没有真的在它选定的攻击角度上发力——本轮角度是「${ANGLE_LABEL[angle]}」，跑题或换赛道就扣分。\n` +
    '只返回 JSON：{"content_quality":0到10的整数,"relevance":0到10的整数}。不要解释。';
  const user = `话题：${topic}\n立场：${side === "pro" ? "正方" : "反方"}\n本轮攻击角度：${ANGLE_LABEL[angle]}\n发言内容：\n${content}`;
  try {
    const raw = await withRetryChat(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      200,
    ));
    const parsed = extractJson(raw) as { content_quality?: unknown; relevance?: unknown };
    const clamp = (v: unknown): number => Math.max(0, Math.min(10, Math.round(Number(v) || 5)));
    return { content_quality: clamp(parsed.content_quality), relevance: clamp(parsed.relevance) };
  } catch {
    return { content_quality: 5, relevance: 5 }; // 中庸，强度不变
  }
};

/**
 * 创建一局玩家主导的辩论会话：玩家选边，对面由一位名人 AI 担任辩手。
 * opts.rand 可注入随机源（便于测试确定性），缺省用 Math.random。
 */
export const createDebateSession = (
  chat: ChatFn,
  opts: { rand?: () => number } = {},
): DebateSession => {
  const rand = opts.rand ?? Math.random;
  let state: DebateState;

  const snapshot = (): DebateState => ({
    ...state,
    argumentStrength: { ...state.argumentStrength },
    transcript: state.transcript.map((t) => ({ ...t })),
    aiOpponent: state.aiOpponent,
  });

  const defaultOpponent = (side: DebateSide): ResolvedCharacter => {
    const pool = CELEBRITIES.filter((c) => resolveCharacter(c.id));
    const picked = pool[side === "con" ? 0 : Math.min(1, pool.length - 1)] ?? pool[0];
    return resolveCharacter(picked.id)!;
  };

  return {
    async start(topic, playerSide) {
      const t = topic.trim();
      if (!t) throw new Error("辩题不能为空");

      // 让 AI 选一位对方辩手；失败则兜底一位。
      let opponent: ResolvedCharacter = defaultOpponent(playerSide === "pro" ? "con" : "pro");
      try {
        const debaters = await selectDebaters(t, 2, chat);
        const aiSide: DebateSide = playerSide === "pro" ? "con" : "pro";
        const chosen = debaters.find((d) => d.side === aiSide);
        if (chosen) opponent = chosen;
      } catch { /* 用兜底辩手 */ }

      state = {
        stage: "debating",
        topic: t,
        playerSide,
        round: 1,
        totalRounds: TOTAL_ROUNDS,
        argumentStrength: { pro: 50, con: 50 },
        transcript: [],
        aiOpponent: opponent,
        aiTendency: rollStanceTendency(rand), // 第 1 回合 AI 倾向，开局即揭示
      };
      return snapshot();
    },

    previewAngle(angle) {
      if (!isArgumentAngle(angle)) throw new Error("非法攻击角度");
      return resolveAngleCounter(angle, state.aiTendency);
    },

    async playerSpeak(round, angle, content) {
      const text = content.trim().slice(0, 400);
      if (!text) throw new Error("发言内容不能为空");
      if (!isArgumentAngle(angle)) throw new Error("请先选一个攻击角度（📊/❤️/🔍）");
      if (state.stage !== "debating") throw new Error("辩论未开始或已裁决");
      if (round !== state.round) throw new Error(`现在是第 ${state.round} 回合`);

      // 1) 玩家角度克制结算（纯函数，确定性）：本回合 AI 倾向 = state.aiTendency。
      const aiTendencyThisTurn = state.aiTendency;
      const playerCounter = resolveAngleCounter(angle, aiTendencyThisTurn);

      // 2) 记录玩家发言。
      const playerTurn: DebateTurn = { round, side: "player", speaker: "我", text, angle };
      state.transcript.push(playerTurn);

      // 3) LLM 双维度评分玩家发言 → 玩家 delta（角度分 + 内容质量 + 切题度加权）。
      const playerScore = await scoreArgument(state.topic, state.playerSide, angle, text, chat);
      const playerDelta = computeTurnDelta(playerCounter.delta, playerScore);
      state.argumentStrength = applyStrengthDelta(state.argumentStrength, state.playerSide, playerDelta);

      // 4) 对方 AI 针对玩家发言做反驳。AI 这回合自己随机选一个反驳角度。
      const aiSide: DebateSide = state.playerSide === "pro" ? "con" : "pro";
      const aiAngle = rollArgumentAngle(rand);
      const context = state.transcript.slice(-6).map((t) => t.text);
      const rebuttal = await debateSpeech(state.aiOpponent, state.topic, aiSide, context, chat);
      const aiTurn: DebateTurn = { round, side: aiSide, speaker: state.aiOpponent.name, text: rebuttal.text, angle: aiAngle };
      state.transcript.push(aiTurn);

      // 5) AI 对称结算：把玩家这回合的角度视作"AI 面对的倾向"，AI 也用 角度分+双维度评分 算 delta，
      //    不再是写死的 +2。玩家不再永远挨打。
      const aiCounter = resolveAngleCounter(aiAngle, tendencyFromAngle(angle));
      const aiScore = await scoreArgument(state.topic, aiSide, aiAngle, rebuttal.text, chat);
      const aiDelta = computeTurnDelta(aiCounter.delta, aiScore);
      state.argumentStrength = applyStrengthDelta(state.argumentStrength, aiSide, aiDelta);

      // 6) 记录本回合结果，推进回合，并摇出下一回合的 AI 倾向（上回合结束时揭示）。
      state.playerAngle = angle;
      state.lastEffectiveness = playerCounter.effectiveness;
      state.round += 1;
      const nextAiTendency = rollStanceTendency(rand);
      state.aiTendency = nextAiTendency;

      return {
        playerTurn,
        aiTurn,
        playerScore,
        aiScore,
        playerEffectiveness: playerCounter.effectiveness,
        aiEffectiveness: aiCounter.effectiveness,
        playerDelta,
        aiDelta,
        nextAiTendency,
        state: snapshot(),
      };
    },

    async aiSpeak(side, round) {
      if (state.stage !== "debating") throw new Error("辩论未开始或已裁决");
      const context = state.transcript.slice(-6).map((t) => t.text);
      const result = await debateSpeech(state.aiOpponent, state.topic, side, context, chat);
      const turn: DebateTurn = { round, side, speaker: state.aiOpponent.name, text: result.text };
      state.transcript.push(turn);
      return turn;
    },

    async judgeVerdict() {
      if (state.transcript.length === 0) throw new Error("还没有任何发言");
      const winner = decideWinner(state.argumentStrength);
      const fallback: DebateVerdict = {
        winner,
        reasoning: winner === "tie"
          ? "双方你来我往，论据势均力敌，这杯算平——再来一轮？"
          : `根据双方论据强度（正方 ${state.argumentStrength.pro} : 反方 ${state.argumentStrength.con}），${winner === "pro" ? "正方" : "反方"} 更胜一筹。`,
        keyMoments: state.transcript.slice(-4).map((t) => t.text),
      };

      const transcriptText = state.transcript
        .map((t) => `【${t.round} 回合·${t.speaker}】${t.text}`)
        .join("\n");
      const system =
        "你是这场酒吧辩论的裁判「苏格拉底」，爱追问、讲逻辑、不偏心，但也懂得酒吧里的幽默。" +
        `最终论据强度：正方 ${state.argumentStrength.pro}，反方 ${state.argumentStrength.con}。` +
        "请据此判定胜负，写一段 60-100 字的裁决理由（要点出双方谁的论证更扎实），并挑出 2-3 个最精彩的瞬间。" +
        '只返回 JSON：{"winner":"pro"|"con"|"tie","reasoning":"裁决理由","keyMoments":["瞬间1","瞬间2"]}。' +
        "强度领先 ≥3 分判对应方胜，接近则 tie。不要 Markdown。";
      const user = `话题：${state.topic}\n辩论记录：\n${transcriptText}`;

      try {
        const raw = await withRetryChat(() => chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          600,
        ));
        const parsed = extractJson(raw) as { winner?: unknown; reasoning?: unknown; keyMoments?: unknown };
        const winnerParsed: DebateSide | "tie" =
          parsed.winner === "pro" || parsed.winner === "con" ? parsed.winner : winner;
        const reasoning = tidy(String(parsed.reasoning ?? ""), 160);
        const keyMoments = Array.isArray(parsed.keyMoments)
          ? (parsed.keyMoments as unknown[]).map((k) => tidy(String(k), 60)).filter(Boolean).slice(0, 3)
          : [];
        state.stage = "verdict";
        const verdict: DebateVerdict = {
          winner: winnerParsed,
          reasoning: reasoning || fallback.reasoning,
          keyMoments: keyMoments.length ? keyMoments : fallback.keyMoments,
        };
        return { verdict, state: snapshot() };
      } catch {
        state.stage = "verdict";
        return { verdict: fallback, state: snapshot() };
      }
    },

    getState() {
      return snapshot();
    },
  };
};
