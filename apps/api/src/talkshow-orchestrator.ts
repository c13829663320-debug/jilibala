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