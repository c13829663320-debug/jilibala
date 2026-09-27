import { describe, it, expect } from 'vitest';
import {
  detectHighlight,
  formatHighlightDescription,
  getHighlightsByType,
} from './highlights.js';
import type { Highlight } from './base-orchestrator.js';

describe('detectHighlight · court', () => {
  it('命中关键证据（hit && delta>=8）→ key_evidence', () => {
    const h = detectHighlight('court', {
      type: 'court_card_resolved',
      payload: { hit: true, delta: 9, round: 2 },
    });
    expect(h?.type).toBe('key_evidence');
    expect(h?.round).toBe(2);
  });
  it('delta<8 不产生高光', () => {
    const h = detectHighlight('court', {
      type: 'court_card_resolved',
      payload: { hit: true, delta: 4 },
    });
    expect(h).toBeNull();
  });
  it('未命中（hit=false）不产生高光', () => {
    const h = detectHighlight('court', {
      type: 'court_card_resolved',
      payload: { hit: false, delta: 20 },
    });
    expect(h).toBeNull();
  });
});

describe('detectHighlight · talkshow', () => {
  it('punchline>=35 → golden_quote', () => {
    const h = detectHighlight('talkshow', {
      type: 'joke_scored',
      payload: { scores: { punchline: 40 } },
    });
    expect(h?.type).toBe('golden_quote');
  });
  it('punchline<35 → null', () => {
    expect(
      detectHighlight('talkshow', { type: 'joke_scored', payload: { scores: { punchline: 20 } } }),
    ).toBeNull();
  });
});

describe('detectHighlight · werewolf', () => {
  it('公投带走狼 → prophet_vote', () => {
    const h = detectHighlight('werewolf', {
      type: 'vote_result',
      payload: { lynchedWerewolf: true },
    });
    expect(h?.type).toBe('prophet_vote');
  });
  it('带错好人 → null', () => {
    expect(
      detectHighlight('werewolf', { type: 'vote_result', payload: { lynchedWerewolf: false } }),
    ).toBeNull();
  });
});

describe('detectHighlight · bar', () => {
  it('counter 且 delta>=8 → epic_rebuttal', () => {
    const h = detectHighlight('bar', {
      type: 'turn_resolved',
      payload: { effectiveness: 'counter', delta: 10 },
    });
    expect(h?.type).toBe('epic_rebuttal');
  });
  it('普通回合 → null', () => {
    expect(
      detectHighlight('bar', { type: 'turn_resolved', payload: { effectiveness: 'agree', delta: 10 } }),
    ).toBeNull();
  });
});

describe('detectHighlight · gym', () => {
  it('perfectRate>=0.9 → extreme_performance', () => {
    const h = detectHighlight('gym', {
      type: 'station_completed',
      payload: { perfectRate: 0.95 },
    });
    expect(h?.type).toBe('extreme_performance');
  });
  it('完美率不足 → null', () => {
    expect(
      detectHighlight('gym', { type: 'station_completed', payload: { perfectRate: 0.7 } }),
    ).toBeNull();
  });
});

describe('detectHighlight · library', () => {
  it('combo>=5 → high_combo', () => {
    const h = detectHighlight('library', { type: 'answered', payload: { combo: 5 } });
    expect(h?.type).toBe('high_combo');
  });
  it('combo<5 → null', () => {
    expect(detectHighlight('library', { type: 'answered', payload: { combo: 3 } })).toBeNull();
  });
});

describe('detectHighlight · 通用翻盘', () => {
  it('settlement + comeback → comeback', () => {
    const h = detectHighlight('court', { type: 'settlement', payload: { comeback: true } });
    expect(h?.type).toBe('comeback');
  });
  it('settlement 非翻盘 → null', () => {
    expect(
      detectHighlight('court', { type: 'settlement', payload: { comeback: false } }),
    ).toBeNull();
  });
});

describe('format / filter', () => {
  it('formatHighlightDescription 带标签', () => {
    const h = detectHighlight('library', { type: 'answered', payload: { combo: 6 } })!;
    expect(formatHighlightDescription(h)).toContain('连胜连击');
  });
  it('getHighlightsByType 过滤', () => {
    const list: Highlight[] = [
      { id: '1', scene: 'x', type: 'comeback', timestamp: 1, description: '', data: {} },
      { id: '2', scene: 'x', type: 'high_combo', timestamp: 2, description: '', data: {} },
    ];
    expect(getHighlightsByType(list, 'comeback')).toHaveLength(1);
  });
});
