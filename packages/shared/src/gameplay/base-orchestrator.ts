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
import type { RelationshipChange } from './relationship.js';
import { TutorialEngine } from './tutorial.js';
import {
  assignHumanToSlot,
  createSlots,
  fillWithAI,
  getAISlots,
  getHumanSlots,
} from './player-slots.js';

type EventHandler = (event: GameEvent) => void;

// ============================================================================
// R5 · 钩子 / 高光 / 结算演出 / 反馈事件类型
// ============================================================================

/** 高光类型（六场景 + 通用）。 */
export type HighlightType =
  | 'key_evidence'
  | 'golden_quote'
  | 'epic_rebuttal'
  | 'prophet_vote'
  | 'extreme_performance'
  | 'high_combo'
  | 'comeback'
  | 'perfect_round';

/** 一条高光时刻（结构与 payload 分离，便于前端回放）。 */
export interface Highlight {
  id: string;
  scene: string;
  type: HighlightType;
  timestamp: number;
  round?: number;
  description: string;
  data: Record<string, unknown>;
}

/** 结算演出三态（胜/负各细分 + 平局 + 翻盘）。 */
export type SettlementType =
  | 'big_win'
  | 'narrow_win'
  | 'comeback_win'
  | 'draw'
  | 'narrow_loss'
  | 'big_loss';

/** 一局结算后的演出数据（战果卡 / 飘字 / 音效共用）。 */
export interface SettlementResult {
  type: SettlementType;
  score: number;
  maxScore: number;
  /** 对局中玩家最低分（用于翻盘检测与「最黑暗时刻」文案）。 */
  minBalance: number;
  highlights: Highlight[];
  durationMs: number;
}

/** 前端反馈事件：飘字 / 音效 / 震屏 / 礼花。 */
export interface FeedbackEvent {
  kind: 'float_text' | 'sound' | 'screen_shake' | 'confetti';
  text?: string;
  soundId?: string;
  /** 0~1，震屏/礼花强度。 */
  intensity?: number;
}

