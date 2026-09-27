import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRelationship,
  getRelationships,
  applyRelationshipChange,
  resetRelationship,
  configureRelationshipsForTest,
} from './relationship.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rel-'));
  configureRelationshipsForTest(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('名人关系持久化', () => {
  it('首次交手：创建档案并返回关系变化', () => {
    const change = applyRelationshipChange('u-1', 'elon-musk', {
      delta: 5,
      reason: '胜利+5',
      result: 'win',
    });
    expect(change.fromType).toBe('stranger');
    expect(change.toType).toBe('acquaintance');
    expect(change.delta).toBe(5);
    expect(change.newUnlock).toBe('greeting:elon-musk');

    const rel = getRelationship('u-1', 'elon-musk');
    expect(rel?.affinity).toBe(5);
    expect(rel?.gamesPlayed).toBe(1);
    expect(rel?.winsAgainst).toBe(1);
    expect(rel?.currentStreak).toBe(1);
  });

  it('连胜累加、bestStreak 刷新', () => {
    applyRelationshipChange('u-1', 'elon-musk', { delta: 5, reason: 'win', result: 'win' });
    applyRelationshipChange('u-1', 'elon-musk', { delta: 6, reason: 'win', result: 'win' });
    const rel = getRelationship('u-1', 'elon-musk')!;
    expect(rel.currentStreak).toBe(2);
    expect(rel.bestStreak).toBe(2);
    expect(rel.affinity).toBe(11);
  });

  it('连败转负、draw 清零', () => {
    applyRelationshipChange('u-1', 'elon-musk', { delta: -2, reason: 'loss', result: 'loss' });
    const rel = getRelationship('u-1', 'elon-musk')!;
    expect(rel.currentStreak).toBe(-1);
    expect(rel.type).toBe('stranger');
  });

  it('跨档解锁：累计到 friend 补发 title 奖励', () => {
    // 从 0 一路赢到 affinity 40+
    applyRelationshipChange('u-1', 'elon-musk', { delta: 15, reason: 'x', result: 'win' }); // 15 acquaintance
    const c2 = applyRelationshipChange('u-1', 'elon-musk', { delta: 30, reason: 'x', result: 'win' }); // 45 close
    expect(c2.toType).toBe('close');
    const rel = getRelationship('u-1', 'elon-musk')!;
    // 跨过 acquaintance→friend→close，三个奖励都应在列表
    expect(rel.unlockedRewards).toContain('greeting:elon-musk');
    expect(rel.unlockedRewards).toContain('title:elon-musk');
    expect(rel.unlockedRewards).toContain('case:elon-musk');
  });

  it('getRelationships 列出全部', () => {
    applyRelationshipChange('u-1', 'elon-musk', { delta: 5, reason: 'x', result: 'win' });
    applyRelationshipChange('u-1', 'steve-jobs', { delta: -3, reason: 'x', result: 'loss' });
    expect(getRelationships('u-1')).toHaveLength(2);
  });

  it('reset 后档案消失', () => {
    applyRelationshipChange('u-1', 'elon-musk', { delta: 5, reason: 'x', result: 'win' });
    resetRelationship('u-1', 'elon-musk');
    expect(getRelationship('u-1', 'elon-musk')).toBeNull();
    expect(existsSync(join(dir, 'u-1.json'))).toBe(true); // 文件仍在但 relationships 为空
  });

  it('落盘结构正确', () => {
    applyRelationshipChange('u-9', 'elon-musk', { delta: 5, reason: 'x', result: 'win' });
    const raw = JSON.parse(readFileSync(join(dir, 'u-9.json'), 'utf8'));
    expect(raw.userId).toBe('u-9');
    expect(raw.relationships['elon-musk'].affinity).toBe(5);
  });
});
