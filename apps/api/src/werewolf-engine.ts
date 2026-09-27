// ============================================================================
// 狼人杀引擎 WerewolfEngine —— 继承共享编排基类 BaseOrchestrator。
// 把 werewolf-orchestrator.ts 里已经验证过的 night/day 规则套进
// 「phase / round / timer / slots / 事件总线 / 计分 / 引导 / 快照」框架。
//
// 本文件是**可单测的纯规则状态机**：AI 决策通过注入钩子（aiHooks）完成，
// 测试用确定性桩，线上再接 LLM。私密信息一律走 getPrivateSnapshot(seat)。
// ============================================================================
import {
  BaseOrchestrator,
  computeTier,
  getDailyChallenge,
  type GameResult,
  type PlayerSlot,
  type TutorialStep,
  type WerewolfDayAction,
  type WerewolfDayActionRecord,
  type WerewolfRole,
  type WerewolfWinner,
} from "@balabala/shared";

// ===== 配置常量 =====
export const SEAT_COUNT = 9;
export const ROLE_DISTRIBUTION: WerewolfRole[] = [
  "werewolf", "werewolf", "werewolf",
  "seer", "witch", "hunter",
  "villager", "villager", "villager",
];
export const MAX_DAYS = 4;
/** 白天自由发言窗口（默认 90s；测试缝可注入更短）。 */
export const DEFAULT_SPEECH_WINDOW_MS = 90_000;

// ===== 子阶段（主 phase 落在 BaseOrchestrator 的 playing/round/results）=====
export type WwSubPhase =
  | "lobby"
  | "night_wolf"
  | "night_seer"
  | "night_witch"
  | "day_announce"
  | "speech"
  | "vote"
  | "ended";

export interface WwPlayer {
  seat: number;
  role: WerewolfRole;
  alive: boolean;
  witchHeal: boolean;
  witchPoison: boolean;
  correctVotes: number;
  totalVotes: number;
  diedDay?: number;
}

export interface WwState {
  day: number;
  sub: WwSubPhase;
  players: WwPlayer[];
  // 夜晚
  wolfVotes: Record<number, number>;   // wolfSeat -> targetSeat
  killTarget: number | null;
  seerResults: Array<{ seat: number; isWolf: boolean; day: number }>;
  witchHealApplied: boolean;
  witchPoisonTarget: number | null;
  lastNightDeaths: number[];
  // 白天
  dayActions: WerewolfDayActionRecord[];
  votes: Record<number, number | null>; // voterSeat -> targetSeat
  lastVoteResult: { lynchedSeat: number | null; votes: Record<string, number> } | null;
  hunterPending: number | null;
  winner: WerewolfWinner;
  log: string[];
  /** 真人在本夜预提交的行动；未提交则超时由 AI 钩子代打。 */
  humanNightOverride: {
    wolfKill?: number;
    seerCheck?: number;
    witchHeal?: boolean;
    witchPoison?: number | null;
  };
  humanVote: number | null | undefined; // undefined = 未提交
  humanHunterShot: number | null | undefined;
  speechWindowEndsAt: number | null;
}

export type WwAction =
  | { kind: "night_kill"; target: number }
  | { kind: "night_check"; target: number }
  | { kind: "night_witch"; heal: boolean; poison: number | null }
  | { kind: "day_action"; action: WerewolfDayAction }
  | { kind: "day_vote"; target: number | null }
  | { kind: "hunter_shot"; target: number | null };

export interface WwConfig {
  topic?: string;
  /** 测试缝：强制真人（slot-0）扮演某角色。 */
  forceHumanRole?: WerewolfRole;
  /** 测试缝：强制 9 席身份排布（长度=9）。 */
  forceRoles?: WerewolfRole[];
  /** 真人在每夜/投票窗口的思考时长；超时即 AI 代打。 */
  humanThinkMs?: number;
}

/** AI 决策钩子：线上接 LLM，测试给确定性桩。 */
export interface WwAiHooks {
  wolfKill: (wolfSeat: number, candidates: number[]) => number;
  seerCheck: (seerSeat: number, candidates: number[]) => number;
  witch: (witchSeat: number, killTarget: number | null) => { heal: boolean; poison: number | null };
  vote: (voterSeat: number, candidates: number[]) => number | null;
  hunterShot: (hunterSeat: number, candidates: number[]) => number | null;
}

