// ===== M11: 健身房编排器 Gym Orchestrator =====
// 纯函数逻辑：训练计划生成、连续打卡天数计算、成就解锁判定。
// 不依赖 DB / 网络 / LLM，可被 Vitest 直接测试。
import { randomUUID } from "node:crypto";
import type {
  GymGoal,
  GymExercise,
  GymPlan,
  GymAchievementId,
} from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";

// ===== 连续打卡天数计算 =====

/** 将 ISO 时间字符串转为本地日期 key（YYYY-MM-DD）。 */
function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地日期 key → 当地午夜 Date 对象（用于精确差值计算，跨月/跨年安全）。 */
function localDateToMidnight(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const DAY_MS = 86_400_000;

/**
 * 输入 ISO 日期字符串数组，按本地日期去重排序后计算：
 * - current: 当前连续打卡天数。今天没打卡则从昨天算起（昨天+前天=2）。
 * - longest: 历史最长连续天数。
 */
export function calculateStreak(checkinDates: string[]): { current: number; longest: number } {
  if (!checkinDates || checkinDates.length === 0) return { current: 0, longest: 0 };

  const dateKeys = [...new Set(checkinDates.map(toLocalDateKey))].sort();
  const dates = dateKeys.map(localDateToMidnight);
  const dateTimes = new Set(dates.map((d) => d.getTime()));

  // 最长连续
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].getTime() - dates[i - 1].getTime() === DAY_MS) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // 当前连续：从今天或昨天向前追溯
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hasToday = dateTimes.has(todayMidnight);
  let current = 0;
  let cursor = hasToday ? todayMidnight : todayMidnight - DAY_MS;
  while (dateTimes.has(cursor)) {
    current++;
    cursor -= DAY_MS;
  }

  return { current, longest };
}

// ===== 训练计划生成（内置模板，确定性） =====

type Level = "beginner" | "intermediate" | "advanced";

interface ExerciseTemplate {
  name: string;
  equipment?: GymExercise["equipment"];
  sets: number;
  reps: number;
  restSeconds: number;
  tips: string;
  safety: string;
}

