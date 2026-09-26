// ===== 狼人杀馆编排器 Werewolf Orchestrator (M9) =====
// 服务端唯一权威：身份与夜晚行动只存在于内存，客户端不可信任。
// AI LLM 调用严格串行，每次都有超时与规则兜底，绝不因模型异常中断游戏。
// 私密信息（myRole/wolfTeammates/seerResults/witchPotions 等）只通过 sendToUser
// 单独发给对应玩家；broadcast 只携带公开事件。
import { randomUUID } from "node:crypto";
import {
  CELEBRITIES,
  type Celebrity,
  type WerewolfRole,
  type WerewolfPhase,
  type WerewolfPublicPlayer,
  type WerewolfLogEntry,
  type WerewolfReportData,
  type WerewolfPlayerSnapshot,
  type WerewolfBroadcastEvent,
  type WerewolfClientAction,
  type WerewolfWinner,
  type WerewolfDayAction,
  type WerewolfDayActionRecord,
  type WerewolfPersonalReport,
  type WSMessage,
} from "@balabala/shared";
import { resolveCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";
import * as db from "./db.js";

// ===== 游戏配置 =====
const SEAT_COUNT = 9;
const ROLE_DISTRIBUTION: WerewolfRole[] = [
  "werewolf", "werewolf", "werewolf",
  "seer", "witch", "hunter",
  "villager", "villager", "villager",
];

// 阶段超时（毫秒）。night 拆为 wolf/seer/witch 三个子阶段，合计约 35s。
const WOLF_TIMEOUT = 15000;
const SEER_TIMEOUT = 8000;
const WITCH_TIMEOUT = 12000;
/** Round2：白天不再"每人依次 20s"，而是全体 90s 自由发言窗口。 */
const SPEECH_WINDOW = 90000;
const VOTE_TIMEOUT = 20000;
const HUNTER_TIMEOUT = 15000;
/** Round2：最多进行 4 个昼夜，第 4 天结束强制终局。 */
const MAX_DAYS = 4;
const AI_CALL_GAP = 150; // AI LLM 调用之间的礼让间隔，避免 StepFun 限流

// 快速模式：前端点「加速」后大幅缩短 AI 发言间隔（P0 压缩等待）。
let fastModeGlobal = false;
export function setFastMode(on: boolean): void {
  fastModeGlobal = on;
}

/** 测试缝：可缩短白天自由发言窗口，避免单例 90s 等待。 */
let speechWindowMs = SPEECH_WINDOW;
export function setSpeechWindowMs(ms: number): void {
  speechWindowMs = ms;
}

// ===== 工具函数 =====
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 抽取 LLM 返回中的 JSON 对象。 */
const extractJson = (text: string): unknown => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
};

/** 带退避与容错的 LLM 调用：失败重试 1 次（间隔 1s），再失败返回 null 由调用方兜底。 */
const withRetry = async (fn: () => Promise<string>): Promise<string | null> => {
  try {
    return await fn();
  } catch {
    await sleep(1000);
    try {
      return await fn();
    } catch {
      return null;
    }
  }
};

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ===== 对外新增类型（P0 玩法重构；按约束不污染 @balabala/shared，定义在本模块内）=====
/** 玩家发言阶段的快捷动作牌。 */
export type PlayerQuickAction = "claim_seer" | "accuse" | "rally" | "defend";
/** 夜晚好人微操作。 */
export type NightGoodAction = "eavesdrop" | "observe";

/** 本局表现评分（游戏结束时返回给前端展示）。 */
export interface WerewolfPerformance {
  score: number;
  survivedDays: number;
  voteAccuracy: number; // 0..1，无投票记 0
  correctVotes: number;
  totalVotes: number;
  won: boolean;
  side: "wolf" | "good";
  keyActions: string[];
}

// ===== 内部状态结构（不导出，服务端唯一权威）=====
interface InternalPlayer {
  seat: number;
  userId: string;
  nickname: string;
  celebrityId?: string;
  avatarType: string;
  avatarRef: string;
  isAI: boolean;
  role: WerewolfRole;
  alive: boolean;
  hasSpoken: boolean;
  /** 女巫私有：剩余解药 / 毒药 */
  witchHeal: boolean;
  witchPoison: boolean;
  // —— P0 新增：用于表现评分与快捷动作回顾 ——
  deathDay?: number;       // 出局当天（存活到结束则不设）
  correctVotes: number;    // 投中狼的次数
  totalVotes: number;      // 有效投票次数
  claimedSeer: boolean;    // 是否跳了预言家
  quickActions: string[];   // 关键操作回顾文案
  nightMicroUsed: boolean; // 本夜是否已用微操作
}

type NightStage = "idle" | "wolf" | "seer" | "witch" | "done";

interface WerewolfGame {
  gameId: string;
  phase: WerewolfPhase;
  day: number;
  players: InternalPlayer[];
  hostUserId: string;
  nightStage: NightStage;
  nightState: {
    wolfVotes: Map<number, number>;
    killTarget: number | null;
    seerCheck: number | null;
    witchHeal: boolean;
    witchPoisonTarget: number | null;
  };
  dayState: {
    speeches: Map<number, string>;
    votes: Map<number, number | null>;
    currentSpeakerSeat?: number;
    /** Round2：本白天窗口内的结构化动作牌。 */
    dayActions: WerewolfDayActionRecord[];
  };
  seerResults: Array<{ seat: number; isWolf: boolean; day: number }>;
  hunterPending: number | null;
  lastNightDeaths: number[];
  lastVoteResult?: { lynchedSeat: number | null; votes: Record<string, number> };
  log: WerewolfLogEntry[];
  winner: WerewolfWinner;
  timers: Set<ReturnType<typeof setTimeout>>;
  // —— P0 新增 ——
  /** 每玩家私密便签（夜晚偷听 / 观察线索），由 notes 接口 drain。 */
  privateNotes: Map<string, string[]>;
  /** 夜晚发起的观察，天亮后生成行为线索。 */
  pendingObservations: Array<{ observerSeat: number; targetSeat: number; day: number }>;
  /** 快速模式：缩短 AI 发言等待间隔（前端可开启 2x）。 */
  fastMode: boolean;
  // —— Round2 新增 ——
  /** 出局玩家座位集合：alive=false 但留在局内当幽灵观众。 */
  spectators: Set<number>;
  /** 跨天累积的动作牌记录（复盘 / AI 上下文用）。 */
  dayActionsLog: WerewolfDayActionRecord[];
  /** 自由发言窗口关闭时间戳（ms）。 */
  speechWindowEndsAt?: number;
  /** 本局 MVP 座位（结束时计算）。 */
  mvpSeat: number | null;
  /** 等待真人行动的回调句柄 */
  awaiters: {
    wolf?: { onVote: (seat: number) => void };
    seer?: { resolve: (seat: number) => void };
    witch?: { resolve: (r: { heal: boolean; poison: number | null }) => void };
    hunter?: { resolve: (seat: number | null) => void };
    speech?: { resolve: (text: string) => void };
    vote?: { onVote: (seat: number) => void };
  };
  createdAt: string;
}

// ===== 模块级回调注入（由 server.ts 在启动时设置）=====
let broadcastFn: (gameId: string, event: WerewolfBroadcastEvent) => void = () => {};
let sendToUserFn: (gameId: string, userId: string, msg: WSMessage) => void = () => {};
let chatProvider: ChatFn | null = null;

export function setBroadcastCallbacks(
  broadcast: (gameId: string, event: WerewolfBroadcastEvent) => void,
  sendToUser: (gameId: string, userId: string, msg: WSMessage) => void,
): void {
  broadcastFn = broadcast;
  sendToUserFn = sendToUser;
}

/** 注入 LLM chat 函数（server.ts 的 chatWithProviders）。AI 决策需要它。 */
export function setChatProvider(chat: ChatFn): void {
  chatProvider = chat;
}

const games = new Map<string, WerewolfGame>();
const usedCelebrities = new Set<string>();

