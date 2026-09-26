// ============================================================================
// 每日挑战 —— 确定性种子 + 预设挑战池。
// 同一天、同一场景，所有人拿到同一个挑战（seed 由日期哈希得出）。
// ============================================================================

import type { GameResult, SceneId } from './types.js';

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  /** 修饰语 / 特殊规则描述，前端展示用。 */
  modifier: string;
  reward: number;
}

/** FNV-1a 字符串哈希，返回非负整数。 */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 由日期得到确定性种子。同一天（本地日历日）返回同一数字。
 */
export function getDailySeed(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return hashString(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

interface ChallengeDef extends Omit<DailyChallenge, 'id'> {
  id: string;
}

/** 每场景至少 5 条；用 seed 取模选中当天那条。 */
const CHALLENGE_POOL: Record<SceneId, ChallengeDef[]> = {
  court: [
    { id: 'court-evidence-clinch', title: '铁证如山', description: '本局靠出示证据牌取胜', modifier: '证据命中双倍', reward: 30 },
    { id: 'court-balanced-win', title: '天平压过55', description: '以天平 ≥55 的优势赢下判决', modifier: '天平初值 45:55', reward: 30 },
    { id: 'court-honest-lawyer', title: '正人君子', description: '整局不使用嘲讽牌取胜', modifier: '禁用 mock 牌', reward: 40 },
    { id: 'court-clean-rounds', title: '干净利落', description: '本局达到 expert 及以上段位', modifier: '对手 AI 语速 +20%', reward: 50 },
    { id: 'court-comeback', title: '绝地反击', description: '先落后再翻盘获胜', modifier: '开局天平 40:60', reward: 60 },
    { id: 'court-gavel-master', title: '金牌大状', description: '本局达到 master 段位', modifier: '满分 120 分', reward: 100 },
  ],
  talkshow: [
    { id: 'ts-callback-chain', title: '三段全 callback', description: '三个段子全部成功回扣前置梗', modifier: '共鸣加成翻倍', reward: 50 },
    { id: 'ts-punchline-master', title: '包袱大师', description: '单段 punchline 维度 ≥36', modifier: 'punchline 权重 +20%', reward: 40 },
    { id: 'ts-zero-silence', title: '零冷场', description: '本局无任何 silence 反应', modifier: '观众基线更挑剔', reward: 40 },
    { id: 'ts-fast-pen', title: '速战速决', description: '单段作答时间 ≤20 秒仍拿高分', modifier: '每题限时 30 秒', reward: 30 },
    { id: 'ts-tonight-star', title: '今日之星', description: '本局达到 master 段位', modifier: '满分 120 分', reward: 100 },
  ],
  werewolf: [
    { id: 'ww-good-win', title: '正义黎明', description: '以好人阵营身份获胜', modifier: '狼人夜间刀人 -1 次', reward: 50 },
    { id: 'ww-reasoning-mvp', title: '推理大师', description: '本局达到 expert 及以上段位', modifier: '预言家首验必中', reward: 60 },
    { id: 'ww-survivor', title: '活到最后', description: '以存活状态撑到终局', modifier: '首夜平安夜', reward: 40 },
    { id: 'ww-seer-true', title: '明察秋毫', description: '作为预言家验人全对', modifier: '查验窗口 +5 秒', reward: 50 },
    { id: 'ww-wolf-alpha', title: '狼王降临', description: '以狼人阵营身份获胜', modifier: '女巫首药不能自解', reward: 70 },
  ],
  bar: [
    { id: 'bar-counter-king', title: '属性克制', description: '本局至少打出一次克制效果取胜', modifier: 'AI 倾向每轮必换', reward: 40 },
    { id: 'bar-sweep', title: '三回合全胜', description: '三回合每回合强度都领先', modifier: '初始强度 45:45', reward: 50 },
    { id: 'bar-quick-tongue', title: '快嘴', description: '单回合作答 ≤15 秒', modifier: '每回合限时 20 秒', reward: 30 },
    { id: 'bar-rebound', title: '后发制人', description: '首回合落后后反超获胜', modifier: '首回合 AI 先手', reward: 50 },
    { id: 'bar-debate-god', title: '辩神', description: '本局达到 master 段位', modifier: '满分 120 分', reward: 100 },
  ],
  gym: [
    { id: 'gym-quick-eyes', title: '眼疾手快', description: '反应关平均反应 ≤350ms', modifier: '圆圈存活 1200ms', reward: 40 },
    { id: 'gym-rhythm-master', title: '节奏大师', description: '节奏关最高 combo ≥8', modifier: '轨道速度 +10%', reward: 50 },
    { id: 'gym-power-clean', title: '力量爆发', description: '力量关最好成绩 ≥90', modifier: '目标区收窄到 [82,88]', reward: 40 },
    { id: 'gym-no-miss', title: '满血通关', description: '本局 3 滴血一滴不丢', modifier: '圆圈间隔缩短', reward: 60 },
    { id: 'gym-explosive', title: '爆杆', description: '本局达到 master 段位', modifier: '满分 4500 分', reward: 100 },
  ],
  library: [
    { id: 'library-triple', title: '三连击', description: '本局达成一次三连对', modifier: 'AI 抢答概率 +10%', reward: 40 },
    { id: 'library-outscore-2', title: '力压双人', description: '总分击败至少 2 位 AI 对手', modifier: 'AI 答对率 +10%', reward: 50 },
    { id: 'library-buzzer', title: '秒答', description: '单题作答 ≤3 秒答对', modifier: '每题限时 8 秒', reward: 30 },
    { id: 'library-flawless', title: '全对', description: '8 题全部答对', modifier: '题目难度 +1 档', reward: 80 },
    { id: 'library-grandmaster', title: '知识宗师', description: '本局达到 master 段位', modifier: '满分 1200 分', reward: 100 },
  ],
};

/** 取某场景某天的挑战。 */
export function getDailyChallenge(
  scene: SceneId,
  date: Date,
): DailyChallenge {
  const pool = CHALLENGE_POOL[scene];
  const seed = (getDailySeed(date) ^ hashString(scene)) >>> 0;
  const picked = pool[seed % pool.length];
  return { ...picked };
}

/**
 * 校验挑战是否在结算结果中达成。
 * 基础层只看 GameResult 能表达的事实（段位 / 胜负 / 时长）；
 * 更细的条件（如"没用嘲讽牌"）由场景在 payload 里追加 highlight 后扩展。
 */
export function isChallengeCompleted(
  challengeId: string,
  result: GameResult,
): boolean {
  const tier = result.tier.level;

  // master 段位类挑战
  if (challengeId.endsWith('-master') || challengeId.endsWith('-star') ||
      challengeId.endsWith('-explosive') || challengeId.endsWith('-grandmaster') ||
      challengeId === 'court-gavel-master' || challengeId === 'ts-tonight-star' ||
      challengeId === 'bar-debate-god' || challengeId === 'gym-explosive' ||
      challengeId === 'library-grandmaster') {
    return tier === 'master';
  }

  // expert 段位类挑战
  if (challengeId === 'court-clean-rounds' || challengeId === 'ww-reasoning-mvp') {
    return tier === 'expert' || tier === 'master';
  }

  // 阵营 / 胜负类挑战：有 winner 即视为分出胜负
  if (
    challengeId.endsWith('-win') ||
    challengeId.endsWith('-clinch') ||
    challengeId.endsWith('-sweep') ||
    challengeId.endsWith('-comeback') ||
    challengeId === 'bar-counter-king' ||
    challengeId === 'ww-good-win' ||
    challengeId === 'ww-wolf-alpha'
  ) {
    return result.winner !== null;
  }

  // 默认：达到 adept 及以上视为完成（兜底）
  return tier === 'adept' || tier === 'expert' || tier === 'master';
}