const PLAN_TEMPLATES: Record<GymGoal, { title: string; description: string; exercises: ExerciseTemplate[] }> = {
  muscle: {
    title: "增肌塑形计划",
    description: "以复合动作为核心，渐进超负荷，刺激肌肉生长。",
    exercises: [
      { name: "杠铃卧推", equipment: "bench_press", sets: 4, reps: 8, restSeconds: 90, tips: "下放至胸中部，推起时呼气", safety: "肩胛收紧，不要锁死肘关节" },
      { name: "哑铃划船", equipment: "dumbbell", sets: 4, reps: 10, restSeconds: 75, tips: "肘部贴身，顶峰收缩挤压背部", safety: "保持背部平直，不要弓腰" },
      { name: "深蹲", equipment: "dumbbell", sets: 4, reps: 10, restSeconds: 90, tips: "膝与脚尖同向，蹲至大腿平行地面", safety: "重心在脚掌中部，膝盖不内扣" },
      { name: "哑铃肩推", equipment: "dumbbell", sets: 3, reps: 12, restSeconds: 75, tips: "核心收紧，推过头顶不后仰", safety: "不要用腰部借力" },
      { name: "杠铃硬拉", equipment: "bench_press", sets: 3, reps: 8, restSeconds: 120, tips: "背部绷紧，沿腿部提拉", safety: "用腿发力，不要弯腰拉起" },
    ],
  },
  fat_loss: {
    title: "燃脂塑形计划",
    description: "力量+有氧组合，提升代谢，高效燃脂。",
    exercises: [
      { name: "跑步机快走", equipment: "treadmill", sets: 1, reps: 1, restSeconds: 60, tips: "坡度 5-8，速度 5-6 km/h", safety: "抓紧扶手起步，避免摔倒" },
      { name: "哑铃弓步蹲", equipment: "dumbbell", sets: 3, reps: 12, restSeconds: 60, tips: "前膝不超脚尖，躯干直立", safety: "步幅适中，保持平衡" },
      { name: "动感单车", equipment: "bike", sets: 1, reps: 1, restSeconds: 60, tips: " resistance 中等，保持 30-45rpm", safety: "调整座椅高度，膝盖不锁死" },
      { name: "哑铃推举", equipment: "dumbbell", sets: 3, reps: 15, restSeconds: 45, tips: "轻重量多次数，保持心率", safety: "核心稳定，不要借力摆动" },
      { name: "划船机", equipment: "rowing", sets: 1, reps: 1, restSeconds: 60, tips: "先腿蹬再手拉，节奏 22-26", safety: "不要过度后仰，腰背平直" },
    ],
  },
  stretch: {
    title: "柔韧拉伸计划",
    description: "全身拉伸放松，改善关节活动度，缓解久坐疲劳。",
    exercises: [
      { name: "猫牛式伸展", equipment: "yoga_mat", sets: 2, reps: 10, restSeconds: 30, tips: "吸气塌腰抬头，呼气弓背低头", safety: "动作缓慢，不要用力过猛" },
      { name: "下犬式", equipment: "yoga_mat", sets: 2, reps: 30, restSeconds: 30, tips: "坐骨上提，脚跟踩地", safety: "微屈膝盖，不要强迫伸直" },
      { name: "股四头肌拉伸", equipment: "yoga_mat", sets: 2, reps: 30, restSeconds: 20, tips: "站立单腿抓脚，膝盖指向地面", safety: "保持平衡，扶墙辅助" },
      { name: "臀部拉伸", equipment: "yoga_mat", sets: 2, reps: 30, restSeconds: 20, tips: "仰卧4字拉伸，抱大腿后侧", safety: "不要猛拉，感受拉伸即可" },
      { name: "肩部拉伸", equipment: "yoga_mat", sets: 2, reps: 20, restSeconds: 20, tips: "手臂横过胸前，另臂按压", safety: "不要压关节，只拉伸肌肉" },
    ],
  },
  endurance: {
    title: "心肺耐力计划",
    description: "中等强度持续有氧，提升心肺功能和耐力。",
    exercises: [
      { name: "跑步机慢跑", equipment: "treadmill", sets: 1, reps: 20, restSeconds: 60, tips: "速度 8-10 km/h，保持能说话但不能唱歌", safety: "先热身 5 分钟，逐步提速" },
      { name: "划船机", equipment: "rowing", sets: 4, reps: 5, restSeconds: 45, tips: "2000m 分段，保持稳定配速", safety: "动作规范，避免腰部代偿" },
      { name: "动感单车", equipment: "bike", sets: 3, reps: 5, restSeconds: 45, tips: "HIIT 间歇：快 1min + 慢 1min", safety: "调整座椅，膝盖不超过脚尖" },
      { name: "跑步机爬坡走", equipment: "treadmill", sets: 1, reps: 15, restSeconds: 60, tips: "坡度 10-12，速度 4-5 km/h", safety: "不要扶扶手，保持自然摆臂" },
      { name: "跳绳", equipment: "treadmill", sets: 5, reps: 1, restSeconds: 30, tips: "每次 1 分钟，前脚掌落地", safety: "穿缓冲鞋，在软垫上进行" },
    ],
  },
  strength: {
    title: "力量基础计划",
    description: "以大重量复合动作为核心，建立基础力量。",
    exercises: [
      { name: "杠铃深蹲", equipment: "bench_press", sets: 5, reps: 5, restSeconds: 180, tips: "重心稳定，蹲至大腿平行", safety: "使用保护架，不要 solo 大重量" },
      { name: "硬拉", equipment: "bench_press", sets: 5, reps: 5, restSeconds: 180, tips: "背部绷紧，髋部驱动", safety: "腰带保护，动作变形即停" },
      { name: "卧推", equipment: "bench_press", sets: 5, reps: 5, restSeconds: 150, tips: "控制下落，胸发力推起", safety: "务必有保护者，不要 solo" },
      { name: "哑铃划船", equipment: "dumbbell", sets: 4, reps: 8, restSeconds: 90, tips: "肘部贴身，顶峰收缩", safety: "核心稳定，不要扭转腰部" },
      { name: "哑铃肩推", equipment: "dumbbell", sets: 4, reps: 8, restSeconds: 90, tips: "坐姿有靠背，推起不锁肘", safety: "不要后仰借力，核心收紧" },
    ],
  },
};

