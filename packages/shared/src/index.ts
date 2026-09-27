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
export type ContentType = "text" | "closed_court" | "talkshow_clip" | "bar_quote" | "library_note" | "werewolf_report" | "gym_checkin" | "custom_character" | "court_verdict";
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

/** custom_character 类型广场内容携带的自定义人物卡片。 */
export interface CustomCharacterCard {
  characterId: string;
  name: string;
  title: string;
  intro: string;
  portrait: string;
  model?: string;
  voice?: string;
}

// ===== M11: 健身房 Gym =====
export type GymGoal = "muscle" | "fat_loss" | "stretch" | "endurance" | "strength";
export type GymEquipmentId = "treadmill" | "dumbbell" | "bench_press" | "yoga_mat" | "rowing" | "bike";

export interface GymExercise {
  id: string;
  name: string;
  equipment?: GymEquipmentId;
  sets: number;
  reps: number;
  restSeconds: number;
  tips: string;
  safety: string;
}

export interface GymPlan {
  id: string;
  goal: GymGoal;
  title: string;
  description: string;
  exercises: GymExercise[];
  estimatedMinutes: number;
  createdAt: string;
}

export interface GymCheckinRecord {
  id: string;
  userId: string;
  planId?: string;
  exerciseId?: string;
  exerciseName?: string;
  equipment?: GymEquipmentId;
  setsCompleted: number;
  repsCompleted: number;
  durationSeconds: number;
  note?: string;
  createdAt: string;
}

export interface GymStats {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  totalCheckins: number;
  totalMinutes: number;
  lastCheckinDate: string;
}

export type GymAchievementId =
  | "first_checkin" | "streak_3" | "streak_7" | "streak_30"
  | "checkin_10" | "checkin_50" | "checkin_100"
  | "muscle_master" | "cardio_king" | "flexibility_guru";

export interface GymAchievement {
  id: GymAchievementId;
  name: string;
  description: string;
  emoji: string;
  unlockedAt?: string;
}

/** gym_checkin 类型广场内容携带的健身打卡数据。 */
export interface GymCheckinData {
  planTitle?: string;
  exerciseName?: string;
  equipment?: GymEquipmentId;
  setsCompleted: number;
  repsCompleted: number;
  durationSeconds: number;
  streakDays: number;
  celebrityCoach?: string;
  quote?: string;
  createdAt: string;
}

// ===== M14: 健身房 90 秒三关电路（纯计分逻辑，前后端共用）=====
export * from "./gym-circuit.js";

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
  /** R4-05: 统一的参与者类型（与 isAI 等价，前端真人徽章用此字段）。 */
  playerType?: ParticipantType;
}

// ===== Round2：白天自由发言窗口的结构化动作牌 =====
export type WerewolfDayAction =
  | { kind: "claim_role"; role: "seer" | "witch" | "hunter" | "villager" }
  | { kind: "report_check"; seat: number; isWolf: boolean }   // 仅预言家可用
  | { kind: "suspect"; seat: number; reason?: string }
  | { kind: "defend"; seat: number }
  | { kind: "pass" };

export interface WerewolfDayActionRecord {
  day: number;
  seat: number;        // 发起者
  nickname: string;
  action: WerewolfDayAction;
}

/** 对局结束后按玩家视角生成的复盘（私下发给本人）。 */
export interface WerewolfPersonalReport {
  winner: WerewolfWinner;
  myRole: WerewolfRole;
  myKeyActions: Array<{ day: number; action: string; outcome: string }>;
  reasoningScore: number;   // 0-100
  mvpSeat: number;
  highlights: string[];
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
  // —— Round2：白天自由发言窗口 ——
  /** 当前白天已发生的结构化动作牌（断线重连恢复标签）。 */
  dayActions?: WerewolfDayActionRecord[];
  /** 本玩家是否已是幽灵观众（出局但留在局内观战）。 */
  spectator?: boolean;
  /** 自由发言窗口关闭的时间戳（ms），前端倒计时用。 */
  speechWindowEndsAt?: number;
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
  | { type: "day_action"; record: WerewolfDayActionRecord }
  | { type: "spectator_notify"; seat: number; day: number }
  | { type: "log"; entry: WerewolfLogEntry };

/** 客户端 → 服务端 狼人杀行动。 */
export type WerewolfClientAction =
  | { type: "start_game" }
  | { type: "night_kill"; targetSeat: number }
  | { type: "night_check"; targetSeat: number }
  | { type: "night_witch"; heal: boolean; poisonTargetSeat: number | null }
  | { type: "day_speech"; text: string }
  | { type: "day_action"; action: WerewolfDayAction }
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
  gym?: GymCheckinData;
  customCharacter?: CustomCharacterCard;
  courtVerdict?: CourtVerdict;
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
  { id: "gym", label: "健身房", emoji: "🏋️" },
  { id: "library", label: "图书馆", emoji: "📚" },
];

