// ============================================================================
// 趣味法庭引擎 CourtOrchestrator（玩法深化专项）
// 继承共享编排基类 BaseOrchestrator：阶段状态机 / 回合 / 计时器兜底 /
// 玩家槽位（真人恒占 slot-0）/ 事件总线 / 段位 / 新手引导 / 快照。
//
// 结算全部走 court-state.ts 的纯函数（applyBalance / resolveCard /
// decideWinnerFromBalance），保证「确定性输入 → 可复算结算」。
// LLM（法官口播 / 对手反驳文案）只作为可选副作用注入，失败不影响天平。
// ============================================================================
import {
  BaseOrchestrator,
  computeTier,
  computeRankPoints,
  clampScore,
  getDailyChallenge,
  detectHighlight,
  detectComeback,
  computeAffinityDelta,
  type GameResult,
  type TierLevel,
  type TutorialStep,
  type Highlight,
} from "@balabala/shared";
import type { CourtCardType, CourtPlayerMove } from "@balabala/shared";
import {
  applyBalance,
  decideWinnerFromBalance,
  resolveCard,
  MAX_ROUNDS,
  PLAYER_AMMO_PER_ROUND,
  HAND_CARDS,
  CARD_AMMO_COST,
  type BalanceState,
  type CourtSide,
} from "./court-state.js";

// ===== 类型 =====

export type CourtStage =
  | "judge_open"
  | "player_turn"
  | "opponent_rebuttal"
  | "round_recap"
  | "verdict";

export interface CourtEvidence {
  id: string;
  name: string;
  content: string;
}

/** 引擎运行时状态（可 JSON 序列化，用于断线重连快照）。 */
export interface CourtEngineState {
  stage: CourtStage;
  /** 当前轮次 1..MAX_ROUNDS。 */
  round: number;
  /** 天平 0-100 互补。 */
  balance: BalanceState;
  /** 每方每轮弹药。 */
  ammo: Record<CourtSide, number>;
  /** 未决争议点。 */
  unresolved: string[];
  /** 已查明争议点。 */
  resolved: string[];
  /** 已确认事实。 */
  facts: string[];
  /** 己方证据池。 */
  evidencePool: CourtEvidence[];
  /** 真人扮演的一方。 */
  playerSide: CourtSide;
  opponentSide: CourtSide;
  /** 玩家全程打出的牌（高光回放）。 */
  playerMoves: CourtPlayerMove[];
  /** 最近一次天平增量（飘字用）。 */
  lastDelta: number;
  /** 对手本轮反驳后是否已结算（防止重复扣天平）。 */
  rebuttalAppliedThisRound: boolean;
  /** 上一轮 attack 命中 → 下一轮对手反驳 -2。 */
  rebuttalDebt: number;
  /** 本局是否使用过 mock 牌（每日挑战「正人君子」判定）。 */
  usedMock: boolean;
  /** R5：每轮结束后玩家天平分（翻盘检测用，含起点）。 */
  scoreHistory: number[];
}

/** 本局结算附带的 R5 钩子数据（关系 / 高光 / 翻盘）。 */
export interface CourtResultMetadata {
  outcome: "win" | "draw" | "loss";
  comeback: boolean;
  /** 对手名人（关系系统用）。 */
  opponentCelebrity: { id: string; name: string };
  /** 本局好感度变化（已算好，路由层落盘）。 */
  relationshipDelta: number;
  relationshipReason: string;
  /** 结构化高光（已 captureHighlight）。 */
  highlights: Highlight[];
}

/** 带 R5 钩子元数据的法庭结算结果。 */
export interface CourtGameResult extends GameResult {
  metadata: CourtResultMetadata;
}

export interface CourtConfig {
  playerSide: CourtSide;
  disputePoints: string[];
  evidencePool: CourtEvidence[];
  facts?: string[];
  /** 玩家回合限时（默认 15s，超时自动 pass）。 */
  playerTurnTimeoutMs?: number;
  /** 对手每轮反驳天平增量（默认 4）。 */
  opponentRebuttalDelta?: number;
  /** 初始天平（每日挑战「绝地反击」可传 40:60）。 */
  initialBalance?: BalanceState;
  /** 当日挑战（由 getDailyChallenge('court', date) 注入）。 */
  dailyChallengeId?: string;
  /** R5：对手名人（关系/战果卡用）。 */
  opponentCelebrity?: { id: string; name: string };
}

