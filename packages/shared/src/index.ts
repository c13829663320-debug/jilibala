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
export type ContentType = "text" | "closed_court";
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
  caseId?: string;
  likes: number;
  dislikes: number;
  views: number;
  comments: ContentComment[];
}

export const SCENE_META: Array<{ id: SceneId; label: string; emoji: string; locked?: boolean }> = [
  { id: "court", label: "趣味法庭", emoji: "⚖️" },
  { id: "talkshow", label: "脱口秀剧场", emoji: "🎤", locked: true },
  { id: "werewolf", label: "狼人杀馆", emoji: "🐺", locked: true },
  { id: "bar", label: "酒吧辩论", emoji: "🍺", locked: true },
  { id: "gym", label: "健身房", emoji: "🏋️", locked: true },
  { id: "library", label: "图书馆", emoji: "📚", locked: true },
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

export type WSMessage =
  | { type: 'welcome'; roomId: string; users: WSUser[]; courtState?: CourtRoomState }
  | { type: 'user_joined'; user: WSUser }
  | { type: 'user_left'; userId: string }
  | { type: 'presence'; users: Array<{ userId: string; x: number; z: number; rotation: number }> }
  | { type: 'chat'; userId: string; nickname: string; text: string }
  | { type: 'user_speech'; userId: string; nickname: string; text: string }
  | { type: 'user_vote'; userId: string; vote: 'plaintiff' | 'defendant' }
  | { type: 'bench_event'; event: BenchEvent }
  | { type: 'court_snapshot'; state: CourtRoomState }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ===== 人物馆 · 真实名人 =====
export * from "./celebrities.js";
