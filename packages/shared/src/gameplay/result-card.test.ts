import { describe, it, expect } from 'vitest';
import { buildResultCard, resultCardToText } from './result-card.js';
import type { GameResult, Tier } from './types.js';

const TIER: Tier = { level: 'expert', label: '出色', score: 70, percentile: 70 };

function makeResult(over: Partial<GameResult> = {}): GameResult {
  return {
    winner: 'slot-0',
    scores: { 'slot-0': 70 },
    tier: TIER,
    rankPoints: 25,
    highlights: [],
    durationMs: 12_000,
    ...over,
  };
}

describe('buildResultCard', () => {
  it('字段完整', () => {
    const card = buildResultCard({
      scene: 'court',
      result: makeResult(),
      highlights: [],
      relationshipChanges: [],
      streak: { current: 3, best: 5 },
      opponent: { id: 'elon-musk', name: '马斯克', type: 'celebrity' },
      outcome: 'win',
    });
    expect(card.scene).toBe('court');
    expect(card.sceneLabel).toBe('趣味法庭');
    expect(card.result).toBe('win');
    expect(card.tier.label).toBe('出色');
    expect(card.rankPoints).toBe(25);
    expect(card.opponent.type).toBe('celebrity');
    expect(card.playedAt).toBeTruthy();
  });

  it('新纪录标记：current 达到 best 且 >0', () => {
    const card = buildResultCard({
      scene: 'bar',
      result: makeResult(),
      highlights: [],
      relationshipChanges: [],
      streak: { current: 5, best: 5 },
      opponent: { id: 'ai-1', name: 'AI', type: 'ai' },
      outcome: 'win',
    });
    expect(card.streak.isNewBest).toBe(true);
  });

  it('大胜（>85%）推断为 big_win', () => {
    const card = buildResultCard({
      scene: 'court',
      result: makeResult({ tier: { ...TIER, score: 90, percentile: 90 } }),
      highlights: [],
      relationshipChanges: [],
      streak: { current: 0, best: 0 },
      opponent: { id: 'x', name: 'X', type: 'ai' },
      outcome: 'win',
    });
    expect(card.settlementType).toBe('big_win');
  });

  it('惜败（45-50%）推断为 narrow_loss', () => {
    const card = buildResultCard({
      scene: 'court',
      result: makeResult({ tier: { ...TIER, score: 48, percentile: 48 } }),
      highlights: [],
      relationshipChanges: [],
      streak: { current: 0, best: 0 },
      opponent: { id: 'x', name: 'X', type: 'ai' },
      outcome: 'loss',
    });
    expect(card.settlementType).toBe('narrow_loss');
  });
});

describe('resultCardToText', () => {
  it('生成非空分享文案', () => {
    const card = buildResultCard({
      scene: 'werewolf',
      result: makeResult(),
      highlights: [],
      relationshipChanges: [],
      streak: { current: 3, best: 3 },
      opponent: { id: 'luxun', name: '鲁迅', type: 'celebrity' },
      outcome: 'win',
    });
    const text = resultCardToText(card);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('狼人杀馆');
    expect(text).toContain('连胜');
  });
});