const DEFAULT_AI: WwAiHooks = {
  wolfKill: (_w, c) => c[0] ?? 0,
  seerCheck: (_s, c) => c[0] ?? 0,
  witch: () => ({ heal: false, poison: null }),
  vote: (_v, c) => c[0] ?? null,
  hunterShot: (_h, c) => c[0] ?? null,
};

const TUTORIAL: TutorialStep[] = [
  { id: "ww-role", title: "看清你的身份", description: "左侧身份牌会告诉你是狼人/预言家/女巫/猎人/村民，以及你知道的私密信息。", target: "identity-card" },
  { id: "ww-night", title: "夜间行动", description: "狼人刀人、预言家查验、女巫用药；超时会由 AI 代打。", target: "night-panel" },
  { id: "ww-speech", title: "白天动作牌", description: "用动作牌起跳身份、报查验、怀疑某人——标签全员可见。", target: "day-action-bar" },
  { id: "ww-vote", title: "投票放逐", description: "投出你认为是狼的人；平票无人出局。", target: "vote-panel" },
  { id: "ww-win", title: "胜负规则", description: "狼=0 好人胜；狼≥存活好人则狼胜。出局后变幽灵看完全程。", target: "recap" },
];

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyState(): WwState {
  return {
    day: 1,
    sub: "lobby",
    players: [],
    wolfVotes: {},
    killTarget: null,
    seerResults: [],
    witchHealApplied: false,
    witchPoisonTarget: null,
    lastNightDeaths: [],
    dayActions: [],
    votes: {},
    lastVoteResult: null,
    hunterPending: null,
    winner: null,
    log: [],
    humanNightOverride: {},
    humanVote: undefined,
    humanHunterShot: undefined,
    speechWindowEndsAt: null,
  };
}

/** 公开玩家视图（绝不含身份）。 */
export interface WwPublicPlayer {
  seat: number;
  nickname: string;
  alive: boolean;
  isAI: boolean;
}

/** 某玩家的私密视角快照。 */
export interface WwPrivateSnapshot {
  sub: WwSubPhase;
  day: number;
  players: WwPublicPlayer[];
  winner: WerewolfWinner;
  lastNightDeaths: number[];
  dayActions: WerewolfDayActionRecord[];
  lastVoteResult: WwState["lastVoteResult"];
  log: string[];
  // —— 私密字段，仅本人可见 ——
  mySeat?: number;
  myRole?: WerewolfRole;
  wolfTeammates?: number[];
  seerResults?: WwState["seerResults"];
  witchPotions?: { heal: boolean; poison: boolean };
  spectator?: boolean;
}

export class WerewolfEngine extends BaseOrchestrator<WwState, WwAction, WwConfig> {
  readonly humanSeat = 0;
  private ai: WwAiHooks;
  private rand: () => number;

  constructor(opts: { ai?: Partial<WwAiHooks>; rand?: () => number } = {}) {
    super({ maxRounds: MAX_DAYS, initialState: emptyState(), tutorialSteps: TUTORIAL });
    this.rand = opts.rand ?? Math.random;
    this.ai = { ...DEFAULT_AI, ...(opts.ai ?? {}) };
  }

  // ---- 开局：建槽位 + 发身份 ----------------------------------------------
  setup(config: WwConfig): void {
    this.start(config);
    const roles = this.resolveRoles(config);
    // 9 席，slot-0 真人，其余 AI。
    this.setupSlots(
      Array.from({ length: SEAT_COUNT }, (_, i) => `seat-${i}`),
      1,
      Array.from({ length: SEAT_COUNT - 1 }, (_, i) => `ai-celeb-${i}`),
    );
    this.assignHuman("human-0", "我", "slot-0");
    this.slots[0].nickname = "我";
    for (let i = 1; i < SEAT_COUNT; i += 1) this.slots[i].nickname = `${this.slots[i].role}#${i + 1}`;

    this.state.players = roles.map((role, seat) => ({
      seat,
      role,
      alive: true,
      witchHeal: role === "witch",
      witchPoison: role === "witch",
      correctVotes: 0,
      totalVotes: 0,
    }));
    this.state.log.push(`游戏开始，9 人入座。`);
  }

