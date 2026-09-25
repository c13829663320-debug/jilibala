// ===== 脱口秀剧场编排器 Talkshow Orchestrator (M8) =====
// 纯 AI 逻辑层：虚拟观众反应、名人 open-mic、AI 帮写段子。
// 所有 LLM 调用串行执行，失败重试 1 次后用兜底文本，绝不中断流程。
import { resolveCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 抽取 LLM 返回中的 JSON 对象。 */
const extractJson = (text: string): unknown => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
};

/** 带退避与容错的 LLM 调用：失败重试 1 次（间隔 1s），再失败抛错由调用方兜底。 */
const withRetry = async (fn: () => Promise<string>): Promise<string> => {
  try {
    return await fn();
  } catch {
    await sleep(1000);
    return await fn();
  }
};

// ===== 1. 虚拟观众反应 =====
export interface AudienceReaction {
  score: number;        // 0-100
  reactions: string[]; // 笑声/鼓掌/起哄/冷场/欢呼
  comment: string;      // 一句观众评论
}

const REACTION_TAGS = ["笑声", "鼓掌", "起哄", "冷场", "欢呼", "叹息", "爆笑"];

/** 用一个伪随机兜底评分，避免 LLM 不可用时流程中断。 */
const fallbackReaction = (jokeText: string): AudienceReaction => {
  // 根据文本长度与感叹号数量给一个看似合理的基础分。
  const lengthScore = Math.min(40, jokeText.length / 4);
  const exclaim = (jokeText.match(/[!！？?]/g) ?? []).length;
  const score = Math.max(35, Math.min(95, Math.round(50 + lengthScore + exclaim * 4 + Math.random() * 10)));
  const reactions = score >= 80 ? ["欢呼", "笑声", "鼓掌"] : score >= 60 ? ["笑声", "鼓掌"] : ["冷场", "叹息"];
  const comments = [
    "这个节奏还行，我先笑为敬。",
    "前面铺垫不错，结尾差口气。",
    "哈哈哈这段真的有共鸣。",
    "有点冷，但我礼貌性笑一下。",
    "下次加油，我看好你。",
  ];
  return { score, reactions, comment: comments[Math.floor(Math.random() * comments.length)] };
};

/**
 * AI 虚拟观众评分：设定 system 为「脱口秀现场观众，真实反应，不客套」。
 */
export const audienceReaction = async (
  jokeText: string,
  chat: ChatFn,
): Promise<AudienceReaction> => {
  const system =
    "你是脱口秀剧场的现场观众，刚听完一位新人上台讲段子。你要给出真实反应，不客套、不捧场：好笑就大声笑，冷场就直接说冷。返回 JSON：{\"score\":0到100的整数,\"reactions\":[\"笑声\"/\"鼓掌\"/\"起哄\"/\"冷场\"/\"欢呼\"/\"叹息\"/\"爆笑\"中选1-3个],\"comment\":\"一句15字以内的现场观众吐槽或捧场\"}。不要 Markdown，不要解释。";
  const user = `刚上台的表演者讲了这段：\n「${jokeText}」\n\n请作为现场观众给出反应。`;

  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      400,
    ));
    const parsed = extractJson(raw) as { score?: unknown; reactions?: unknown; comment?: unknown };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)));
    const reactions = Array.isArray(parsed.reactions)
      ? (parsed.reactions as unknown[]).map((r) => String(r))
          .filter((r) => REACTION_TAGS.includes(r))
          .slice(0, 3)
      : [];
    const comment = String(parsed.comment ?? "").trim().slice(0, 40) || fallbackReaction(jokeText).comment;
    return { score, reactions: reactions.length ? reactions : fallbackReaction(jokeText).reactions, comment };
  } catch {
    return fallbackReaction(jokeText);
  }
};

// ===== 2. 名人 open-mic =====
export interface CelebrityOpenMic {
  celebrityId: string;
  name: string;
  jokes: string[];
  score: number;
}

const cleanJoke = (raw: string): string => {
  let text = raw.trim();
  text = text.replace(/^[""「『]|[""」』]$/g, "").trim();
  text = text.replace(/^第[一二三四\d]个段子[：:]\s*/, "").trim();
  if (text.length > 80) text = `${text.slice(0, 80)}…`;
  return text;
};