/** 根据目标和等级生成训练计划（内置模板，不调用 LLM）。 */
export function generatePlan(
  goal: GymGoal,
  level: Level = "beginner",
  durationMinutes = 30,
): GymPlan {
  const tmpl = PLAN_TEMPLATES[goal] ?? PLAN_TEMPLATES.muscle;
  const levelMult: Record<Level, { setMult: number; repMult: number; restMult: number }> = {
    beginner: { setMult: 0.75, repMult: 1.1, restMult: 1.2 },
    intermediate: { setMult: 1, repMult: 1, restMult: 1 },
    advanced: { setMult: 1.25, repMult: 0.9, restMult: 1.1 },
  };
  const mult = levelMult[level] ?? levelMult.beginner;

  const exercises: GymExercise[] = tmpl.exercises.map((ex, i) => ({
    id: `ex-${i + 1}`,
    name: ex.name,
    equipment: ex.equipment,
    sets: Math.max(1, Math.round(ex.sets * mult.setMult)),
    reps: Math.max(1, Math.round(ex.reps * mult.repMult)),
    restSeconds: Math.round(ex.restSeconds * mult.restMult),
    tips: ex.tips,
    safety: ex.safety,
  }));

  // 根据时长裁剪动作数量（保留前 N 个，至少 3 个）
  const targetCount = Math.max(3, Math.min(exercises.length, Math.round((durationMinutes / 30) * exercises.length)));
  const trimmed = exercises.slice(0, targetCount);

  return {
    id: randomUUID(),
    goal,
    title: `${tmpl.title}（${level === "beginner" ? "初级" : level === "intermediate" ? "中级" : "高级"}）`,
    description: tmpl.description,
    exercises: trimmed,
    estimatedMinutes: durationMinutes,
    createdAt: new Date().toISOString(),
  };
}

// ===== 成就解锁判定 =====

export interface CheckAchievementInput {
  totalCheckins: number;
  currentStreak: number;
  longestStreak: number;
}

export interface CheckinHint {
  equipment?: string;
  exerciseName?: string;
}

const MUSCLE_EQUIPMENT = new Set(["dumbbell", "bench_press"]);
const CARDIO_EQUIPMENT = new Set(["treadmill", "bike", "rowing"]);
const FLEX_KEYWORDS = ["拉伸", "伸展", "瑜伽"];

/**
 * 根据统计和历史打卡判定应解锁的成就 ID 列表。
 * - streak 类用 longestStreak（历史里程碑）
 * - 次数类用 totalCheckins
 * - 器械类按打卡记录中器械/动作名统计
 */
export function checkAchievements(
  stats: CheckAchievementInput,
  checkins: CheckinHint[],
): GymAchievementId[] {
  const result: GymAchievementId[] = [];

  if (stats.totalCheckins >= 1) result.push("first_checkin");
  if (stats.longestStreak >= 3) result.push("streak_3");
  if (stats.longestStreak >= 7) result.push("streak_7");
  if (stats.longestStreak >= 30) result.push("streak_30");
  if (stats.totalCheckins >= 10) result.push("checkin_10");
  if (stats.totalCheckins >= 50) result.push("checkin_50");
  if (stats.totalCheckins >= 100) result.push("checkin_100");

  // 器械/动作判定
  let muscleCount = 0;
  let cardioCount = 0;
  let flexCount = 0;
  for (const c of checkins) {
    if (c.equipment && MUSCLE_EQUIPMENT.has(c.equipment)) muscleCount++;
    if (c.equipment && CARDIO_EQUIPMENT.has(c.equipment)) cardioCount++;
    if (c.equipment === "yoga_mat") flexCount++;
    else if (c.exerciseName && FLEX_KEYWORDS.some((k) => c.exerciseName!.includes(k))) flexCount++;
  }
  if (muscleCount >= 5) result.push("muscle_master");
  if (cardioCount >= 5) result.push("cardio_king");
  if (flexCount >= 5) result.push("flexibility_guru");

  return result;
}

