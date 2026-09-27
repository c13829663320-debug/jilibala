import { describe, it, expect } from 'vitest';
import {
  computeAffinityDelta,
  typeFromAffinity,
  getUnlockForType,
  clampAffinity,
} from './relationship.js';

const base = {
  scene: 'court',
  score: 50,
  maxScore: 100,
  highlights: [],
  comeback: false,
  opponentAffinity: 0,
};

describe('computeAffinityDelta', () => {
  it('基础胜 +5 / 平 +2 / 负 -2', () => {
    expect(computeAffinityDelta({ ...base, result: 'win' })).toBe(5);
    expect(computeAffinityDelta({ ...base, result: 'draw' })).toBe(2);
    expect(computeAffinityDelta({ ...base, result: 'loss' })).toBe(-2);
  });

  it('每个高光 +3', () => {
    const d = computeAffinityDelta({
      ...base,
      result: 'win',
      highlights: [{ type: 'key_evidence' }, { type: 'golden_quote' }],
    });
    // 5 + 2*3 = 11
    expect(d).toBe(11);
  });

  it('翻盘额外 +10', () => {
    const d = computeAffinityDelta({ ...base, result: 'win', comeback: true });
    expect(d).toBe(15);
  });

  it('大胜（得分率>85%）再 +5', () => {
    const d = computeAffinityDelta({ ...base, result: 'win', score: 90, maxScore: 100 });
    expect(d).toBe(10);
  });

  it('大胜 + 高光 + 翻盘叠加', () => {
    const d = computeAffinityDelta({
      ...base,
      result: 'win',
      score: 90,
      maxScore: 100,
      highlights: [{ type: 'x' }],
      comeback: true,
    });
    // 5 +3 +10 +5 = 23
    expect(d).toBe(23);
  });

  it('宿敌（affinity<-30）胜负双倍基础分，高光/翻盘不翻倍', () => {
    // 赢宿敌：基础 5*2=10，无高光
    const win = computeAffinityDelta({ ...base, result: 'win', opponentAffinity: -40 });
    expect(win).toBe(10);
    // 输宿敌：基础 -2*2=-4
    const loss = computeAffinityDelta({ ...base, result: 'loss', opponentAffinity: -40 });
    expect(loss).toBe(-4);
    // 平不翻倍
    const draw = computeAffinityDelta({ ...base, result: 'draw', opponentAffinity: -40 });
    expect(draw).toBe(2);
  });

  it('边界：affinity 刚好 -30 不触发宿敌双倍', () => {
    const win = computeAffinityDelta({ ...base, result: 'win', opponentAffinity: -30 });
    expect(win).toBe(5);
  });
});

describe('typeFromAffinity', () => {
  it('全档位边界', () => {
    expect(typeFromAffinity(-100)).toBe('rival');
    expect(typeFromAffinity(-30)).toBe('rival');
    expect(typeFromAffinity(-31)).toBe('rival');
    expect(typeFromAffinity(-1)).toBe('stranger');
    expect(typeFromAffinity(0)).toBe('acquaintance');
    expect(typeFromAffinity(19)).toBe('acquaintance');
    expect(typeFromAffinity(20)).toBe('friend');
    expect(typeFromAffinity(39)).toBe('friend');
    expect(typeFromAffinity(40)).toBe('close');
    expect(typeFromAffinity(59)).toBe('close');
    expect(typeFromAffinity(60)).toBe('soulmate');
    expect(typeFromAffinity(100)).toBe('soulmate');
  });
});

describe('getUnlockForType', () => {
  it('正向档各解锁对应奖励 id', () => {
    expect(getUnlockForType('acquaintance', 'elon-musk')).toBe('greeting:elon-musk');
    expect(getUnlockForType('friend', 'elon-musk')).toBe('title:elon-musk');
    expect(getUnlockForType('close', 'elon-musk')).toBe('case:elon-musk');
    expect(getUnlockForType('soulmate', 'elon-musk')).toBe('partner_mode:elon-musk');
  });
  it('stranger / rival 无奖励', () => {
    expect(getUnlockForType('stranger', 'x')).toBeNull();
    expect(getUnlockForType('rival', 'x')).toBeNull();
  });
});

describe('clampAffinity', () => {
  it('夹到 [-100,100]', () => {
    expect(clampAffinity(250)).toBe(100);
    expect(clampAffinity(-250)).toBe(-100);
    expect(clampAffinity(37.4)).toBe(37);
    expect(clampAffinity(NaN)).toBe(0);
  });
});