  private resolveRoles(config: WwConfig): WerewolfRole[] {
    if (config.forceRoles && config.forceRoles.length === SEAT_COUNT) {
      return [...config.forceRoles];
    }
    const roles = shuffle(ROLE_DISTRIBUTION, this.rand);
    if (config.forceHumanRole) {
      // 把真人想要的角色换到 seat 0。
      const idx = roles.indexOf(config.forceHumanRole);
      if (idx >= 0) {
        [roles[0], roles[idx]] = [roles[idx], roles[0]];
      }
    }
    return roles;
  }

  // ---- BaseOrchestrator 抽象 ------------------------------------------------
  protected applyAction(action: WwAction): void {
    const me = this.state.players[this.humanSeat];
    if (!me) return;
    switch (action.kind) {
      case "night_kill":
        if (me.role === "werewolf" && this.state.sub === "night_wolf") {
          this.state.humanNightOverride.wolfKill = action.target;
        }
        return;
      case "night_check":
        if (me.role === "seer" && this.state.sub === "night_seer") {
          this.state.humanNightOverride.seerCheck = action.target;
        }
        return;
      case "night_witch":
        if (me.role === "witch" && this.state.sub === "night_witch") {
          this.state.humanNightOverride.witchHeal = action.heal;
          this.state.humanNightOverride.witchPoison = action.poison;
        }
        return;
      case "day_action":
        this.submitDayAction(action.action);
        return;
      case "day_vote":
        if (this.state.sub === "vote") this.state.humanVote = action.target;
        return;
      case "hunter_shot":
        if (this.state.sub === "day_announce" && this.state.hunterPending === this.humanSeat) {
          this.state.humanHunterShot = action.target;
        }
        return;
    }
  }

  settle(): GameResult {
    const winner = this.state.winner;
    const me = this.state.players[this.humanSeat];
    const mySide: WerewolfRole = me?.role ?? "villager";
    const humanWon = winner != null && ((winner === "wolf") === (mySide === "werewolf"));
    const reasoningScore = this.getScore(`slot-${this.humanSeat}`);
    return {
      winner: winner ?? null,
      scores: { [`slot-${this.humanSeat}`]: reasoningScore },
      tier: computeTier(reasoningScore, 100, {
        novice: "旁观者", adept: "入门神探", expert: "推理大师", master: "读心者",
      }),
      rankPoints: humanWon ? 25 : -15,
      highlights: this.state.log.slice(-5),
      durationMs: this.elapsedMs,
    };
  }

  // ---- 工具 ------------------------------------------------------------------
  private alivePlayers(): WwPlayer[] {
    return this.state.players.filter((p) => p.alive);
  }
  private aliveGood(): WwPlayer[] {
    return this.state.players.filter((p) => p.alive && p.role !== "werewolf");
  }
  private aliveWolves(): WwPlayer[] {
    return this.state.players.filter((p) => p.alive && p.role === "werewolf");
  }

  // ---- 夜晚 ------------------------------------------------------------------
  /**
   * 打开夜晚：重置 override、进入 night_wolf 子阶段。
   * 真人在此之后通过 act() 预提交自己的夜间行动（刀人/查验/用药）。
   */
  openNight(): void {
    this.state.sub = "night_wolf";
    this.state.wolfVotes = {};
    this.state.humanNightOverride = {};
    this.nextRound();
  }

