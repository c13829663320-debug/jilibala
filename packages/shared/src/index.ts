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

// ===== 人物馆 · 真实名人 =====
export * from "./celebrities.js";