/**
 * 让某位名人用 persona 讲 2-3 个短段子（每个 < 80 字）。
 */
export const celebrityOpenMic = async (
  celebrityId: string,
  chat: ChatFn,
): Promise<CelebrityOpenMic> => {
  const celeb = resolveCharacter(celebrityId);
  if (!celeb) {
    return { celebrityId, name: "神秘嘉宾", jokes: ["（这位嘉宾今天状态不佳，下次再来。）"], score: 40 };
  }

  const system =
    `${celeb.persona}\n` +
    `现在你来到叽里呱啦脱口秀剧场 open-mic 环节，要用你自己的口吻和经历讲 2-3 个短段子。` +
    `每个段子不超过 80 字，简短、有包袱、符合你的人设与领域。` +
    `返回 JSON：{\"jokes\":[\"段子1\",\"段子2\",\"段子3\"]}，必须是 2-3 条。不要 Markdown，不要解释，不要自我介绍。`;
  const user = "请上台，开始你的 open-mic 表演。";

  const fallbackJokes = [
    `${celeb.greeting}（今天我先讲个暖场段子。）`,
    `说实话，我这辈子见过最离谱的事，就是有人把 ${celeb.field ?? "我所从事的领域"} 当成随便聊聊。`,
    `下次我再给你们讲更狠的，今天先到这儿。`,
  ];

  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      700,
    ));
    const parsed = extractJson(raw) as { jokes?: unknown };
    const jokes = Array.isArray(parsed.jokes)
      ? (parsed.jokes as unknown[]).map((j) => cleanJoke(String(j))).filter(Boolean).slice(0, 3)
      : [];
    if (jokes.length === 0) throw new Error("名人没有返回段子");
    // 名人段子默认高分，但随机浮动一点。
    const score = Math.max(60, Math.min(98, Math.round(78 + Math.random() * 16)));
    return { celebrityId: celeb.id, name: celeb.name, jokes, score };
  } catch {
    return { celebrityId: celeb.id, name: celeb.name, jokes: fallbackJokes, score: 55 };
  }
};

// ===== 3. AI 帮写段子 =====
/**
 * AI 帮写段子：返回一段可直接讲的脱口秀文本（< 200 字）。
 */
export const aiWriteJoke = async (
  topic: string,
  style: string,
  chat: ChatFn,
): Promise<string> => {
  const cleanTopic = (topic || "生活中的一件小事").trim().slice(0, 60);
  const cleanStyle = (style || "轻松自嘲、贴近生活").trim().slice(0, 40);
  const system =
    "你是叽里呱啦脱口秀剧场的御用编剧。根据用户给的主题和风格，写一段可以直接上台讲的脱口秀段子：" +
    "1）150 字以内；2）有铺垫、有反转、有包袱；3）语气轻松幽默，不冒犯、不涉及敏感话题；" +
    "4）只输出段子正文，不要解释、不要前缀、不要 Markdown。";
  const user = `主题：${cleanTopic}\n风格：${cleanStyle}\n请写一段。`;

  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      500,
    ));
    let text = raw.trim().replace(/^[""「『]|[""」』]$/g, "").trim();
    if (text.length > 200) text = `${text.slice(0, 200)}…`;
    if (!text) throw new Error("空段子");
    return text;
  } catch {
    return `说真的，关于「${cleanTopic}」这件事，我本来想讲个高级笑话，结果上台才发现——最搞笑的是我自己。${cleanStyle}，你们懂吧？`;
  }
};

// ===== 4. 开放麦主循环：玩家上台连讲 3 个笑话 =====
// 从「看演出」变成「开放麦之星」：AI 主持热身 → 玩家连讲 3 个笑话 →
// AI 观众实时笑声分贝评分 → 平均分定段位。
export type OpenMicStage = "warmup" | "performance" | "results";

/** AI 观众的整体反应档位。 */
export type OpenMicReaction = "roast" | "applaud" | "mixed" | "silence";

/** 表演段位。 */
export type OpenMicTier = "冷场" | "尚可" | "炸场" | "今日之星";