  /**
   * 结算整个夜晚：狼刀 → 查验 → 用药 → 结算死亡。
   * 真人若已通过 act() 预提交行动则用之，否则用 AI 钩子（=超时代打）。
   */
  settleNight(): void {
    // 1) 狼刀
    const wolves = this.aliveWolves();
    for (const w of wolves) {
      let target: number;
      if (w.seat === this.humanSeat && this.state.humanNightOverride.wolfKill != null) {
        target = this.state.humanNightOverride.wolfKill;
      } else {
        const cands = this.aliveGood().map((p) => p.seat);
        target = w.seat === this.humanSeat
          ? (this.state.humanNightOverride.wolfKill ?? this.ai.wolfKill(w.seat, cands))
          : this.ai.wolfKill(w.seat, cands);
      }
      this.state.wolfVotes[w.seat] = target;
    }
    // 多数决
    const tally = new Map<number, number>();
    for (const t of Object.values(this.state.wolfVotes)) tally.set(t, (tally.get(t) ?? 0) + 1);
    let kill: number | null = null;
    let max = 0;
    for (const [t, c] of tally) {
      if (c > max) { max = c; kill = t; }
      else if (c === max) kill = null;
    }
    if (kill == null) {
      const g = this.aliveGood();
      kill = g.length ? g[Math.floor(this.rand() * g.length)].seat : null;
    }
    this.state.killTarget = kill;

    // 2) 预言家查验
    this.state.sub = "night_seer";
    const seer = this.state.players.find((p) => p.alive && p.role === "seer");
    if (seer) {
      let check: number;
      if (seer.seat === this.humanSeat && this.state.humanNightOverride.seerCheck != null) {
        check = this.state.humanNightOverride.seerCheck;
      } else {
        const cands = this.alivePlayers().filter((p) => p.seat !== seer.seat).map((p) => p.seat);
        check = seer.seat === this.humanSeat
          ? (this.state.humanNightOverride.seerCheck ?? this.ai.seerCheck(seer.seat, cands))
          : this.ai.seerCheck(seer.seat, cands);
      }
      const target = this.state.players[check];
      if (target) {
        this.state.seerResults.push({ seat: check, isWolf: target.role === "werewolf", day: this.state.day });
        this.state.log.push(`预言家查验了座位 ${check + 1}。`);
      }
    }

    // 3) 女巫用药
    this.state.sub = "night_witch";
    const witch = this.state.players.find((p) => p.alive && p.role === "witch");
    if (witch) {
      let heal = false;
      let poison: number | null = null;
      if (witch.seat === this.humanSeat &&
          (this.state.humanNightOverride.witchHeal !== undefined || this.state.humanNightOverride.witchPoison !== undefined)) {
        heal = this.state.humanNightOverride.witchHeal === true && witch.witchHeal;
        poison = this.state.humanNightOverride.witchPoison ?? null;
      } else {
        const r = this.ai.witch(witch.seat, this.state.killTarget);
        heal = r.heal && witch.witchHeal;
        poison = r.poison;
      }
      if (heal) witch.witchHeal = false;
      if (poison != null) {
        const tp = this.state.players[poison];
        if (!tp || !tp.alive || poison === witch.seat || !witch.witchPoison) poison = null;
        else witch.witchPoison = false;
      }
      this.state.witchHealApplied = heal;
      this.state.witchPoisonTarget = poison;
    }

    // 结算死亡
    const deaths: number[] = [];
    if (this.state.killTarget != null && !this.state.witchHealApplied) deaths.push(this.state.killTarget);
    if (this.state.witchPoisonTarget != null) deaths.push(this.state.witchPoisonTarget);
    this.state.lastNightDeaths = deaths;
  }

  /** 兼容旧测试/同步用法：打开夜晚并立即结算（真人不预提交，AI 代打）。 */
  runNight(): void {
    this.openNight();
    this.settleNight();
  }

  // ---- 白天公布 + 死亡处理 + 猎人开枪 ----------------------------------------
  runDayAnnounce(): void {
    this.state.sub = "day_announce";
    if (this.state.lastNightDeaths.length) {
      this.kill(this.state.lastNightDeaths, "night");
    }
    // 猎人开枪（真人若为猎人且待开枪，可用 humanHunterShot，否则 AI 钩子）
    const hunter = this.state.players.find((p) => p.role === "hunter" && !p.alive && this.state.lastNightDeaths.includes(p.seat));
    if (hunter) {
      this.state.hunterPending = hunter.seat;
      const cands = this.alivePlayers().map((p) => p.seat);
      let shot: number | null;
      if (hunter.seat === this.humanSeat && this.state.humanHunterShot !== undefined) {
        shot = this.hunterShotTarget(this.state.humanHunterShot, cands);
      } else {
        shot = hunter.seat === this.humanSeat
          ? this.hunterShotTarget(this.state.humanHunterShot ?? this.ai.hunterShot(hunter.seat, cands), cands)
          : this.ai.hunterShot(hunter.seat, cands);
      }
      this.state.hunterPending = null;
      if (shot != null && this.state.players[shot]?.alive) {
        this.kill([shot], "hunter_shot");
        this.state.log.push(`猎人开枪带走了座位 ${shot + 1}。`);
      }
    }
  }

