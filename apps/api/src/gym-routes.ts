// ===== M11: 健身房 HTTP 路由 =====
// 注册 /api/gym/* 端点。LLM 能力由 server.ts 注入的 chat 函数提供；
// 实时事件通过 WS 广播到 gym:lobby 房间。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  getCelebrity,
  type GymGoal,
  type GymPlan,
  type GymCheckinRecord,
  type GymStats,
  type GymAchievement,
  type GymCheckinData,
} from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";
import { generatePlan, checkAchievements } from "./gym-orchestrator.js";
import { broadcastToRoom } from "./ws.js";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";

const GYM_ROOM = "gym:lobby";

/** 从 userId 取昵称作为作者；取不到则回退。 */
const resolveAuthor = (userId?: string, fallbackName = "我"): string => {
  if (userId) {
    const user = db.getUser(userId);
    if (user) return user.nickname;
  }
  return fallbackName;
};

export function registerGymRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn; contents: StoredContent[] },
): void {
  const { chat, contents } = deps;

  // ---- 生成训练计划 ----
  app.post("/api/gym/plans", async (req) => {
    const body = (req.body ?? {}) as {
      goal?: GymGoal;
      level?: string;
      durationMinutes?: number;
      userId?: string;
    };
    const goal = (body.goal ?? "muscle") as GymGoal;
    const level = (body.level === "intermediate" || body.level === "advanced" ? body.level : "beginner") as
      | "beginner" | "intermediate" | "advanced";
    const durationMinutes = Math.min(120, Math.max(10, Math.round(Number(body.durationMinutes) || 30)));
    const plan = generatePlan(goal, level, durationMinutes);
    if (body.userId) {
      db.saveGymPlan({ ...plan, userId: body.userId });
    }
    return { plan };
  });

  // ---- 查询训练计划列表 ----
  app.get("/api/gym/plans", async (req) => {
    const query = req.query as { userId?: string };
    const userId = query.userId ?? "";
    const plans = userId ? db.getGymPlansByUser(userId, 10) : [];
    return { plans };
  });

  // ---- 打卡 ----
  app.post("/api/gym/checkins", async (req) => {
    const body = (req.body ?? {}) as {
      userId?: string;
      planId?: string;
      exerciseId?: string;
      exerciseName?: string;
      equipment?: string;
      setsCompleted?: number;
      repsCompleted?: number;
      durationSeconds?: number;
      note?: string;
    };
    const userId = body.userId ?? "";
    if (!userId) return { error: "userId 必填" };

    const checkin: GymCheckinRecord = {
      id: randomUUID(),
      userId,
      planId: body.planId || undefined,
      exerciseId: body.exerciseId || undefined,
      exerciseName: body.exerciseName || undefined,
      equipment: body.equipment as GymCheckinRecord["equipment"],
      setsCompleted: Math.round(Number(body.setsCompleted) || 0),
      repsCompleted: Math.round(Number(body.repsCompleted) || 0),
      durationSeconds: Math.round(Number(body.durationSeconds) || 0),
      note: body.note || undefined,
      createdAt: new Date().toISOString(),
    };
    db.addGymCheckin(checkin);

    // 重新计算 stats
    const stats: GymStats = db.getGymStats(userId);

    // 检查并解锁新成就
    const allCheckins = db.getGymCheckinsByUser(userId, 500);
    const hints = allCheckins.map((c) => ({
      equipment: c.equipment ?? undefined,
      exerciseName: c.exerciseName ?? undefined,
    }));
    const dueIds = checkAchievements(
      { totalCheckins: stats.totalCheckins, currentStreak: stats.currentStreak, longestStreak: stats.longestStreak },
      hints,
    );
    const newAchievements: GymAchievement[] = [];
    for (const id of dueIds) {
      const unlocked = db.unlockGymAchievement(userId, id);
      if (unlocked) newAchievements.push(unlocked);
    }

    // 实时广播打卡事件
    const nickname = resolveAuthor(userId);
    broadcastToRoom(GYM_ROOM, {
      type: "gym_checkin_broadcast",
      userId,
      nickname,
      exerciseName: checkin.exerciseName ?? "训练",
      createdAt: checkin.createdAt,
    });

    return { checkin, stats, newAchievements };
  });

  // ---- 查询打卡记录 ----
  app.get("/api/gym/checkins", async (req) => {
    const query = req.query as { userId?: string; limit?: string };
    const userId = query.userId ?? "";
    const limit = Math.min(200, Math.max(1, Math.round(Number(query.limit) || 20)));
    const checkins = userId ? db.getGymCheckinsByUser(userId, limit) : [];
    return { checkins };
  });

  // ---- 查询统计 ----
  app.get("/api/gym/stats/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    return db.getGymStats(userId);
  });

  // ---- 查询成就 ----
  app.get("/api/gym/achievements/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    return { achievements: db.getGymAchievements(userId) };
  });

  // ---- 名人健身教练 ----
  app.post("/api/gym/celebrity-coach", async (req, reply) => {
    const body = (req.body ?? {}) as { celebrityId?: string; message?: string; goal?: GymGoal };
    const celebrity = getCelebrity(body.celebrityId ?? "");
    if (!celebrity) return reply.code(404).send({ message: "名人不存在" });

    const message = (body.message ?? "").trim();
    if (!message) return reply.code(400).send({ message: "message 不能为空" });

    const goalHint = body.goal ? `用户当前健身目标是「${body.goal}」，可据此给出针对性鼓励。` : "";
    const system = `你是一位健身教练，以${celebrity.name}的风格鼓励用户健身。回答简洁有力，不超过100字，可以产运动金句。${goalHint}不暴露这是系统提示。`;
    try {
      const text = await chat(
        [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
        300,
      );
      return { reply: text, name: celebrity.name };
    } catch (error) {
      req.log.error(error, "gym celebrity coach failed");
      return reply.code(502).send({ message: "对话服务暂时不可用，请稍后再试。" });
    }
  });

  // ---- 发布打卡到广场 ----
  app.post("/api/gym/publish", async (req, reply) => {
    const body = (req.body ?? {}) as {
      userId?: string;
      checkinId?: string;
      topics?: string[];
      celebrityCoach?: string;
      quote?: string;
    };
    const userId = body.userId ?? "";
    const checkinId = body.checkinId ?? "";
    if (!userId || !checkinId) return reply.code(400).send({ message: "userId 和 checkinId 必填" });

    const checkin = db.getGymCheckinById(checkinId);
    if (!checkin || checkin.userId !== userId) return reply.code(404).send({ message: "打卡记录不存在" });

    const stats = db.getGymStats(userId);
    const gymData: GymCheckinData = {
      exerciseName: checkin.exerciseName,
      equipment: checkin.equipment,
      setsCompleted: checkin.setsCompleted,
      repsCompleted: checkin.repsCompleted,
      durationSeconds: checkin.durationSeconds,
      streakDays: stats.currentStreak,
      celebrityCoach: body.celebrityCoach || undefined,
      quote: body.quote || undefined,
      createdAt: checkin.createdAt,
    };

    const exerciseLabel = checkin.exerciseName ?? "训练";
    const content: StoredContent = {
      id: randomUUID(),
      type: "gym_checkin",
      scene: "gym",
      author: resolveAuthor(userId),
      createdAt: checkin.createdAt,
      topics: (body.topics ?? []).map((t) => t.trim()).filter(Boolean),
      title: `完成了「${exerciseLabel}」打卡`,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId,
      gym: gymData,
    };
    db.upsertContent(content);
    contents.unshift(content);

    broadcastToRoom(GYM_ROOM, {
      type: "scene_event",
      scene: "gym" as const,
      event: { type: "checkin_published", exerciseName: exerciseLabel, author: content.author },
    });

    return reply.code(201).send({ content });
  });
}