// ===== P0：AI 教练 + 节奏点击带练（最小可用版）=====
// reps 不再自动增长，由玩家按节奏点击/空格驱动；教练用 LLM 实时语音鼓励/纠错。

export interface GymCoach {
  id: string;
  name: string;
  emoji: string;
  style: string;   // 一句话风格标签
  persona: string; // 注入 LLM 的人格
}

export interface GymWorkoutPreset {
  id: string;
  name: string;
  emoji: string;
  targetReps: number;
  equipment: string;
}

export type CoachEventType = "start" | "rep_good" | "rep_miss" | "halfway" | "finish";

export interface GymWorkoutSession {
  sessionId: string;
  userId: string;
  plan: GymWorkoutPreset;
  coach: GymCoach;
  startTime: string;
  reps: number;
  rhythmHits: number;
  rhythmMisses: number;
  status: "active" | "finished";
}

export interface GymWorkoutResult {
  score: number;
  grade: "S" | "A" | "B" | "C";
  rhythmHitRate: number;
  reps: number;
  targetReps: number;
  coachComment: string;
}

/** 三位可选中的 AI 教练（名人风格 persona）。 */
export const GYM_COACHES: GymCoach[] = [
  {
    id: "rock",
    name: "巨石教练",
    emoji: "🪨",
    style: "硬核激励派",
    persona: "你是巨石·强森风格的硬核健身教练，说话简短有力、充满力量感，喜欢用硬汉金句激励人，绝不拖泥带水。",
  },
  {
    id: "yogi",
    name: "瑜伽大师",
    emoji: "🧘",
    style: "呼吸引导派",
    persona: "你是一位东方瑜伽大师，语气温和、舒缓，强调呼吸与节奏，像冥想引导一样带练。",
  },
  {
    id: "pal",
    name: "邻家教练",
    emoji: "🙋",
    style: "轻松陪伴派",
    persona: "你是一位亲切的邻家健身伙伴，语气轻松像朋友聊天，会开玩笑、会鼓励，不压迫。",
  },
];

/** 三组入门节奏训练（俯卧撑 / 深蹲 / 平板支撑）。 */
export const GYM_WORKOUT_PRESETS: GymWorkoutPreset[] = [
  { id: "pushup", name: "俯卧撑", emoji: "💪", targetReps: 20, equipment: "dumbbell" },
  { id: "squat", name: "深蹲", emoji: "🦵", targetReps: 20, equipment: "dumbbell" },
  { id: "plank", name: "平板支撑", emoji: "🧎", targetReps: 30, equipment: "yoga_mat" },
];

const workoutSessions = new Map<string, GymWorkoutSession>();
let gymChat: ChatFn | null = null;

/** 注入 LLM chat 函数（由 server.ts 在启动时设置）。 */
export function setGymChat(chat: ChatFn): void {
  gymChat = chat;
}

export function getCoaches(): GymCoach[] {
  return GYM_COACHES;
}

export function getWorkoutPresets(): GymWorkoutPreset[] {
  return GYM_WORKOUT_PRESETS;
}

/** 开启一节节奏训练会话。 */
export function startWorkout(
  userId: string,
  planId: string,
  coachId: string,
): GymWorkoutSession | { error: string } {
  const plan = GYM_WORKOUT_PRESETS.find((p) => p.id === planId);
  const coach = GYM_COACHES.find((c) => c.id === coachId);
  if (!plan) return { error: "训练计划不存在" };
  if (!coach) return { error: "教练不存在" };
  const session: GymWorkoutSession = {
    sessionId: randomUUID(),
    userId,
    plan,
    coach,
    startTime: new Date().toISOString(),
    reps: 0,
    rhythmHits: 0,
    rhythmMisses: 0,
    status: "active",
  };
  workoutSessions.set(session.sessionId, session);
  return session;
}

