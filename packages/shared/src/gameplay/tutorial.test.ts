import { describe, it, expect } from 'vitest';
import { TutorialEngine } from './tutorial.js';
import type { TutorialStep } from './types.js';

const steps: TutorialStep[] = [
  { id: 's1', title: '第一步', description: '欢迎' },
  { id: 's2', title: '第二步', description: '出牌' },
  { id: 's3', title: '第三步', description: '结算' },
];

describe('TutorialEngine', () => {
  it('start 后从第一步开始', () => {
    const t = new TutorialEngine(steps);
    t.start();
    expect(t.isActive).toBe(true);
    expect(t.getCurrentStep()?.id).toBe('s1');
  });
  it('next 前进，到末尾自动结束', () => {
    const t = new TutorialEngine(steps);
    t.start();
    t.next();
    expect(t.getCurrentStep()?.id).toBe('s2');
    t.next();
    expect(t.getCurrentStep()?.id).toBe('s3');
    t.next();
    expect(t.isActive).toBe(false);
    expect(t.isCompleted).toBe(true);
    expect(t.getCurrentStep()).toBeNull();
  });
  it('skip 标记完成，不再触发', () => {
    const t = new TutorialEngine(steps);
    t.start();
    t.skip();
    expect(t.isActive).toBe(false);
    expect(t.isSkipped).toBe(true);
    expect(t.isCompleted).toBe(true);
    // 已完成后再 start 不会重新激活
    t.start();
    expect(t.isActive).toBe(false);
  });
  it('无步骤时 start 直接完成', () => {
    const t = new TutorialEngine([]);
    t.start();
    expect(t.isActive).toBe(false);
    expect(t.isCompleted).toBe(true);
  });
  it('reset 恢复可教学状态', () => {
    const t = new TutorialEngine(steps);
    t.start();
    t.skip();
    t.reset();
    expect(t.isCompleted).toBe(false);
    t.start();
    expect(t.getCurrentStep()?.id).toBe('s1');
  });
});
