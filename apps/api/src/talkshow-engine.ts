// ============================================================================
// 脱口秀引擎 TalkshowOrchestrator（玩法深化专项）
// 继承共享编排基类 BaseOrchestrator：阶段状态机 / 计时器兜底 / 槽位 / 事件 /
// 段位 / 新手引导 / 快照。
//
// 三维度评分（punchline/pacing/resonance）与 callback 回扣复用
// talkshow-orchestrator.ts 的纯函数（scorePlayerJoke / detectCallback /
// computeOpenMicTier / reactionFromScore / TOPIC_LIBRARY），不重写结算。
// ============================================================================
import {
  BaseOrchestrator,
  computeTier,
  clampScore,
  getDailyChallenge,
  type GameResult,
  type TierLevel,
  type TutorialStep,
} from "@balabala/shared";
import {
  TOPIC_LIBRARY,
  computeOpenMicTier,
  detectCallback,
  reactionFromScore,
  scorePlayerJoke,
  type JokeDimensionScores,
  type OpenMicReaction,
  type PerformedJoke,
  type TopicOption,
} from "./talkshow-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

// ===== 类型 =====

export type TalkshowStage = "warmup" | "picking_topic" | "performing" | "results";

export interface TalkshowState {
  stage: TalkshowStage;
  topic: TopicOption | null;
  /** 下一个要讲的段子序号（0 起）。 */
  currentJokeIndex: number;
  totalJokes: number;
  jokeTimeLimitMs: number;
  jokes: PerformedJoke[];
  warmupJokes: string[];
  callbackOptions: Array<{ index: number; preview: string }>;
  /** 60s 倒计时最后 10s 已发过 time_warning。 */
  warnedLastTen: boolean;
}

export interface TalkshowConfig {
  chat?: ChatFn;
  totalJokes?: number;
  jokeTimeLimitMs?: number;
  /** 测试/无 LLM 环境下注入确定性评分器。 */
  scorer?: (text: string) => Promise<{
    scores: JokeDimensionScores;
    total: number;
    reaction: OpenMicReaction;
    note: string;
  }>;
}

export type TalkshowAction =
  | { kind: "pick_topic"; topicId: string }
  /** 超时自动提交（内容可为空 → 记冷场）。 */
  | { kind: "timeout_submit"; text?: string };

const TALKSHOW_TIER_LABELS: Record<TierLevel, string> = {
  novice: "冷场",
  adept: "尚可",
  expert: "炸场",
  master: "今日之星",
};

const TUTORIAL_STEPS: TutorialStep[] = [
  { id: "ts-topic", title: "选话题", description: "左侧 4 张话题票选一个作为今晚主题。", target: "topic-picker" },
  { id: "ts-write", title: "写第一段", description: "每个段子 60 秒限时，最后 10 秒变红。", target: "joke-timer" },
  { id: "ts-radar", title: "看三维度", description: "不再是黑盒单分：包袱/节奏/共鸣三条，吐槽指向最该改的那项。", target: "joke-score-radar" },
  { id: "ts-callback", title: "用 callback", description: "第 2/3 段可选回扣前段，真引用关键词 → 共鸣 +15、反应升一档。", target: "callback-chooser" },
];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const sumScores = (s: JokeDimensionScores): number =>
  clamp(Math.round(s.punchline) + Math.round(s.pacing) + Math.round(s.resonance), 0, 100);

/** 冷场兜底：超时未写 / 空文本时的确定性评分。 */
const silentScore = (): { scores: JokeDimensionScores; total: number; reaction: OpenMicReaction; note: string } => ({
  scores: { punchline: 4, pacing: 6, resonance: 3 },
  total: 13,
  reaction: "silence",
  note: "（超时未开口，台下安静得能听到酒杯声）",
});

/**
 * 脱口秀编排器。流程：热身 → 选话题 → 3 段段子（每段 60s 限时）→ 结算。
 * 真人 = 演员 slot-0；AI = 主持人 slot-1 + 3 位观众评委 slot-2..4。
 */
export class TalkshowOrchestrator extends BaseOrchestrator<
  TalkshowState,
  TalkshowAction,
  TalkshowConfig
