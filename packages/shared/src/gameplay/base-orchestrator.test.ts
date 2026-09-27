import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseOrchestrator } from './base-orchestrator.js';
import type { GameEvent, GamePhase, GameResult, Tier } from './types.js';

interface TestState {
  count: number;
  lastAction: string | null;
}
interface TestAction {
  type: string;
  targetSlot?: string;
  points?: number;
}
interface TestConfig {
  label: string;
}

const TIER: Tier = { level: 'expert', label: '出色', score: 0, percentile: 70 };

class TestOrchestrator extends BaseOrchestrator<TestState, TestAction, TestConfig> {
  protected applyAction(action: TestAction): void {
    this.state.lastAction = action.type;
    this.state.count += 1;
    if (action.targetSlot && action.points) {
      this.addScore(action.targetSlot, action.points, action.type);
    }
  }
  settle(): GameResult {
    return {
      winner: 'slot-0',
      scores: Object.fromEntries(this.slots.map((s) => [s.slotId, s.score])),
      tier: TIER,
      rankPoints: 25,
      highlights: [],
      durationMs: this.elapsedMs,
    };
  }
  /** 暴露给测试：强制触发一次正反馈 */
  pingFeedback(kind: string, payload: Record<string, unknown>) {
    this.emitFeedback(kind, payload);
  }
}

describe('BaseOrchestrator', () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = new TestOrchestrator({ maxRounds: 3, initialState: { count: 0, lastAction: null } });
    vi.useFakeTimers();
  });
  afterEach(() => {
    orch.cancelTimer();
    vi.useRealTimers();
  });

  it('start() 把阶段推到 playing', () => {
    orch.start({ label: 'x' });
    expect(orch.phase).toBe('playing');
  });

  it('transitionTo 带守卫：守卫拒绝时保持原阶段', () => {
    (orch as any).phaseGuard = (_f: GamePhase, to: GamePhase) => to !== 'round';
    orch.start({ label: 'x' });
    expect(orch.phase).toBe('playing');
    const ok = orch.transitionTo('round');
    expect(ok).toBe(false);
    expect(orch.phase).toBe('playing');
  });

  it('nextRound 递增且不超过 maxRounds', () => {
    expect(orch.nextRound()).toBe(1);
    expect(orch.nextRound()).toBe(2);
    expect(orch.nextRound()).toBe(3);
    expect(orch.nextRound()).toBe(3);
    expect(orch.currentRound).toBe(3);
  });

  it('计时：超时触发 onTimeout，cancelTimer 阻止', () => {
    const onTimeout = vi.fn();
    orch.startTimer(1000, onTimeout);
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancelTimer 后不再触发', () => {
    const onTimeout = vi.fn();
    orch.startTimer(1000, onTimeout);
    orch.cancelTimer();
    vi.advanceTimersByTime(2000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('getTimer 返回剩余时间', () => {
    orch.startTimer(5000, () => {});
    vi.advanceTimersByTime(2000);
    const t = orch.getTimer();
    expect(t?.durationMs).toBe(5000);
    expect(t?.remainingMs).toBe(3000);
  });

  it('addScore / getScore', () => {
    orch.setupSlots(['a', 'b'], 1, ['p1']);
    orch.assignHuman('u-1', '小明');
    orch.addScore('slot-0', 10, 'attack');
    orch.addScore('slot-0', 5, 'evidence');
    expect(orch.getScore('slot-0')).toBe(15);
  });

  it('事件系统 on/emit/off', () => {
    const handler = vi.fn();
    orch.on('score_added', handler);
    orch.setupSlots(['a'], 1, []);
    orch.addScore('slot-0', 3, 'x');
    expect(handler).toHaveBeenCalledTimes(1);
    orch.off(handler);
    orch.addScore('slot-0', 3, 'x');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('on 返回取消订阅函数', () => {
    const handler = vi.fn();
    orch.setupSlots(['a'], 1, []);
    const unsub = orch.on('score_added', handler);
    orch.addScore('slot-0', 1, 'x');
    unsub();
    orch.addScore('slot-0', 1, 'x');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('真人 / AI 槽位分配', () => {
    orch.setupSlots(['defendant', 'plaintiff', 'judge'], 1, ['luxun', 'xuesen']);
    orch.assignHuman('u-1', '小明');
    expect(orch.getHumanSlots()).toHaveLength(1);
    expect(orch.getAISlots()).toHaveLength(2);
    // 再来一个真人局：空占位自动填 AI
    orch.fillEmptySlotsWithAI(['backup']);
    expect(orch.slots.find((s) => s.slotId === 'slot-0')?.isHuman).toBe(true);
  });

  it('正反馈钩子 onFeedback', () => {
    const cb = vi.fn();
    orch.onFeedback(cb);
    orch.pingFeedback('combo', { n: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    const ev: GameEvent = cb.mock.calls[0][0];
    expect(ev.type).toBe('feedback:combo');
    expect(ev.payload.n).toBe(3);
  });

  it('新手引导 start/skip', () => {
    const o = new TestOrchestrator({
      maxRounds: 1,
      initialState: { count: 0, lastAction: null },
      tutorialSteps: [{ id: 't1', title: 't' }],
    });
    o.startTutorial();
    expect(o.tutorial.isActive).toBe(true);
    o.skipTutorial();
    expect(o.tutorial.isCompleted).toBe(true);
  });

  it('act 只在 playing/round 阶段接受', () => {
    orch.setupSlots(['a'], 1, []);
    orch.assignHuman('u', 'n');
    // lobby 阶段拒绝
    orch.act({ type: 'noop' });
    expect(orch.state.count).toBe(0);
    orch.start({ label: 'x' });
    orch.act({ type: 'play', targetSlot: 'slot-0', points: 7 });
    expect(orch.state.count).toBe(1);
    expect(orch.state.lastAction).toBe('play');
    expect(orch.getScore('slot-0')).toBe(7);
  });

  it('finish() 进入 results 并返回 GameResult', () => {
    orch.setupSlots(['a'], 1, []);
    orch.assignHuman('u', 'n');
    orch.start({ label: 'x' });
    orch.addScore('slot-0', 42, 'x');
    const result = orch.finish();
    expect(orch.phase).toBe('results');
    expect(result.winner).toBe('slot-0');
    expect(result.scores['slot-0']).toBe(42);
  });

  it('getSnapshot / loadSnapshot 往返', () => {
    orch.setupSlots(['a', 'b'], 1, ['p1']);
    orch.assignHuman('u-1', '小明');
    orch.start({ label: 'x' });
    orch.nextRound();
    orch.addScore('slot-0', 20, 'x');
    const snap = orch.getSnapshot();

    const fresh = new TestOrchestrator({ maxRounds: 3, initialState: { count: 0, lastAction: null } });
    fresh.setupSlots(['a', 'b'], 1, ['p1']);
    fresh.loadSnapshot(snap);
    expect(fresh.phase).toBe('playing');
    expect(fresh.currentRound).toBe(1);
    expect(fresh.getScore('slot-0')).toBe(20);
  });
});
