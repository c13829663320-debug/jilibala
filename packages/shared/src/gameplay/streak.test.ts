import { describe, it, expect } from 'vitest';
import { updateStreak, getStreakBonus, detectComeback } from './streak.js';
import type { MatchStats } from '../index.js';

describe('updateStreak', () => {
  it('胜：currentStreak 累加（正），best 刷新', () => {
    let s: MatchStats | undefined = undefined;
    s = updateStreak(s, 'win');
    expect(s).toEqual({ played: 1, wins: 1, bestStreak: 1, currentStreak: 1 });
    s = updateStreak(s, 'win');
    expect(s.currentStreak).toBe(2);
    expect(s.bestStreak).toBe(2);
    expect(s.wins).toBe(2);
  });

  it('从连败转连胜：currentStreak 从 0 开始累加', () => {
    let s: MatchStats = { played: 3, wins: 1, bestStreak: 2, currentStreak: -2 };
    s = updateStreak(s, 'win');
    expect(s.currentStreak).toBe(1);
    // best 不受连败影响
    expect(s.bestStreak).toBe(2);
  });

  it('负：currentStreak 递减（负），best 不变', () => {
    let s: MatchStats = { played: 5, wins: 4, bestStreak: 3, currentStreak: 3 };
    s = updateStreak(s, 'loss');
    expect(s.currentStreak).toBe(-1);
    expect(s.bestStreak).toBe(3);
    s = updateStreak(s, 'loss');
    expect(s.currentStreak).toBe(-2);
  });

  it('平：currentStreak 归零', () => {
    let s: MatchStats = { played: 5, wins: 4, bestStreak: 3, currentStreak: 3 };
    s = updateStreak(s, 'draw');
    expect(s.currentStreak).toBe(0);
    expect(s.wins).toBe(4);
  });
});

describe('getStreakBonus', () => {
  it('3/5/7 连胜阈值', () => {
    expect(getStreakBonus(0)).toBe(0);
    expect(getStreakBonus(2)).toBe(0);
    expect(getStreakBonus(3)).toBe(5);
    expect(getStreakBonus(4)).toBe(5);
    expect(getStreakBonus(5)).toBe(10);
    expect(getStreakBonus(6)).toBe(10);
    expect(getStreakBonus(7)).toBe(20);
    expect(getStreakBonus(99)).toBe(20);
  });
  it('连败无惩罚（返回 0）', () => {
    expect(getStreakBonus(-3)).toBe(0);
  });
});

describe('detectComeback', () => {
  it('正例：曾跌破 30%，终局 >50% → 翻盘', () => {
    expect(detectComeback([10, 20, 60], 60, 100)).toBe(true);
  });
  it('反例：全程领先，终局胜 → 非翻盘', () => {
    expect(detectComeback([50, 60, 70], 70, 100)).toBe(false);
  });
  it('反例：曾落后但终局未过 50%', () => {
    expect(detectComeback([10, 20, 40], 40, 100)).toBe(false);
  });
  it('反例：终局正好 50% 不算翻盘', () => {
    expect(detectComeback([10], 50, 100)).toBe(false);
  });
  it('maxScore<=0 安全返回 false', () => {
    expect(detectComeback([], 0, 0)).toBe(false);
  });
});