export function getWorkoutSession(sessionId: string): GymWorkoutSession | undefined {
  return workoutSessions.get(sessionId);
}

/** 记录一次节奏点击：hit=落在绿区。reps 仅在命中时 +1。 */
export function recordRhythm(sessionId: string, hit: boolean): GymWorkoutSession | { error: string } {
  const s = workoutSessions.get(sessionId);
  if (!s) return { error: "会话不存在" };
  if (s.status !== "active") return { error: "会话已结束" };
  if (hit) {
    s.reps += 1;
    s.rhythmHits += 1;
  } else {
    s.rhythmMisses += 1;
  }
  return s;
}

/** 教练开场白 / 实时鼓励文本（LLM 生成，失败回退 canned 文案）。 */
export async function coachSpeak(
  sessionId: string,
  eventType: CoachEventType,
): Promise<{ text: string }> {
  const s = workoutSessions.get(sessionId);
  if (!s) return { text: "教练：准备好了吗？" };
  const c = s.coach;
  const targets: Record<CoachEventType, string> = {
    start: `对学员说开场鼓励：今天要挑战 ${s.plan.name} ${s.plan.targetReps} 个，简短有力地动员。`,
    rep_good: "学员刚刚节奏完美地完成了一次，给一句简短的即时鼓励（不超过20字）。",
    rep_miss: "学员刚刚节奏慢了/抢拍了，给一句简短的纠错提醒（不超过20字）。",
    halfway: `已经完成一半（${Math.floor(s.plan.targetReps / 2)}个），给一句不要停下的打气。`,
    finish: `学员完成了全部 ${s.plan.targetReps} 个${s.plan.name}，给一句收尾的祝贺点评。`,
  };
  const fallback: Record<CoachEventType, string> = {
    start: `${c.emoji} 准备好了吗？今天我们要干 ${s.plan.targetReps} 个${s.plan.name}！`,
    rep_good: "漂亮！保持这个节奏！",
    rep_miss: "别急，跟上节拍！",
    halfway: "已经一半了，不要停！",
    finish: `太棒了！你完成了 ${s.plan.targetReps} 个${s.plan.name}！`,
  };
  if (!gymChat) return { text: fallback[eventType] };
  try {
    const raw = await gymChat(
      [
        { role: "system", content: `${c.persona}\n你是健身房里的 AI 教练，正在陪学员做${s.plan.name}。说话口语化、简短、有感染力，不超过 40 字，不要解释、不要 markdown。` },
        { role: "user", content: targets[eventType] },
      ],
      120,
    );
    const text = raw.trim().replace(/^[""「『]|[""」』.]$/g, "");
    return { text: text || fallback[eventType] };
  } catch {
    return { text: fallback[eventType] };
  }
}

/** 结束训练并计算评分：节奏命中率×100 + 完成度×50。 */
export function finishWorkout(sessionId: string): GymWorkoutResult | { error: string } {
  const s = workoutSessions.get(sessionId);
  if (!s) return { error: "会话不存在" };
  s.status = "finished";

  const attempts = s.rhythmHits + s.rhythmMisses;
  const hitRate = attempts > 0 ? s.rhythmHits / attempts : 0;
  const completion = Math.min(1, s.reps / s.plan.targetReps);
  const score = Math.round(hitRate * 100 + completion * 50);
  const grade: GymWorkoutResult["grade"] = score >= 90 ? "S" : score >= 75 ? "A" : score >= 60 ? "B" : "C";

  const comment =
    grade === "S" ? `完美的节奏！${s.coach.emoji} 你就是行走的计时器！`
    : grade === "A" ? `非常不错，继续保持！${s.coach.emoji}`
    : grade === "B" ? `还可以，下次再稳一点节奏。`
    : `别灰心，跟着节拍再来一组！`;

  return {
    score,
    grade,
    rhythmHitRate: Math.round(hitRate * 100) / 100,
    reps: s.reps,
    targetReps: s.plan.targetReps,
    coachComment: comment,
  };
}