/** start() 时传入的钩子配置（全可选，不传不影响现有行为）。 */
export interface OrchestratorHooks {
  onHighlight?: (highlight: Highlight) => void;
  onSettlement?: (settlement: SettlementResult) => void;
  onStreakChange?: (streak: number, scene: string) => void;
  onRelationshipChange?: (change: RelationshipChange) => void;
  onFeedback?: (feedback: FeedbackEvent) => void;
}

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

  // ---- R5: 钩子 / 高光 / 结算演出 ----
  private hooks: OrchestratorHooks | null = null;
  private capturedHighlights: Highlight[] = [];
  /** 玩家在对局中达到的最低绝对分（翻盘检测用）。 */
  private minBalance = Number.POSITIVE_INFINITY;
  private highlightSeq = 0;
  /** 子类可覆写：玩家所在槽位（结算演出判定用）。 */
  protected humanSlotId = 'slot-0';
  /** 子类可覆写：本局满分（用于百分比判定）。 */
  protected settlementMaxScore = 100;

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
    // R5: 追踪玩家最低分（翻盘检测）。
    if (slotId === this.humanSlotId) {
      this.minBalance = Math.min(this.minBalance, slot.score);
    }
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

  // ---- R5: 高光捕捉 ----

  /** 记录一条高光：内部收集 + 同步调 onHighlight 钩子。 */
  captureHighlight(highlight: Highlight): void {
    this.capturedHighlights.push(highlight);
    this.hooks?.onHighlight?.(highlight);
    this.emit({
      type: 'highlight_captured',
      timestamp: highlight.timestamp,
      payload: { highlight },
    });
  }

  /** 本局已捕获的全部高光。 */
  getHighlights(): Highlight[] {
    return [...this.capturedHighlights];
  }

  /** 子类生成高光 id 用的自增计数器。 */
  nextHighlightId(): string {
    this.highlightSeq += 1;
    return `hl-${this.startedAt || Date.now()}-${this.highlightSeq}`;
  }

  // ---- R5: 反馈事件（飘字/音效/震屏/礼花） ----

  /** R5: 触发一条结构化反馈事件（前端飘字 / 音效）。 */
  emitFeedback(feedback: FeedbackEvent): void;
  /** Legacy: 子类在出现值得夸的时刻调用，向前端推正反馈节奏事件。 */
  emitFeedback(kind: string, payload: Record<string, unknown>): void;
  emitFeedback(kindOrFeedback: string | FeedbackEvent, payload?: Record<string, unknown>): void {
    if (typeof kindOrFeedback === 'object') {
      const feedback = kindOrFeedback;
      this.hooks?.onFeedback?.(feedback);
      this.emit({
        type: 'feedback_event',
        timestamp: Date.now(),
        payload: { ...feedback },
      });
      return;
    }
    const kind = kindOrFeedback;
    const event: GameEvent = {
      type: `feedback:${kind}`,
      timestamp: Date.now(),
      payload: payload ?? {},
    };
    for (const cb of this.feedbackCbs) cb(event);
    this.emit(event);
  }

  // ---- R5: 关系 / 连胜钩子转发（子类在结算后调用） ----

  /** 子类结算后调用，把关系变化推给 onRelationshipChange 钩子。 */
  protected notifyRelationshipChange(change: RelationshipChange): void {
    this.hooks?.onRelationshipChange?.(change);
  }

  /** 子类在连胜变化时调用。 */
  protected notifyStreakChange(streak: number, scene: string): void {
    this.hooks?.onStreakChange?.(streak, scene);
  }

  // ---- 新手引导 -----------------------------------------------------------

  startTutorial(): void {
    this.tutorial.start();
  }

  skipTutorial(): void {
    this.tutorial.skip();
  }

  // ---- 三个主方法 ---------------------------------------------------------

  /** 开局：进入 setup→playing，打时间戳，发开始事件。可传入 R5 钩子。 */
  start(config: TConfig, hooks?: OrchestratorHooks): void {
    this.config = config;
    this.hooks = hooks ?? null;
    this.startedAt = Date.now();
    this.minBalance = Number.POSITIVE_INFINITY;
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

  /** 收尾：停表、进 results、结算并发结果事件。R5：自动产出 SettlementResult 并触发钩子。 */
  finish(): GameResult {
    this.cancelTimer();
    this.finishedAt = Date.now();
    this.transitionTo('results');
    const result = this.settle();

    // R5: 检测结算演出三态并回调 onSettlement。
    const settlement = this.buildSettlement(result);
    this.hooks?.onSettlement?.(settlement);
    this.emit({
      type: 'settlement',
      timestamp: Date.now(),
      payload: { settlement },
    });

    this.emit({
      type: 'game_result',
      timestamp: Date.now(),
      payload: { result },
    });
    return result;
  }

  /**
   * 由 GameResult 与运行轨迹推出结算演出类型。子类可覆写 resolveResult /
   * humanSlotId / settlementMaxScore 来适配阵营制（狼人杀）等场景。
   *
   * 规则：
   *  - 胜：过程中最低分率 < 30% 且终局 > 50% → comeback_win；终局 > 85% → big_win；其余 narrow_win。
   *  - 平：draw。
   *  - 负：终局分率 45%~50% → narrow_loss（惜败）；其余 big_loss。
   */
  protected buildSettlement(result: GameResult): SettlementResult {
    const maxScore = this.settlementMaxScore;
    const score = this.getScore(this.humanSlotId);
    const minBalance = Number.isFinite(this.minBalance) ? this.minBalance : score;
    const ratio = maxScore > 0 ? score / maxScore : 0;
    const minRatio = maxScore > 0 ? minBalance / maxScore : 0;
    const outcome = this.resolveResult(result);

    let type: SettlementType;
    if (outcome === 'draw') {
      type = 'draw';
    } else if (outcome === 'win') {
      if (minRatio < 0.3 && ratio > 0.5) type = 'comeback_win';
      else if (ratio > 0.85) type = 'big_win';
      else type = 'narrow_win';
    } else {
      type = ratio >= 0.45 && ratio < 0.5 ? 'narrow_loss' : 'big_loss';
    }

    return {
      type,
      score,
      maxScore,
      minBalance,
      highlights: this.getHighlights(),
      durationMs: this.elapsedMs,
    };
  }

  /** 子类可覆写：把 GameResult 翻译成玩家视角胜/平/负。默认按 winner===humanSlotId。 */
  protected resolveResult(result: GameResult): 'win' | 'draw' | 'loss' {
    if (result.winner === null || result.winner === undefined) return 'draw';
    return result.winner === this.humanSlotId ? 'win' : 'loss';
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
