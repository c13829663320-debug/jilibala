// ===== 狼人杀馆编排器 Werewolf Orchestrator (M9) =====
// 服务端唯一权威：身份与夜晚行动只存在于内存，客户端不可信任。
// AI LLM 调用严格串行，每次都有超时与规则兜底，绝不因模型异常中断游戏。
// 私密信息（myRole/wolfTeammates/seerResults/witchPotions 等）只通过 sendToUser
// 单独发给对应玩家；broadcast 只携带公开事件。
import { randomUUID } from "node:crypto";
import {
  CELEBRITIES,
  getCelebrity,
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
  type WSMessage,
} from "@balabala/shared";
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
const SPEECH_TIMEOUT = 20000;
const VOTE_TIMEOUT = 20000;
const HUNTER_TIMEOUT = 15000;
const AI_CALL_GAP = 150; // AI LLM 调用之间的礼让间隔，避免 StepFun 限流

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
  };
  seerResults: Array<{ seat: number; isWolf: boolean; day: number }>;
  hunterPending: number | null;
  lastNightDeaths: number[];
  lastVoteResult?: { lynchedSeat: number | null; votes: Record<string, number> };
  log: WerewolfLogEntry[];
  winner: WerewolfWinner;
  timers: Set<ReturnType<typeof setTimeout>>;
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
    dayState: { speeches: new Map(), votes: new Map() },
    seerResults: [],
    hunterPending: null,
    lastNightDeaths: [],
    log: [],
    winner: null,
    timers: new Set(),
    awaiters: {},
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
  });

  game.phase = "night";
  game.nightStage = "wolf";
  game.day = 1;
  game.nightState = { wolfVotes: new Map(), killTarget: null, seerCheck: null, witchHeal: false, witchPoisonTarget: null };
  game.dayState = { speeches: new Map(), votes: new Map() };
  game.seerResults = [];
  game.hunterPending = null;
  game.lastNightDeaths = [];

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

  const me = playerByUserId(game, userId);
  if (!me) return base; // 旁观者：无任何私密字段

  base.mySeat = me.seat;
  base.myRole = me.role;

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
    if (game.dayState.currentSpeakerSeat === me.seat) return "speak";
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
  await sleep(AI_CALL_GAP);
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
  const celeb = wolf.celebrityId ? getCelebrity(wolf.celebrityId) : undefined;
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
  const celeb = seer.celebrityId ? getCelebrity(seer.celebrityId) : undefined;
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
  const celeb = witch.celebrityId ? getCelebrity(witch.celebrityId) : undefined;
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

async function aiSpeech(speaker: InternalPlayer, game: WerewolfGame): Promise<string> {
  const celeb = speaker.celebrityId ? getCelebrity(speaker.celebrityId) : undefined;
  const publicLog = game.log.slice(-10).map((l) => l.text).join("；");
  const roleHint =
    speaker.role === "werewolf"
      ? "你是狼人，必须伪装成好人，不要暴露身份，可以适当分析或误导。"
      : speaker.role === "seer"
        ? "你是预言家，可以根据昨夜的查验结果选择是否跳明身份。"
        : "你是好人阵营，认真分析局势、找出狼人。";
  const system =
    `${celeb?.persona ?? "你是一个参与狼人杀的玩家。"}\n` +
    `现在你在玩狼人杀的白天发言环节。${roleHint}发言 1-2 句话，简短、有观点、像真人。` +
    `只返回 JSON：{"text": "你的发言"}，不要解释。`;
  const user = `第 ${game.day} 天，存活玩家：${describePlayers(game)}。\n之前发生：${publicLog || "无"}。\n请发言。`;
  const parsed = await aiDecision(system, user, 500);
  if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
    let text = parsed.text.trim().replace(/^[""「『]|[""」』]$/g, "");
    if (text.length > 120) text = `${text.slice(0, 120)}…`;
    return text;
  }
  return fallbackSpeechText(speaker, game);
}

async function aiVote(voter: InternalPlayer, game: WerewolfGame): Promise<number | null> {
  const celeb = voter.celebrityId ? getCelebrity(voter.celebrityId) : undefined;
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
  const celeb = hunter.celebrityId ? getCelebrity(hunter.celebrityId) : undefined;
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
    names.push(p.nickname);
  }
  if (names.length) {
    const verb = cause === "night" ? "在夜晚倒下" : cause === "lynch" ? "被投票放逐" : "被猎人带走";
    addLog(game, `${names.join("、")} ${verb}。`);
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

  if (game.lastNightDeaths.length) {
    await killAndResolveHunter(game, game.lastNightDeaths, "night");
  } else {
    addLog(game, `昨晚是平安夜，没有人死亡。`);
  }

  if (checkWin(game)) { endGame(game); return; }
  void runSpeech(game).catch((err) => console.error("[werewolf] runSpeech failed", err));
}

// ===== 白天发言 =====
async function runSpeech(game: WerewolfGame): Promise<void> {
  if (game.phase === "ended") return;
  game.phase = "speech";
  game.dayState.speeches = new Map();
  broadcastFn(game.gameId, { type: "phase_change", phase: "speech", day: game.day });
  addLog(game, `进入白天发言环节。`);

  const speakers = game.players
    .filter((p) => p.alive)
    .sort((a, b) => a.seat - b.seat);

  for (const sp of speakers) {
    game.dayState.currentSpeakerSeat = sp.seat;
    pushSnapshotsAll(game);
    let text: string;
    if (sp.isAI) {
      text = await aiSpeech(sp, game);
    } else {
      pushSnapshot(game, sp.userId);
      text = await waitForRealSpeech(game, sp, SPEECH_TIMEOUT);
    }
    game.dayState.speeches.set(sp.seat, text);
    sp.hasSpoken = true;
    broadcastFn(game.gameId, { type: "speech", seat: sp.seat, nickname: sp.nickname, text });
    addLog(game, `${sp.nickname} 发言：${text}`, sp.seat);
  }

  game.dayState.currentSpeakerSeat = undefined;
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

  if (lynched != null) {
    const lp = playerAt(game, lynched);
    addLog(game, `${lp?.nickname ?? "某位玩家"} 被投票放逐。`);
    await killAndResolveHunter(game, [lynched], "lynch");
  } else {
    addLog(game, `投票平票，今天没有人出局。`);
  }

  if (checkWin(game)) { endGame(game); return; }
  game.day += 1;
  void runNight(game).catch((err) => console.error("[werewolf] runNight failed", err));
}

// ===== 结束 =====
function endGame(game: WerewolfGame): void {
  game.phase = "ended";
  clearAllTimers(game);
  const report = generateReport(game.gameId);
  addLog(game, game.winner === "wolf" ? "狼人阵营获得胜利！" : "好人阵营获得胜利！");
  broadcastFn(game.gameId, { type: "game_end", winner: game.winner, report });
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
      if (game.phase !== "speech" || game.dayState.currentSpeakerSeat !== me.seat) return;
      const text = (action.text ?? "").trim();
      if (!text) return;
      game.awaiters.speech?.resolve(text);
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