export type CourtAction =
  | {
      kind: "play_card";
      card: CourtCardType;
      targetEvidenceId?: string;
      freeText?: string;
    }
  | { kind: "pass" };

// mock 越界启发式词表（与 court-orchestrator 保持一致，确定性）。
const MOCK_OUTRAGEOUS_WORDS = ["笨蛋", "蠢货", "白痴", "滚", "垃圾", "不要脸", "废物", "神经病"];

const COURT_TIER_LABELS: Record<TierLevel, string> = {
  novice: "菜鸟律师",
  adept: "出庭律师",
  expert: "王牌律师",
  master: "金牌大状",
};

const TUTORIAL_STEPS: TutorialStep[] = [
  { id: "court-side", title: "选边", description: "你是决定胜负的律师，真人永远坐在关键席位 slot-0。", target: "court-side-banner" },
  { id: "court-balance", title: "看懂天平", description: "顶部天平 0-100 互补，3 轮结束时你方 ≥55 即胜诉。", target: "balance-scale" },
  { id: "court-hand", title: "出第一张牌", description: "每回合 2 点弹药。攻击/证据/嘲讽各花 1 点，要求记录不花弹药。", target: "player-hand-cards" },
  { id: "court-hit", title: "命中与未命中", description: "牌面内容命中未决争议点 → 天平大涨；没命中 → 小涨甚至反向（嘲讽越界）。", target: "court-card-resolved" },
];

export interface CourtEngineEvents {
  // 透传给前端的事件名与 shared CourtTrialEvent 对齐
}

/**
 * 法庭编排器。一局 = 3 轮，每轮：玩家回合（出牌，限时兜底）→ 对手反驳 → 小结。
 * 胜方由终局天平决定；LLM 只负责文案。
 */
export class CourtOrchestrator extends BaseOrchestrator<
  CourtEngineState,
  CourtAction,
  CourtConfig