> {
  constructor() {
    super({
      maxRounds: 3,
      initialState: TalkshowOrchestrator.initialState(3, 60_000),
      tutorialSteps: TUTORIAL_STEPS,
    });
  }

  private static initialState(totalJokes: number, limitMs: number): TalkshowState {
    return {
      stage: "warmup",
      topic: null,
      currentJokeIndex: 0,
      totalJokes,
      jokeTimeLimitMs: limitMs,
      jokes: [],
      warmupJokes: [],
      callbackOptions: [],
      warnedLastTen: false,
    };
  }

  override start(config: TalkshowConfig): void {
    this.state = TalkshowOrchestrator.initialState(
      config.totalJokes ?? 3,
      config.jokeTimeLimitMs ?? 60_000,
    );
    super.start(config);
    // slot-0 真人演员；slot-1 主持人；slot-2..4 三位观众评委（AI）
    this.setupSlots(["performer", "host", "audience-1", "audience-2", "audience-3"], 1, [
      "host-ai",
      "audience-picky",
      "audience-laugh",
      "audience-regular",
    ]);
    this.assignHuman("human-player", "你", "slot-0");
    this.slots[0].nickname = "你（开放麦演员）";
    this.slots[1].nickname = "主持人（AI）";
    this.slots[2].nickname = "挑剔观众";
    this.slots[3].nickname = "捧场观众";
    this.slots[4].nickname = "普通观众";

    // 热身段子（无 LLM 环境用兜底文案，保证流程不中断）
    this.state.warmupJokes = [
      "大家晚上好！我是今晚的主持——先说好，我讲的段子不包笑，包退。",
      "掌声欢迎下一位上台的朋友……呃，掌声呢？没事，他脸皮比我厚。",
    ];
    this.state.stage = "picking_topic";
    this.emit({
      type: "talkshow_warmup",
      timestamp: Date.now(),
      payload: { warmupJokes: [...this.state.warmupJokes] },
    });
    this.emit({
      type: "talkshow_topic_options",
      timestamp: Date.now(),
      payload: { topics: TOPIC_LIBRARY.map((t) => ({ id: t.id, label: t.label, icon: t.icon })) },
    });
  }

  protected applyAction(action: TalkshowAction): void {
    if (action.kind === "pick_topic") {
      if (this.state.stage !== "picking_topic") return;
      const topic = TOPIC_LIBRARY.find((t) => t.id === action.topicId);
      if (!topic) return;
      this.state.topic = topic;
      this.state.stage = "performing";
      this.emit({ type: "talkshow_topic_picked", timestamp: Date.now(), payload: { topic: topic.label } });
      this.beginJokeTurn();
      return;
    }

    if (action.kind === "timeout_submit") {
      // 计时器兜底：把空文本当作冷场段子提交，不卡死。
      void this.performJoke(action.text?.trim() ?? "");
    }
  }

  /** 开始一段段子计时。 */
  private beginJokeTurn(): void {
    this.state.warnedLastTen = false;
    const limitMs = this.state.jokeTimeLimitMs;
    this.emit({
      type: "talkshow_joke_start",
      timestamp: Date.now(),
      payload: { index: this.state.currentJokeIndex, timeLimitMs: limitMs, callbackOptions: [...this.state.callbackOptions] },
    });
    // 最后 10s 提醒（非阻断）
    this.startTimer(Math.max(0, limitMs - 10_000), () => {
      if (!this.state.warnedLastTen) {
        this.state.warnedLastTen = true;
        this.emit({ type: "talkshow_time_warning", timestamp: Date.now(), payload: { secondsLeft: 10 } });
      }
    });
    // 超时自动提交（用一个可被覆盖的 pending 文本；默认空=冷场）
    this.startTimer(limitMs, () => {
      this.act({ kind: "timeout_submit", text: this.pendingText });
    });
  }

  /** 前端在输入框里暂存的文本（超时提交用）。 */
  pendingText = "";

  /**
   * 玩家讲一段段子（异步：LLM 三维度评分）。
   * 这是脱口秀的主动作：评分是异步副作用，callback 检测是纯函数。
   */
  async performJoke(
    text: string,
    opts: { callbackTo?: number; switchTopic?: string } = {},
  ): Promise<PerformedJoke> {
    if (this.state.stage !== "performing" || !this.state.topic) {
      throw new Error("请先选话题再上台");
    }
    if (this.state.currentJokeIndex >= this.state.totalJokes) {
      throw new Error("段子已讲完，请结算");
    }
    this.cancelTimer();
    this.pendingText = "";

    let topicLabel = this.state.topic.label;
    if (opts.switchTopic) {
      const next = TOPIC_LIBRARY.find((t) => t.id === opts.switchTopic);
      if (next) {
        this.state.topic = next;
        topicLabel = next.label;
      }
    }

    const clean = text.trim().slice(0, 500);
    const scored = clean
      ? await this.scoreText(clean)
      : silentScore();

    const joke: PerformedJoke = {
      text: clean || "（超时未开口）",
      topic: topicLabel,
      scores: { ...scored.scores },
      total: scored.total,
      reaction: scored.reaction,
      note: scored.note,
    };

    // ===== Callback 纯函数检测 =====
    if (typeof opts.callbackTo === "number") {
      const idx = opts.callbackTo;
      if (idx >= 0 && idx < this.state.jokes.length) {
        joke.callbackTo = idx;
        const prev = this.state.jokes[idx];
        const { hit } = detectCallback(prev.text, joke.text);
        if (hit) {
          joke.callbackHit = true;
          joke.scores.resonance = clamp(joke.scores.resonance + 15, 0, 30);
          joke.total = sumScores(joke.scores);
          joke.reaction = upgradeReactionLocal(joke.reaction);
          if (!joke.note) joke.note = "callback 真响了！共鸣拉满。";
        } else {
          joke.callbackHit = false;
          joke.note = "你说要 call back 但我没听到那个梗啊。";
        }
      }
    }

    this.state.jokes.push(joke);
    this.state.currentJokeIndex += 1;
    this.state.callbackOptions = this.state.jokes.map((j, i) => ({
      index: i,
      preview: j.text.length > 24 ? `${j.text.slice(0, 24)}…` : j.text,
    }));

    this.emit({
      type: "talkshow_joke_scored",
      timestamp: Date.now(),
      payload: {
        index: this.state.currentJokeIndex - 1,
        scores: joke.scores,
        total: joke.total,
        reaction: joke.reaction,
        note: joke.note,
        callbackEligible: this.state.currentJokeIndex < this.state.totalJokes,
      },
    });
    this.emitFeedback("joke", { index: joke.total, reaction: joke.reaction });

    if (this.state.currentJokeIndex >= this.state.totalJokes) {
      this.state.stage = "results";
      this.finish();
    } else {
      this.beginJokeTurn();
    }
    return joke;
  }

  private async scoreText(text: string) {
    if (this.config?.scorer) return this.config.scorer(text);
    if (this.config?.chat) return scorePlayerJoke(text, this.config.chat);
    // 无注入：用确定性兜底（长度/感叹号），保证可复算测试。
    return deterministicFallbackScore(text);
  }

  override settle(): GameResult {
    const count = this.state.jokes.length;
    const average = count > 0
      ? Math.round(this.state.jokes.reduce((s, j) => s + j.total, 0) / count)
      : 0;
    const { tier: sceneTier, verdict } = computeOpenMicTier(average);
    const tier = computeTier(average, 100, TALKSHOW_TIER_LABELS);
    void sceneTier;
    void verdict;

    const gold = this.state.jokes.reduce<PerformedJoke | null>(
      (best, j) => (best === null || j.total > best.total ? j : best),
      null,
    );

    const highlights: string[] = [];
    if (gold) highlights.push(`金句卡：「${gold.text.slice(0, 40)}」（${gold.total} 分）`);
    const cbHits = this.state.jokes.filter((j) => j.callbackHit).length;
    if (cbHits > 0) highlights.push(`成功回扣 ${cbHits} 次，共鸣拉满。`);
    if (highlights.length === 0) highlights.push("第一次上台都这样，开放麦就是用来试段子的。");

    return {
      winner: null, // 单人表演，无对手
      scores: { "slot-0": average },
      tier,
      rankPoints: average,
      highlights,
      durationMs: this.elapsedMs,
    };
  }

  static dailyChallenge(date: Date) {
    return getDailyChallenge("talkshow", date);
  }
}

const REACTION_ORDER: OpenMicReaction[] = ["silence", "roast", "mixed", "applaud"];
function upgradeReactionLocal(r: OpenMicReaction): OpenMicReaction {
  const i = REACTION_ORDER.indexOf(r);
  return i >= 0 && i < REACTION_ORDER.length - 1 ? REACTION_ORDER[i + 1] : r;
}

/** 无 LLM 时的确定性评分（不用 Math.random，保证测试可复算）。 */
function deterministicFallbackScore(text: string): {
  scores: JokeDimensionScores;
  total: number;
  reaction: OpenMicReaction;
  note: string;
} {
  const len = text.length;
  const exclaim = (text.match(/[!！？?]/g) ?? []).length;
  const punchline = clamp(Math.round(18 + Math.min(16, exclaim * 3) + Math.min(8, len / 20)), 0, 40);
  const pacing = clamp(Math.round(26 - Math.min(16, len / 24)), 0, 30);
  const resonance = clamp(Math.round(16 + Math.min(12, len / 18)), 0, 30);
  const scores = { punchline, pacing, resonance };
  const total = sumScores(scores);
  return { scores, total, reaction: reactionFromScore(total), note: "无 LLM 环境下的确定性参考分。" };
}

export { TOPIC_LIBRARY };