// ===== M7: 用户身份 =====
export interface User {
  userId: string;
  nickname: string;
  avatarType: 'capsule' | 'celebrity' | 'custom' | 'photo';
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
  /** Round4 R4-02: 是否为房间房主（房主徽章） */
  isOwner?: boolean;
}

export interface CourtRoomState {
  caseId: string;
  phase: 'config' | 'streaming' | 'verdict';
  members: BenchMember[];
  speeches: BenchSpeech[];
  currentStage: BenchStage;
  votes: { plaintiff: number; defendant: number };
  verdict?: Verdict;
  /** M13: userId -> perspective，用于法庭房间视角过滤 */
  perspectives?: Record<string, Perspective>;
}

// ===== M8: 通用场景房间状态 =====
export interface SceneRoomState {
  scene: SceneId;
  sessionId: string;
  phase: string;
  participants: number;
  payload?: Record<string, unknown>;
}

// ===== 广场实时推送事件 =====
export type PlazaLiveEvent =
  | { kind: "content_created"; content: PlazaContent }
  | { kind: "reaction"; id: string; reaction: "like" | "dislike"; userId: string; likes: number; dislikes: number }
  | { kind: "comment_created"; id: string; comment: ContentComment };

// ===== 社交临场感 (social-presence): 表情/手势/口型同步 =====
// R4-08: emote 从 7 种扩充至 15 种（原 wave/nod/shake/point/clap/laugh/surprised +
// 新增 dance/bow/cheer/cry/angry/think/salute/heart）。
export type EmoteType =
  | 'wave' | 'nod' | 'shake' | 'point' | 'clap' | 'laugh' | 'surprised'
  | 'dance' | 'bow' | 'cheer' | 'cry' | 'angry' | 'think' | 'salute' | 'heart'
export type AvatarExpression = 'neutral' | 'happy' | 'surprised' | 'angry'
export type AvatarAnimation = 'idle' | 'talking' | EmoteType

/** WebRTC SDP 结构化描述（shared 包无 DOM lib，不用 RTCSessionDescriptionInit） */
export interface RtcSdpJson {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp: string
}

/** WebRTC ICE candidate 结构化描述 */
export interface RtcIceJson {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
}

/** presence 中单个玩家的扩展字段（全部可选，向后兼容） */
export interface PresenceUser {
  userId: string
  x: number
  z: number
  rotation: number
  /** 说话强度 0~1，用于远端口型驱动 */
  talkingIntensity?: number
  /** 当前动画状态 idle/talking/wave/... */
  animation?: string
  /** 表情 neutral/happy/surprised/angry */
  expression?: string
  /** 头部注视目标世界坐标 */
  headTarget?: { x: number; z: number } | null
  /**
   * R4-01: 该玩家最近一次位置更新的递增序号。
   * 客户端据此检测丢包（序号跳跃）并触发速度外推。旧服务端不发此字段，按未知处理。
   */
  seq?: number
}

/**
 * R4-01: 一条被服务端缓冲、断线期间补发的房间广播消息。
 * 结构即原 WSMessage（含 type 与各业务字段），额外打 `replayed: true` 标记，
 * 客户端据此区分「实时消息」与「断线期间补发的历史消息」（如聊天不重复弹 toast）。
 */
export type ReplayedMessage = Record<string, unknown> & { type: string; replayed: true }

/** R4-01: 会话恢复时服务端回传的玩家位置/旋转/化身快照。 */
export interface ResumedSessionState {
  userId: string
  x: number
  z: number
  rotation: number
  avatarType: string
  avatarRef: string
  nickname: string
}

