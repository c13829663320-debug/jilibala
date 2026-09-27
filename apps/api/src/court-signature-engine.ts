// ============================================================================
// R5 · 名人法庭招牌模式引擎 CourtSignatureEngine
//
// 继承 BaseOrchestrator（阶段机 / 槽位 / 事件总线 / 高光 / 反馈），
// 天平机制完全复用 court-state.ts 的纯函数（resolveCard / applyBalance /
// decideWinnerFromBalance）。在普通 3 轮出牌之上叠加：
//   - 陪审团情绪 juryMood 0-100（命中 + / 被反驳 -）
//   - 结案陈词阶段：玩家输入文本，纯函数 evaluateClosingStatement 算 0-15 加成
//   - 名场面自动捕捉：关键证据命中 / 陪审团倒戈 / 翻盘
//   - 最终裁决 = 天平 + 陪审团情绪 + 结案陈词 综合判定
// ============================================================================
import {
  BaseOrchestrator,
  computeTier,
  computeRankPoints,
  clampScore,
  detectHighlight,
  detectComeback,
  type GameResult,
  type TierLevel,
} from "@balabala/shared";
import type { CourtCardType } from "@balabala/shared";
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
import {
  getSignatureCase,
  type CelebrityCourtCase,
} from "./court-signature-cases.js";

// ===== 类型 =====

export type SignatureStage =
  | "opening"       // 开庭陈述（短暂，立即进入举证）
  | "player_turn"   // 玩家出牌
  | "opponent_rebuttal"
  | "closing"        // 结案陈词输入
  | "verdict";

export interface SignatureEngineState {
  stage: SignatureStage;
  caseId: string;
  round: number;
  balance: BalanceState;
  /** 陪审团情绪 0-100，50 中立（朝向玩家方）。 */
  juryMood: number;
  ammo: Record<CourtSide, number>;
  unresolved: string[];
  resolved: string[];
  facts: string[];
  /** 玩家方证据池（来自案件库中 side=玩家方 的证据）。 */
  evidencePool: Array<{ id: string; name: string; content: string }>;
  playerSide: CourtSide;
  opponentSide: CourtSide;
  playerMoves: Array<{
    round: number; card: CourtCardType; delta: number; hit: boolean; judgeComment: string;
  }>;
  /** 每轮结束后的玩家天平分（翻盘检测用，含起点）。 */
  scoreHistory: number[];
  lastDelta: number;
  rebuttalAppliedThisRound: boolean;
  /** attack 命中 → 下轮对手反驳减免。 */
  rebuttalDebt: number;
  closingText: string;
  closingScore: number;
  /** 已放送的名场面索引（按 case.dramaticMoments 顺序取）。 */
  shownMoments: string[];
  /** 陪审团是否已倒戈过（避免重复触发）。 */
  jurySwingFired: boolean;
}

export interface SignatureConfig {
  caseId: string;
  playerSide?: CourtSide;
  playerTurnTimeoutMs?: number;
  opponentRebuttalDelta?: number;
}

export type SignatureAction =
  | { kind: "play_card"; card: CourtCardType; targetEvidenceId?: string; freeText?: string }
  | { kind: "pass" }
  | { kind: "submit_closing"; text: string };

/** 招牌模式结算结果（在通用 GameResult 上追加戏剧化字段）。 */
export interface SignatureGameResult extends GameResult {
  juryMood: number;
  closingScore: number;
  /** 综合裁决分（玩家方，0-100，含陪审团情绪修正）。 */
  verdictScore: number;
  dramaticMoments: string[];
  /** 本案元信息。 */
  case: CelebrityCourtCase;
}

const SIGNATURE_TIER_LABELS: Record<TierLevel, string> = {
  novice: "初出茅庐律师",
  adept: "雄辩律师",
  expert: "王牌庭辩",
  master: "传奇大状",
};

const MOCK_OUTRAGEOUS_WORDS = ["笨蛋", "蠢货", "白痴", "滚", "垃圾", "不要脸", "废物", "神经病"];