// ===== 基础工具 =====
function playerAt(game: WerewolfGame, seat: number): InternalPlayer | undefined {
  return game.players.find((p) => p.seat === seat);
}

function playerByUserId(game: WerewolfGame, userId: string): InternalPlayer | undefined {
  return game.players.find((p) => p.userId === userId);
}

function toPublic(p: InternalPlayer): WerewolfPublicPlayer {
  // 注意：绝不暴露 role 字段。
  return {
    seat: p.seat,
    userId: p.userId,
    nickname: p.nickname,
    celebrityId: p.celebrityId,
    avatarType: p.avatarType,
    avatarRef: p.avatarRef,
    alive: p.alive,
    isAI: p.isAI,
  };
}

function registerTimer(game: WerewolfGame, timer: ReturnType<typeof setTimeout>): void {
  game.timers.add(timer);
}

function clearAllTimers(game: WerewolfGame): void {
  for (const t of game.timers) clearTimeout(t);
  game.timers.clear();
  game.awaiters = {};
}

function addLog(game: WerewolfGame, text: string, speakerSeat?: number): void {
  const entry: WerewolfLogEntry = {
    id: randomUUID(),
    day: game.day,
    phase: game.phase,
    text,
    speakerSeat,
    timestamp: new Date().toISOString(),
  };
  game.log.push(entry);
  broadcastFn(game.gameId, { type: "log", entry });
}

function pushSnapshot(game: WerewolfGame, userId: string): void {
  if (userId.startsWith("ai:")) return;
  const snap = getSnapshotForPlayer(game.gameId, userId);
  sendToUserFn(game.gameId, userId, { type: "werewolf_snapshot", snapshot: snap });
}

function pushSnapshotsAll(game: WerewolfGame): void {
  for (const p of game.players) pushSnapshot(game, p.userId);
}

// ===== 胜负判定 =====
export function checkWin(game: WerewolfGame): boolean {
  const wolves = game.players.filter((p) => p.alive && p.role === "werewolf").length;
  const good = game.players.filter((p) => p.alive && p.role !== "werewolf").length;
  if (wolves === 0) { game.winner = "good"; return true; }
  if (wolves >= good) { game.winner = "wolf"; return true; }
  return false;
}

// ===== 导出：游戏生命周期 =====
export function createGame(hostUserId: string): string {
  const gameId = randomUUID();
  games.set(gameId, {
    gameId,
    phase: "lobby",
    day: 1,
    players: [],
    hostUserId,
    nightStage: "idle",
    nightState: { wolfVotes: new Map(), killTarget: null, seerCheck: null, witchHeal: false, witchPoisonTarget: null },
    dayState: { speeches: new Map(), votes: new Map(), dayActions: [] },
    seerResults: [],
    hunterPending: null,
    lastNightDeaths: [],
    log: [],
    winner: null,
    timers: new Set(),
    awaiters: {},
    privateNotes: new Map(),
    pendingObservations: [],
    fastMode: false,
    spectators: new Set(),
    dayActionsLog: [],
    mvpSeat: null,
    createdAt: new Date().toISOString(),
  });
  return gameId;
}

export function joinGame(
  gameId: string,
  userId: string,
  profile: { nickname: string; avatarType: string; avatarRef: string },
): { seat: number } | null {
  const game = games.get(gameId);
  if (!game) return null;
  if (game.phase !== "lobby") return null;
  const existing = playerByUserId(game, userId);
  if (existing) return { seat: existing.seat };
  if (game.players.length >= SEAT_COUNT) return null;
  const occupied = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (occupied.has(seat)) seat += 1;
  const player: InternalPlayer = {
    seat,
    userId,
    nickname: profile.nickname || `玩家${seat + 1}`,
    avatarType: profile.avatarType || "capsule",
    avatarRef: profile.avatarRef || "",
    isAI: false,
    role: "villager", // 占位，startGame 时重新分配
    alive: true,
    hasSpoken: false,
    witchHeal: false,
    witchPoison: false,
    correctVotes: 0,
    totalVotes: 0,
    claimedSeer: false,
    quickActions: [],
    nightMicroUsed: false,
  };
  game.players.push(player);
  broadcastFn(gameId, { type: "player_joined", player: toPublic(player) });
  return { seat };
}

function pickAICelebrity(): Celebrity | undefined {
  const available = CELEBRITIES.filter((c) => !usedCelebrities.has(c.id));
  if (available.length === 0) return undefined;
  const celeb = available[Math.floor(Math.random() * available.length)];
  usedCelebrities.add(celeb.id);
  return celeb;
}

export function startGame(gameId: string, hostUserId: string): void {
  const game = games.get(gameId);
  if (!game) return;
  if (game.phase !== "lobby") return;
  if (game.hostUserId !== hostUserId) return;

  // 每局重新抽取名人，保证同一局内不重复，多局之间可复用。
  usedCelebrities.clear();

  // 按座位顺序把真人玩家填入 0..8，空位补 AI 名人。
  const seats: InternalPlayer[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    const real = game.players.find((p) => p.seat === seat);
    if (real) {
      seats[seat] = real;
    } else {
      const celeb = pickAICelebrity();
      seats[seat] = {
        seat,
        userId: `ai:${seat}`,
        nickname: celeb?.name ?? `AI玩家${seat + 1}`,
        celebrityId: celeb?.id,
        avatarType: "celebrity",
        avatarRef: celeb?.portrait ?? "",
        isAI: true,
        role: "villager",
        alive: true,
        hasSpoken: false,
        witchHeal: false,
        witchPoison: false,
        correctVotes: 0,
        totalVotes: 0,
        claimedSeer: false,
        quickActions: [],
        nightMicroUsed: false,
      };
    }
  }
  game.players = seats;

  // 分配身份。
  const roles = shuffle(ROLE_DISTRIBUTION);
  game.players.forEach((p, i) => {
    p.role = roles[i];
    p.witchHeal = p.role === "witch";
    p.witchPoison = p.role === "witch";
    p.hasSpoken = false;
    p.deathDay = undefined;
    p.correctVotes = 0;
    p.totalVotes = 0;
    p.claimedSeer = false;
    p.quickActions = [];
    p.nightMicroUsed = false;
  });

  game.phase = "night";
  game.nightStage = "wolf";
  game.day = 1;
  game.nightState = { wolfVotes: new Map(), killTarget: null, seerCheck: null, witchHeal: false, witchPoisonTarget: null };
  game.dayState = { speeches: new Map(), votes: new Map(), dayActions: [] };
  game.seerResults = [];
  game.hunterPending = null;
  game.lastNightDeaths = [];
  game.privateNotes = new Map();
  game.pendingObservations = [];
  game.spectators = new Set();
  game.dayActionsLog = [];
  game.mvpSeat = null;
  game.speechWindowEndsAt = undefined;

  broadcastFn(gameId, { type: "phase_change", phase: "night", day: game.day });
  addLog(game, `游戏开始，共 ${SEAT_COUNT} 名玩家入座。`);
  pushSnapshotsAll(game);

  // 异步推进夜晚流程（fire-and-forget，内部全部 try/catch 兜底）。
  void runNight(game).catch((err) => {
    console.error("[werewolf] runNight failed", err);
  });
}

export function getGame(gameId: string): WerewolfGame | undefined {
  return games.get(gameId);
}

