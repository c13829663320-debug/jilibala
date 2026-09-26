// ============================================================================
// 抽象编排基类 —— 六场景共用的玩法编排框架。
// 纯 TS，不依赖 React / Fastify；计时器用 globalThis.setTimeout 封装，
// 浏览器与 Node 均可运行。
//
// 子类必须：
//   - 实现 abstract settle(): GameResult
//   - 实现 abstract applyAction(action: TAction): void
//   - 按需覆写 phaseGuard() 收紧阶段流转
// ============================================================================

import type {
  GameEvent,
  GamePhase,
  GameResult,
  PlayerSlot,
  TimerState,
  TutorialStep,
} from './types.js';
import { TutorialEngine } from './tutorial.js';
import {
  assignHumanToSlot,
  createSlots,
  fillWithAI,
  getAISlots,
  getHumanSlots,
} from './player-slots.js';

type EventHandler = (event: GameEvent) => void;

export interface OrchestratorOptions<TState> {
  maxRounds: number;
  initialState: TState;
  tutorialSteps?: TutorialStep[];
}

interface TimerHandle {
  id: ReturnType<typeof setTimeout>;
  durationMs: number;
  endsAt: number;
}

export abstract class BaseOrchestrator<TState, TAction, TConfig> {
  phase: GamePhase = 'lobby';
  currentRound = 0;
  readonly maxRounds: number;
  slots: PlayerSlot[] = [];
  state: TState;
  config: TConfig | null = null;
  readonly tutorial: TutorialEngine;

  private listeners = new Map<string, Set<EventHandler>>();
  private feedbackCbs = new Set<EventHandler>();
  private timer: TimerHandle | null = null;
  private startedAt = 0;
  private finishedAt = 0;

  constructor(options: OrchestratorOptions<TState>) {
    this.maxRounds = options.maxRounds;
    this.state = options.initialState;
    this.tutorial = new TutorialEngine(options.tutorialSteps ?? []);
  }

  // ---- 子类必须实现 -------------------------------------------------------

  /** 子类结算本局。 */
  abstract settle(): GameResult;

  /** 子类把一个玩家动作落到 state 上。 */
  protected abstract applyAction(action: TAction): void;

  // ---- 阶段状态机 ---------------------------------------------------------

  /** 阶段流转守卫，子类可覆写以收紧（如只允许 lobby→setup→playing）。 */
  protected phaseGuard(_from: GamePhase, _to: GamePhase): boolean {
    return true;
  }

  transitionTo(phase: GamePhase): boolean {
    if (phase === this.phase) return true;
    if (!this.phaseGuard(this.phase, phase)) return false;
    const from = this.phase;
    this.phase = phase;
    this.emit({
      type: 'phase_changed',
      timestamp: Date.now(),
      payload: { from, to: phase },
    });
    return true;
  }

  // ---- 回合 ---------------------------------------------------------------

  nextRound(): number {
    if (this.currentRound < this.maxRounds) {
      this.currentRound += 1;
      this.emit({
        type: 'round_started',
        timestamp: Date.now(),
        payload: { round: this.currentRound, maxRounds: this.maxRounds },
      });
    }
    return this.currentRound;
  }

  // ---- 计时器（每回合 / 每行动）------------------------------------------

  /**
   * 开始倒计时。超时后调用 onTimeout —— 子类通常在这里放 AI 自动决策 / pass 兜底，
   * 保证真人不操作也不会卡死局面。
   */
  startTimer(durationMs: number, onTimeout: () => void): void {
    this.cancelTimer();
    const id = setTimeout(() => {
      this.timer = null;
      onTimeout();
    }, durationMs);
    this.timer = { id, durationMs, endsAt: Date.now() + durationMs };
  }

  cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer.id);
      this.timer = null;
    }
  }

  getTimer(): TimerState | null {
    if (!this.timer) return null;
    const remainingMs = Math.max(0, this.timer.endsAt - Date.now());
    return {
      durationMs: this.timer.durationMs,
      endsAt: this.timer.endsAt,
      remainingMs,
    };
  }

  // ---- 玩家槽位 -----------------------------------------------------------

  setupSlots(roles: string[], humanCount: number, aiPersonas: string[]): void {
    this.slots = createSlots({ roles, humanCount, aiPersonas });
  }

  assignHuman(userId: string, nickname: string, slotId = 'slot-0'): void {
    this.slots = assignHumanToSlot(this.slots, slotId, userId, nickname);
  }

  /** 把所有空槽位填成 AI（超时 / 缺人时调用）。 */
  fillEmptySlotsWithAI(aiPersonas: string[]): void {
    this.slots = fillWithAI(this.slots, aiPersonas);
  }

  getHumanSlots(): PlayerSlot[] {
    return getHumanSlots(this.slots);
  }

  getAISlots(): PlayerSlot[] {
    return getAISlots(this.slots);
  }

  // ---- 事件系统（发布订阅，浏览器 / Node 通用）----------------------------

  emit(event: GameEvent): void {
    const set = this.listeners.get(event.type);
    if (set) for (const handler of set) handler(event);
    // 通配事件：'*'
    const wildcard = this.listeners.get('*');
    if (wildcard) for (const handler of wildcard) handler(event);
  }

  /** 订阅某类事件，返回取消订阅函数。 */
  on(eventType: string, handler: EventHandler): () => void {
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(handler);
    return () => this.off(handler);
  }

  /** 从所有事件类型中移除该 handler。 */
  off(handler: EventHandler): void {
    for (const set of this.listeners.values()) set.delete(handler);
  }

  // ---- 计分 ---------------------------------------------------------------

  addScore(slotId: string, points: number, reason: string): void {
    const slot = this.slots.find((s) => s.slotId === slotId);
    if (!slot) return;
    slot.score += points;
    this.emit({
      type: 'score_added',
      timestamp: Date.now(),
      payload: { slotId, points, reason, total: slot.score },
    });
  }

  getScore(slotId: string): number {
    return this.slots.find((s) => s.slotId === slotId)?.score ?? 0;
  }

  // ---- 正反馈节奏保障 -----------------------------------------------------

  /** 订阅正反馈事件（用于"每 3 分钟至少一次"的节奏保障）。 */
  onFeedback(callback: EventHandler): () => void {
    this.feedbackCbs.add(callback);
    return () => this.feedbackCbs.delete(callback);
  }

  /** 子类在出现值得夸的时刻调用，向前端推正反馈。 */
  protected emitFeedback(kind: string, payload: Record<string, unknown>): void {
    const event: GameEvent = {
      type: `feedback:${kind}`,
      timestamp: Date.now(),
      payload,
    };
    for (const cb of this.feedbackCbs) cb(event);
    this.emit(event);
  }

  // ---- 新手引导 -----------------------------------------------------------

  startTutorial(): void {
    this.tutorial.start();
  }

  skipTutorial(): void {
    this.tutorial.skip();
  }

  // ---- 三个主方法 ---------------------------------------------------------

  /** 开局：进入 setup→playing，打时间戳，发开始事件。 */
  start(config: TConfig): void {
    this.config = config;
    this.startedAt = Date.now();
    this.transitionTo('setup');
    this.transitionTo('playing');
    this.emit({
      type: 'game_started',
      timestamp: this.startedAt,
      payload: {},
    });
  }

  /** 玩家行动：仅在 playing / round 阶段接受。 */
  act(action: TAction): void {
    if (this.phase !== 'playing' && this.phase !== 'round') return;
    this.cancelTimer();
    this.applyAction(action);
  }

  /** 收尾：停表、进 results、结算并发结果事件。 */
  finish(): GameResult {
    this.cancelTimer();
    this.finishedAt = Date.now();
    this.transitionTo('results');
    const result = this.settle();
    this.emit({
      type: 'game_result',
      timestamp: Date.now(),
      payload: { result },
    });
    return result;
  }

  // ---- 序列化（断线重连）--------------------------------------------------

  getSnapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      currentRound: this.currentRound,
      maxRounds: this.maxRounds,
      slots: this.slots.map((s) => ({ ...s })),
      state: JSON.parse(JSON.stringify(this.state)) as TState,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      timer: this.getTimer(),
      tutorialCompleted: this.tutorial.isCompleted,
      tutorialSkipped: this.tutorial.isSkipped,
    };
  }

  loadSnapshot(snapshot: Record<string, unknown>): void {
    const s = snapshot as Partial<{
      phase: GamePhase;
      currentRound: number;
      slots: PlayerSlot[];
      state: TState;
      startedAt: number;
      finishedAt: number;
      tutorialCompleted: boolean;
      tutorialSkipped: boolean;
    }>;
    if (s.phase) this.phase = s.phase;
    if (typeof s.currentRound === 'number') this.currentRound = s.currentRound;
    if (Array.isArray(s.slots)) this.slots = s.slots.map((x) => ({ ...x }));
    if (s.state !== undefined) this.state = JSON.parse(JSON.stringify(s.state)) as TState;
    if (typeof s.startedAt === 'number') this.startedAt = s.startedAt;
    if (typeof s.finishedAt === 'number') this.finishedAt = s.finishedAt;
    if (s.tutorialCompleted || s.tutorialSkipped) {
      this.tutorial.skip();
    }
    this.cancelTimer();
  }

  protected get elapsedMs(): number {
    const end = this.finishedAt || Date.now();
    return Math.max(0, end - this.startedAt);
  }
}