export type WSMessage =
  | { type: 'welcome'; roomId: string; users: WSUser[]; courtState?: CourtRoomState; sceneState?: SceneRoomState }
  | { type: 'user_joined'; user: WSUser }
  | { type: 'user_left'; userId: string }
  | { type: 'presence'; users: PresenceUser[] }
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
  | { type: 'werewolf_report'; report: WerewolfPersonalReport }
  | { type: 'court_event'; event: CourtTrialEvent }
  | { type: 'court_perspective'; perspective: Perspective }
  | { type: 'court_snapshot_v2'; case: CourtCase }
  | { type: 'gym_state'; users: Array<{ userId: string; nickname: string; avatarType: string; avatarRef: string; x: number; z: number; rotation: number; activity?: string }>; recentCheckins: Array<{ userId: string; nickname: string; exerciseName: string; createdAt: string }> }
  | { type: 'gym_user_joined'; user: { userId: string; nickname: string; avatarType: string; avatarRef: string; x: number; z: number; rotation: number } }
  | { type: 'gym_user_left'; userId: string }
  | { type: 'gym_presence'; users: Array<{ userId: string; x: number; z: number; rotation: number; activity?: string }> }
  | { type: 'gym_cheer'; userId: string; nickname: string; text: string }
  | { type: 'gym_checkin_broadcast'; userId: string; nickname: string; exerciseName: string; createdAt: string }
  | { type: 'plaza_event'; event: PlazaLiveEvent }
  // —— 社交临场感：WebRTC 语音信令（服务端只转发，不处理内容） ——
  | { type: 'rtc_sdp'; from: string; to: string; sdp: RtcSdpJson }
  | { type: 'rtc_ice'; from: string; to: string; candidate: RtcIceJson }
  | { type: 'rtc_bye'; from: string; to: string }
  // —— 社交临场感：表情/手势/说话强度 ——
  | { type: 'emote'; userId: string; emote: EmoteType; durationMs?: number }
  | { type: 'talking'; userId: string; intensity: number }
  // ===== R4-01: 断线重连与会话恢复 =====
  /** 服务端首次连接时下发会话 token，客户端须持久化，重连时通过 ?sessionToken= 带回。 */
  | { type: 'session_token'; token: string }
  /**
   * 重连成功且 token 有效：服务端恢复该玩家在房间中的位置/旋转/化身（不再随机入场），
   * 并携带断线期间缓冲（TTL=30s）的房间广播消息，按序补发，每条打 replayed:true。
   */
  | { type: 'session_resumed'; state: ResumedSessionState; replayed: ReplayedMessage[] }
  /** 玩家 WS 断开但尚在宽限期内（默认 15s）：其他玩家仍可见其化身冻结，勿立即移除。 */
  | { type: 'player_reconnecting'; userId: string; graceMs: number }
  /** 宽限期已过、玩家确认离开：此时才真正从房间移除（与旧版 user_left 并存，旧客户端走 user_left）。 */
  | { type: 'player_left'; userId: string }
  // —— Round4 R4-03：安全模块举报（客户端→服务端，服务端记录到 reports.log 后回执） ——
  | { type: 'report_user'; targetUserId: string; reason: string; category: ReportCategory }
  | { type: 'report_ack'; accepted: boolean; reportedAt?: string }
  | { type: 'pong' }
  | { type: 'pong' }
  // —— Round4 R4-02: 房间权限系统 ——
  | { type: 'player_kicked'; userId: string; reason: string }
  | { type: 'room_owner_changed'; oldOwnerId: string; newOwnerId: string }
  | { type: 'room_lock_changed'; isLocked: boolean }
  // —— Round4 R4-04：语音不可用时的文字喊话回落（3D 头顶气泡） ——
  | { type: 'text_shout'; userId: string; nickname: string; text: string; at: number }
  // —— Round4 R4-04：客户端渲染/运行时错误上报（可选） ——
  | { type: 'client_error'; userId?: string; message: string; componentStack?: string; at: number }
  // ===== Round4 R4-05：玩法多人适配 — 真人混入 AI =====
  // —— 客户端 → 服务端 ——
  /** 法庭：真人玩家在轮到自己时提交当庭发言。 */
  | { type: 'court_player_speech'; text: string }
  /** 酒吧：真人辩手提交发言（side 标明正方/反方）。 */
  | { type: 'bar_player_speech'; side: 'pro' | 'con'; text: string }
  // —— 服务端 → 客户端（广播） ——
  /** 法庭：参与者列表（含真人徽章 playerType）。 */
  | { type: 'court_participants'; participants: GameParticipant[] }
  /** 法庭：一条当庭发言（真人或 AI，playerType 区分）。 */
  | { type: 'court_multiplayer_speech'; slotId: string; playerType: ParticipantType; nickname: string; text: string }
  /** 法庭：投票环节真人/AI 合并计票结果。 */
  | { type: 'court_multi_vote_result'; result: MultiPartyVoteResult }
  /** 酒吧：参与者列表。 */
  | { type: 'bar_participants'; participants: GameParticipant[] }
  /** 酒吧：一条辩论发言。 */
  | { type: 'bar_multiplayer_speech'; side: 'pro' | 'con'; playerType: ParticipantType; nickname: string; text: string }
  /** 酒吧：观众投票合并结果。 */
  | { type: 'bar_multi_vote_result'; result: MultiPartyVoteResult }
  // ===== Round4 R4-07：好友系统 + 私聊 + 房间 @提及 =====
  // —— 服务端 → 客户端：好友在线状态 ——
  | { type: 'friend_online'; userId: string; roomCode?: string }
  | { type: 'friend_offline'; userId: string }
  /** 新好友请求到达（推送给被请求方）。 */
  | { type: 'friend_request'; request: FriendRequest }
  /** 好友请求被接受/拒绝（推送给发起方）。 */
  | { type: 'friend_request_handled'; requestId: string; status: 'accepted' | 'rejected' }
  /** 好友被删除（推送给对方）。 */
  | { type: 'friend_removed'; userId: string }
  /** 邀请进房（推送给被邀请方）。 */
  | { type: 'friend_invite'; invite: FriendInvite }
  // —— 私聊 ——
  | { type: 'private_message'; message: PrivateMessage }
  /** 私聊发送失败（非好友/校验不通过），回送给发送方。 */
  | { type: 'private_message_error'; messageId?: string; error: string }
  /** 已读回执：conversationId 格式为 "a_b"（字典序），lastReadMessageId 为对方已读到的最后一条。 */
  | { type: 'message_read'; conversationId: string; userId: string; lastReadMessageId: string }
  /** 上线时补发离线私聊消息。 */
  | { type: 'offline_messages'; messages: PrivateMessage[] }
  // —— 房间 @提及 ——
  | { type: 'mention'; mention: MentionEvent }
  | { type: 'error'; message: string; code?: string };