// ===== 导出：玩家视角快照（关键：按视角过滤）=====
export function getSnapshotForPlayer(gameId: string, userId: string): WerewolfPlayerSnapshot {
  const game = games.get(gameId);
  const empty: WerewolfPlayerSnapshot = {
    gameId,
    phase: game?.phase ?? "lobby",
    day: game?.day ?? 1,
    players: game ? game.players.map(toPublic) : [],
    winner: game?.winner ?? null,
    lastNightDeaths: game?.lastNightDeaths ?? [],
    log: game?.log ?? [],
  };
  if (!game) return empty;

  const base: WerewolfPlayerSnapshot = {
    gameId: game.gameId,
    phase: game.phase,
    day: game.day,
    players: game.players.map(toPublic),
    winner: game.winner,
    lastNightDeaths: game.lastNightDeaths,
    log: game.log,
  };
  if (game.dayState.currentSpeakerSeat != null) base.currentSpeakerSeat = game.dayState.currentSpeakerSeat;
  if (game.lastVoteResult) base.lastVoteResult = game.lastVoteResult;
  if (game.dayState.dayActions.length) base.dayActions = game.dayState.dayActions.map((r) => ({ ...r, action: { ...r.action } }));
  if (game.speechWindowEndsAt) base.speechWindowEndsAt = game.speechWindowEndsAt;

  const me = playerByUserId(game, userId);
  if (!me) return base; // 旁观者：无任何私密字段

  base.mySeat = me.seat;
  base.myRole = me.role;
  // Round2：出局即幽灵观众，留在局内看完全程。
  if (!me.alive) base.spectator = true;

  // —— 角色专属私密信息 ——
  if (me.role === "werewolf") {
    base.wolfTeammates = game.players
      .filter((p) => p.role === "werewolf" && p.seat !== me.seat)
      .map((p) => p.seat);
    if (game.nightStage === "wolf") {
      base.wolfKillTarget =
        game.nightState.killTarget ?? game.nightState.wolfVotes.get(me.seat) ?? null;
    }
  }
  if (me.role === "seer") {
    base.seerResults = game.seerResults.map((r) => ({ ...r }));
  }
  if (me.role === "witch") {
    base.witchPotions = { heal: me.witchHeal, poison: me.witchPoison };
    if (game.nightStage === "witch") {
      base.witchTonightKill = game.nightState.killTarget ?? null;
    }
  }

  base.pendingAction = computePending(game, me);
  return base;
}

function computePending(game: WerewolfGame, me: InternalPlayer): string | null {
  if (game.phase === "lobby" || game.phase === "ended") return null;
  // 猎人虽死，但待开枪时仍需行动。
  if (game.phase === "day_announce" && game.hunterPending === me.seat) return "hunter_shot";
  if (!me.alive) return null;

  if (game.phase === "night") {
    if (me.role === "werewolf" && game.nightStage === "wolf") return "kill";
    if (me.role === "seer" && game.nightStage === "seer") return "check";
    if (me.role === "witch" && game.nightStage === "witch") return "heal_poison";
    return null;
  }
  if (game.phase === "speech") {
    // Round2：90s 自由窗口内，任何存活玩家都可随时发言 / 打动作牌。
    if (me.alive) return "speak";
    return null;
  }
  if (game.phase === "vote") {
    if (!game.dayState.votes.has(me.seat)) return "vote";
    return null;
  }
  return null;
}

// ===== AI 决策（LLM 串行，失败随机兜底）=====
function aliveNonWolves(game: WerewolfGame): InternalPlayer[] {
  return game.players.filter((p) => p.alive && p.role !== "werewolf");
}

function describePlayers(game: WerewolfGame): string {
  return game.players
    .filter((p) => p.alive)
    .map((p) => `座位${p.seat}（${p.nickname}${p.isAI ? "，AI" : ""}）`)
    .join("，");
}

