import { describe, it, expect } from 'vitest';
import {
  createSlots,
  assignHumanToSlot,
  fillWithAI,
  getKeySlot,
  getHumanSlots,
  getAISlots,
} from './player-slots.js';

describe('createSlots', () => {
  it('前 humanCount 个为真人占位，其余为 AI', () => {
    const slots = createSlots({
      roles: ['defendant', 'plaintiff', 'judge'],
      humanCount: 1,
      aiPersonas: ['luxun', 'xuesen'],
    });
    expect(slots).toHaveLength(3);
    expect(slots[0].isHuman).toBe(true);
    expect(slots[0].userId).toBeUndefined();
    expect(slots[1].isHuman).toBe(false);
    expect(slots[1].aiPersona).toBe('luxun');
    expect(slots[2].aiPersona).toBe('xuesen');
  });
  it('AI persona 不足时循环填充', () => {
    const slots = createSlots({
      roles: ['a', 'b', 'c', 'd'],
      humanCount: 1,
      aiPersonas: ['only-one'],
    });
    expect(slots[1].aiPersona).toBe('only-one');
    expect(slots[2].aiPersona).toBe('only-one');
  });
});

describe('assignHumanToSlot', () => {
  it('把真人绑到指定槽位', () => {
    let slots = createSlots({
      roles: ['a', 'b'],
      humanCount: 1,
      aiPersonas: ['p1'],
    });
    slots = assignHumanToSlot(slots, 'slot-0', 'u-123', '小明');
    const key = getKeySlot(slots);
    expect(key?.userId).toBe('u-123');
    expect(key?.nickname).toBe('小明');
    expect(key?.isHuman).toBe(true);
  });
  it('返回新数组，不修改原数组', () => {
    const original = createSlots({ roles: ['a'], humanCount: 1, aiPersonas: [] });
    const next = assignHumanToSlot(original, 'slot-0', 'u', 'n');
    expect(original[0].userId).toBeUndefined();
    expect(next).not.toBe(original);
  });
});

describe('fillWithAI', () => {
  it('把未绑定的真人占位槽填成 AI', () => {
    let slots = createSlots({
      roles: ['a', 'b', 'c'],
      humanCount: 2,
      aiPersonas: ['p1'],
    });
    slots = fillWithAI(slots, ['p-new']);
    // 两个真人占位都没绑 userId → 都变 AI
    expect(slots[0].isHuman).toBe(false);
    expect(slots[1].isHuman).toBe(false);
  });
  it('已绑定真人的槽位不动', () => {
    let slots = createSlots({ roles: ['a', 'b'], humanCount: 2, aiPersonas: [] });
    slots = assignHumanToSlot(slots, 'slot-0', 'u-1', '小明');
    slots = fillWithAI(slots, ['p-x']);
    expect(slots[0].isHuman).toBe(true);
    expect(slots[0].userId).toBe('u-1');
    expect(slots[1].isHuman).toBe(false);
  });
});

describe('getHumanSlots / getAISlots / getKeySlot', () => {
  it('按是否绑定真人分类', () => {
    let slots = createSlots({
      roles: ['a', 'b', 'c'],
      humanCount: 1,
      aiPersonas: ['p1', 'p2'],
    });
    slots = assignHumanToSlot(slots, 'slot-0', 'u-1', '小明');
    expect(getHumanSlots(slots)).toHaveLength(1);
    expect(getAISlots(slots)).toHaveLength(2);
    expect(getKeySlot(slots)?.slotId).toBe('slot-0');
  });
  it('无真人时 getKeySlot 为 undefined', () => {
    const slots = createSlots({ roles: ['a'], humanCount: 0, aiPersonas: ['p1'] });
    expect(getKeySlot(slots)).toBeUndefined();
  });
});