> {
  private dailyChallengeId?: string;

  constructor() {
    super({ maxRounds: MAX_ROUNDS, initialState: CourtOrchestrator.initialState("plaintiff", [], []), tutorialSteps: TUTORIAL_STEPS });
  }

  private static initialState(
    playerSide: CourtSide,
    disputePoints: string[],
    evidencePool: CourtEvidence[],
  ): CourtEngineState {
    const opponentSide: CourtSide = playerSide === "plaintiff" ? "defendant" : "plaintiff";
    return {
      stage: "judge_open",
      round: 0,
      balance: { plaintiff: 50, defendant: 50 },
      ammo: { plaintiff: PLAYER_AMMO_PER_ROUND, defendant: PLAYER_AMMO_PER_ROUND },
      unresolved: [...disputePoints],
      resolved: [],
      facts: [],
      evidencePool,
      playerSide,
      opponentSide,
      playerMoves: [],
      lastDelta: 0,
      rebuttalAppliedThisRound: false,
      rebuttalDebt: 0,
      usedMock: false,
      scoreHistory: [50],
    };
  }

  /** 开局：装槽位（真人=律师 slot-0，AI=对方律师/法官/被告），第 1 轮开始。 */
  override start(config: CourtConfig): void {
    this.dailyChallengeId = config.dailyChallengeId;
    const opponentSide: CourtSide = config.playerSide === "plaintiff" ? "defendant" : "plaintiff";
    this.state = {
      ...CourtOrchestrator.initialState(config.playerSide, config.disputePoints, config.evidencePool),
      facts: config.facts ?? [],
      balance: config.initialBalance ?? { plaintiff: 50, defendant: 50 },
    };
    super.start(config);
    // 槽位：slot-0 真人律师；slot-1 对方律师（AI）；slot-2 法官（AI）；slot-3 被告/原告当事人（AI）。
    this.setupSlots(
      ["player_lawyer", "opponent_lawyer", "judge", "client"],
      1,
      ["opponent-lawyer-ai", "judge-ai", "client-ai"],
    );
    this.assignHuman("human-player", "你", "slot-0");
    this.slots[0].nickname = "你（律师）";
    this.slots[1].nickname = opponentSide === "defendant" ? "对方辩护律师（AI）" : "对方代理律师（AI）";
    this.slots[2].nickname = "法官（AI）";
    // 广播初始天平
    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: 0, reason: "开庭，天平居中。" },
    });
    this.beginRound();
  }

  /** 进入新一轮：补弹药、广播 player_turn、启动限时兜底。 */
  private beginRound(): void {
    this.currentRound = this.nextRound();
    this.state.round = this.currentRound;
    this.state.stage = "player_turn";
    this.state.ammo[this.state.playerSide] = PLAYER_AMMO_PER_ROUND;
    this.state.ammo[this.state.opponentSide] = PLAYER_AMMO_PER_ROUND;
    this.state.rebuttalAppliedThisRound = false;
    this.emit({
      type: "round_started",
      timestamp: Date.now(),
      payload: { round: this.currentRound, maxRounds: this.maxRounds },
    });
    this.emit({
      type: "court_player_turn",
      timestamp: Date.now(),
      payload: {
        round: this.currentRound,
        ammo: this.state.ammo[this.state.playerSide],
        handCards: [...HAND_CARDS],
        unresolved: [...this.state.unresolved],
      },
    });
    const timeoutMs = this.config?.playerTurnTimeoutMs ?? 15_000;
    this.startTimer(timeoutMs, () => {
      // 超时兜底：自动 pass，不卡死局面。
      this.act({ kind: "pass" });
    });
  }

  protected applyAction(action: CourtAction): void {
    if (this.state.stage !== "player_turn") return;

    if (action.kind === "pass") {
      this.closeRound();
      return;
    }

    const { card, targetEvidenceId, freeText } = action;
    const cost = CARD_AMMO_COST[card];
    if (this.state.ammo[this.state.playerSide] < cost) {
      this.emit({
        type: "error",
        timestamp: Date.now(),
        payload: { message: "弹药不足，无法出这张牌。" },
      });
      return;
    }

    const isMockOutrageous =
      card === "mock" &&
      MOCK_OUTRAGEOUS_WORDS.some((w) => (freeText ?? "").includes(w));

    const resolution = resolveCard(card, {
      unresolved: this.state.unresolved,
      evidencePool: this.state.evidencePool,
      targetEvidenceId,
      freeText: (freeText ?? "").trim(),
      mockOutrageous: isMockOutrageous,
    });

    // 扣弹药
    this.state.ammo[this.state.playerSide] -= cost;
    if (card === "mock") this.state.usedMock = true;

    // 结算天平（delta 以「玩家方」为正方向）
    this.state.balance = applyBalance(this.state.balance, this.state.playerSide, resolution.delta);
    this.state.lastDelta = resolution.delta;

    // resolved point / added fact
    if (resolution.resolvedPoint) {
      this.state.unresolved = this.state.unresolved.filter((p) => p !== resolution.resolvedPoint);
      this.state.resolved.push(resolution.resolvedPoint);
    }
    if (resolution.addedFact) {
      this.state.facts.push(resolution.addedFact);
    }
    // attack 命中 → 下轮对手反驳 -2
    if (card === "attack" && resolution.hit) {
      this.state.rebuttalDebt = 2;
    }

    const move: CourtPlayerMove = {
      round: this.state.round,
      card,
      targetEvidenceId,
      freeText: (freeText ?? "").slice(0, 200) || undefined,
      delta: resolution.delta,
      hit: resolution.hit,
      judgeComment: resolution.judgeComment,
    };
    this.state.playerMoves.push(move);

    // R5：喂高光检测器，命中关键证据就 captureHighlight。
    const hl = detectHighlight("court", {
      type: "court_card_resolved",
      payload: { hit: resolution.hit, delta: resolution.delta, round: this.state.round, timestamp: Date.now() },
    });
    if (hl) this.captureHighlight({ ...hl, id: this.nextHighlightId() });

    this.emit({
      type: "court_card_resolved",
      timestamp: Date.now(),
      payload: { card, hit: resolution.hit, delta: resolution.delta, judgeComment: resolution.judgeComment },
    });
    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: resolution.delta, reason: resolution.judgeComment },
    });
    if (resolution.hit) {
      this.emitFeedback("court_hit", { round: this.state.round, card, delta: resolution.delta });
    }

    // 弹药耗尽 → 关闭本轮；否则继续玩家回合（剩弹药）。
    if (this.state.ammo[this.state.playerSide] <= 0) {
      this.closeRound();
    } else {
      // 仍有弹药，继续玩家回合（重启计时）
      this.emit({
        type: "court_player_turn",
        timestamp: Date.now(),
        payload: {
          round: this.state.round,
          ammo: this.state.ammo[this.state.playerSide],
          handCards: [...HAND_CARDS],
          unresolved: [...this.state.unresolved],
        },
      });
      const timeoutMs = this.config?.playerTurnTimeoutMs ?? 15_000;
      this.startTimer(timeoutMs, () => this.act({ kind: "pass" }));
    }
  }

  /** 一轮结束：对手反驳（确定性 -4，attack 命中减免）→ 小结 → 下一轮/结算。 */
  private closeRound(): void {
    if (this.state.rebuttalAppliedThisRound) return;
    this.state.rebuttalAppliedThisRound = true;
    this.cancelTimer();
    this.state.stage = "opponent_rebuttal";

    const baseDelta = this.config?.opponentRebuttalDelta ?? 4;
    const delta = Math.max(0, baseDelta - this.state.rebuttalDebt);
    this.state.rebuttalDebt = 0;
    // 对手反驳 = 玩家方天平下降
    this.state.balance = applyBalance(this.state.balance, this.state.playerSide, -delta);
    this.state.lastDelta = -delta;
    // R5：记录本论结束后玩家天平分（翻盘检测）。
    this.state.scoreHistory.push(this.state.balance[this.state.playerSide]);

    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: {
        balance: { ...this.state.balance },
        lastDelta: -delta,
        reason: `对方律师针对性反驳，天平向对方倾斜 ${delta} 点。`,
      },
    });
    this.emit({
      type: "court_round_recap",
      timestamp: Date.now(),
      payload: { round: this.state.round, unresolved: [...this.state.unresolved], balance: { ...this.state.balance } },
    });

    if (this.state.round >= this.maxRounds) {
      this.state.stage = "verdict";
      this.finish();
    } else {
      this.beginRound();
    }
  }

  /** 终局结算：胜方由天平决定。附带 R5 钩子元数据。 */
  override settle(): CourtGameResult {
    const playerBalance = this.state.balance[this.state.playerSide];
    const rawWinner = decideWinnerFromBalance(this.state.balance);
    // 真人方胜 / 对方胜 / 平局
    let result: "win" | "draw" | "loss";
    let winner: string | null;
    if (rawWinner === this.state.playerSide) {
      result = "win";
      winner = "slot-0";
    } else if (rawWinner === "mixed") {
      result = "draw";
      winner = null;
    } else {
      result = "loss";
      winner = "slot-1";
    }

    const percentileScore = clampScore(playerBalance, 0, 100);
    const tier = computeTier(percentileScore, 100, COURT_TIER_LABELS);
    const rankPoints = computeRankPoints(result, 100, 100);

    const highlights: string[] = this.state.playerMoves
      .filter((m) => m.hit)
      .map((m) => `第${m.round}轮【${cardLabel(m.card)}】${m.judgeComment ?? ""}`);
    if (highlights.length === 0) {
      highlights.push("本局没有命中争议点——下次出牌前先读一眼上方未决焦点。");
    }

    // R5：翻盘检测 + 好感度变化（路由层落盘）。
    const comeback = detectComeback(this.state.scoreHistory, playerBalance, 100);
    const captured = this.getHighlights();
    const opponentCelebrity = this.config?.opponentCelebrity ?? { id: "court-opponent", name: "对方律师" };
    const relationshipDelta = computeAffinityDelta({
      scene: "court",
      result,
      score: playerBalance,
      maxScore: 100,
      highlights: captured,
      comeback,
      opponentAffinity: 0,
    });
    const relationshipReason =
      result === "win" ? (comeback ? "翻盘胜诉" : "庭审胜诉")
      : result === "draw" ? "势均力敌"
      : "庭审惜败";

    return {
      winner,
      scores: {
        "slot-0": playerBalance,
        "slot-1": this.state.balance[this.state.opponentSide],
      },
      tier,
      rankPoints,
      highlights,
      durationMs: this.elapsedMs,
      metadata: {
        outcome: result,
        comeback,
        opponentCelebrity,
        relationshipDelta,
        relationshipReason,
        highlights: captured,
      },
    };
  }

  /** 本局是否达成「正人君子」挑战（全程未用 mock 牌且获胜）。 */
  isHonestLawyer(): boolean {
    return !this.state.usedMock;
  }

  /** 当日挑战（供路由 / 前端展示）。 */
  static dailyChallenge(date: Date) {
    return getDailyChallenge("court", date);
  }
}

function cardLabel(card: CourtCardType): string {
  switch (card) {
    case "attack": return "攻击论点";
    case "evidence": return "出示证据";
    case "mock": return "嘲讽";
    case "request_record": return "要求记录";
  }
}

export { HAND_CARDS, CARD_AMMO_COST, MAX_ROUNDS, PLAYER_AMMO_PER_ROUND };
