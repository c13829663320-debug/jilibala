export const TRIAL_STAGES = ["立案", "开庭", "举证", "辩论", "判决", "执行"] as const;
export type TrialStage = typeof TRIAL_STAGES[number];
export type CourtRole = "judge" | "plaintiff" | "defendant" | "witness";
export type Emotion = "neutral" | "angry" | "surprised" | "warm";
export interface TrialEvent { type: "stage" | "dialogue" | "verdict" | "error"; stage?: TrialStage; role?: CourtRole; text?: string; emotion?: Emotion; action?: string; verdict?: Verdict; }
export interface Verdict { caseNo: string; title: string; charge: string; sentence: string; facts: string; plaintiffClaim: string; defense: string; judgeNote: string; quote: string; }

// ===== 合议庭 Bench (M6) =====
export type BenchStage = "forming" | "opening" | "debate" | "summary" | "verdict";
export type BenchStance = "plaintiff" | "defendant" | "neutral";
export type Perspective = "plaintiff" | "defendant" | "audience";

export interface BenchMember {
  celebrityId: string;
  name: string;
  title: string;
  portrait: string;
  model?: string;
  stance: BenchStance;
  seatIndex: number;
}

export interface BenchSpeech {
  id: string;
  speakerId: string;       // celebrity id, or "judge"
  speakerName: string;
  stage: BenchStage;
  text: string;
  timestamp: string;
  /** 引用了哪位名人的观点，可选 */
  references?: string;
}

export type BenchInteractionKind = "interrupt" | "question" | "call" | "evidence" | "vote";

export interface BenchInteraction {
  id: string;
  kind: BenchInteractionKind;
  text?: string;
  targetCelebrityId?: string;
  evidenceName?: string;
  vote?: "plaintiff" | "defendant";
  perspective: Perspective;
  createdAt: string;
}

/** SSE 事件：合议庭实时推送 */
export type BenchEvent =
  | { type: "stage"; stage: BenchStage }
  | { type: "bench_members"; members: BenchMember[] }
  | { type: "speech"; speech: BenchSpeech }
  | { type: "speech_start"; speakerId: string; speakerName: string }
  | { type: "user_ack"; interactionId: string; handled: boolean }
  | { type: "vote_update"; plaintiff: number; defendant: number }
  | { type: "verdict"; verdict: Verdict; transcript: BenchSpeech[] }
  | { type: "error"; message: string };

export interface BenchStartRequest {
  celebrityIds?: string[];   // 为空或不传时由 AI 自动推荐
  perspective: Perspective;
  autoSelect?: boolean;
  benchSize?: number;        // 3-5，默认 3
}

// ===== 广场 Plaza =====
export type ContentType = "text" | "closed_court" | "talkshow_clip" | "bar_quote" | "library_note" | "werewolf_report";
export type SceneId = "court" | "talkshow" | "werewolf" | "bar" | "gym" | "library";
export type ContentSort = "recommended" | "hot" | "latest";

export interface ContentComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

/** closed_court 类型内容携带的已结案法庭摘要。 */
export interface ClosedCourtData {
  caseNo: string;
  title: string;
  plaintiffClaim: string;
  defendantClaim: string;
  evidence: string;
  verdict: string;
  judgeNote: string;
  participants: number;
  closedAt: string;
}

/** talkshow_clip 类型内容携带的脱口秀精彩片段。 */
export interface TalkshowClipData {
  performer: string;
  text: string;
  audienceScore: number;
  reactions: string[];
  celebrityGuest?: string;
  createdAt: string;
}

/** bar_quote 类型内容携带的酒吧辩论金句/共识。 */
export interface BarQuoteData {
  topic: string;
  quote: string;
  speaker: string;
  side: "pro" | "con" | "bartender";
  consensus?: string;
  createdAt: string;
}

/** library_note 类型内容携带的图书馆读书笔记/金句。 */
export interface LibraryNoteData {
  celebrityId?: string;
  celebrityName?: string;
  book?: string;
  question?: string;
  answer: string;
  createdAt: string;
}

// ===== M9: 狼人杀 Werewolf =====
export type WerewolfRole = "werewolf" | "seer" | "witch" | "hunter" | "villager";
export type WerewolfPhase = "lobby" | "night" | "day_announce" | "speech" | "vote" | "ended";
export type WerewolfSide = "wolf" | "good";
export type WerewolfWinner = WerewolfSide | null;

/** 公开玩家信息（不含身份，全员可见）。 */
export interface WerewolfPublicPlayer {
  seat: number;
  userId: string;        // AI 玩家为 "ai:<seat>"
  nickname: string;
  celebrityId?: string;
  avatarType: string;
  avatarRef: string;
  alive: boolean;
  isAI: boolean;
}

/** 狼人杀公开日志条目。 */
export interface WerewolfLogEntry {
  id: string;
  day: number;
  phase: WerewolfPhase;
  text: string;
  speakerSeat?: number;
  timestamp: string;
}

/** 狼人杀战报（广场内容）。 */
export interface WerewolfReportData {
  gameId: string;
  setup: string;
  winner: WerewolfWinner;
  totalDays: number;
  players: Array<{ seat: number; nickname: string; role: WerewolfRole; survived: boolean }>;
  summary: string;
  createdAt: string;
}

/**
 * 单玩家视角快照——服务端按身份过滤后单独发给该玩家。
 * 绝不能把 myRole / wolfTeammates / seerResults 等私密字段广播给他人。
 */