// ===== Round4 R4-07：好友系统 =====
/** 好友关系中的一条记录（含在线状态快照）。 */
export interface Friend {
  userId: string
  nickname: string
  avatarType?: string
  avatarRef?: string
  status: 'online' | 'offline'
  /** 在线时所在房间码（social:<code> 的 code；其他场景房间为空）。 */
  roomCode?: string
}

/** 一条待处理的好友请求。 */
export interface FriendRequest {
  requestId: string
  fromUserId: string
  fromNickname: string
  toUserId: string
  message?: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

/** 邀请好友进房。 */
export interface FriendInvite {
  inviteId: string
  fromUserId: string
  fromNickname: string
  toUserId: string
  roomCode: string
  createdAt: string
}

/** 一条私聊消息。 */
export interface PrivateMessage {
  messageId: string
  conversationId: string
  fromUserId: string
  toUserId: string
  text: string
  timestamp: string
  /** 发送方已被对方读到的最后一条 messageId（双向维护）。 */
  readBy?: Record<string, string>
}

/** 房间内 @提及事件。 */
export interface MentionEvent {
  roomId: string
  roomCode?: string
  fromUserId: string
  fromNickname: string
  text: string
  mentionedUserIds: string[]
  timestamp: string
}

// ===== Round4 R4-03：化身换装分层系统 =====
/** 化身装备分层：每层一个可选项 id，叠加渲染。 */
export type OutfitLayer = 'base' | 'top' | 'bottom' | 'accessory' | 'hair'

/** 某一层里一个可选装备的元数据（目录用，纯展示） */
export interface OutfitOption {
  /** 装备 id（在该层内唯一） */
  id: string
  /** 中文展示名 */
  label: string
  /** 色板（程序化占位渲染时用的主色） */
  swatch: string
}

/** 当前穿戴：每层 → 选中的 option id */
export type OutfitState = Record<OutfitLayer, string>

// ===== Round4 R4-03：安全模块（静音 / 屏蔽 / 举报） =====
/** 对某玩家可执行的安全操作 */
export type SafetyAction = 'mute' | 'unmute' | 'block' | 'unblock' | 'report'

/** 举报分类（与服务端 reports.log 的 category 对齐） */
export type ReportCategory = 'harassment' | 'spam' | 'abuse' | 'cheating' | 'other'

/** 客户端发送举报时携带的结构化信息（report_user WS 消息的载荷） */
export interface ReportPayload {
  targetUserId: string
  reason: string
  category: ReportCategory
}


// ===== M13: 趣味法庭 · 全屏 3D + 完整案件状态机 =====
/** 案件状态机 */
export type CourtCaseStatus = 'DRAFT' | 'ANALYZING' | 'GENERATED' | 'CONFIRMED' | 'IN_PROGRESS' | 'JUDGING' | 'COMPLETED';

/** 证据类型 */
export type EvidenceType = 'TEXT' | 'IMAGE' | 'DOCUMENT';

/** 证据 */
export interface CourtEvidence {
  id: string;
  caseId: string;
  type: EvidenceType;
  name: string;
  content: string;
  submittedBy: 'plaintiff' | 'defendant' | 'user' | 'system';
  createdAt: string;
}

/** 结构化事实 */
export interface CourtFact {
  id: string;
  caseId: string;
  content: string;
  source: string; // 'user_input' 或 evidence id
  disputed: boolean;
  createdAt: string;
}

/** 原告/被告立场角色（法官不参与角色生成） */
export interface CourtPartyRole {
  id: string;
  caseId: string;
  side: 'plaintiff' | 'defendant';
  name: string;
  stance: string;
  persona: string;
  createdAt: string;
}

/** 双方知识库 */
export interface CourtKnowledgeBase {
  caseId: string;
  side: 'plaintiff' | 'defendant';
  facts: string[];
  evidence: string[];
  claims: string[];
  arguments: string[];
  assumptions: string[];
  opponent_arguments: string[];
  user_additions: string[];
  updatedAt: string;
}

/** 每次发言独立对象 */
export interface CourtTurn {
  id: string;
  caseId: string;
  round: number;
  turn: number;
  /** player = 玩家本人当庭发言上屏（玩家驱动庭审） */
  speaker: 'judge' | 'plaintiff' | 'defendant' | 'defender' | 'player';
  speakerId: string; // role id 或 celebrity id 或 'judge' 或 'player'
  speakerName: string;
  content: string;
  referenced_evidence: string[];
  response_to_turn_id: string | null;
  createdAt: string;
}

/** 法官持续维护的记录 */
export interface CourtRecord {
  caseId: string;
  facts: string[];
  claims: string[];
  arguments: string[];
  counter_arguments: string[];
  evidence_relations: Array<{ evidenceId: string; supports: string }>;
  unresolved: string[];
  resolved: string[];
  /** 局势优势条：原告:被告，0-100，初始 50:50，玩家行为实时影响。 */
  momentum?: { plaintiff: number; defendant: number };
  updatedAt: string;
}

/** 玩家输入 */
export interface CourtPlayerInput {
  id: string;
  caseId: string;
  userId: string;
  player_role: 'plaintiff' | 'defendant';
  type: 'argument' | 'evidence' | 'question';
  content: string;
  evidenceName?: string;
  createdAt: string;
}

/** 预制牌类型：攻击论点 / 出示证据 / 嘲讽对方 / 要求记录。 */
export type CourtCardType = 'attack' | 'evidence' | 'mock' | 'request_record';

/** 玩家打出的一张牌（用于高光时刻回放）。 */
export interface CourtPlayerMove {
  round: number;
  card: CourtCardType;
  targetEvidenceId?: string;
  freeText?: string;
  /** 实际对玩家方天平产生的增量（正=玩家方）。 */
  delta: number;
  /** 是否命中 unresolved 争议点。 */
  hit: boolean;
  judgeComment?: string;
}

/** 客户端通过 play-card 动作提交的一次出牌请求。 */
export interface CourtCardPlay {
  id: string;
  card: CourtCardType;
  targetEvidenceId?: string;
  freeText?: string;
}

/** 结构化判决 */
export interface CourtVerdict {
  id: string;
  caseId: string;
  case_summary: string;
  key_facts: string[];
  key_evidence: string[];
  plaintiff_arguments: string[];
  defendant_arguments: string[];
  judge_analysis: string;
  reasoning: string;
  verdict: 'plaintiff' | 'defendant' | 'mixed' | 'dismissed';
  conclusion: string;
  createdAt: string;
  /** LLM 写的高光时刻（服务端仅写文案，不决定胜方）。 */
  key_moments?: string[];
  /** 玩家全程打出的牌（前端据此回放高光时刻）。 */
  player_moves?: CourtPlayerMove[];
  /** 终局天平（原告:被告），由天平决定胜方。 */
  final_balance?: { plaintiff: number; defendant: number };
}

/** 完整案件对象（聚合） */
export interface CourtCase {
  id: string;
  userId: string;
  status: CourtCaseStatus;
  title: string;
  user_input: string;
  evidence: CourtEvidence[];
  facts: CourtFact[];
  dispute_points: string[];
  plaintiff: CourtPartyRole | null;
  defendant: CourtPartyRole | null;
  plaintiff_kb: CourtKnowledgeBase | null;
  defendant_kb: CourtKnowledgeBase | null;
  court_record: CourtRecord | null;
  current_round: number;
  current_turn: number;
  final_verdict: CourtVerdict | null;
  /** 玩家选择扮演的一方（玩家驱动庭审：玩家当庭发言）。 */
  player_side?: 'plaintiff' | 'defendant';
  createdAt: string;
  updatedAt: string;
}

/** SSE 事件类型 */
export type CourtTrialEvent =
  | { type: 'court_status'; status: CourtCaseStatus; round: number; turn: number }
  | { type: 'court_turn'; turn: CourtTurn }
  | { type: 'court_record'; record: CourtRecord }
  | { type: 'should_continue'; shouldContinue: boolean; unresolvedPoints: string[]; reason: string }
  | { type: 'court_verdict'; verdict: CourtVerdict }
  | { type: 'player_input_ack'; inputId: string }
  /** 轮到玩家发言：前端展开输入面板、聚焦、提示「轮到你发言」。 */
  | { type: 'player_turn_request'; round: number; side: 'plaintiff' | 'defendant' }
  /** 局势优势条更新（原告:被告，0-100）。 */
  | { type: 'momentum_update'; momentum: { plaintiff: number; defendant: number } }
  /** 玩家发言已上屏确认（speaker='player' 的 CourtTurn）。 */
  | { type: 'player_turn'; turn: CourtTurn }
  /** 天平滑动：balance 互补 0-100，lastDelta 最近一次增量（带方向），reason 口播。 */
  | { type: 'court_balance_update'; balance: { plaintiff: number; defendant: number }; lastDelta: number; reason: string }
  /** 轮到玩家出牌：推送本回合弹药、手牌、当前 unresolved，前端展开牌面。 */
  | { type: 'court_player_turn'; round: number; ammo: number; handCards: CourtCardType[]; unresolved: string[] }
  /** 一张牌结算完成：命中/未命中、delta、法官口播。 */
  | { type: 'court_card_resolved'; card: CourtCardType; hit: boolean; delta: number; judgeComment: string }
  /** 一回合结束小结：剩余 unresolved、当前天平。 */
  | { type: 'court_round_recap'; round: number; unresolved: string[]; balance: { plaintiff: number; defendant: number } }
  | { type: 'error'; message: string };

// ===== Round4 R4-05: 玩法多人适配 — 真人玩家混入 AI =====
/** 玩法参与者是真人还是 AI NPC。前端据此渲染真人徽章。 */
export type ParticipantType = "human" | "ai";

/** 通用玩法参与者（法庭 / 酒吧等多人局共用），区分真人与 AI。 */
export interface GameParticipant {
  /** 角色位 id，如 plaintiff / defendant / witness / pro-1。 */
  slotId: string;
  /** 展示名，如「原告」「反方一辩」。 */
  label: string;
  /** 真人 / AI。 */
  playerType: ParticipantType;
  /** 真人 userId（AI 无此字段）。 */
  userId?: string;
  /** 显示名（真人=昵称，AI=AI 兜底名）。 */
  nickname: string;
}

/** 一场多人局的合并投票结果（真人票 + AI 陪审员/观众票）。 */
export interface MultiPartyVoteResult {
  votes: Record<string, number>;
  humanVotes: number;
  aiVotes: number;
  leading?: string;
}

// ===== Round 3: 社交房间（真人多人同房间） =====
/** 房间所在场景：plaza 为开放广场，其余为六大场景建筑内 */
export type RoomScene = 'plaza' | SceneId;

/** 社交房间元数据（REST 返回 + WS 广播共用） */
export interface SocialRoom {
  /** 房间唯一 id，格式 social:<code> */
  id: string;
  /** 6 位大写字母数字房间码，用于邀请加入 */
  code: string;
  /** 房间名称 */
  name: string;
  /** 创建者 userId */
  creatorId: string;
  /** 创建者昵称 */
  creatorName: string;
  /** 房间场景 */
  scene: RoomScene;
  /** 最大人数（默认 16） */
  maxPlayers: number;
  /** 是否公开（公开房间出现在房间列表） */
  isPublic: boolean;
  /** 创建时间 ISO */
  createdAt: string;
  /** 当前在线人数（由 WS 实时维护，REST 查询时也返回） */
  playerCount: number;
  /** Round4 R4-02: 当前房主 userId（旧房间默认 = creatorId） */
  ownerId: string;
  /** Round4 R4-02: 房间是否锁定（锁定后拒绝新玩家加入） */
  isLocked: boolean;
  /** Round4 R4-02: 是否设有密码（列表可见，不暴露哈希） */
  hasPassword: boolean;
  /** Round4 R4-02: 密码 SHA-256 哈希（内部存储，REST 返回前必须剥离） */
  passwordHash?: string;
  /** Round4 R4-02: 密码盐（内部存储，REST 返回前必须剥离） */
  passwordSalt?: string;
}

/** 创建房间请求 */
export interface CreateRoomRequest {
  name: string;
  scene?: RoomScene;
  isPublic?: boolean;
  maxPlayers?: number;
  /** Round4 R4-02: 房间密码（明文传入，服务端哈希存储） */
  password?: string;
}

/** 房间相关 WS 消息（在已有 WSMessage 联合类型之外，通过 type 区分） */
export type SocialRoomWsMessage =
  | { type: 'room_info'; room: SocialRoom }
  | { type: 'room_player_update'; roomId: string; playerCount: number }
  | { type: 'player_kicked'; userId: string; reason: string }
  | { type: 'room_owner_changed'; oldOwnerId: string; newOwnerId: string }
  | { type: 'room_lock_changed'; isLocked: boolean };

// ===== R4-06: 玩家档案持久化字段（本地 localStorage + 服务端 JSON 双写） =====
// 注：OutfitState 复用 R4-03 已有的 `Record<OutfitLayer, string>` 类型（见上方）。

/** 玩家本地设置（音量 / 画质等）。 */
export interface PlayerSettings {
  /** 主音量 0~1 */
  volume: number;
  /** 空间语音开关 */
  voiceEnabled: boolean;
  /** 画质档位：low 跳过高分辨率纹理 / high 保持原画质 */
  quality: 'low' | 'high' | 'auto';
  /** 是否开启阴影 */
  shadows: boolean;
}

/** 多人新手引导（R4-06）完成进度。 */
export interface MultiplayerTourState {
  /** 5 步引导是否已全部完成 */
  done: boolean;
  /** 当前进行到第几步（0-based） */
  step: number;
  /** 用户主动跳过 */
  skipped: boolean;
  /** 完成时间 */
  completedAt?: string;
}

/**
 * 玩家完整档案（本地持久化 key=balabala_profile_v1）。
 * 所有字段可选/带默认值，以便老存档缺字段时向前兼容迁移。
 */
export interface PlayerProfile {
  nickname: string;
  avatarType: User['avatarType'];
  avatarRef: string;
  /** 已选换装（R4-03 outfit）；未选过的层缺省。 */
  outfit: Partial<OutfitState>;
  settings: PlayerSettings;
  multiplayerTour: MultiplayerTourState;
  /** 最近所在房间码（sessionStorage 另存一份做刷新恢复） */
  lastRoomCode: string | null;
  updatedAt: string | null;
}

// ===== R4-08: 单玩法战绩快照（每个场景一份） =====
export interface MatchStats {
  /** 总场次 */
  played: number;
  /** 胜场 */
  wins: number;
  /** 最高连胜 */
  bestStreak: number;
  /** 当前连胜 */
  currentStreak: number;
}

/** 服务端档案（apps/api/.data/profiles/<userId>.json）：跨设备/重启不丢。 */
export interface ServerProfile {
  userId: string;
  /** 经验值 */
  xp: number;
  /** 段位 */
  rank: 'rookie' | 'bronze' | 'silver' | 'gold' | 'platinum';
  /** 已解锁成就 id */
  achievements: string[];
  /** 每日挑战进度：challengeId -> 0~100 */
  dailyChallenge: Record<string, number>;
  /** R4-08: 各玩法战绩快照（court/werewolf/bar 等） */
  stats?: Partial<Record<'court' | 'werewolf' | 'bar', MatchStats>>;
  updatedAt: string;
}

// ===== R4-08: 排行榜 =====
/** 排行榜分榜维度：全服 / 法庭 / 狼人杀 / 酒吧。 */
export type LeaderboardScope = 'global' | 'court' | 'werewolf' | 'bar';

/** 排行榜单条记录（REST 返回）。 */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  xp: number;
  tier: ServerProfile['rank'];
  avatarType: string;
  avatarRef: string;
  /** 该分榜依据的战绩（global 为 xp；分榜为对应玩法胜场/胜率）。 */
  score: number;
  stats?: Partial<Record<'court' | 'werewolf' | 'bar', MatchStats>>;
}

