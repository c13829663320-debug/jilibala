// ===== R5: 未成年人保护 · 年龄门 =====
// 用户首次进入时自报年龄段（前端弹窗 → localStorage + 后端 session/memory）。
// 隐私原则：不收集真实姓名 / 手机号，用户标识用随机 UUID（见 server.ts POST /api/users）。
//
// 规则：
//   - under14（未满 14 岁）：禁止发布 UGC（只能浏览），提示家长监护。
//   - 14-17（青少年）：夜间时段（默认 22:00-06:00）提示休息（软提示，可配置
//     MINOR_NIGHT_START / MINOR_NIGHT_END 小时数）。
//   - adult：不限制。
import type { FastifyInstance } from "fastify";

export type AgeBand = "under14" | "minor14to17" | "adult";

export type AgeDeclaration = {
  userId: string;
  band: AgeBand;
  declaredAt: string;
};

/** 后端 session/memory 存储（进程内；重启后用户需在前端 localStorage 保留并重新声明）。 */
const declarations = new Map<string, AgeDeclaration>();

/** 供测试使用：清空年龄声明。 */
export function _resetAgeGateForTest(): void {
  declarations.clear();
}

/** 夜间限制开始/结束小时（0-23）。默认 22:00 - 06:00。可用环境变量覆盖。 */
export function nightWindow(): { start: number; end: number } {
  const start = Number(process.env.MINOR_NIGHT_START ?? 22);
  const end = Number(process.env.MINOR_NIGHT_END ?? 6);
  return { start: Number.isFinite(start) ? start : 22, end: Number.isFinite(end) ? end : 6 };
}

/** 由年龄数字推导年龄段。 */
export function bandFromAge(age: number): AgeBand {
  if (age < 14) return "under14";
  if (age < 18) return "minor14to17";
  return "adult";
}

/** 声明年龄（age 数字优先；否则用 band）。 */
export function declareAge(userId: string, input: { age?: number; band?: AgeBand }): AgeDeclaration {
  const band: AgeBand =
    typeof input.age === "number" && Number.isFinite(input.age)
      ? bandFromAge(Math.max(0, Math.floor(input.age)))
      : input.band === "under14" || input.band === "minor14to17" || input.band === "adult"
        ? input.band
        : "adult";
  const decl: AgeDeclaration = { userId, band, declaredAt: new Date().toISOString() };
  declarations.set(userId, decl);
  return decl;
}

export function getDeclaration(userId: string): AgeDeclaration | undefined {
  return declarations.get(userId);
}

/** 当前时刻是否落在青少年夜间限制窗口内（跨午夜区间也正确）。 */
export function isNightRestrictedHour(date = new Date()): boolean {
  const { start, end } = nightWindow();
  const h = date.getHours();
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  // 跨午夜，如 22 -> 06
  return h >= start || h < end;
}

/**
 * 该用户是否被禁止发布 UGC。仅 under14 硬禁止。
 * 未声明年龄的用户按 adult 处理（不阻断，但前端会弹窗引导声明）。
 */
export function isMinorBlockedFromUGC(userId: string): boolean {
  const decl = declarations.get(userId);
  if (!decl) return false;
  return decl.band === "under14";
}

/** 综合状态：供前端展示「青少年模式」标识与夜间提示。 */
export function ageGateStatus(userId: string, now = new Date()): {
  band: AgeBand | "unset";
  ugcAllowed: boolean;
  nightRestricted: boolean;
  minor: boolean;
  message?: string;
} {
  const decl = declarations.get(userId);
  if (!decl) {
    return { band: "unset", ugcAllowed: true, nightRestricted: false, minor: false };
  }
  if (decl.band === "under14") {
    return {
      band: decl.band, ugcAllowed: false, nightRestricted: false, minor: true,
      message: "未成年人模式：仅可浏览内容，请在家长监护下使用。",
    };
  }
  if (decl.band === "minor14to17") {
    const night = isNightRestrictedHour(now);
    return {
      band: decl.band, ugcAllowed: true, nightRestricted: night, minor: true,
      message: night ? "现在是夜间休息时间，建议早点休息哦。" : undefined,
    };
  }
  return { band: "adult", ugcAllowed: true, nightRestricted: false, minor: false };
}

/** 注册年龄门路由。 */
export function registerAgeGateRoutes(app: FastifyInstance): void {
  app.post("/api/age-gate/declare", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; age?: number; band?: AgeBand };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "userId 为必填" });
    const decl = declareAge(userId, { age: body.age, band: body.band });
    return reply.code(201).send({ ...decl, status: ageGateStatus(userId) });
  });

  app.get("/api/age-gate/status", async (req, reply) => {
    const { userId } = req.query as { userId?: string };
    if (!userId) return reply.code(400).send({ message: "userId 为必填" });
    return ageGateStatus(userId);
  });
}