async function aiDecision(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const provider = chatProvider;
  if (!provider) return null;
  const raw = await withRetry(() => provider(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
  ));
  await sleep(fastModeGlobal ? 40 : AI_CALL_GAP);
  if (!raw) return null;
  try {
    return extractJson(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asSeat(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

async function aiWolfKill(wolf: InternalPlayer, game: WerewolfGame): Promise<number> {
  const celeb = wolf.celebrityId ? resolveCharacter(wolf.celebrityId) : undefined;
  const teammates = game.players
    .filter((p) => p.alive && p.role === "werewolf" && p.seat !== wolf.seat)
    .map((p) => p.seat);
  const candidates = aliveNonWolves(game);
  const system =
    `${celeb?.persona ?? "你是一个冷静的狼人。"}\n` +
    `现在你在玩狼人杀，你是狼人，你的狼人队友座位是：${teammates.join("、") || "无"}。` +
    `今晚要和队友一起刀掉一名好人，目标是杀光所有好人。` +
    `只能从存活的好人中选择。只返回 JSON：{"targetSeat": 数字}，不要解释。`;
  const user = `存活好人：${candidates.map((p) => `座位${p.seat}=${p.nickname}`).join("，")}\n你要刀谁？`;
  const parsed = await aiDecision(system, user, 300);
  const target = parsed ? asSeat(parsed.targetSeat) : null;
  const valid = candidates.find((p) => p.seat === target);
  if (valid) return valid.seat;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick ? pick.seat : wolf.seat;
}

async function aiSeerCheck(seer: InternalPlayer, game: WerewolfGame): Promise<number> {
  const celeb = seer.celebrityId ? resolveCharacter(seer.celebrityId) : undefined;
  const candidates = game.players.filter((p) => p.alive && p.seat !== seer.seat);
  const system =
    `${celeb?.persona ?? "你是一个敏锐的预言家。"}\n` +
    `现在你在玩狼人杀，你是预言家，每晚可以查验一名玩家的身份（狼人/好人）。` +
    `你要选择今晚查验谁。只返回 JSON：{"targetSeat": 数字}，不要解释。`;
  const user = `存活玩家：${candidates.map((p) => `座位${p.seat}=${p.nickname}`).join("，")}\n你要查验谁？`;
  const parsed = await aiDecision(system, user, 300);
  const target = parsed ? asSeat(parsed.targetSeat) : null;
  const valid = candidates.find((p) => p.seat === target);
  if (valid) return valid.seat;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick ? pick.seat : seer.seat;
}

async function aiWitch(
  witch: InternalPlayer,
  game: WerewolfGame,
  killTarget: number | null,
): Promise<{ heal: boolean; poison: number | null }> {
  const celeb = witch.celebrityId ? resolveCharacter(witch.celebrityId) : undefined;
  const poisonCandidates = game.players.filter((p) => p.alive && p.seat !== witch.seat);
  const system =
    `${celeb?.persona ?? "你是一个冷静的女巫。"}\n` +
    `现在你在玩狼人杀，你是女巫。你有一瓶解药（${witch.witchHeal ? "还能用" : "已用完"}）和一瓶毒药（${witch.witchPoison ? "还能用" : "已用完"}）。` +
    `解药只能救今晚被刀的人；毒药可以毒杀任意存活玩家。谨慎使用，毒药只有一次。` +
    `只返回 JSON：{"heal": true或false, "poisonTargetSeat": 数字或null}，不要解释。`;
  const user =
    `今晚被狼人刀的人是：座位${killTarget ?? "无"}。\n` +
    `存活其他玩家：${poisonCandidates.map((p) => `座位${p.seat}=${p.nickname}`).join("，")}\n` +
    `你要怎么做？`;
  const parsed = await aiDecision(system, user, 300);
  let heal = false;
  let poison: number | null = null;
  if (parsed) {
    heal = parsed.heal === true;
    poison = asSeat(parsed.poisonTargetSeat);
    const valid = poisonCandidates.find((p) => p.seat === poison);
    if (!valid) poison = null;
  }
  return { heal, poison };
}

function fallbackSpeechText(player: InternalPlayer, game: WerewolfGame): string {
  const recent = game.log.slice(-6).map((l) => l.text).join("；");
  if (player.role === "werewolf") {
    return `我这边没什么头绪，先跟着感觉走，白天多听听大家怎么说。${recent ? `（刚才：${recent}）` : ""}`;
  }
  return `我是好人，目前信息还不够，先观察一下大家的发言。${recent ? `（刚才：${recent}）` : ""}`;
}

function describeDayActions(game: WerewolfGame): string {
  if (game.dayState.dayActions.length === 0) return "目前还没有人打出动作牌。";
  return game.dayState.dayActions
    .map((r) => {
      const who = `座位${r.seat}（${r.nickname}）`;
      const a = r.action;
      switch (a.kind) {
        case "claim_role": return `${who} 跳了${roleLabel(a.role)}`;
        case "report_check": return `${who} 报查验：${a.seat + 1}号是${a.isWolf ? "狼人" : "好人"}`;
        case "suspect": return `${who} 怀疑${a.seat + 1}号${a.reason ? `（${a.reason}）` : ""}`;
        case "defend": return `${who} 为${a.seat + 1}号辩护`;
        case "pass": return `${who} 划水过`;
        default: return who;
      }
    })
    .join("；");
}

function roleLabel(role: WerewolfRole): string {
  return role === "seer" ? "预言家" : role === "witch" ? "女巫" : role === "hunter" ? "猎人" : "村民";
}

async function aiSpeech(speaker: InternalPlayer, game: WerewolfGame): Promise<string> {
  const celeb = speaker.celebrityId ? resolveCharacter(speaker.celebrityId) : undefined;
  const publicLog = game.log.slice(-10).map((l) => l.text).join("；");
  const actions = describeDayActions(game);
  const roleHint =
    speaker.role === "werewolf"
      ? "你是狼人，必须伪装成好人，不要暴露身份，可以适当分析或误导。"
      : speaker.role === "seer"
        ? "你是预言家，可以根据昨夜的查验结果选择是否跳明身份。"
        : "你是好人阵营，认真分析局势、找出狼人。";
  const system =
    `${celeb?.persona ?? "你是一个参与狼人杀的玩家。"}\n` +
    `现在你在玩狼人杀的白天自由发言环节。${roleHint}\n` +
    `【场上动作牌】${actions}\n` +
    `【硬性要求】请用 2-4 句话发言，不超过 200 字，可以针对动作牌里怀疑你的人直接反驳，像真人在圆桌讨论，不要长篇大论。` +
    `只返回 JSON：{"text": "你的发言"}，不要解释。`;
  const user = `第 ${game.day} 天，存活玩家：${describePlayers(game)}。\n之前发生：${publicLog || "无"}。\n请发言。`;
  const parsed = await aiDecision(system, user, 300);
  if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
    let text = parsed.text.trim().replace(/^[""「『]|[""」』]$/g, "");
    if (text.length > 200) text = `${text.slice(0, 200)}…`;
    return text;
  }
  return fallbackSpeechText(speaker, game);
}

async function aiVote(voter: InternalPlayer, game: WerewolfGame): Promise<number | null> {
  const celeb = voter.celebrityId ? resolveCharacter(voter.celebrityId) : undefined;
  const candidates = game.players.filter((p) => p.alive && p.seat !== voter.seat);
  const system =
    `${celeb?.persona ?? "你是一个参与狼人杀的玩家。"}\n` +
    `现在是白天投票放逐环节。${voter.role === "werewolf" ? "你是狼人，请尽量把好人投出去。" : "你是好人，请投票放逐你认为最像狼的人。"}` +
    `可以弃权（返回 null）。只返回 JSON：{"targetSeat": 数字或null}，不要解释。`;
  const user = `存活玩家：${candidates.map((p) => `座位${p.seat}=${p.nickname}`).join("，")}\n之前发言与事件：${game.log.slice(-8).map((l) => l.text).join("；")}\n你投谁？`;
  const parsed = await aiDecision(system, user, 300);
  if (parsed && parsed.targetSeat != null) {
    const target = asSeat(parsed.targetSeat);
    const valid = candidates.find((p) => p.seat === target);
    if (valid) return valid.seat;
  }
  // 兜底：50% 随机投一名存活玩家，50% 弃权。
  if (Math.random() < 0.5 && candidates.length) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return pick.seat;
  }
  return null;
}

async function aiHunterShot(hunter: InternalPlayer, game: WerewolfGame): Promise<number | null> {
  const celeb = hunter.celebrityId ? resolveCharacter(hunter.celebrityId) : undefined;
  const candidates = game.players.filter((p) => p.alive);
  const system =
    `${celeb?.persona ?? "你是一个猎人。"}\n` +
    `你在出局前可以开最后一枪带走任意一名存活玩家。谨慎选择。只返回 JSON：{"targetSeat": 数字或null}，不要解释。`;
  const user = `存活玩家：${candidates.map((p) => `座位${p.seat}=${p.nickname}`).join("，")}\n你要带走谁？`;
  const parsed = await aiDecision(system, user, 300);
  if (parsed) {
    const target = asSeat(parsed.targetSeat);
    const valid = candidates.find((p) => p.seat === target);
    if (valid) return valid.seat;
  }
  if (candidates.length) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return pick.seat;
  }
  return null;
}

// ===== 等待真人行动（超时兜底）=====
function waitForRealWolfVotes(game: WerewolfGame, realWolves: InternalPlayer[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const needed = realWolves.length;
    const done = new Set<number>();
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.wolf = undefined;
      resolve();
    }, ms);
    registerTimer(game, timer);
    game.awaiters.wolf = {
      onVote: (seat) => {
        done.add(seat);
        if (done.size >= needed) {
          clearTimeout(timer);
          game.awaiters.wolf = undefined;
          resolve();
        }
      },
    };
  });
}

function waitForRealSeer(game: WerewolfGame, seerSeat: number, ms: number): Promise<number> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.seer = undefined;
      const cands = game.players.filter((p) => p.alive && p.seat !== seerSeat);
      const pick = cands[Math.floor(Math.random() * cands.length)];
      resolve(pick ? pick.seat : seerSeat);
    }, ms);
    registerTimer(game, timer);
    game.awaiters.seer = {
      resolve: (seat) => {
        clearTimeout(timer);
        game.awaiters.seer = undefined;
        resolve(seat);
      },
    };
  });
}

function waitForRealWitch(game: WerewolfGame, ms: number): Promise<{ heal: boolean; poison: number | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.witch = undefined;
      resolve({ heal: false, poison: null });
    }, ms);
    registerTimer(game, timer);
    game.awaiters.witch = {
      resolve: (r) => {
        clearTimeout(timer);
        game.awaiters.witch = undefined;
        resolve(r);
      },
    };
  });
}

function waitForRealHunter(game: WerewolfGame, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.hunter = undefined;
      const cands = game.players.filter((p) => p.alive);
      const pick = cands.length ? cands[Math.floor(Math.random() * cands.length)] : undefined;
      resolve(pick ? pick.seat : null);
    }, ms);
    registerTimer(game, timer);
    game.awaiters.hunter = {
      resolve: (seat) => {
        clearTimeout(timer);
        game.awaiters.hunter = undefined;
        resolve(seat);
      },
    };
  });
}

function waitForRealSpeech(game: WerewolfGame, speaker: InternalPlayer, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.speech = undefined;
      resolve(fallbackSpeechText(speaker, game));
    }, ms);
    registerTimer(game, timer);
    game.awaiters.speech = {
      resolve: (text) => {
        clearTimeout(timer);
        game.awaiters.speech = undefined;
        const clean = text.trim().replace(/\s+/g, " ").slice(0, 200);
        resolve(clean || fallbackSpeechText(speaker, game));
      },
    };
  });
}

function waitForRealVotes(game: WerewolfGame, realVoters: InternalPlayer[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const needed = realVoters.length;
    const done = new Set<number>();
    const timer = setTimeout(() => {
      clearTimeout(timer);
      game.awaiters.vote = undefined;
      resolve();
    }, ms);
    registerTimer(game, timer);
    game.awaiters.vote = {
      onVote: (seat) => {
        done.add(seat);
        if (done.size >= needed) {
          clearTimeout(timer);
          game.awaiters.vote = undefined;
          resolve();
        }
      },
    };
  });
}

// ===== 夜晚流程 =====
function resolveWolfKillTarget(game: WerewolfGame): number | null {
  const tally = new Map<number, number>();
  for (const t of game.nightState.wolfVotes.values()) {
    tally.set(t, (tally.get(t) ?? 0) + 1);
  }
  let target: number | null = null;
  let max = 0;
  for (const [t, c] of tally) {
    if (c > max) { max = c; target = t; }
    else if (c === max) target = null; // 平票
  }
  if (target != null) return target;
  const candidates = aliveNonWolves(game);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick.seat;
}

