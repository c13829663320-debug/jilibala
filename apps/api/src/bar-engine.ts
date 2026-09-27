// ============================================================================
// 酒吧辩论引擎 BarEngine —— 继承共享编排基类 BaseOrchestrator。
// 把 bar-orchestrator.ts 里已经验证过的纯函数（角度克制表 / 双向强度条 /
// 双维评分 delta）套进「phase / round / timer / slots / 事件总线 / 计分 / 引导」。
// LLM 评分与 AI 发言通过注入钩子完成，测试用确定性桩。
// ============================================================================
import {
  BaseOrchestrator,
  computeTier,
  type GameResult,
  type TutorialStep,
} from "@balabala/shared";
import {
  applyStrengthDelta,
  computeTurnDelta,
  resolveAngleCounter,
  rollArgumentAngle,
  rollStanceTendency,
  tendencyFromAngle,
  type AngleCounterResult,
  type ArgumentAngle,
  type ArgumentScore,
  type DebateSide,
  type StanceTendency,
} from "./bar-orchestrator.js";

export const BAR_TOTAL_ROUNDS = 3;
/** 终局玩家方强度 ≥ 此值判玩家胜。 */
export const PLAYER_WIN_THRESHOLD = 55;

export interface BarTurn {
  round: number;
  side: "player" | DebateSide;
  speaker: string;
  text: string;
  angle?: ArgumentAngle;
  effectiveness?: AngleCounterResult["effectiveness"];
  delta?: number;
  score?: ArgumentScore;
}

export interface BarState {
  topic: string;
  playerSide: DebateSide;
  aiSide: DebateSide;
  round: number; // 1 起；>totalRounds 表示打满
  strength: { pro: number; con: number };
  aiTendency: StanceTendency;
  transcript: BarTurn[];
  lastEffectiveness?: AngleCounterResult["effectiveness"];
  finished: boolean;
}

export type BarAction =
  | { kind: "speak"; angle: ArgumentAngle; content: string };

export interface BarConfig {
  topic: string;
  playerSide: DebateSide;
  opponentName?: string;
  humanThinkMs?: number;
}

/** 双维评分钩子：线上接 LLM，测试给确定性桩。 */
export type ScoreHook = (
  topic: string,
  side: DebateSide | "player",
  angle: ArgumentAngle,
  content: string,
) => ArgumentScore;

/** 确定性默认评分：发言越长、越贴角度 → 分越高（中庸 5/5 兜底）。 */
export const deterministicScore: ScoreHook = (_topic, _side, angle, content) => {
  const len = content.trim().length;
  // 0-10：长度映射 content_quality；包含角度关键词映射 relevance。
  const cq = Math.max(0, Math.min(10, Math.round(3 + len / 12)));
  const relKw = angle === "data" ? ["数据", "统计", "%" , "率"]
    : angle === "emotion" ? ["我", "他", "感受", "回忆"]
    : ["但是", "矛盾", "漏洞", "因为"];
  const hit = relKw.some((k) => content.includes(k));
  const rel = hit ? 9 : 5;
  return { content_quality: cq, relevance: rel };
};

const TUTORIAL: TutorialStep[] = [
  { id: "bar-side", title: "选边", description: "正方赞成 / 反方反对，你押哪一边。", target: "side-chooser" },
  { id: "bar-angle", title: "选攻击角度", description: "每回合选一张角度卡：📊数据 / ❤️情感 / 🔍逻辑，选完才解锁发言。", target: "angle-chooser" },
  { id: "bar-counter", title: "克制三角", description: "数据克情感、情感克理性、逻辑克混合——看上方 AI 倾向猜它下一张。", target: "tendency-meter" },
  { id: "bar-meter", title: "看强度条", description: "克制时金色飘字+强度大滑；三回合后你方 ≥55 即胜。", target: "strength-meter" },
];

function emptyState(): BarState {
  return {
    topic: "",
    playerSide: "pro",
    aiSide: "con",
    round: 1,
    strength: { pro: 50, con: 50 },
    aiTendency: "mixed",
    transcript: [],
    finished: false,
  };
}

export class BarEngine extends BaseOrchestrator<BarState, BarAction, BarConfig> {
  readonly humanSlot = "slot-0";
  private scoreHook: ScoreHook;
  private rand: () => number;

  constructor(opts: { score?: ScoreHook; rand?: () => number } = {}) {
    super({ maxRounds: BAR_TOTAL_ROUNDS, initialState: emptyState(), tutorialSteps: TUTORIAL });
    this.scoreHook = opts.score ?? deterministicScore;
    this.rand = opts.rand ?? Math.random;
  }