  private hunterShotTarget(raw: number | null, cands: number[]): number | null {
    if (raw == null) return null;
    return cands.includes(raw) ? raw : null;
  }

  private kill(seats: number[], cause: "night" | "lynch" | "hunter_shot"): void {
    for (const s of seats) {
      const p = this.state.players[s];
      if (!p || !p.alive) continue;
      p.alive = false;
      p.diedDay = this.state.day;
      this.state.log.push(`${cause === "night" ? "座位" : cause === "lynch" ? "座位" : "座位"} ${s + 1} 出局。`);
    }
  }

  // ---- 白天动作牌 ------------------------------------------------------------
  beginSpeech(): void {
    this.state.sub = "speech";
    this.state.dayActions = [];
    this.state.speechWindowEndsAt = Date.now() + (this.config?.humanThinkMs ?? DEFAULT_SPEECH_WINDOW_MS);
  }

  submitDayAction(action: WerewolfDayAction): { ok: boolean; message?: string } {
    const me = this.state.players[this.humanSeat];
    if (this.state.sub !== "speech") return { ok: false, message: "只能在白天发言窗口打动作牌" };
    if (!me || !me.alive) return { ok: false, message: "你已出局" };
    let resolved: WerewolfDayAction = action;
    switch (action.kind) {
      case "report_check": {
        if (me.role !== "seer") return { ok: false, message: "只有预言家能报查验" };
        const real = this.state.seerResults.find((r) => r.seat === action.seat);
        if (real) resolved = { kind: "report_check", seat: action.seat, isWolf: real.isWolf };
        break;
      }
      case "suspect": {
        const t = this.state.players[action.seat];
        if (!t || !t.alive || action.seat === me.seat) return { ok: false, message: "怀疑目标无效" };
        break;
      }
      default:
        break;
    }
    const record: WerewolfDayActionRecord = {
      day: this.state.day,
      seat: me.seat,
      nickname: this.slots[this.humanSeat]?.nickname ?? "我",
      action: resolved,
    };
    this.state.dayActions.push(record);
    this.emit({ type: "day_action", timestamp: Date.now(), payload: { record } });
    return { ok: true };
  }

  endSpeech(): void {
    this.state.speechWindowEndsAt = null;
  }

  // ---- 投票 ------------------------------------------------------------------
  /** 打开投票窗口：sub=vote，真人可通过 act({kind:"day_vote"}) 预提交。 */
  openVote(): void {
    this.state.sub = "vote";
    this.state.votes = {};
    this.state.humanVote = undefined;
  }

