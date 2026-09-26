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

// ===== 4. 开放麦主循环：三维度评分 + 话题选择 + callback 回扣 + 限时压力 =====
// R2 重构：从「单值黑盒 0-100」升级为 Punchline/Pacing/Resonance 三维度；
// 3 个段子不再彼此独立——玩家可选「Call back 第 N 段」，真引用 resonance+15。
export type OpenMicStage = "warmup" | "picking_topic" | "performing" | "results";

/** AI 观众的整体反应档位。 */
export type OpenMicReaction = "roast" | "applaud" | "mixed" | "silence";

/** 表演段位。 */
export type OpenMicTier = "冷场" | "尚可" | "炸场" | "今日之星";

/** 三维度评分：包袱强度(0-40) + 节奏(0-30) + 共鸣(0-30) = 满分 100。 */
export interface JokeDimensionScores {
  punchline: number; // 0-40 包袱强度
  pacing: number;    // 0-30 节奏/铺垫
  resonance: number; // 0-30 共鸣/代入感
}

/** 话题票：4 大类，每类 3-5 个子话题。 */
export interface TopicOption {
  id: string;
  label: string;
  icon: string;
  subtopics: string[];
}

export const TOPIC_LIBRARY: TopicOption[] = [
  {
    id: "workplace",
    label: "职场吐槽",
    icon: "💼",
    subtopics: ["老板画的饼", "周一早会", "加班文化", "早高峰地铁", "永远写不完的周报"],
  },
  {
    id: "dating",
    label: "恋爱翻车",
    icon: "💘",
    subtopics: ["相亲现场", "忘了纪念日", "偷偷查手机", "前任的朋友圈", "第一次见家长"],
  },
  {
    id: "family",
    label: "我妈/我爸",
    icon: "🏠",
    subtopics: ["妈觉得我冷", "催婚催生", "家庭群谣言", "我爸的哲理", "妈妈的黑暗料理"],
  },
  {
    id: "life",
    label: "当代生活",
    icon: "🛋️",
    subtopics: ["外卖凑单", "租房中介", "健身房年卡", "短视频刷到凌晨", "月底看余额"],
  },
];

/** 一个已讲过的段子（含三维评分）。 */
export interface PerformedJoke {
  text: string;
  topic: string;
  /** 本段是否声明要回扣第 N 段（0 起）。 */
  callbackTo?: number;
  /** 回扣是否真的命中了前段子关键词。 */
  callbackHit?: boolean;
  scores: JokeDimensionScores;
  /** 三维度合计 0-100。 */
  total: number;
  reaction: OpenMicReaction;
  /** 一句具体吐槽，指向最该改的维度。 */
  note: string;
}

export interface OpenMicState {
  stage: OpenMicStage;
  /** 玩家选的话题票。 */
  topic: TopicOption | null;
  /** 下一个要讲的段子序号（0 起），等于 totalJokes 表示讲完可结算。 */
  currentJokeIndex: number;
  totalJokes: number;
  jokeTimeLimitMs: number;
  jokes: PerformedJoke[];
  /** AI 主持热身段子（自动播约 10 秒）。 */
  warmupJokes: string[];
  /** 讲完一段后，下一段可选择回调的前段子列表（用于 CallbackChooser）。 */
  callbackOptions: Array<{ index: number; preview: string }>;
  average: number | null;
  tier: OpenMicTier | null;
  verdict: string;
  /** 最高分那个段子自动成「金句卡」。 */
  goldJoke: PerformedJoke | null;
}

const TOTAL_JOKES = 3;
const JOKE_TIME_LIMIT_MS = 60_000;

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

/** 把 0-100 总分映射到观众反应档位。 */
export const reactionFromScore = (score: number): OpenMicReaction => {
  if (score >= 80) return "applaud";
  if (score >= 60) return "mixed";
  if (score >= 35) return "roast";
  return "silence";
};

const REACTION_ORDER: OpenMicReaction[] = ["silence", "roast", "mixed", "applaud"];