async function runNight(game: WerewolfGame): Promise<void> {
  if (game.phase === "ended") return;
  game.phase = "night";
  game.nightStage = "wolf";
  game.nightState = { wolfVotes: new Map(), killTarget: null, seerCheck: null, witchHeal: false, witchPoisonTarget: null };
  for (const p of game.players) p.nightMicroUsed = false;
  broadcastFn(game.gameId, { type: "phase_change", phase: "night", day: game.day });
  addLog(game, `第 ${game.day} 天夜晚降临，狼人请睁眼。`);
  pushSnapshotsAll(game);

  // 1) 狼人刀人
  const wolves = game.players.filter((p) => p.alive && p.role === "werewolf");
  for (const w of wolves) {
    if (w.isAI) {
      const target = await aiWolfKill(w, game);
      game.nightState.wolfVotes.set(w.seat, target);
    }
  }
  const realWolves = wolves.filter((w) => !w.isAI);
  if (realWolves.length) {
    pushSnapshotsAll(game);
    await waitForRealWolfVotes(game, realWolves, WOLF_TIMEOUT);
  }
  game.nightState.killTarget = resolveWolfKillTarget(game);

  // 2) 预言家查验
  game.nightStage = "seer";
  pushSnapshotsAll(game);
  const seer = game.players.find((p) => p.alive && p.role === "seer");
  if (seer) {
    let checkTarget: number;
    if (seer.isAI) {
      checkTarget = await aiSeerCheck(seer, game);
    } else {
      pushSnapshot(game, seer.userId);
      checkTarget = await waitForRealSeer(game, seer.seat, SEER_TIMEOUT);
    }
    game.nightState.seerCheck = checkTarget;
    const target = playerAt(game, checkTarget);
    if (target) {
      const isWolf = target.role === "werewolf";
      game.seerResults.push({ seat: checkTarget, isWolf, day: game.day });
      addLog(game, `预言家查验了 ${target.nickname}。`);
    }
  }

  // 3) 女巫用药
  game.nightStage = "witch";
  pushSnapshotsAll(game);
  const witch = game.players.find((p) => p.alive && p.role === "witch");
  if (witch) {
    let heal = false;
    let poison: number | null = null;
    if (witch.isAI) {
      const r = await aiWitch(witch, game, game.nightState.killTarget);
      heal = r.heal;
      poison = r.poison;
    } else {
      pushSnapshot(game, witch.userId);
      const r = await waitForRealWitch(game, WITCH_TIMEOUT);
      heal = r.heal;
      poison = r.poison;
    }
    // 校验药水是否还在。
    if (heal && !witch.witchHeal) heal = false;
    if (heal) witch.witchHeal = false;
    if (poison != null && !witch.witchPoison) poison = null;
    if (poison != null) {
      const tp = playerAt(game, poison);
      if (!tp || !tp.alive || poison === witch.seat) poison = null;
      else witch.witchPoison = false;
    }
    game.nightState.witchHeal = heal;
    game.nightState.witchPoisonTarget = poison;
  }
  game.nightStage = "done";

  // 结算夜晚死亡。
  const deaths: number[] = [];
  const killTarget = game.nightState.killTarget;
  if (killTarget != null) {
    if (game.nightState.witchHeal) {
      const kp = playerAt(game, killTarget);
      addLog(game, `${kp?.nickname ?? "某位玩家"} 被女巫的解药救回。`);
    } else {
      deaths.push(killTarget);
    }
  }
  if (game.nightState.witchPoisonTarget != null) {
    deaths.push(game.nightState.witchPoisonTarget);
  }
  game.lastNightDeaths = deaths;

  await runDayAnnounce(game);
}

// ===== 死亡处理 + 猎人开枪 =====
async function killAndResolveHunter(
  game: WerewolfGame,
  seats: number[],
  cause: "night" | "lynch" | "hunter_shot",
): Promise<void> {
  const names: string[] = [];
  for (const s of seats) {
    const p = playerAt(game, s);
    if (!p || !p.alive) continue;
    p.alive = false;
    p.hasSpoken = false;
    p.deathDay = game.day;
    // Round2：出局即加入幽灵观众列表（不离开游戏，可看完全程）。
    game.spectators.add(p.seat);
    names.push(p.nickname);
    broadcastFn(game.gameId, { type: "spectator_notify", seat: s, day: game.day });
  }
  if (names.length) {
    const verb = cause === "night" ? "在夜晚倒下" : cause === "lynch" ? "被投票放逐" : "被猎人带走";
    addLog(game, `${names.join("、")} ${verb}，化为幽灵观战本局。`);
  }
  if (seats.length) {
    broadcastFn(game.gameId, { type: "death", seats, cause });
  }
  pushSnapshotsAll(game);

  // 猎人若在本批死亡中，触发开枪。
  const hunter = game.players.find((p) => p.role === "hunter");
  if (hunter && !hunter.alive && seats.includes(hunter.seat)) {
    game.hunterPending = hunter.seat;
    pushSnapshot(game, hunter.userId);
    let shotTarget: number | null;
    if (hunter.isAI) {
      shotTarget = await aiHunterShot(hunter, game);
    } else {
      shotTarget = await waitForRealHunter(game, HUNTER_TIMEOUT);
    }
    game.hunterPending = null;
    if (shotTarget != null) {
      const t = playerAt(game, shotTarget);
      if (t && t.alive) {
        t.alive = false;
        addLog(game, `猎人开枪带走了 ${t.nickname}。`);
        broadcastFn(game.gameId, { type: "death", seats: [shotTarget], cause: "hunter_shot" });
        pushSnapshotsAll(game);
      }
    }
  }
}

async function runDayAnnounce(game: WerewolfGame): Promise<void> {
  game.phase = "day_announce";
  broadcastFn(game.gameId, { type: "phase_change", phase: "day_announce", day: game.day });
  addLog(game, `天亮了，公布昨夜结果。`);

  // —— P0：把昨夜「观察」的行为线索投递为观察者的私密便签 ——
  flushObservations(game);

  if (game.lastNightDeaths.length) {
    await killAndResolveHunter(game, game.lastNightDeaths, "night");
  } else {
    addLog(game, `昨晚是平安夜，没有人死亡。`);
  }

  if (checkWin(game)) { endGame(game); return; }
  void runSpeech(game).catch((err) => console.error("[werewolf] runSpeech failed", err));
}

// ===== 白天发言（Round2：全体 90s 自由窗口，不再依次阻塞等待）=====
async function runSpeech(game: WerewolfGame): Promise<void> {
  if (game.phase === "ended") return;
  game.phase = "speech";
  game.dayState.speeches = new Map();
  game.dayState.dayActions = [];
  game.dayState.currentSpeakerSeat = undefined;
  game.speechWindowEndsAt = Date.now() + speechWindowMs;
  broadcastFn(game.gameId, { type: "phase_change", phase: "speech", day: game.day });
  addLog(game, `进入白天自由发言窗口（90s）：点左侧动作牌打标签，也可自由发言。`);
  pushSnapshotsAll(game);

  // AI 玩家在窗口内轮流发言（异步，不阻塞真人打动作牌）。
  const aiSpeakers = game.players
    .filter((p) => p.alive && p.isAI)
    .sort((a, b) => a.seat - b.seat);
  const aiSpeeches = (async () => {
    for (const sp of aiSpeakers) {
      let text: string;
      try {
        text = await aiSpeech(sp, game);
      } catch {
        text = fallbackSpeechText(sp, game);
      }
      if (game.phase !== "speech") return;
      game.dayState.speeches.set(sp.seat, text);
      sp.hasSpoken = true;
      broadcastFn(game.gameId, { type: "speech", seat: sp.seat, nickname: sp.nickname, text });
      addLog(game, `${sp.nickname} 发言：${text}`, sp.seat);
    }
  })().catch(() => {});

  // 全体自由窗口：固定等待 90s（测试缝可缩短），真人随时可发言 / 打动作牌。
  await sleep(speechWindowMs);
  // 给 AI 一个小收尾宽限（线上 AI 基本已在窗口内说完；测试里 chatProvider 永不 resolve，靠 race 兜底）。
  await Promise.race([aiSpeeches, sleep(fastModeGlobal ? 60 : 400)]);

  game.dayState.currentSpeakerSeat = undefined;
  game.speechWindowEndsAt = undefined;
  void runVote(game).catch((err) => console.error("[werewolf] runVote failed", err));
}

