// ===== R5 发布域：内容审核纯函数（前后端共用，无 DOM / 无 Node 依赖） =====
//
// 本模块 additive 提供：
//   1. 分类敏感词词表（中文 + 英文，覆盖 政治谣言 / 色情 / 辱骂 / 广告 四类）
//   2. moderateText(text) 纯函数：命中片段替换为 ***，返回 shared.ModerationAction
//   3. isCelebrityNameSafe(name)：名人形象合规校验（是否冒充 / 诽谤名人）
//
// 注意：
//   - 不修改已有 ModerationAction / ReportCategory 定义，仅复用。
//   - 词表「覆盖常见类别但不过度封禁」：英文词用单词边界匹配，避免误伤
//     （如 ass 命中 class）；中文按子串匹配。
//   - 本模块不做禁言计数（禁言状态由服务端 apps/api/src/moderation.ts 维护），
//     因此纯函数返回的 muted 恒为 false。
import type { ModerationAction } from "./index.js";
import { CELEBRITIES } from "./celebrities.js";

// ---------------------------------------------------------------------------
// 1. 分类敏感词词表
// ---------------------------------------------------------------------------

/** 敏感词类别（与运营后台分类对齐）。 */
export type ModerationCategory = "political" | "porn" | "insult" | "ad";

export const MODERATION_CATEGORIES: readonly ModerationCategory[] = [
  "political",
  "porn",
  "insult",
  "ad",
] as const;

/**
 * 敏感词词表。
 * - political：政治谣言 / 违禁信息类（不点名真实政治人物，仅列传播违禁谣言、
 *   攻击国家机器等通用违规模式，便于运营扩充）。
 * - porn：色情低俗。
 * - insult：辱骂人身攻击。
 * - ad：垃圾广告 / 引流 / 黑产。
 * 中文按子串匹配；英文按单词边界匹配（见 buildReplaceRegex）。
 */
export const SENSITIVE_WORDS: Record<ModerationCategory, readonly string[]> = {
  political: [
    "颠覆国家",
    "分裂国家",
    "违禁品交易",
    "政治谣言",
    "煽动颠覆",
  ],
  porn: [
    "色情视频",
    "裸体聊天",
    "一夜情",
    "援交",
    "av女优",
    "porn",
    "nsfw",
    "sexchat",
  ],
  insult: [
    "傻逼",
    "操你妈",
    "草泥马",
    "他妈的",
    "王八蛋",
    "去死吧",
    "废物东西",
    "nigger",
    "faggot",
    "motherfucker",
    "fuck",
  ],
  ad: [
    "刷单兼职",
    "博彩网站",
    "赌场开户",
    "办证刻章",
    "发票代开",
    "贷款秒下",
    "加微信约",
    "高仿名牌",
    "代开发票",
    "gambling",
    "casino bonus",
    "viagra",
    "cheap meds",
  ],
};

/** 全部敏感词拍平（按类别聚合便于统计命中类别）。 */
export const ALL_SENSITIVE_WORDS: readonly string[] = MODERATION_CATEGORIES.flatMap(
  (c) => SENSITIVE_WORDS[c],
);

// ---------------------------------------------------------------------------
// 2. 纯函数：文本过滤
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判断是否为纯 ASCII（英文/数字）词。 */
function isAsciiWord(word: string): boolean {
  return /^[\x20-\x7E]+$/.test(word);
}

/**
 * 构造单个敏感词的匹配正则（大小写不敏感）。
 * ASCII 词用 \b 单词边界，避免误伤（class 命中 ass）；中文等非 ASCII 直接子串匹配。
 */
function buildMatchRegex(word: string): RegExp | null {
  const escaped = escapeRegExp(word.trim());
  if (!escaped) return null;
  if (isAsciiWord(word)) {
    return new RegExp(`\\b${escaped}\\b`, "gi");
  }
  return new RegExp(escaped, "g");
}

/** 命中的替换占位。 */
export const MASK = "***";

/**
 * 纯函数文本审核：返回 ModerationAction。
 * - hit: 是否命中任一敏感词
 * - text: 命中处替换为 *** 后的文本（未命中时与原文一致）
 * - muted: 纯函数无用户上下文，恒为 false（禁言由服务端计数）
 *
 * 纯函数、无副作用，可在前端 / 服务端 / 测试任意调用。
 */
export function moderateText(raw: string): ModerationAction {
  if (!raw) {
    return { hit: false, text: raw ?? "", muted: false };
  }
  let hit = false;
  let out = raw;
  for (const word of ALL_SENSITIVE_WORDS) {
    const re = buildMatchRegex(word);
    if (!re) continue;
    if (re.test(out)) {
      hit = true;
      out = out.replace(re, MASK);
    }
  }
  return { hit, text: out, muted: false };
}

/** 仅判断是否命中（不做替换）。 */
export function containsSensitiveWord(raw: string): boolean {
  return moderateText(raw).hit;
}

// ---------------------------------------------------------------------------
// 3. 名人形象合规校验
// ---------------------------------------------------------------------------

/** 冒充暗示词：用户输入把自己包装成某名人本人/官方。 */
const IMPERSONATION_HINTS: readonly string[] = [
  "我是",
  "本尊",
  "本人",
  "真身",
  "官方认证",
  "假装是",
  "冒充",
  "真名",
];

/** 诽谤 / 侮辱名人形象的词（与辱骂词表取子集，针对名人形象）。 */
const DEFAMATION_WORDS: readonly string[] = [
  "傻逼",
  "骗子",
  "废物",
  "去死",
  "假的",
  "狗屁",
  "人渣",
];

/** 名人名单（取中文 display name；小写化便于英文不区分大小写）。 */
const CELEBRITY_NAMES: readonly string[] = CELEBRITIES.map((c) => c.name);

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

/**
 * 名人形象合规校验。
 * @returns true 表示安全（未冒充、未诽谤名人）；false 表示命中冒充/诽谤，应拦截或人工复核。
 *
 * 判定：
 *  - 冒充：文本同时出现某名人名 + 冒充暗示词（如「我是马斯克本尊」）。
 *  - 诽谤：文本同时出现某名人名 + 侮辱词（如「鲁迅就是个骗子」）。
 * 单纯提到/讨论名人（如「我很喜欢李白」「和马斯克辩论」）判定为安全。
 */
export function isCelebrityNameSafe(input: string): boolean {
  const text = (input ?? "").trim();
  if (!text) return true;

  // 命中任一真实名人名？
  const mentionsCelebrity = CELEBRITY_NAMES.some((name) => text.includes(name));
  if (!mentionsCelebrity) return true; // 没提名人，自然不涉及冒充/诽谤

  const impersonating = includesAny(text, IMPERSONATION_HINTS);
  const defaming = includesAny(text, DEFAMATION_WORDS);
  return !(impersonating || defaming);
}
