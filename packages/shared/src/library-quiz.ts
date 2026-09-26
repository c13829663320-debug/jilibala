// ===== 图书馆 · 知识擂台赛（纯逻辑，前后端共用）=====
// 领域、对手阵容、计分规则、AI 抢答模拟全部为纯函数，便于单测与复用。
// LLM 题目生成在 apps/api；AI 抢答由前端 setTimeout 触发，但判定逻辑收敛在这里。

export type QuizDomain = "science" | "literature" | "philosophy" | "history" | "art";

export interface QuizQuestion {
  prompt: string;
  /** 恰好 4 个选项。 */
  options: string[];
  /** 0-3，正确选项下标。 */
  correctIndex: number;
  /** 一句话解析。 */
  explanation: string;
}

export const QUIZ_DOMAINS: Array<{ id: QuizDomain; label: string }> = [
  { id: "science", label: "科学" },
  { id: "literature", label: "文学" },
  { id: "philosophy", label: "哲学" },
  { id: "history", label: "历史" },
  { id: "art", label: "艺术" },
];

export const QUIZ_DOMAIN_LABEL: Record<QuizDomain, string> = {
  science: "科学",
  literature: "文学",
  philosophy: "哲学",
  history: "历史",
  art: "艺术",
};

export const isQuizDomain = (v: string): v is QuizDomain =>
  v === "science" || v === "literature" || v === "philosophy" || v === "history" || v === "art";

// ===== 每局固定参数 =====
export const QUIZ_QUESTION_COUNT = 8;
export const QUIZ_QUESTION_TIME_LIMIT_MS = 10_000;
export const QUIZ_STARTING_LIVES = 3;

export const PLAYER_BASE_SCORE = 100;
/** 连对达到该 combo 后，下一题开始 ×2。 */
export const COMBO_DOUBLE_THRESHOLD = 3;
export const AI_BUZZ_SUCCESS_SCORE = 50;
export const AI_BUZZ_WRONG_SCORE = -20;

// ===== 对手阵容：每领域 3 位 AI 名人 =====
export const QUIZ_OPPONENT_IDS: Record<QuizDomain, [string, string, string]> = {
  science: ["albert-einstein", "isaac-newton", "marie-curie"],
  literature: ["lu-xun", "li-bai", "shakespeare"],
  philosophy: ["confucius", "socrates", "nietzsche"],
  history: ["zhuge-liang", "su-shi", "confucius"],
  art: ["leonardo", "van-gogh", "su-shi"],
};

/** 名人领域 → 擂台领域的映射，用于主场正确率加权。 */
const FIELD_TO_DOMAIN: Record<string, QuizDomain> = {
  科学: "science",
  文学: "literature",
  哲学: "philosophy",
  艺术: "art",
};

/**
 * AI 名人在某领域题上抢答的正确率。
 * 主场名人（领域对口）约 85%，客场名人约 55%。
 * 例：文学题鲁迅（文学场）≈0.85，文学题居里夫人（科学场）≈0.55。
 */
export function celebBuzzAccuracy(celebField: string | undefined, domain: QuizDomain): number {
  const home = celebField ? FIELD_TO_DOMAIN[celebField] : undefined;
  return home === domain ? 0.85 : 0.55;
}

// ===== 计分（纯函数）=====

/** 玩家答对时本回合得分；comboBefore 为答题前的连对数。 */
export function playerScoreDelta(comboBefore: number): number {
  return comboBefore >= COMBO_DOUBLE_THRESHOLD ? PLAYER_BASE_SCORE * 2 : PLAYER_BASE_SCORE;
}

/** 答题后更新 combo。答对 +1，答错/超时归零。 */
export function nextCombo(comboBefore: number, correct: boolean): number {
  return correct ? comboBefore + 1 : 0;
}

export interface QuizPlayer {
  id: string;       // "you" 或 celebrityId
  name: string;
  score: number;
  isCeleb: boolean;
}

/** 按分数降序排名，返回名次表（1 起）。 */
export function rankPlayers(players: QuizPlayer[]): Array<QuizPlayer & { rank: number }> {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => ({ ...p, rank: i + 1 }));
}

/** 段位：打赢全部 3 位对手=宗师；赢 1 位=学霸；其余=门外汉。 */
export type QuizTier = "门外汉" | "学霸" | "宗师";

export function tierForRank(playerRank: number): QuizTier {
  if (playerRank <= 1) return "宗师";
  if (playerRank === 2) return "学霸";
  return "门外汉";
}

// ===== AI 抢答模拟（纯函数，rand 可注入便于测试）=====

export interface PlannedBuzz {
  celebId: string;
  /** 在题目开始后多少毫秒抢答（2000-8000）。 */
  atMs: number;
  /** 是否答对。 */
  correct: boolean;
  /** 对 AI 分数的影响 +50 / -20。 */
  delta: number;
}

export interface BuzzOpponent {
  id: string;
  field: string | undefined;
}

/**
 * 为一道题规划 1-2 位 AI 对手的抢答。
 * @param rand 返回 [0,1) 随机数；默认 Math.random，测试可注入确定性序列。
 */
export function planBuzzes(
  domain: QuizDomain,
  opponents: BuzzOpponent[],
  rand: () => number = Math.random,
): PlannedBuzz[] {
  if (opponents.length === 0) return [];
  // 每题 1-2 位 AI 抢答。
  const count = rand() < 0.5 ? 1 : 2;
  // 随机挑选 count 位不重复的对手。
  const pool = [...opponents];
  const picked: BuzzOpponent[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.map((o) => {
    const accuracy = celebBuzzAccuracy(o.field, domain);
    const correct = rand() < accuracy;
    return {
      celebId: o.id,
      // 2000-8000ms 之间随机抢答。
      atMs: 2000 + Math.floor(rand() * 6000),
      correct,
      delta: correct ? AI_BUZZ_SUCCESS_SCORE : AI_BUZZ_WRONG_SCORE,
    };
  });
}

// ===== 题库校验（LLM 生成结果清洗）=====

/** 校验单题结构是否合法；非法返回 null。 */
export function validateQuizQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
  const options = Array.isArray(q.options) ? q.options : [];
  const correctIndex = Number(q.correctIndex);
  const explanation = typeof q.explanation === "string" ? q.explanation.trim() : "";
  if (!prompt) return null;
  if (options.length !== 4) return null;
  if (!options.every((o) => typeof o === "string" && o.trim())) return null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) return null;
  return {
    prompt,
    options: options.map((o) => (o as string).trim()),
    correctIndex,
    explanation: explanation || "（这道题值得记住。）",
  };
}
