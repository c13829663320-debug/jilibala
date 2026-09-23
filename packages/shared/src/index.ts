export const TRIAL_STAGES = ["立案", "开庭", "举证", "辩论", "判决", "执行"] as const;
export type TrialStage = typeof TRIAL_STAGES[number];
export type CourtRole = "judge" | "plaintiff" | "defendant" | "witness";
export type Emotion = "neutral" | "angry" | "surprised" | "warm";
export interface TrialEvent { type: "stage" | "dialogue" | "verdict" | "error"; stage?: TrialStage; role?: CourtRole; text?: string; emotion?: Emotion; action?: string; verdict?: Verdict; }
export interface Verdict { caseNo: string; title: string; charge: string; sentence: string; facts: string; plaintiffClaim: string; defense: string; judgeNote: string; quote: string; }

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