export interface WerewolfPlayerSnapshot {
  gameId: string;
  phase: WerewolfPhase;
  day: number;
  players: WerewolfPublicPlayer[];
  winner: WerewolfWinner;
  currentSpeakerSeat?: number;
  lastNightDeaths: number[];
  lastVoteResult?: { lynchedSeat: number | null; votes: Record<string, number> };
  log: WerewolfLogEntry[];
  // —— 以下为该玩家私密信息，旁观者/其他玩家均为 undefined ——
  mySeat?: number;
  myRole?: WerewolfRole;
  wolfTeammates?: number[];
  wolfKillTarget?: number | null;
  seerResults?: Array<{ seat: number; isWolf: boolean; day: number }>;
  witchPotions?: { heal: boolean; poison: boolean };
  witchTonightKill?: number | null;
  /** 当前阶段该玩家需要执行的行动提示，如 "kill" | "check" | "heal_poison" | "speak" | "vote" | null */
  pendingAction?: string | null;
  actionDeadlineMs?: number;
}

/** 狼人杀广播事件（公开信息，全员含旁观可见）。 */
export type WerewolfBroadcastEvent =
  | { type: "phase_change"; phase: WerewolfPhase; day: number }
  | { type: "death"; seats: number[]; cause: "night" | "lynch" | "hunter_shot" }
  | { type: "speech"; seat: number; nickname: string; text: string }
  | { type: "vote_cast"; seat: number; targetSeat: number | null }
  | { type: "vote_result"; lynchedSeat: number | null; votes: Record<string, number> }
  | { type: "game_end"; winner: WerewolfWinner; report?: WerewolfReportData }
  | { type: "player_joined"; player: WerewolfPublicPlayer }
  | { type: "player_left"; seat: number }
  | { type: "log"; entry: WerewolfLogEntry };

/** 客户端 → 服务端 狼人杀行动。 */
export type WerewolfClientAction =
  | { type: "start_game" }
  | { type: "night_kill"; targetSeat: number }
  | { type: "night_check"; targetSeat: number }
  | { type: "night_witch"; heal: boolean; poisonTargetSeat: number | null }
  | { type: "day_speech"; text: string }
  | { type: "day_vote"; targetSeat: number | null }
  | { type: "hunter_shot"; targetSeat: number | null }
  | { type: "request_snapshot" };

export interface PlazaContent {
  id: string;
  type: ContentType;
  scene: SceneId | "all";
  author: string;
  createdAt: string;
  topics: string[];
  title: string;
  body?: string;
  court?: ClosedCourtData;
  talkshow?: TalkshowClipData;
  bar?: BarQuoteData;
  library?: LibraryNoteData;
  werewolf?: WerewolfReportData;
  caseId?: string;
  likes: number;
  dislikes: number;
  views: number;
  comments: ContentComment[];
}

export const SCENE_META: Array<{ id: SceneId; label: string; emoji: string; locked?: boolean }> = [
  { id: "court", label: "趣味法庭", emoji: "⚖️" },
  { id: "talkshow", label: "脱口秀剧场", emoji: "🎤" },
  { id: "werewolf", label: "狼人杀馆", emoji: "🐺" },
  { id: "bar", label: "酒吧辩论", emoji: "🍺" },
  { id: "gym", label: "健身房", emoji: "🏋️", locked: true },
  { id: "library", label: "图书馆", emoji: "📚" },
];

// ===== M7: 用户身份 =====
export interface User {
  userId: string;
  nickname: string;
  avatarType: 'capsule' | 'celebrity' | 'custom';
  avatarRef: string;
  createdAt: string;
}

// ===== M7: 证书 =====
export interface CertRecord {
  id: string;
  userId: string;
  caseId: string;
  caseTitle: string;
  verdict: string;
  charge?: string;
  createdAt: string;
}

// ===== M7: 消息 =====
export interface MsgRecord {
  id: string;
  userId: string;
  kind: 'court' | 'comment' | 'cert' | 'system';
  title: string;
  summary: string;
  read: boolean;
  createdAt: string;
}

// ===== M7: WebSocket 实时多人 =====
export interface WSUser {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  x: number;
  z: number;
  rotation: number;
}

export interface CourtRoomState {
  caseId: string;
  phase: 'config' | 'streaming' | 'verdict';
  members: BenchMember[];
  speeches: BenchSpeech[];
  currentStage: BenchStage;
  votes: { plaintiff: number; defendant: number };
  verdict?: Verdict;
}

// ===== M8: 通用场景房间状态 =====
export interface SceneRoomState {
  scene: SceneId;
  sessionId: string;
  phase: string;
  participants: number;
  payload?: Record<string, unknown>;
}

export type WSMessage =
  | { type: 'welcome'; roomId: string; users: WSUser[]; courtState?: CourtRoomState; sceneState?: SceneRoomState }
  | { type: 'user_joined'; user: WSUser }
  | { type: 'user_left'; userId: string }
  | { type: 'presence'; users: Array<{ userId: string; x: number; z: number; rotation: number }> }
  | { type: 'chat'; userId: string; nickname: string; text: string }
  | { type: 'user_speech'; userId: string; nickname: string; text: string }
  | { type: 'user_vote'; userId: string; vote: 'plaintiff' | 'defendant' }
  | { type: 'bench_event'; event: BenchEvent }
  | { type: 'court_snapshot'; state: CourtRoomState }
  | { type: 'scene_event'; scene: SceneId; event: Record<string, unknown> }
  | { type: 'scene_snapshot'; scene: SceneId; state: SceneRoomState }
  | { type: 'werewolf_snapshot'; snapshot: WerewolfPlayerSnapshot }
  | { type: 'werewolf_event'; event: WerewolfBroadcastEvent }
  | { type: 'werewolf_action'; action: WerewolfClientAction }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ===== 人物馆 · 真实名人 =====
export * from "./celebrities.js";