  /** 结算投票：用真人预提交的 humanVote，否则 AI 代打。 */
  settleVote(): void {
    const voters = this.alivePlayers();
    for (const v of voters) {
      let target: number | null;
      if (v.seat === this.humanSeat) {
        target = this.state.humanVote ?? this.ai.vote(v.seat, voters.filter((p) => p.seat !== v.seat).map((p) => p.seat));
      } else {
        target = this.ai.vote(v.seat, voters.filter((p) => p.seat !== v.seat).map((p) => p.seat));
      }
      this.state.votes[v.seat] = target;
    }
    // 计票
    const tally = new Map<number, number>();
    for (const t of Object.values(this.state.votes)) {
      if (t != null) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    let lynched: number | null = null;
    let max = 0;
    for (const [t, c] of tally) {
      if (c > max) { max = c; lynched = t; }
      else if (c === max) lynched = null;
    }
    const votesRecord: Record<string, number> = {};
    for (const [s, t] of Object.entries(this.state.votes)) votesRecord[s] = t ?? -1;
    this.state.lastVoteResult = { lynchedSeat: lynched, votes: votesRecord };

    // 推理分：真人投对狼 +10
    const lynchedWasWolf = lynched != null && this.state.players[lynched]?.role === "werewolf";
    const humanVoteTarget = this.state.votes[this.humanSeat];
    const human = this.state.players[this.humanSeat];
    if (humanVoteTarget != null) {
      human.totalVotes += 1;
      if (lynched != null && humanVoteTarget === lynched && lynchedWasWolf) {
        human.correctVotes += 1;
        this.addScore(`slot-${this.humanSeat}`, 10, "投对狼");
      }
    }

    if (lynched != null) {
      this.kill([lynched], "lynch");
      // 被正确识别：真人是狼且被放逐 → -5
      if (human.alive === false && human.seat === lynched && human.role === "werewolf") {
        this.addScore(`slot-${this.humanSeat}`, -5, "被好人正确识别放逐");
      }
    }
  }

  /** 兼容旧测试/同步用法：打开投票并立即结算。 */
  runVote(): void {
    this.openVote();
    this.settleVote();
  }

  // ---- 胜负 ------------------------------------------------------------------
  checkWin(): boolean {
    const wolves = this.aliveWolves().length;
    const good = this.aliveGood().length;
    if (wolves === 0) { this.state.winner = "good"; return true; }
    if (wolves >= good) { this.state.winner = "wolf"; return true; }
    return false;
  }

  /** 走到天数上限时的强制裁定。 */
  deadlineWin(): WerewolfWinner {
    const wolves = this.aliveWolves().length;
    const good = this.aliveGood().length;
    this.state.winner = wolves >= good ? "wolf" : "good";
    return this.state.winner;
  }

  /** 结束本局：存活到终局 +20，然后走 BaseOrchestrator.finish。 */
  endGame(): GameResult {
    const human = this.state.players[this.humanSeat];
    if (human?.alive) this.addScore(`slot-${this.humanSeat}`, 20, "存活到终局");
    this.state.sub = "ended";
    return this.finish();
  }

  /**
   * 一个完整昼夜：夜 → 公布 → 发言 → 投票 → 胜负检查。
   * 返回 true 表示本局已结束（胜负分出或到上限）。
   */
  playOneDay(): boolean {
    this.runNight();
    this.runDayAnnounce();
    if (this.checkWin()) { this.endGame(); return true; }
    this.beginSpeech();
    // 真人在此期间可通过 act() 打动作牌；测试直接调用 submitDayAction。
    this.endSpeech();
    this.runVote();
    if (this.checkWin()) { this.endGame(); return true; }
    if (this.state.day >= MAX_DAYS) { this.deadlineWin(); this.endGame(); return true; }
    this.state.day += 1;
    return false;
  }

  // ---- 私密快照（按视角过滤）----------------------------------------------
  getPublicView(): WwPublicPlayer[] {
    return this.state.players.map((p) => ({
      seat: p.seat,
      nickname: this.slots[p.seat]?.nickname ?? `座位${p.seat + 1}`,
      alive: p.alive,
      isAI: p.seat !== this.humanSeat,
    }));
  }

  getPrivateSnapshot(seat: number): WwPrivateSnapshot {
    const base: WwPrivateSnapshot = {
      sub: this.state.sub,
      day: this.state.day,
      players: this.getPublicView(),
      winner: this.state.winner,
      lastNightDeaths: this.state.lastNightDeaths,
      dayActions: this.state.dayActions,
      lastVoteResult: this.state.lastVoteResult,
      log: this.state.log,
    };
    if (seat !== this.humanSeat) return base; // 非真人视角：无任何私密字段
    const me = this.state.players[seat];
    if (!me) return base;
    base.mySeat = me.seat;
    base.myRole = me.role;
    if (!me.alive) base.spectator = true;
    if (me.role === "werewolf") {
      base.wolfTeammates = this.state.players
        .filter((p) => p.role === "werewolf" && p.seat !== me.seat)
        .map((p) => p.seat);
    }
    if (me.role === "seer") base.seerResults = this.state.seerResults;
    if (me.role === "witch") base.witchPotions = { heal: me.witchHeal, poison: me.witchPoison };
    return base;
  }

  get playerSlots(): PlayerSlot[] {
    return this.slots;
  }

  /** 当日挑战（供路由 / 前端展示）。 */
  static dailyChallenge(date: Date) {
    return getDailyChallenge("werewolf", date);
  }
}
