import { describe, it, expect } from 'vitest';
import {
  getDailySeed,
  getDailyChallenge,
  isChallengeCompleted,
} from './daily-challenge.js';
import type { GameResult, Tier } from './types.js';

function resultWithTier(level: Tier['level'], winner: string | null = 'slot-0'): GameResult {
  return {
    winner,
    scores: { 'slot-0': 100 },
    tier: { level, label: level, score: 100, percentile: level === 'master' ? 95 : 50 },
    rankPoints: 25,
    highlights: [],
    durationMs: 1000,
  };
}

describe('getDailySeed — 确定性', () => {
  it('同一天返回相同种子', () => {
    const d1 = new Date(2026, 8, 27, 9, 0, 0);
    const d2 = new Date(2026, 8, 27, 23, 0, 0);
    expect(getDailySeed(d1)).toBe(getDailySeed(d2));
  });
  it('不同天返回不同种子', () => {
    const a = new Date(2026, 8, 27);
    const b = new Date(2026, 8, 28);
    expect(getDailySeed(a)).not.toBe(getDailySeed(b));
  });
});

describe('getDailyChallenge', () => {
  it('每场景每天返回同一挑战', () => {
    const d = new Date(2026, 8, 27, 10);
    expect(getDailyChallenge('court', d)).toEqual(getDailyChallenge('court', d));
  });
  it('六场景都能取到挑战且字段完整', () => {
    const d = new Date(2026, 8, 27);
    const scenes = ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library'] as const;
    for (const s of scenes) {
      const c = getDailyChallenge(s, d);
      expect(c.id).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.reward).toBeGreaterThan(0);
    }
  });
  it('同一挑战在一周内分布在不同条目（可复算性）', () => {
    const ids = new Set<string>();
    for (let day = 1; day <= 7; day++) {
      ids.add(getDailyChallenge('court', new Date(2026, 8, day)).id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('isChallengeCompleted', () => {
  it('master 类挑战需要 master 段位', () => {
    expect(isChallengeCompleted('court-gavel-master', resultWithTier('master'))).toBe(true);
    expect(isChallengeCompleted('court-gavel-master', resultWithTier('expert'))).toBe(false);
  });
  it('expert 类挑战 expert/master 都算过', () => {
    expect(isChallengeCompleted('court-clean-rounds', resultWithTier('expert'))).toBe(true);
    expect(isChallengeCompleted('court-clean-rounds', resultWithTier('adept'))).toBe(false);
  });
  it('胜负类挑战有 winner 即算完成', () => {
    expect(isChallengeCompleted('court-evidence-clinch', resultWithTier('novice', 'slot-0'))).toBe(true);
    expect(isChallengeCompleted('court-evidence-clinch', resultWithTier('novice', null))).toBe(false);
  });
});