export interface PlayerJokeScore {
  /** 笑声分贝 0-100。 */
  score: number;
  reaction: OpenMicReaction;
  /** 一句现场观众点评。 */
  comment: string;
}

export interface OpenMicState {
  stage: OpenMicStage;
  jokes: string[];
  /** 下一个要讲的段子序号（0 起），等于 totalJokes 表示讲完可结算。 */
  currentJokeIndex: number;
  totalJokes: number;
  scores: PlayerJokeScore[];
  /** AI 主持热身段子（1-2 个，自动播放约 15 秒）。 */
  warmupJokes: string[];
  average: number | null;
  tier: OpenMicTier | null;
  verdict: string;
}

const TOTAL_JOKES = 3;

/** 根据平均分计算段位与总评（纯函数，便于测试）。 */
export const computeOpenMicTier = (
  average: number,
): { tier: OpenMicTier; verdict: string } => {
  const avg = Math.max(0, Math.min(100, average));
  if (avg < 30) {
    return { tier: "冷场", verdict: "台下礼貌性地咳嗽了一声……别灰心，开放麦本来就是用来试段子的，再来一轮找找节奏。" };
  }
  if (avg < 60) {
    return { tier: "尚可", verdict: "有那么几个点真的响了，差一点就炸。把铺垫再压一压，下一轮能上一个段位。" };
  }
  if (avg <= 85) {
    return { tier: "炸场", verdict: "好家伙，这一顿包袱甩得台下直拍桌子！今晚你就是剧场的顶梁柱。" };
  }
  return { tier: "今日之星", verdict: "全场沸腾！这三个段子一个比一个顶，观众已经把你名字喊上了天花板。" };
};

/** 把 0-100 分贝映射到观众反应档位。 */
const reactionFromScore = (score: number): OpenMicReaction => {
  if (score >= 80) return "applaud";
  if (score >= 60) return "mixed";
  if (score >= 35) return "roast";
  return "silence";
};

/** 评分失败时的兜底：按文本长度与感叹号给一个看似合理的分，绝不中断流程。 */
const fallbackPlayerScore = (jokeText: string): PlayerJokeScore => {
  const lengthScore = Math.min(40, jokeText.length / 4);
  const exclaim = (jokeText.match(/[!！？?]/g) ?? []).length;
  const score = Math.max(20, Math.min(96, Math.round(48 + lengthScore + exclaim * 4 + Math.random() * 12)));
  const pool: Record<OpenMicReaction, string[]> = {
    applaud: ["这段真的绝了，再来一个！", "笑到拍大腿，这位有东西。"],
    mixed: ["前半段还行，结尾再磨磨。", "有包袱，但节奏还差一口气。"],
    roast: ["……所以呢？冷到我点了杯热水。", "这段子是从十年前的段子库抄的吗？"],
    silence: ["（台下安静得能听到酒杯声）", "哥们儿，要不咱先下去喝一杯？"],
  };
  const reaction = reactionFromScore(score);
  const comments = pool[reaction];
  return { score, reaction, comment: comments[Math.floor(Math.random() * comments.length)] };
};

/**
 * AI 观众给玩家的一个笑话打分：按幽默度、创意、节奏感给 0-100，并给反应档位与一句点评。
 */
export const scorePlayerJoke = async (
  jokeText: string,
  chat: ChatFn,
): Promise<PlayerJokeScore> => {
  const system =
    "你是脱口秀剧场里刚听完一位开放麦新人讲段子的现场观众，要给出真实反应，不客套、不捧场。" +
    "请根据这个笑话的【幽默度】【创意】【节奏感】综合打一个 0-100 的整数分：爆笑=80-100，不错=60-79，一般=35-59，冷场=0-34。" +
    '返回 JSON：{"score":0到100整数,"reaction":"applaud"|"mixed"|"roast"|"silence"之一,"comment":"一句15字以内的现场吐槽或捧场"}。' +
    "不要 Markdown，不要解释。";
  const user = `这位新人刚讲了：\n「${jokeText}」\n\n请作为现场观众打分。`;

  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      300,
    ));
    const parsed = extractJson(raw) as { score?: unknown; reaction?: unknown; comment?: unknown };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const validReactions: OpenMicReaction[] = ["roast", "applaud", "mixed", "silence"];
    const reaction = validReactions.includes(parsed.reaction as OpenMicReaction)
      ? (parsed.reaction as OpenMicReaction)
      : reactionFromScore(score);
    const comment = String(parsed.comment ?? "").trim().slice(0, 40);
    return { score, reaction, comment: comment || fallbackPlayerScore(jokeText).comment };
  } catch {
    return fallbackPlayerScore(jokeText);
  }
};