/** 结案陈词里这些词会额外加分（激情 / 法律词汇）。 */
const CLOSING_KEYWORDS = [
  "请", "恳请", "相信", "正义", "法律", "历史", "真相", "证据",
  "不容", "诸位", "陪审团", "公理", "良知", "公正", "判决",
];

// ===== 纯函数：结案陈词评分 0-15 =====

export interface ClosingEvalInput {
  text: string;
  balance: BalanceState;
  /** 当前陪审团情绪 0-100。 */
  juryMood: number;
  disputePoints: string[];
}

/**
 * 结案陈词加成（0-15）：
 *  - 长度分：每 8 字 +1，封顶 8 分（太短显得敷衍）；
 *  - 关键词分：每命中一个激情/法律词 +1，封顶 5 分；
 *  - 争议点呼应分：陈词里出现争议焦点关键词 +2；
 *  - 陪审团情绪修正：mood>60 时若陈词慷慨（长）再 +0，mood<40 时陈词难挽狂澜（不奖励）。
 * 最终夹到 [0,15]。
 */
export function evaluateClosingStatement(
  input: ClosingEvalInput,
): number {
  const text = (input.text ?? "").trim();
  if (!text) return 0;

  // 长度分
  const lengthScore = Math.min(8, Math.floor(text.length / 8));

  // 关键词分
  let kwHits = 0;
  for (const w of CLOSING_KEYWORDS) {
    if (text.includes(w)) kwHits += 1;
  }
  const kwScore = Math.min(5, kwHits);

  // 争议点呼应：陈词 bigram 与任一争议点共享即 +2
  const grams = (s: string) => {
    const clean = s.replace(/[\s，。、；：？！「」『』"'（）()【】《》·,.!?;:]/g, "");
    const g = new Set<string>();
    for (let i = 0; i < clean.length - 1; i += 1) g.add(clean.slice(i, i + 2));
    return g;
  };
  const textGrams = grams(text);
  const echoes = input.disputePoints.some((p) => {
    for (const g of grams(p)) if (textGrams.has(g)) return true;
    return false;
  });
  const echoScore = echoes ? 2 : 0;

  const raw = lengthScore + kwScore + echoScore;
  return clampScore(raw, 0, 15);
}

// ===== 引擎 =====

export class CourtSignatureEngine extends BaseOrchestrator<
  SignatureEngineState,
  SignatureAction,
  SignatureConfig
> {
  private caseData!: CelebrityCourtCase;

  constructor() {
    super({
      maxRounds: MAX_ROUNDS,
      initialState: CourtSignatureEngine.blankState("__init__", "plaintiff", [], []),
    });
  }

  private static blankState(
    caseId: string,
    playerSide: CourtSide,
    disputePoints: string[],
    evidencePool: Array<{ id: string; name: string; content: string }>,
  ): SignatureEngineState {
    const opponentSide: CourtSide = playerSide === "plaintiff" ? "defendant" : "plaintiff";
    return {
      stage: "opening",
      caseId,
      round: 0,
      balance: { plaintiff: 50, defendant: 50 },
      juryMood: 50,
      ammo: { plaintiff: PLAYER_AMMO_PER_ROUND, defendant: PLAYER_AMMO_PER_ROUND },
      unresolved: [...disputePoints],
      resolved: [],
      facts: [],
      evidencePool,
      playerSide,
      opponentSide,
      playerMoves: [],
      scoreHistory: [50],
      lastDelta: 0,
      rebuttalAppliedThisRound: false,
      rebuttalDebt: 0,
      closingText: "",
      closingScore: 0,
      shownMoments: [],
      jurySwingFired: false,
    };
  }

  /** 开局：装槽位、按案件设定初始天平与陪审团情绪、开始第 1 轮举证。 */
  override start(config: SignatureConfig): void {
    const caze = getSignatureCase(config.caseId);
    if (!caze) throw new Error(`unknown signature case: ${config.caseId}`);
    this.caseData = caze;

    const playerSide: CourtSide = config.playerSide === "defendant" ? "defendant" : "plaintiff";
    const opponentSide: CourtSide = playerSide === "plaintiff" ? "defendant" : "plaintiff";

    // 玩家方证据池 = 案件库中 side===playerSide 的证据。
    const evidencePool = caze.evidence
      .filter((e) => e.side === playerSide)
      .map((e) => ({ id: e.id, name: e.text, content: e.text }));

    this.state = CourtSignatureEngine.blankState(config.caseId, playerSide, caze.disputePoints, evidencePool);
    this.state.facts = [...caze.facts];
    // 陪审团初始情绪：juryBias 正=偏原告。若玩家是被告，偏原告对玩家不利 → 取反。
    const biasTowardPlayer = playerSide === "plaintiff" ? caze.juryBias : -caze.juryBias;
    this.state.juryMood = clampScore(50 + biasTowardPlayer, 0, 100);

    super.start(config);
    this.setupSlots(["player_lawyer", "opponent_lawyer", "judge", "jury"], 1, ["celebrity-opponent", "judge-ai", "jury-ai"]);
    this.assignHuman("human-player", "你", "slot-0");
    this.slots[0].nickname = `你（${opponentSide === "defendant" ? "原告律师" : "被告律师"}）`;
    this.slots[1].nickname = opponentSide === "defendant" ? `${caze.celebrityDefendant.name}（对方）` : `${caze.celebrityPlaintiff.name}（对方）`;

    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: 0, reason: `${caze.title} —— 开庭陈述，天平居中，陪审团就位。` },
    });
    this.emit({
      type: "jury_mood_update",
      timestamp: Date.now(),
      payload: { juryMood: this.state.juryMood, reason: "陪审团入席，初步倾向已形成。" },
    });
    this.beginRound();
  }

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
    const timeoutMs = this.config?.playerTurnTimeoutMs ?? 120_000;
    this.startTimer(timeoutMs, () => this.act({ kind: "pass" }));
  }

  protected applyAction(action: SignatureAction): void {
    // 结案陈词：只在 closing 阶段接受。
    if (action.kind === "submit_closing") {
      if (this.state.stage !== "closing") {
        this.emit({ type: "error", timestamp: Date.now(), payload: { message: "当前不在结案陈词阶段。" } });
        return;
      }
      this.resolveClosing(action.text);
      return;
    }

    if (this.state.stage !== "player_turn") return;

    if (action.kind === "pass") {
      this.closeRound();
      return;
    }

    const { card, targetEvidenceId, freeText } = action;
    const cost = CARD_AMMO_COST[card];
    if (this.state.ammo[this.state.playerSide] < cost) {
      this.emit({ type: "error", timestamp: Date.now(), payload: { message: "弹药不足。" } });
      return;
    }

    const isMockOutrageous =
      card === "mock" && MOCK_OUTRAGEOUS_WORDS.some((w) => (freeText ?? "").includes(w));

    const resolution = resolveCard(card, {
      unresolved: this.state.unresolved,
      evidencePool: this.state.evidencePool,
      targetEvidenceId,
      freeText: (freeText ?? "").trim(),
      mockOutrageous: isMockOutrageous,
    });

    this.state.ammo[this.state.playerSide] -= cost;

    // mock 牌：气氛组。得体幽默 → 陪审团情绪 +3，但法律效果打折（额外 -2 天平）。
    let balanceDelta = resolution.delta;
    if (card === "mock") {
      if (!isMockOutrageous) {
        this.state.juryMood = clampScore(this.state.juryMood + 3, 0, 100);
        balanceDelta -= 2;
      } else {
        this.state.juryMood = clampScore(this.state.juryMood - 5, 0, 100);
      }
    }

    this.state.balance = applyBalance(this.state.balance, this.state.playerSide, balanceDelta);
    this.state.lastDelta = balanceDelta;

    // 陪审团情绪：命中大涨 +6，小命中 +2，未命中 -1。
    if (resolution.hit && resolution.delta >= 5) this.state.juryMood = clampScore(this.state.juryMood + 6, 0, 100);
    else if (resolution.hit) this.state.juryMood = clampScore(this.state.juryMood + 2, 0, 100);
    else this.state.juryMood = clampScore(this.state.juryMood - 1, 0, 100);

    // resolved / fact
    if (resolution.resolvedPoint) {
      this.state.unresolved = this.state.unresolved.filter((p) => p !== resolution.resolvedPoint);
      this.state.resolved.push(resolution.resolvedPoint);
    }
    if (resolution.addedFact) this.state.facts.push(resolution.addedFact);
    if (card === "attack" && resolution.hit) this.state.rebuttalDebt = 2;

    this.state.playerMoves.push({
      round: this.state.round, card, delta: balanceDelta, hit: resolution.hit, judgeComment: resolution.judgeComment,
    });

    // 高光捕捉：关键证据命中（delta>=8）
    const hl = detectHighlight("court", {
      type: "court_card_resolved",
      payload: { hit: resolution.hit, delta: balanceDelta, round: this.state.round, timestamp: Date.now() },
    });
    if (hl) {
      this.captureHighlight({ ...hl, id: this.nextHighlightId() });
      this.popDramaticMoment(`关键证据：${resolution.judgeComment}`);
      this.emitFeedback({ kind: "float_text", text: "关键证据命中！", intensity: 0.7 });
    }

    // 陪审团倒戈检测：情绪跨过 65（热血沸腾）
    if (!this.state.jurySwingFired && this.state.juryMood >= 65) {
      this.state.jurySwingFired = true;
      this.popDramaticMoment("陪审团开始倒向你方——旁听席响起掌声。");
    }

    this.emit({
      type: "court_card_resolved",
      timestamp: Date.now(),
      payload: { card, hit: resolution.hit, delta: balanceDelta, juryMood: this.state.juryMood, judgeComment: resolution.judgeComment },
    });
    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: balanceDelta, reason: resolution.judgeComment },
    });
    this.emit({
      type: "jury_mood_update",
      timestamp: Date.now(),
      payload: { juryMood: this.state.juryMood, reason: resolution.hit ? "陪审团被说动了。" : "陪审团反应平平。" },
    });

    if (this.state.ammo[this.state.playerSide] <= 0) {
      this.closeRound();
    } else {
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
      const timeoutMs = this.config?.playerTurnTimeoutMs ?? 120_000;
      this.startTimer(timeoutMs, () => this.act({ kind: "pass" }));
    }
  }

  /** 一轮结束：对手名人反驳 → 情绪 -4 → 下一轮 / 结案陈词。 */
  private closeRound(): void {
    if (this.state.rebuttalAppliedThisRound) return;
    this.state.rebuttalAppliedThisRound = true;
    this.cancelTimer();
    this.state.stage = "opponent_rebuttal";

    const baseDelta = this.config?.opponentRebuttalDelta ?? 4;
    const delta = Math.max(0, baseDelta - this.state.rebuttalDebt);
    this.state.rebuttalDebt = 0;
    this.state.balance = applyBalance(this.state.balance, this.state.playerSide, -delta);
    this.state.lastDelta = -delta;
    this.state.juryMood = clampScore(this.state.juryMood - 4, 0, 100);

    // 记录本轮结束后玩家天平分（翻盘检测）。
    this.state.scoreHistory.push(this.state.balance[this.state.playerSide]);

    const opponentName = this.opponentCelebrityName();
    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: -delta, reason: `${opponentName}当庭反驳，天平回摆 ${delta} 点。` },
    });
    this.emit({
      type: "jury_mood_update",
      timestamp: Date.now(),
      payload: { juryMood: this.state.juryMood, reason: `${opponentName} 的反驳让部分陪审团动摇。` },
    });
    this.emit({
      type: "court_round_recap",
      timestamp: Date.now(),
      payload: { round: this.state.round, balance: { ...this.state.balance }, juryMood: this.state.juryMood },
    });

    if (this.state.round >= this.maxRounds) {
      this.state.stage = "closing";
      this.emit({ type: "closing_open", timestamp: Date.now(), payload: {} });
    } else {
      this.beginRound();
    }
  }

  /** 玩家提交结案陈词 → 算加成 → 综合裁决 → finish。 */
  private resolveClosing(text: string): void {
    this.cancelTimer();
    this.state.closingText = (text ?? "").slice(0, 500);
    const score = evaluateClosingStatement({
      text: this.state.closingText,
      balance: this.state.balance,
      juryMood: this.state.juryMood,
      disputePoints: this.caseData.disputePoints,
    });
    this.state.closingScore = score;
    this.state.balance = applyBalance(this.state.balance, this.state.playerSide, score);

    this.emit({
      type: "court_balance_update",
      timestamp: Date.now(),
      payload: { balance: { ...this.state.balance }, lastDelta: score, reason: `结案陈词掷地有声，天平 +${score}。` },
    });
    this.emit({
      type: "closing_scored",
      timestamp: Date.now(),
      payload: { score, text: this.state.closingText },
    });

    // 结案陈词慷慨激昂且陪审团已热 → 追加名场面。
    if (score >= 10) {
      this.popDramaticMoment("结案陈词慷慨激昂，陪审席有人起立鼓掌。");
    }
    this.state.stage = "verdict";
    this.finish();
  }

  override settle(): SignatureGameResult {
    const playerBalance = this.state.balance[this.state.playerSide];
    // 综合裁决：天平 + 陪审团情绪修正（mood 偏离 50 每 5 点 → 1 分）。
    const verdictScore = clampScore(playerBalance + (this.state.juryMood - 50) / 5, 0, 100);

    let result: "win" | "draw" | "loss";
    let winner: string | null;
    if (verdictScore >= 52) { result = "win"; winner = "slot-0"; }
    else if (verdictScore <= 48) { result = "loss"; winner = "slot-1"; }
    else { result = "draw"; winner = null; }

    const tier = computeTier(verdictScore, 100, SIGNATURE_TIER_LABELS);
    const rankPoints = computeRankPoints(result, 100, 100);

    // 翻盘检测：过程中曾 <30% 而终局 >50%。
    const comeback = detectComeback(this.state.scoreHistory, verdictScore, 100);
    if (comeback) {
      this.captureHighlight({
        id: this.nextHighlightId(), scene: "court", type: "comeback",
        timestamp: Date.now(), description: "逆风翻盘！陪审团最终站到了你这边。",
        data: { scoreHistory: [...this.state.scoreHistory], verdictScore },
      });
      this.popDramaticMoment("最黑暗时刻过后，陪审团集体倒戈——经典翻盘！");
    }

    const hlDescriptions: string[] = this.getHighlights().map((h) => `【${h.type}】${h.description}`);
    if (hlDescriptions.length === 0) {
      hlDescriptions.push("本局没有特别亮眼的时刻，下次试着直击争议焦点。");
    }

    return {
      winner,
      scores: { "slot-0": Math.round(verdictScore), "slot-1": 100 - Math.round(verdictScore) },
      tier,
      rankPoints,
      highlights: hlDescriptions,
      durationMs: this.elapsedMs,
      juryMood: this.state.juryMood,
      closingScore: this.state.closingScore,
      verdictScore: Math.round(verdictScore),
      dramaticMoments: [...this.state.shownMoments],
      case: this.caseData,
    };
  }

  /** 取一个未放送的名场面文本（优先案件预设，其次运行时生成）。 */
  private popDramaticMoment(runtimeText: string): void {
    const idx = this.state.shownMoments.length;
    const preset = this.caseData.dramaticMoments[idx];
    const text = preset ?? runtimeText;
    this.state.shownMoments.push(text);
    this.emit({ type: "dramatic_moment", timestamp: Date.now(), payload: { text, index: idx } });
    this.emitFeedback({ kind: "confetti", intensity: preset ? 0.8 : 0.4 });
  }

  /** 本局对手名人 id（关系系统用）。 */
  opponentCelebrityId(): string {
    return this.state.opponentSide === "defendant"
      ? this.caseData.celebrityDefendant.id
      : this.caseData.celebrityPlaintiff.id;
  }

  /** 本局对手名人名。 */
  opponentCelebrityName(): string {
    return this.state.opponentSide === "defendant"
      ? this.caseData.celebrityDefendant.name
      : this.caseData.celebrityPlaintiff.name;
  }
}

// 供外部复用
export { HAND_CARDS, CARD_AMMO_COST, MAX_ROUNDS, PLAYER_AMMO_PER_ROUND };