// ===== R4-08: 活动公告 / 主题房间 =====
/** 一条可展示的活动公告（服务端聚合当前主题房间生成）。 */
export interface Announcement {
  id: string;
  title: string;
  description: string;
  /** 活动开始 ISO */
  startsAt: string;
  /** 活动结束 ISO */
  endsAt: string;
  /** 对应主题房间码（点击跳转加入）；无房间时为空串 */
  roomCode: string;
  /** 主题标签，如 #周末法庭 #狼人杀之夜 */
  tags: string[];
}

// ===== R4-08: 内容治理 =====
/** 内容治理动作结果（聊天/喊话/房间名过滤后回执给调用方）。 */
export interface ModerationAction {
  /** 原始文本是否命中敏感词 */
  hit: boolean;
  /** 过滤后的文本（命中处替换为 ***）；未命中时与原文一致 */
  text: string;
  /** 当前发送者是否被临时禁言 */
  muted: boolean;
  /** 若被禁言，禁言截止时间戳 ms */
  mutedUntil?: number;
}

// ===== 人物馆 · 真实名人 =====
export * from "./celebrities.js";
export * from "./character-voices.js";
export * from "./skill.js";

// ===== 图书馆 · 知识擂台赛 =====
export * from "./library-quiz.js";

// ===== 自定义场景工作室 =====
export * from "./scene-studio.js";

// ===== Round4 R4-09: 场景 UGC（模板市场/保存分享/CC0 道具/可拾取） =====
export * from "./scene-ugc.js";

// ===== R5-IA: 信息架构 / 导航骨架 / Shell 契约（additive） =====
export * from "./ia.js";

// ===== R5 招牌玩法/核心循环：统一长期目标线与结算契约 =====
export * from "./gameplay-loop.js";

// ===== R5: 名人关系 / 记忆 / 收集 / 邀约 / 广场偶遇（additive） =====
export * from "./celebrity-relation.js";
export * from "./celebrity-facts.js";

// ===== R5: 性能 / 稳定性域（懒加载/LOD/AI网关/崩溃恢复） =====
export * from "./perf.js";

// ===== R5 新手引导（r5-onboarding 域）：状态机类型 + 纯函数（additive） =====
export * from "./onboarding.js";

// ===== R5: 组队 / 约局（多人社交关系链） =====
// additive：仅新增，不改已有 Friend/PrivateMessage/SocialRoom 定义。
export * from "./social-party.js";

// ===== Round5 R5-UGC: 一句话造场景 / 发布分享闭环 / 照片头像化身 =====
export * from "./ugc-pipeline.js";