/** AI 主持热身：讲 1-2 个短段子暖场（失败用兜底，保证流程不中断）。 */
const hostWarmupJokes = async (chat: ChatFn): Promise<string[]> => {
  const system =
    "你是叽里呱啦脱口秀剧场的主持人，马上要把舞台交给一位开放麦新人。" +
    "请用主持人的口吻讲 1-2 个超短暖场段子（每个不超过 50 字，自嘲、轻松、带一点现场感）。" +
    '只返回 JSON：{"jokes":["段子1","段子2"]}，必须 1-2 条。不要 Markdown，不要解释。';
  const fallback = [
    "大家晚上好！我是今晚的主持——先说好，我讲的段子不包笑，包退。",
    "掌声欢迎下一位上台的朋友……呃，掌声呢？没事，他脸皮比我厚。",
  ];
  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: "暖个场吧。" },
      ],
      300,
    ));
    const parsed = extractJson(raw) as { jokes?: unknown };
    const jokes = Array.isArray(parsed.jokes)
      ? (parsed.jokes as unknown[]).map((j) => cleanJoke(String(j))).filter(Boolean).slice(0, 2)
      : [];
    return jokes.length ? jokes : fallback;
  } catch {
    return fallback;
  }
};

export interface OpenMicSession {
  /** 开局：AI 主持热身，随后进入玩家表演阶段。 */
  start(): Promise<OpenMicState>;
  /** 玩家讲一个笑话，AI 观众实时打分。 */
  tellJoke(jokeText: string): Promise<{ result: PlayerJokeScore; state: OpenMicState }>;
  /** 3 个讲完后结算：平均分 + 段位。 */
  finish(): Promise<{ state: OpenMicState; average: number; tier: OpenMicTier; verdict: string }>;
  getState(): OpenMicState;
}

/**
 * 创建一局开放麦会话（纯内存，便于路由单例复用与测试注入 mock chat）。
 */
export const createOpenMicSession = (chat: ChatFn): OpenMicSession => {
  let state: OpenMicState = {
    stage: "warmup",
    jokes: [],
    currentJokeIndex: 0,
    totalJokes: TOTAL_JOKES,
    scores: [],
    warmupJokes: [],
    average: null,
    tier: null,
    verdict: "",
  };

  const snapshot = (): OpenMicState => ({ ...state, jokes: [...state.jokes], scores: [...state.scores], warmupJokes: [...state.warmupJokes] });

  return {
    async start() {
      const warmupJokes = await hostWarmupJokes(chat);
      state = {
        stage: "performance",
        jokes: [],
        currentJokeIndex: 0,
        totalJokes: TOTAL_JOKES,
        scores: [],
        warmupJokes,
        average: null,
        tier: null,
        verdict: "",
      };
      return snapshot();
    },

    async tellJoke(jokeText: string) {
      const text = jokeText.trim().slice(0, 500);
      if (!text) throw new Error("段子不能为空");
      if (state.stage !== "performance") throw new Error("开放麦尚未开始或已结束");
      if (state.currentJokeIndex >= state.totalJokes) throw new Error("3 个笑话已讲完，请结算");

      const result = await scorePlayerJoke(text, chat);
      state.jokes.push(text);
      state.scores.push(result);
      state.currentJokeIndex += 1;
      return { result, state: snapshot() };
    },

    async finish() {
      if (state.scores.length === 0) throw new Error("还没有任何评分");
      const average = Math.round(state.scores.reduce((sum, s) => sum + s.score, 0) / state.scores.length);
      const { tier, verdict } = computeOpenMicTier(average);
      state.stage = "results";
      state.average = average;
      state.tier = tier;
      state.verdict = verdict;
      return { state: snapshot(), average, tier, verdict };
    },

    getState() {
      return snapshot();
    },
  };
};