// ===== M8: 酒吧辩论编排器 Bar Orchestrator =====
// 纯 AI 逻辑层：选辩手 / 名人发言 / 酒保总结。所有 LLM 调用串行，失败有兜底。
import { CELEBRITIES, getCelebrity, type Celebrity } from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";

export type DebateSide = "pro" | "con";

/** 带立场的辩手（在 Celebrity 上扩展 side）。 */
export interface Debater extends Celebrity {
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
    const celebs = picked.map((id) => getCelebrity(id)).filter((c): c is Celebrity => Boolean(c));
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
    const proIds = toIds(parsed.pro).filter((id) => getCelebrity(id));
    const conIds = toIds(parsed.con).filter((id) => getCelebrity(id));
    if (proIds.length === 0 || conIds.length === 0) return fallbackPick();
    const pro = proIds.slice(0, 2).map((id) => ({ ...getCelebrity(id)!, side: "pro" as const }));
    const con = conIds.slice(0, 2).map((id) => ({ ...getCelebrity(id)!, side: "con" as const }));
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
  celebrity: Celebrity,
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
