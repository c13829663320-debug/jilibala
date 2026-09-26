import { describe, it, expect } from 'vitest';
import {
  clampScore,
  computeTier,
  computeRankPoints,
  computeStreak,
} from './scoring.js';
import type { TierLevel } from './types.js';

const LABELS: Record<TierLevel, string> = {
  novice: '菜鸟',
  adept: '尚可',
  expert: '出色',
  master: '大师',
};

describe('clampScore', () => {
  it('clamps into range', () => {
    expect(clampScore(150, 0, 100)).toBe(100);
    expect(clampScore(-5, 0, 100)).toBe(0);
    expect(clampScore(42, 0, 100)).toBe(42);
  });
  it('NaN falls back to min', () => {
    expect(clampScore(NaN, 0, 100)).toBe(0);
  });
});

describe('computeTier — 边界阈值', () => {
  it('ratio <30% => novice', () => {
    expect(computeTier(0, 100, LABELS).level).toBe('novice');
    expect(computeTier(29, 100, LABELS).level).toBe('novice');
    expect(computeTier(29.9, 100, LABELS).level).toBe('novice');
  });
  it('ratio ==30% => adept（边界归入上一档）', () => {
    expect(computeTier(30, 100, LABELS).level).toBe('adept');
    expect(computeTier(59, 100, LABELS).level).toBe('adept');
  });
  it('ratio ==60% => expert', () => {
    expect(computeTier(60, 100, LABELS).level).toBe('expert');
    expect(computeTier(84, 100, LABELS).level).toBe('expert');
  });
  it('ratio >=85% => master', () => {
    expect(computeTier(85, 100, LABELS).level).toBe('master');
    expect(computeTier(100, 100, LABELS).level).toBe('master');
  });
  it('percentile 0-100 四舍五入', () => {
    expect(computeTier(33, 100, LABELS).percentile).toBe(33);
    expect(computeTier(0, 100, LABELS).percentile).toBe(0);
    expect(computeTier(100, 100, LABELS).percentile).toBe(100);
  });
  it('maxScore<=0 时不除零', () => {
    const t = computeTier(10, 0, LABELS);
    expect(t.level).toBe('novice');
    expect(t.percentile).toBe(0);
  });
  it('label 取场景文案', () => {
    expect(computeTier(90, 100, LABELS).label).toBe('大师');
  });
});

describe('computeRankPoints', () => {
  it('基础分：win/draw/loss', () => {
    expect(computeRankPoints('win', 1000)).toBe(25);
    expect(computeRankPoints('draw', 1000)).toBe(10);
    expect(computeRankPoints('loss', 1000)).toBe(-15);
  });
  it('5 分以内不修正', () => {
    expect(computeRankPoints('win', 1000, 1000)).toBe(25);
    expect(computeRankPoints('win', 1000, 1005)).toBe(25);
    expect(computeRankPoints('win', 1000, 1100)).toBe(25); // 差100，超出5的部分=95<100
  });
  it('每超出 100 分 ±2：赢强者加分', () => {
    expect(computeRankPoints('win', 1000, 1200)).toBe(27); // 200差→excess195→1档→+2
    expect(computeRankPoints('win', 1000, 1300)).toBe(29); // 300差→excess295→2档→+4
  });
  it('赢弱者减分', () => {
    expect(computeRankPoints('win', 1000, 800)).toBe(23);
  });
  it('输弱者多扣，输强者少扣', () => {
    expect(computeRankPoints('loss', 1000, 800)).toBe(-17);
    expect(computeRankPoints('loss', 1000, 1200)).toBe(-13);
  });
  it('draw 不应用对手修正', () => {
    expect(computeRankPoints('draw', 1000, 2000)).toBe(10);
  });
});

describe('computeStreak', () => {
  it('<3 无加成', () => {
    expect(computeStreak(0)).toEqual({ bonus: 0, label: '' });
    expect(computeStreak(2)).toEqual({ bonus: 0, label: '' });
  });
  it('3 连胜 +5', () => {
    expect(computeStreak(3)).toEqual({ bonus: 5, label: '三连胜' });
    expect(computeStreak(4)).toEqual({ bonus: 5, label: '三连胜' });
  });
  it('5 连胜 +10', () => {
    expect(computeStreak(5)).toEqual({ bonus: 10, label: '五连胜' });
    expect(computeStreak(6)).toEqual({ bonus: 10, label: '五连胜' });
  });
  it('7 连胜 +20', () => {
    expect(computeStreak(7)).toEqual({ bonus: 20, label: '七连胜' });
    expect(computeStreak(12)).toEqual({ bonus: 20, label: '七连胜' });
  });
});