/** 观众反应升一档（callback 真命中时用）。 */
export const upgradeReaction = (r: OpenMicReaction): OpenMicReaction => {
  const i = REACTION_ORDER.indexOf(r);
  return i >= 0 && i < REACTION_ORDER.length - 1 ? REACTION_ORDER[i + 1] : r;
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const sumScores = (s: JokeDimensionScores): number =>
  clamp(Math.round(s.punchline) + Math.round(s.pacing) + Math.round(s.resonance), 0, 100);

// ===== Callback 关键词检测（纯函数，便于测试） =====
const CALLBACK_STOPWORDS = new Set([
  "我们", "你们", "他们", "这个", "那个", "什么", "怎么", "为什么", "因为", "所以",
  "但是", "而且", "然后", "现在", "以前", "以后", "今天", "昨天", "明天", "时候",
  "真的", "觉得", "知道", "看到", "听到", "开始", "结束", "一下", "一样", "一直",
  "其实", "可能", "应该", "如果", "虽然", "不过", "还是", "就是", "只是", "不要",
  "可以", "没有", "不是", "就是", "大家", "自己", "这么", "那么", "这样", "那样",
]);

const splitTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map((t) => t.trim())
    .filter(Boolean);

/** 从一段中文里抽出 2-4 字的候选关键词（去掉停用词与纯虚词）。 */
export const extractKeywords = (text: string): string[] => {
  const found = new Set<string>();
  for (const token of splitTokens(text)) {
    // 英文/数字词 >=2 直接收。
    if (/^[a-z0-9]{2,}$/.test(token)) found.add(token);
    // 中文：抽 2-gram 与 3-gram。
    const han = token.match(/[\u4e00-\u9fa5]+/g) ?? [];
    for (const run of han) {
      for (let n = 2; n <= 3; n += 1) {
        for (let i = 0; i + n <= run.length; i += 1) {
          const gram = run.slice(i, i + n);
          if (CALLBACK_STOPWORDS.has(gram)) continue;
          // 全是单字虚词组合的跳过。
          if ([...gram].every((ch) => "的了是我你他她它们在有和也就都还不吗呢吧啊呀哦嘛".includes(ch))) continue;
          found.add(gram);
        }
      }
    }
  }
  return [...found];
};

/**
 * 检测新段子是否真的回扣了第 N 段：
 * 从 prevText 抽关键词，看 currentText 是否真的引用了其中至少一个有辨识度的词。
 */
export const detectCallback = (
  prevText: string,
  currentText: string,
): { hit: boolean; keywords: string[] } => {
  const keywords = extractKeywords(prevText);
  const haystack = currentText.toLowerCase();
  const hit = keywords.filter((kw) => haystack.includes(kw.toLowerCase()));
  return { hit: hit.length > 0, keywords: hit };
};

/** 评分失败时的兜底：按文本长度/感叹号拆三维度，绝不中断流程。 */
const fallbackPlayerScore = (jokeText: string): { scores: JokeDimensionScores; total: number; reaction: OpenMicReaction; note: string } => {
  const len = jokeText.length;
  const exclaim = (jokeText.match(/[!！？?]/g) ?? []).length;
  const punchline = clamp(Math.round(20 + Math.min(16, exclaim * 3) + Math.random() * 10), 0, 40);
  const pacing = clamp(Math.round(28 - Math.min(18, len / 14) + Math.random() * 8), 0, 30);
  const resonance = clamp(Math.round(18 + Math.min(12, len / 12) + Math.random() * 8), 0, 30);
  const scores = { punchline, pacing, resonance };
  const total = sumScores(scores);
  const reaction = reactionFromScore(total);
  const notePool: Record<OpenMicReaction, string[]> = {
    applaud: ["包袱甩得脆，再来一段！", "笑到拍大腿，节奏也舒服。"],
    mixed: ["前半段还行，结尾再磨磨。", "有包袱，但节奏还差一口气。"],
    roast: ["铺垫太长了，包袱没等到就散了。", "……所以呢？冷到我点了杯热水。"],
    silence: ["（台下安静得能听到酒杯声）", "哥们儿，要不咱先下去喝一杯？"],
  };
  return { scores, total, reaction, note: notePool[reaction][Math.floor(Math.random() * notePool[reaction].length)] };
};

/**
 * AI 观众给玩家的一个笑话打三维度分：
 * punchline 包袱强度(0-40) / pacing 节奏(0-30) / resonance 共鸣(0-30)。
 */
export const scorePlayerJoke = async (
  jokeText: string,
  chat: ChatFn,
): Promise<{ scores: JokeDimensionScores; total: number; reaction: OpenMicReaction; note: string }> => {
  const system =
    "你是脱口秀剧场里刚听完一位开放麦新人讲段子的现场观众，要给出真实反应，不客套、不捧场。" +
    "请从三个维度打分：\n" +
    "1) punchline 包袱强度 0-40：结尾反转/梗够不够响；\n" +
    "2) pacing 节奏 0-30：铺垫是否拖沓、句子是否紧凑；\n" +
    "3) resonance 共鸣 0-30：观众能不能代入、像不像自己的生活。\n" +
    "另给 reaction（applaud/mixed/roast/silence 之一）和 note（一句 20 字以内的具体吐槽，指向最该改的那个维度，例如『铺垫再短 5 秒就炸了』）。\n" +
    '返回 JSON：{"punchline":0-40整数,"pacing":0-30整数,"resonance":0-30整数,"reaction":"applaud|mixed|roast|silence","note":"..."}。' +
    "不要 Markdown，不要解释。";
  const user = `这位新人刚讲了：\n「${jokeText}」\n\n请作为现场观众打分。`;

  try {
    const raw = await withRetry(() => chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      350,
    ));
    const parsed = extractJson(raw) as {
      punchline?: unknown; pacing?: unknown; resonance?: unknown;
      reaction?: unknown; note?: unknown;
    };
    const scores: JokeDimensionScores = {
      punchline: clamp(Math.round(Number(parsed.punchline) || 0), 0, 40),
      pacing: clamp(Math.round(Number(parsed.pacing) || 0), 0, 30),
      resonance: clamp(Math.round(Number(parsed.resonance) || 0), 0, 30),
    };
    const total = sumScores(scores);
    const validReactions: OpenMicReaction[] = ["roast", "applaud", "mixed", "silence"];
    const reaction = validReactions.includes(parsed.reaction as OpenMicReaction)
      ? (parsed.reaction as OpenMicReaction)
      : reactionFromScore(total);
    const note = String(parsed.note ?? "").trim().slice(0, 60);
    return { scores, total, reaction, note: note || fallbackPlayerScore(jokeText).note };
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

export interface TellJokeOpts {
  /** 本段声明要回扣第几个段子（0 起，必须是已讲过的）。 */
  callbackTo?: number;
  /** 换一个话题票 id。 */
  switchTopic?: string;
}

export interface OpenMicSession {
  /** 开局：AI 主持热身（自动播 10s），随后进入选话题阶段。 */
  start(): Promise<OpenMicState>;
  /** 玩家选话题票。 */
  pickTopic(topicId: string): Promise<OpenMicState>;
  /** 玩家讲一个笑话（可携带 callbackTo / switchTopic），三维度打分。 */
  tellJoke(jokeText: string, opts?: TellJokeOpts): Promise<{ result: PerformedJoke; state: OpenMicState }>;
  /** 3 个讲完后结算：平均分 + 段位 + 金句卡。 */
  finish(): Promise<{ state: OpenMicState; average: number; tier: OpenMicTier; verdict: string; goldJoke: PerformedJoke }>;
  getState(): OpenMicState;
}

const emptyCallbackOptions = (): OpenMicState["callbackOptions"] => [];

/**
 * 创建一局开放麦会话（纯内存，便于路由单例复用与测试注入 mock chat）。
 */
export const createOpenMicSession = (chat: ChatFn): OpenMicSession => {
  let state: OpenMicState = {
    stage: "warmup",
    topic: null,
    jokes: [],
    currentJokeIndex: 0,
    totalJokes: TOTAL_JOKES,
    jokeTimeLimitMs: JOKE_TIME_LIMIT_MS,
    callbackOptions: emptyCallbackOptions(),
    warmupJokes: [],
    average: null,
    tier: null,
    verdict: "",
    goldJoke: null,
  };

  const snapshot = (): OpenMicState => ({
    ...state,
    topic: state.topic ? { ...state.topic } : null,
    jokes: state.jokes.map((j) => ({ ...j, scores: { ...j.scores } })),
    warmupJokes: [...state.warmupJokes],
    callbackOptions: state.callbackOptions.map((c) => ({ ...c })),
  });

  const rebuildCallbackOptions = (): void => {
    state.callbackOptions = state.jokes.map((j, i) => ({
      index: i,
      preview: j.text.length > 24 ? `${j.text.slice(0, 24)}…` : j.text,
    }));
  };

  return {
    async start() {
      const warmupJokes = await hostWarmupJokes(chat);
      state = {
        stage: "picking_topic",
        topic: null,
        jokes: [],
        currentJokeIndex: 0,
        totalJokes: TOTAL_JOKES,
        jokeTimeLimitMs: JOKE_TIME_LIMIT_MS,
        callbackOptions: emptyCallbackOptions(),
        warmupJokes,
        average: null,
        tier: null,
        verdict: "",
        goldJoke: null,
      };
      return snapshot();
    },

    async pickTopic(topicId: string) {
      if (state.stage !== "picking_topic") throw new Error("现在不是选话题的环节");
      const topic = TOPIC_LIBRARY.find((t) => t.id === topicId);
      if (!topic) throw new Error("话题不存在");
      state.topic = topic;
      state.stage = "performing";
      return snapshot();
    },

    async tellJoke(jokeText: string, opts = {}) {
      const text = jokeText.trim().slice(0, 500);
      if (!text) throw new Error("段子不能为空");
      if (state.stage !== "performing" || !state.topic) throw new Error("请先选话题再上台");
      if (state.currentJokeIndex >= state.totalJokes) throw new Error("3 个笑话已讲完，请结算");

      // 换话题：校验 id 后覆盖当前话题。
      let topicLabel = state.topic.label;
      if (opts.switchTopic) {
        const next = TOPIC_LIBRARY.find((t) => t.id === opts.switchTopic);
        if (!next) throw new Error("要换的话题不存在");
        state.topic = next;
        topicLabel = next.label;
      }

      const scored = await scorePlayerJoke(text, chat);
      const joke: PerformedJoke = {
        text,
        topic: topicLabel,
        scores: { ...scored.scores },
        total: scored.total,
        reaction: scored.reaction,
        note: scored.note,
      };

      // ===== Callback 检测 =====
      if (typeof opts.callbackTo === "number") {
        const idx = opts.callbackTo;
        if (idx < 0 || idx >= state.jokes.length) {
          throw new Error("要回扣的段子不存在");
        }
        joke.callbackTo = idx;
        const prev = state.jokes[idx];
        const { hit } = detectCallback(prev.text, text);
        if (hit) {
          joke.callbackHit = true;
          joke.scores.resonance = clamp(joke.scores.resonance + 15, 0, 30);
          joke.total = sumScores(joke.scores);
          joke.reaction = upgradeReaction(joke.reaction);
          if (!joke.note) joke.note = "callback 真响了！共鸣拉满。";
        } else {
          joke.callbackHit = false;
          joke.note = "你说要 call back 但我没听到那个梗啊。";
        }
      }

      state.jokes.push(joke);
      state.currentJokeIndex += 1;
      rebuildCallbackOptions();
      return { result: joke, state: snapshot() };
    },

    async finish() {
      if (state.jokes.length === 0) throw new Error("还没有任何评分");
      const average = Math.round(state.jokes.reduce((sum, j) => sum + j.total, 0) / state.jokes.length);
      const { tier, verdict } = computeOpenMicTier(average);
      const goldJoke = state.jokes.reduce((best, j) => (j.total > best.total ? j : best), state.jokes[0]);
      state.stage = "results";
      state.average = average;
      state.tier = tier;
      state.verdict = verdict;
      state.goldJoke = goldJoke;
      return { state: snapshot(), average, tier, verdict, goldJoke };
    },

    getState() {
      return snapshot();
    },
  };
};