// ===== 投票放逐 =====
async function runVote(game: WerewolfGame): Promise<void> {
  if (game.phase === "ended") return;
  game.phase = "vote";
  game.dayState.votes = new Map();
  broadcastFn(game.gameId, { type: "phase_change", phase: "vote", day: game.day });
  addLog(game, `进入投票环节。`);

  const voters = game.players.filter((p) => p.alive);
  for (const v of voters) {
    if (v.isAI) {
      const t = await aiVote(v, game);
      game.dayState.votes.set(v.seat, t);
      broadcastFn(game.gameId, { type: "vote_cast", seat: v.seat, targetSeat: t });
    }
  }
  const realVoters = voters.filter((v) => !v.isAI);
  if (realVoters.length) {
    pushSnapshotsAll(game);
    await waitForRealVotes(game, realVoters, VOTE_TIMEOUT);
  }

  // 计票。
  const tally = new Map<number, number>();
  for (const target of game.dayState.votes.values()) {
    if (target != null) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  let lynched: number | null = null;
  let max = 0;
  for (const [t, c] of tally) {
    if (c > max) { max = c; lynched = t; }
    else if (c === max) lynched = null;
  }
  const votesRecord: Record<string, number> = {};
  for (const [seat, target] of game.dayState.votes) {
    votesRecord[String(seat)] = target ?? -1;
  }
  game.lastVoteResult = { lynchedSeat: lynched, votes: votesRecord };
  broadcastFn(game.gameId, { type: "vote_result", lynchedSeat: lynched, votes: votesRecord });

  // —— P0：统计每位真人玩家的投票正确率（投中真狼记为正确）——
  const lynchedWasWolf = lynched != null && playerAt(game, lynched)?.role === "werewolf";
  for (const [voterSeat, target] of game.dayState.votes) {
    if (target == null) continue;
    const voter = playerAt(game, voterSeat);
    if (!voter || voter.isAI) continue;
    voter.totalVotes += 1;
    if (lynched != null && target === lynched && lynchedWasWolf) {
      voter.correctVotes += 1;
      voter.quickActions.push(`第${game.day}天投票放逐狼人（${playerAt(game, lynched)?.nickname ?? "?"}）`);
    }
  }

  if (lynched != null) {
    const lp = playerAt(game, lynched);
    addLog(game, `${lp?.nickname ?? "某位玩家"} 被投票放逐。`);
    await killAndResolveHunter(game, [lynched], "lynch");
  } else {
    addLog(game, `投票平票，今天没有人出局。`);
  }

  if (checkWin(game)) { endGame(game); return; }
  // Round2：第 MAX_DAYS 天结束强制终局，避免无限对局。
  if (game.day >= MAX_DAYS) {
    game.winner = computeDeadlineWinner(game);
    addLog(game, `已达 ${MAX_DAYS} 天上限，按剩余人数裁定胜负。`);
    endGame(game);
    return;
  }
  game.day += 1;
  void runNight(game).catch((err) => console.error("[werewolf] runNight failed", err));
}

/**
 * Round2：到达天数上限后的强制裁定。
 * checkWin 已处理"狼全灭 / 狼>=好人"；此处兜底：狼只要还在场且人数占优即狼胜，否则好人胜。
 */
export function computeDeadlineWinner(game: {
  players: Array<{ alive: boolean; role: WerewolfRole }>;
}): WerewolfWinner {
  const wolves = game.players.filter((p) => p.alive && p.role === "werewolf").length;
  const good = game.players.filter((p) => p.alive && p.role !== "werewolf").length;
  return wolves >= good ? "wolf" : "good";
}

// ===== 结束 =====
function pickMvpSeat(game: WerewolfGame): number {
  // MVP：获胜阵营里投对狼最多的玩家；平局取存活者，再取小号。
  const mySide = game.winner;
  const pool = game.players.filter((p) =>
    mySide === "wolf" ? p.role === "werewolf" : p.role !== "werewolf");
  let best: InternalPlayer = pool[0] ?? game.players[0];
  for (const p of pool) {
    const score = p.correctVotes * 10 + (p.alive ? 2 : 0);
    const bestScore = best.correctVotes * 10 + (best.alive ? 2 : 0);
    if (score > bestScore) best = p;
  }
  return best?.seat ?? 0;
}

function buildHighlights(game: WerewolfGame): string[] {
  const h: string[] = [];
  h.push(game.winner === "wolf" ? "狼人阵营潜伏到最后，成功屠边。" : "好人阵营顶住压力，放逐了所有狼人。");
  const seerClaims = game.dayActionsLog.filter(
    (r) => r.action.kind === "claim_role" && (r.action as { role: string }).role === "seer");
  if (seerClaims.length >= 2) {
    h.push(`第${seerClaims[1].day}天出现对跳预言家：${seerClaims.map((c) => `${c.seat + 1}号`).join("、")}。`);
  }
  const lynchedWolf = game.log.find((l) => /被投票放逐。/.test(l.text) && l.text.includes("狼人"));
  if (lynchedWolf) h.push(`关键放逐：${lynchedWolf.text.replace("。", "")}。`);
  const hunterLog = game.log.find((l) => l.text.includes("猎人开枪"));
  if (hunterLog) h.push(`高光时刻：${hunterLog.text.replace("。", "")}。`);
  if (game.lastNightDeaths.length === 0 && game.day > 1) h.push("出现过平安夜，局势一度扑朔迷离。");
  return h.slice(0, 5);
}

function calcReasoningScore(game: WerewolfGame, me: InternalPlayer): number {
  const totalDays = Math.max(1, game.day);
  const survivedDays = me.alive ? totalDays : (me.deathDay ?? 1);
  let score = 0;
  score += Math.round((Math.min(survivedDays, totalDays) / totalDays) * 30);
  const acc = me.totalVotes > 0 ? me.correctVotes / me.totalVotes : 0;
  score += Math.round(acc * 40);
  const mySide: "wolf" | "good" = me.role === "werewolf" ? "wolf" : "good";
  if (game.winner === mySide) score += 20;
  const myActions = game.dayActionsLog.filter((r) => r.seat === me.seat).length;
  score += Math.min(10, myActions * 3);
  return Math.max(5, Math.min(100, score));
}

function buildPersonalReport(game: WerewolfGame, me: InternalPlayer, highlights: string[]): WerewolfPersonalReport {
  const mySide: "wolf" | "good" = me.role === "werewolf" ? "wolf" : "good";
  const won = game.winner === mySide;
  return {
    winner: game.winner,
    myRole: me.role,
    myKeyActions: me.quickActions.slice(-6).map((a) => ({
      day: me.deathDay ?? game.day,
      action: a,
      outcome: won ? "帮助阵营取胜" : "未能帮助阵营取胜",
    })),
    reasoningScore: calcReasoningScore(game, me),
    mvpSeat: game.mvpSeat ?? 0,
    highlights,
  };
}

function endGame(game: WerewolfGame): void {
  game.phase = "ended";
  clearAllTimers(game);
  game.mvpSeat = pickMvpSeat(game);
  const highlights = buildHighlights(game);
  addLog(game, game.winner === "wolf" ? "狼人阵营获得胜利！" : "好人阵营获得胜利！");
  broadcastFn(game.gameId, { type: "game_end", winner: game.winner, report: generateReport(game.gameId) });

  // Round2：给每位真人单独推送他的私人复盘（myRole / 推理分 / 我的关键行动都因人而异）。
  for (const p of game.players) {
    if (p.userId.startsWith("ai:")) continue;
    sendToUserFn(game.gameId, p.userId, {
      type: "werewolf_report",
      report: buildPersonalReport(game, p, highlights),
    });
  }
  pushSnapshotsAll(game);

  // 落库：记录对局结果，供"我的对局"历史查询。
  try {
    db.addWerewolfGame({
      userId: game.hostUserId,
      gameId: game.gameId,
      payload: {
        winner: game.winner,
        totalDays: game.day,
        players: game.players.map((p) => ({
          seat: p.seat,
          nickname: p.nickname,
          role: p.role,
          alive: p.alive,
        })),
      },
    });
  } catch (err) {
    console.error("[werewolf] persist game record failed", err);
  }
}

// ===== 客户端行动入口 =====
export function handleAction(gameId: string, userId: string, action: WerewolfClientAction): void {
  const game = games.get(gameId);
  if (!game || game.phase === "ended") return;
  const me = playerByUserId(game, userId);

  switch (action.type) {
    case "start_game": {
      if (game.hostUserId !== userId) return;
      startGame(gameId, userId);
      return;
    }
    case "night_kill": {
      if (!me || !me.alive || me.role !== "werewolf") return;
      if (game.phase !== "night" || game.nightStage !== "wolf") return;
      const target = Number(action.targetSeat);
      const tp = playerAt(game, target);
      if (!tp || !tp.alive || tp.role === "werewolf") return;
      game.nightState.wolfVotes.set(me.seat, target);
      game.awaiters.wolf?.onVote(me.seat);
      pushSnapshot(game, userId);
      return;
    }
    case "night_check": {
      if (!me || !me.alive || me.role !== "seer") return;
      if (game.phase !== "night" || game.nightStage !== "seer") return;
      const target = Number(action.targetSeat);
      const tp = playerAt(game, target);
      if (!tp || !tp.alive || target === me.seat) return;
      game.awaiters.seer?.resolve(target);
      return;
    }
    case "night_witch": {
      if (!me || !me.alive || me.role !== "witch") return;
      if (game.phase !== "night" || game.nightStage !== "witch") return;
      const heal = action.heal === true;
      let poison = action.poisonTargetSeat == null ? null : Number(action.poisonTargetSeat);
      if (poison != null) {
        const tp = playerAt(game, poison);
        if (!tp || !tp.alive || poison === me.seat) poison = null;
      }
      game.awaiters.witch?.resolve({ heal, poison });
      return;
    }
    case "day_speech": {
      if (!me || !me.alive) return;
      if (game.phase !== "speech") return;
      const text = (action.text ?? "").trim();
      if (!text) return;
      const clean = text.replace(/\s+/g, " ").slice(0, 200);
      game.dayState.speeches.set(me.seat, clean);
      broadcastFn(gameId, { type: "speech", seat: me.seat, nickname: me.nickname, text: clean });
      addLog(game, `${me.nickname} 发言：${clean}`, me.seat);
      return;
    }
    case "day_action": {
      const res = submitDayAction(gameId, userId, action.action);
      if (!res.ok) console.warn("[werewolf] day_action rejected:", res.message);
      return;
    }
    case "day_vote": {
      if (!me || !me.alive) return;
      if (game.phase !== "vote") return;
      if (game.dayState.votes.has(me.seat)) return;
      let target = action.targetSeat == null ? null : Number(action.targetSeat);
      if (target != null) {
        const tp = playerAt(game, target);
        if (!tp || !tp.alive || target === me.seat) target = null;
      }
      game.dayState.votes.set(me.seat, target);
      broadcastFn(gameId, { type: "vote_cast", seat: me.seat, targetSeat: target });
      game.awaiters.vote?.onVote(me.seat);
      pushSnapshot(game, userId);
      return;
    }
    case "hunter_shot": {
      if (!me) return;
      if (game.phase !== "day_announce" || game.hunterPending !== me.seat) return;
      let target = action.targetSeat == null ? null : Number(action.targetSeat);
      if (target != null) {
        const tp = playerAt(game, target);
        if (!tp || !tp.alive) target = null;
      }
      game.awaiters.hunter?.resolve(target);
      return;
    }
    case "request_snapshot": {
      if (me) pushSnapshot(game, userId);
      return;
    }
    default:
      return;
  }
}

// ===== P0：快捷动作 / 夜晚好人微操作 / 表现评分 =====

/** 把一条私密便签塞进某玩家的私人口袋（notes 接口按需 drain）。 */
function pushPrivateNote(game: WerewolfGame, userId: string, text: string): void {
  const arr = game.privateNotes.get(userId) ?? [];
  arr.push(text);
  game.privateNotes.set(userId, arr);
}

/** 天亮时把昨夜的「观察」转成行为线索，发给观察者本人。 */
function flushObservations(game: WerewolfGame): void {
  if (game.pendingObservations.length === 0) return;
  const CLUES = [
    "看起来有些紧张，眼神躲躲闪闪。",
    "夜里似乎和人交换过眼神，动作鬼鬼祟祟。",
    "表现得很镇定，但你觉得他在刻意掩饰。",
    "深夜还没睡，好像在盘算着什么。",
  ];
  for (const obs of game.pendingObservations) {
    const observer = playerAt(game, obs.observerSeat);
    const target = playerAt(game, obs.targetSeat);
    if (!observer || !target) continue;
    const clue = CLUES[Math.floor(Math.random() * CLUES.length)];
    pushPrivateNote(game, observer.userId, `你观察到 ${target.nickname}：${clue}`);
  }
  game.pendingObservations = [];
}

/**
 * 玩家发言阶段的快捷动作牌。记录到公开日志（影响 AI 上下文），
 * 同时返回一段话术模板给前端填入输入框，玩家可编辑后再发送。
 */
export function playerAction(
  gameId: string,
  userId: string,
  actionType: PlayerQuickAction,
  targetSeat?: number,
): { ok: boolean; text?: string; message?: string } {
  const game = games.get(gameId);
  if (!game || game.phase === "ended") return { ok: false, message: "对局不存在或已结束" };
  const me = playerByUserId(game, userId);
  if (!me || !me.alive) return { ok: false, message: "你已出局或不在本局" };
  if (game.phase !== "speech") return { ok: false, message: "只能在白天发言阶段使用快捷动作" };

  const target = targetSeat == null ? undefined : playerAt(game, targetSeat);

  switch (actionType) {
    case "claim_seer": {
      me.claimedSeer = true;
      me.quickActions.push("跳预言家");
      addLog(game, `${me.nickname} 跳预言家身份。`);
      // 模板：若真有验人结果则带上，否则给通用模板。
      const lastSeer = game.seerResults[game.seerResults.length - 1];
      const tmpl = lastSeer
        ? `我是预言家！昨晚验了 ${playerAt(game, lastSeer.seat)?.nickname ?? "某人"}，是${lastSeer.isWolf ? "狼人" : "好人"}。请大家跟我走。`
        : "我是预言家，请大家相信我，接下来我会逐晚验人，带好人走向胜利。";
      return { ok: true, text: tmpl };
    }
    case "accuse": {
      if (!target || !target.alive) return { ok: false, message: "请选择一名存活玩家进行查杀" };
      addLog(game, `${me.nickname} 公开查杀 ${target.nickname}，认为他是狼人。`);
      me.quickActions.push(`查杀 ${target.nickname}`);
      return { ok: true, text: `我查杀 ${target.nickname}！他的发言一直在划水、带节奏，我强烈怀疑他是狼，请大家仔细听他后面怎么辩。` };
    }
    case "rally": {
      if (!target || !target.alive) return { ok: false, message: "请选择一名要带票的目标" };
      addLog(game, `${me.nickname} 号召大家把票投给 ${target.nickname}。`);
      me.quickActions.push(`带人上票 ${target.nickname}`);
      return { ok: true, text: `我号召大家今天一起投 ${target.nickname}！理由很充分，跟着我投票的好人不会错。` };
    }
    case "defend": {
      addLog(game, `${me.nickname} 为自己辩解。`);
      me.quickActions.push("为自己辩解");
      return { ok: true, text: `我是铁好人！刚才怀疑我的人其实是在打抗推位，我从头到尾都在认真分析，我的票型大家可以盯着。` };
    }
    default:
      return { ok: false, message: "未知动作" };
  }
}

/** 夜晚好人微操作：偷听（小概率模糊信息）或观察某人（天亮后给线索）。 */
export function nightGoodAction(
  gameId: string,
  userId: string,
  action: NightGoodAction,
  targetSeat?: number,
): { ok: boolean; result?: string; message?: string } {
  const game = games.get(gameId);
  if (!game || game.phase === "ended") return { ok: false, message: "对局不存在或已结束" };
  const me = playerByUserId(game, userId);
  if (!me || !me.alive) return { ok: false, message: "你已出局或不在本局" };
  if (game.phase !== "night") return { ok: false, message: "只能在夜晚进行微操作" };
  if (me.role === "werewolf") return { ok: false, message: "狼人无需夜晚微操作" };
  if (me.nightMicroUsed) return { ok: false, message: "今晚你已经行动过了" };

  if (action === "eavesdrop") {
    me.nightMicroUsed = true;
    me.quickActions.push("夜晚偷听");
    const success = Math.random() < 0.3;
    const note = success
      ? "你凑到窗边偷听：隐约听到角落里有人压低声音商量，似乎在给谁记仇……（模糊情报，未必准）"
      : "你屏息听了半天，夜深人静，什么也没听到。";
    pushPrivateNote(game, me.userId, note);
    return { ok: true, result: note };
  }

  if (action === "observe") {
    const target = targetSeat == null ? undefined : playerAt(game, targetSeat);
    if (!target || !target.alive || target.seat === me.seat) {
      return { ok: false, message: "请选择一名其他存活玩家进行观察" };
    }
    me.nightMicroUsed = true;
    me.quickActions.push(`暗中观察 ${target.nickname}`);
    game.pendingObservations.push({ observerSeat: me.seat, targetSeat: target.seat, day: game.day });
    return { ok: true, result: `你开始悄悄留意 ${target.nickname} 的举动……明天天亮会得到一条线索。` };
  }

  return { ok: false, message: "未知微操作" };
}

/**
 * Round2：白天自由窗口内的结构化动作牌。
 * 全员广播 day_action 事件，前端在对应头像挂【被怀疑】【跳身份】等标签；
 * 同时写入 dayActionsLog，作为 AI 发言 / 投票决策的公开输入。
 */
export function submitDayAction(
  gameId: string,
  userId: string,
  action: WerewolfDayAction,
): { ok: boolean; message?: string } {
  const game = games.get(gameId);
  if (!game || game.phase === "ended") return { ok: false, message: "对局不存在或已结束" };
  const me = playerByUserId(game, userId);
  if (!me || !me.alive) return { ok: false, message: "你已出局或不在本局" };
  if (game.phase !== "speech") return { ok: false, message: "只能在白天自由发言窗口打动作牌" };

  switch (action.kind) {
    case "claim_role": {
      if (action.role === "seer") me.claimedSeer = true;
      me.quickActions.push(`起跳${roleLabel(action.role)}`);
      addLog(game, `${me.nickname} 起跳 ${roleLabel(action.role)}。`);
      break;
    }
    case "report_check": {
      if (me.role !== "seer") return { ok: false, message: "只有预言家能报查验结果" };
      const target = playerAt(game, action.seat);
      if (!target) return { ok: false, message: "目标座位不存在" };
      // 只能报自己真实验过的结果。
      const reportedSeat = action.seat;
      const reportedIsWolf = action.isWolf;
      const real = game.seerResults.find((r) => r.seat === reportedSeat);
      const isWolf = real ? real.isWolf : reportedIsWolf;
      me.quickActions.push(`报查验 ${target.nickname} 是${isWolf ? "狼人" : "好人"}`);
      addLog(game, `${me.nickname} 报查验：${target.nickname} 是${isWolf ? "狼人" : "好人"}。`);
      action = { ...action, isWolf };
      break;
    }
    case "suspect": {
      const target = playerAt(game, action.seat);
      if (!target || !target.alive || target.seat === me.seat) {
        return { ok: false, message: "请选择一名其他存活玩家进行怀疑" };
      }
      me.quickActions.push(`怀疑 ${target.nickname}`);
      addLog(game, `${me.nickname} 怀疑 ${target.nickname}。`);
      break;
    }
    case "defend": {
      const target = playerAt(game, action.seat);
      if (!target) return { ok: false, message: "请选择要辩护的玩家" };
      me.quickActions.push(`辩护 ${target.nickname}`);
      addLog(game, `${me.nickname} 为 ${target.nickname} 辩护。`);
      break;
    }
    case "pass": {
      me.quickActions.push("划水过");
      addLog(game, `${me.nickname} 划水过。`);
      break;
    }
    default:
      return { ok: false, message: "未知动作" };
  }

  const record: WerewolfDayActionRecord = {
    day: game.day,
    seat: me.seat,
    nickname: me.nickname,
    action,
  };
  game.dayState.dayActions.push(record);
  game.dayActionsLog.push(record);
  broadcastFn(game.gameId, { type: "day_action", record });
  return { ok: true };
}

/** 取走并清空某玩家的私密便签（偷听结果 / 观察线索）。 */
export function drainPrivateNotes(gameId: string, userId: string): string[] {
  const game = games.get(gameId);
  if (!game) return [];
  const arr = game.privateNotes.get(userId) ?? [];
  game.privateNotes.set(userId, []);
  return arr;
}

/** 本局表现评分：生存天数×10 + 投中狼×15 + 胜负阵营加成。 */
export function calculatePerformance(gameId: string, userId: string): WerewolfPerformance | null {
  const game = games.get(gameId);
  if (!game) return null;
  const me = playerByUserId(game, userId);
  if (!me) return null;

  const survivedDays = me.alive ? game.day : (me.deathDay ?? 1);
  const voteAccuracy = me.totalVotes > 0 ? me.correctVotes / me.totalVotes : 0;
  const mySide: "wolf" | "good" = me.role === "werewolf" ? "wolf" : "good";
  const won = game.winner != null && game.winner === mySide;

  let score = survivedDays * 10 + me.correctVotes * 15;
  if (won) score += mySide === "wolf" ? 20 : 15;

  return {
    score,
    survivedDays,
    voteAccuracy: Math.round(voteAccuracy * 100) / 100,
    correctVotes: me.correctVotes,
    totalVotes: me.totalVotes,
    won,
    side: mySide,
    keyActions: me.quickActions.slice(-6),
  };
}

// ===== 战报 =====
export function generateReport(gameId: string): WerewolfReportData {
  const game = games.get(gameId);
  const players = (game?.players ?? []).map((p) => ({
    seat: p.seat,
    nickname: p.nickname,
    role: p.role,
    survived: p.alive,
  }));
  const winner = game?.winner ?? null;
  const summary = winner === "wolf"
    ? `狼人阵营经过 ${game?.day ?? 1} 天的博弈取得胜利。`
    : winner === "good"
      ? `好人阵营成功驱逐所有狼人，历经 ${game?.day ?? 1} 天。`
      : "对局尚未结束。";
  return {
    gameId,
    setup: "9人局：3狼人 / 1预言家 / 1女巫 / 1猎人 / 3村民",
    winner,
    totalDays: game?.day ?? 1,
    players,
    summary,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Round2：按玩家视角生成私人复盘（供断线重连 / HTTP 兜底拉取）。
 * myRole / reasoningScore / myKeyActions 都因人而异，不能广播。
 */
export function generatePersonalReport(gameId: string, userId: string): WerewolfPersonalReport | null {
  const game = games.get(gameId);
  if (!game) return null;
  const me = playerByUserId(game, userId);
  if (!me) return null;
  game.mvpSeat = game.mvpSeat ?? pickMvpSeat(game);
  return buildPersonalReport(game, me, buildHighlights(game));
}