  // ---- 开局 ------------------------------------------------------------------
  setup(config: BarConfig): void {
    this.start(config);
    this.state.topic = config.topic;
    this.state.playerSide = config.playerSide;
    this.state.aiSide = config.playerSide === "pro" ? "con" : "pro";
    // 槽位：slot-0 真人辩手，slot-1 AI 对手，slot-2 酒保裁判。
    this.setupSlots(["debater", "opponent", "bartender"], 1, ["celebrity-opponent", "socrates-bartender"]);
    this.assignHuman("human-0", "我", "slot-0");
    this.slots[0].nickname = "我";
    this.slots[1].nickname = config.opponentName ?? "对手名人";
    this.slots[2].nickname = "苏格拉底";
    this.state.aiTendency = rollStanceTendency(this.rand);
  }

  // ---- BaseOrchestrator 抽象 ------------------------------------------------
  protected applyAction(action: BarAction): void {
    if (action.kind === "speak") this.resolveTurn(action.angle, action.content);
  }

  settle(): GameResult {
    const s = this.state;
    const playerStrength = s.strength[s.playerSide];
    const playerWon = playerStrength >= PLAYER_WIN_THRESHOLD;
    const winner = playerWon ? this.humanSlot : "opponent";
    const score = Math.round(playerStrength); // 0-100
    return {
      winner,
      scores: { [this.humanSlot]: score },
      tier: computeTier(score, 100, {
        novice: "酒客", adept: "辩手", expert: "辩士", master: "辩神",
      }),
      rankPoints: playerWon ? 25 : -15,
      highlights: s.transcript.slice(-3).map((t) => `${t.speaker}：${t.text.slice(0, 30)}`),
      durationMs: this.elapsedMs,
    };
  }

  /**
   * 结算一回合：玩家选角度发言 → 克制 + 双维评分 → AI 对称反驳。
   * 超时 fallback：若真人未选角度/未写，用默认角度 data + 占位发言自动结算。
   */
  resolveTurn(angle: ArgumentAngle | null, content: string): BarTurn {
    const s = this.state;
    if (s.finished) throw new Error("辩论已结束");
    if (s.round > BAR_TOTAL_ROUNDS) throw new Error("已打满 3 回合");

    const playerAngle: ArgumentAngle = angle ?? "data"; // 超时兜底角度
    const playerText = content.trim() || "（超时未发言，AI 代打）";

    // 1) 玩家克制结算
    const playerCounter = resolveAngleCounter(playerAngle, s.aiTendency);
    const playerScore = this.scoreHook(s.topic, "player", playerAngle, playerText);
    const playerDelta = computeTurnDelta(playerCounter.delta, playerScore);
    s.strength = applyStrengthDelta(s.strength, s.playerSide, playerDelta);
    const playerTurn: BarTurn = {
      round: s.round, side: "player", speaker: "我", text: playerText,
      angle: playerAngle, effectiveness: playerCounter.effectiveness,
      delta: playerDelta, score: playerScore,
    };
    s.transcript.push(playerTurn);
    s.lastEffectiveness = playerCounter.effectiveness;
    this.emit({
      type: "bar_turn_resolved", timestamp: Date.now(),
      payload: { turn: s.round, side: "player", effectiveness: playerCounter.effectiveness, delta: playerDelta },
    });

    // 2) AI 对称反驳：AI 自选角度，面对玩家角度做克制
    const aiAngle = rollArgumentAngle(this.rand);
    const aiCounter = resolveAngleCounter(aiAngle, tendencyFromAngle(playerAngle));
    const aiScore = this.scoreHook(s.topic, s.aiSide, aiAngle, `${this.slots[1]?.nickname ?? "对手"} 的反驳`);
    const aiDelta = computeTurnDelta(aiCounter.delta, aiScore);
    s.strength = applyStrengthDelta(s.strength, s.aiSide, aiDelta);
    const aiTurn: BarTurn = {
      round: s.round, side: s.aiSide, speaker: this.slots[1]?.nickname ?? "对手",
      text: "我不同意，让我用事实/故事/逻辑反驳你。", angle: aiAngle,
      effectiveness: aiCounter.effectiveness, delta: aiDelta, score: aiScore,
    };
    s.transcript.push(aiTurn);

    // 3) 推进回合 + 揭示下回合 AI 倾向
    s.round += 1;
    s.aiTendency = rollStanceTendency(this.rand);
    this.addScore(this.humanSlot, Math.max(0, Math.round(playerDelta)), `第${s.round - 1}回合交锋`);

    if (s.round > BAR_TOTAL_ROUNDS) s.finished = true;
    return playerTurn;
  }

  /** 超时 fallback：真人整回合没操作，自动用默认角度走完本回合。 */
  timeoutFallback(): BarTurn {
    return this.resolveTurn(null, "");
  }

  /** 终局裁决。 */
  judge(): GameResult {
    this.state.finished = true;
    return this.finish();
  }

  get currentTendency(): StanceTendency {
    return this.state.aiTendency;
  }
}
