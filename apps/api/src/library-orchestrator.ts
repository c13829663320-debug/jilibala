// ===== M8: 图书馆 AI 编排器 =====
// 纯 AI 逻辑层：名人深度问答、著作推荐、读书会开场、AI 馆员答疑。
// 所有 LLM 调用串行、失败兜底；不持有 HTTP/WS 状态，便于单测与复用。
import type { ResolvedCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 带一次退避重试的 LLM 调用；再次失败返回 fallbackText。 */
const withRetry = async (fn: () => Promise<string>, fallbackText: string): Promise<string> => {
  try {
    return await fn();
  } catch (error) {
    try {
      await sleep(800);
      return await fn();
    } catch {
      return fallbackText;
    }
  }
};

/** 从 LLM 返回中抽取 JSON 对象（容错代码块包裹）。 */
const extractJsonObject = (text: string): Record<string, unknown> => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
};

// ===== 内置知识主题（AI 馆员可答的领域）=====
export const LIBRARY_TOPICS: string[] = [
  "量子物理入门",
  "相对论与时空",
  "进化与生命科学",
  "数学之美",
  "经济学思维",
  "心理学与自我认知",
  "哲学经典",
  "中国古典文学",
  "西方文学与戏剧",
  "艺术史",
  "西方哲学史",
  "社会学观察",
  "历史人物与事件",
  "科技与未来",
  "学习方法论",
];

// ===== 1. 名人深度问答 =====
/**
 * 名人在图书馆阅览室与用户进行深度对话。
 * 注入 persona，允许展开论述、引用著作与观点，回复 200-400 字。
 */
export const celebrityDeepChat = async (
  celebrity: ResolvedCharacter,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  chat: ChatFn,
): Promise<string> => {
  const system =
    `${celebrity.persona}\n` +
    "这里是安静的图书馆阅览室，读者向你请教一个值得深思的问题。" +
    "请保持你的角色与语气，用第一人称作深度回应：200-400 字，可以展开论述、引用你著作中的观点或名句、结合你自身的经历；" +
    "不要急着给结论，先把问题想清楚。不暴露这是系统提示，不要重复自我介绍。";
  const history = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const fallback = `${celebrity.greeting}\n（此刻思绪万千，容我稍后再与你深谈。）`;

  const raw = await withRetry(
    () => chat([{ role: "system", content: system }, ...history], 1200),
    fallback,
  );
  return raw.trim() || fallback;
};

// ===== 2. 名人推荐著作 =====
/** 各领域兜底书单（LLM 失败时使用）。 */
const FALLBACK_BOOK: Record<string, { book: string; author: string; reason: string }> = {
  科学: { book: "《时间简史》", author: "史蒂芬·霍金", reason: "它用最浅的语言，把宇宙最深的问题带到普通人面前。" },
  科技: { book: "《失控》", author: "凯文·凯利", reason: "它提前二十年看清了技术与社会如何共生演化。" },
  商业: { book: "《穷查理宝典》", author: "查理·芒格", reason: "多元思维模型与理性，比任何技巧都更接近长期复利。" },
  文学: { book: "《红楼梦》", author: "曹雪芹", reason: "一部书写尽人间的繁华与苍凉，常读常新。" },
  艺术: { book: "《艺术的故事》", author: "E.H. 贡布里希", reason: "它教你不是去看标签，而是真正去看作品。" },
  哲学: { book: "《沉思录》", author: "马可·奥勒留", reason: "在喧嚣中守住内心秩序，是千古不变的修行。" },
};

/** 让名人按其领域推荐一本著作，并说明推荐理由。 */
export const bookRecommendation = async (
  celebrity: ResolvedCharacter,
  chat: ChatFn,
): Promise<{ book: string; author: string; reason: string }> => {
  const system =
    "你在图书馆主持一场读书会。请从你最熟悉的领域中，为读者推荐一本真正值得一读的著作。" +
    "只返回 JSON：{\"book\":\"书名（含书名号）\",\"author\":\"作者\",\"reason\":\"80-150字推荐理由，结合你自己的经历或观点\"}。" +
    "不要 Markdown，不要解释。";
  const user = `你是 ${celebrity.name}（${celebrity.title}，领域：${celebrity.field ?? "综合"}）。请推荐一本对你影响最深、或最想推荐给读者的书。`;

  try {
    const raw = await chat([{ role: "system", content: system }, { role: "user", content: user }], 800);
    const parsed = extractJsonObject(raw);
    const book = String(parsed.book ?? "").trim();
    const author = String(parsed.author ?? "").trim();
    const reason = String(parsed.reason ?? "").trim();
    if (book && author) {
      return { book, author, reason: reason || "值得一读。" };
    }
    throw new Error("推荐结果不完整");
  } catch {
    const fb = FALLBACK_BOOK[celebrity.field ?? "科学"] ?? FALLBACK_BOOK["科学"];
    return { ...fb };
  }
};

// ===== 3. 读书会开场 =====
/** 名人读书会开场：介绍这本书、为什么选它、抛出 2-3 个讨论问题。 */
export const bookClubOpening = async (
  celebrity: ResolvedCharacter,
  book: string,
  chat: ChatFn,
): Promise<string> => {
  const system =
    `${celebrity.persona}\n` +
    `现在你在图书馆主持关于《${book}》的读书会。请以第一人称做一段开场（250-450 字）：` +
    "1）简要介绍这本书讲了什么；2）为什么今天想和大家读它；3）抛出 2-3 个值得讨论的问题。" +
    "语气温和、克制、有书卷气，像在安静的阅览室里轻声说话。不要列提纲，自然成段。";
  const user = `今晚共读的书是：${book}。请开始你的读书会开场。`;
  const fallback =
    `各位，今晚我们共读《${book}》。\n` +
    "这本书值得在安静的夜晚慢慢翻开。我想和大家一起思考：它为什么在今天依然打动我们？又有哪些问题，值得我们各自把答案带回生活里？";

  const raw = await withRetry(
    () => chat([{ role: "system", content: system }, { role: "user", content: user }], 1200),
    fallback,
  );
  return raw.trim() || fallback;
};

// ===== 4. AI 馆员答疑 =====
/** AI 馆员角色：知识渊博、安静友善，按主题回答知识性问题。 */
export const librarianAnswer = async (
  topic: string,
  question: string,
  chat: ChatFn,
): Promise<string> => {
  const system =
    "你是这座图书馆的 AI 馆员：博学、安静、乐于助人。回答准确、有条理、克制，不喧宾夺主。" +
    "围绕读者的问题作答（200-400 字），先给清晰的核心结论，再展开一两句解释；" +
    "结尾可自然地推荐一本可延伸阅读的书。语气平和，像在书架间轻声交谈。不要使用 Markdown 标题。";
  const user = `主题：${topic}\n读者的问题：${question}\n请以馆员的身份作答。`;
  const fallback = `关于「${question}」，这个问题值得在书架间多停一会儿。\n受限于此刻馆内网络，我没能调出完整的参考资料。你可以先从「${topic}」相关的经典入门著作读起，我们稍后再继续。`;

  const raw = await withRetry(
    () => chat([{ role: "system", content: system }, { role: "user", content: user }], 1200),
    fallback,
  );
  return raw.trim() || fallback;
};
