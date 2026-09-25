// ===== 离线知识包（双 LLM 都挂时的兜底）=====
// 当 StepFun 与 EvoMap 均不可用、且当前对话有名人上下文时，
// 加载 apps/api/data/offline-brains/<id>.json，做简单关键词匹配返回预置 QA。
// 这是有限降级，不是完整实时 LLM；所有回复都会带「（离线模式）」前缀。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getCelebrity } from "@balabala/shared";

export interface OfflineQA {
  q: string;
  a: string;
}

export interface OfflineBrain {
  id: string;
  name: string;
  persona: string;
  keyFacts: string[];
  quotes: string[];
  qa: OfflineQA[];
}

const brainsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "offline-brains");

const brainCache = new Map<string, OfflineBrain | null>();

/** 加载某名人的离线脑 JSON；不存在或损坏时返回 null（调用方据此降级）。 */
export function loadOfflineBrain(id: string): OfflineBrain | null {
  if (brainCache.has(id)) return brainCache.get(id) ?? null;
  // 防路径穿越：只取 id 的 basename 段。
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  const file = resolve(brainsDir, `${safeId}.json`);
  if (!existsSync(file)) {
    brainCache.set(id, null);
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as OfflineBrain;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.qa)) {
      brainCache.set(id, null);
      return null;
    }
    brainCache.set(id, parsed);
    return parsed;
  } catch {
    brainCache.set(id, null);
    return null;
  }
}

/** 把文本切成可匹配的 token：中文按字 + 2-gram，英文按单词。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  // 英文/数字词
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  tokens.push(...words);
  // 中文：单字 + 相邻二字组
  const han = lower.match(/[\u4e00-\u9fa5]/g) ?? [];
  for (const ch of han) tokens.push(ch);
  for (let i = 0; i + 1 < han.length; i++) tokens.push(han[i] + han[i + 1]);
  return tokens;
}

const scoreQA = (userTokens: string[], q: string): number => {
  const qTokens = new Set(tokenize(q));
  let score = 0;
  for (const t of userTokens) if (qTokens.has(t)) score += 1;
  return score;
};

/**
 * 在离线脑里找最相关的一条 QA；没有任何命中时退回 persona + 一句名言。
 */
export function matchOfflineReply(brain: OfflineBrain, userText: string): string {
  const userTokens = tokenize(userText);
  let best: OfflineQA | null = null;
  let bestScore = 0;
  for (const item of brain.qa) {
    const s = scoreQA(userTokens, item.q);
    if (s > bestScore) { bestScore = s; best = item; }
  }
  if (best && bestScore > 0) return best.a;
  // 无命中：给一段 persona 概述 + 随机一句名言，保持角色感。
  const quote = brain.quotes.length
    ? brain.quotes[Math.floor(Math.random() * brain.quotes.length)]
    : "";
  const intro = brain.persona.slice(0, 120);
  return quote
    ? `${intro}。${quote}`
    : intro;
}

/**
 * 顶层入口：根据 characterId 产出带「（离线模式）」前缀的兜底回复。
 * 离线脑缺失时，退而用 celebrities.ts 里的 greeting/persona 拼一段友好提示，
 * 保证有名人上下文时绝不抛 502。
 */
export function offlineFallbackReply(characterId: string, userText: string): string {
  const brain = loadOfflineBrain(characterId);
  if (brain) {
    return `（离线模式）${matchOfflineReply(brain, userText)}`;
  }
  // 防御：离线脑文件缺失，仍用共享数据里的人设给一句友好提示。
  const celeb = getCelebrity(characterId);
  const name = celeb?.name ?? "这位人物";
  const greeting = celeb?.greeting ?? "你好";
  return `（离线模式）现在连不上对话服务，我只能凭着记忆与你说几句。${name}此刻道：${greeting}`;
}
