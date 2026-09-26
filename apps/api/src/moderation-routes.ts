// ===== 分片5: 屏蔽 / 静音 / 举报 REST API =====
// POST   /api/moderation/block          屏蔽用户
// DELETE /api/moderation/block          取消屏蔽（body: userId, targetUserId）
// GET    /api/moderation/blocked?userId 我屏蔽的列表
// POST   /api/moderation/mute           静音用户语音
// DELETE /api/moderation/mute           取消静音
// GET    /api/moderation/muted?userId   我静音的列表
// POST   /api/moderation/report         举报用户/内容
// GET    /api/moderation/reports?status 举报列表（管理用，简单鉴权）
// PUT    /api/moderation/reports/:id/status 更新举报状态
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ReportStatus, ReportTargetType } from "@balabala/shared";
import {
  blockUser,
  unblockUser,
  getBlockedUsers,
  muteUser,
  unmuteUser,
  getMutedUsers,
  createReport,
  listReports,
  getReport,
  updateReportStatus,
} from "./moderation-db.js";

const REPORT_TARGET_TYPES: ReadonlySet<string> = new Set(["user", "content", "avatar"]);
const REPORT_STATUSES: ReadonlySet<string> = new Set(["pending", "reviewing", "resolved", "dismissed"]);

/**
 * 简单管理鉴权：若设置了环境变量 MODERATION_ADMIN_TOKEN，则要求请求头
 * x-admin-token 与之相等；未设置时（本地开发）放行，便于联调。
 */
function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.MODERATION_ADMIN_TOKEN;
  if (!expected) return true;
  const got = (req.headers["x-admin-token"] ?? "") as string;
  if (got !== expected) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export function registerModerationRoutes(app: FastifyInstance): void {
  // ===== 屏蔽 =====
  app.post("/api/moderation/block", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; targetUserId?: string; reason?: string };
    const userId = (body.userId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();
    if (!userId || !targetUserId) {
      return reply.code(400).send({ error: "userId 与 targetUserId 为必填" });
    }
    if (userId === targetUserId) {
      return reply.code(400).send({ error: "不能屏蔽自己" });
    }
    const rel = blockUser(userId, targetUserId, body.reason?.trim());
    return reply.code(201).send({ relation: rel });
  });

  app.delete("/api/moderation/block", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; targetUserId?: string };
    const userId = (body.userId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();
    if (!userId || !targetUserId) {
      return reply.code(400).send({ error: "userId 与 targetUserId 为必填" });
    }
    const removed = unblockUser(userId, targetUserId);
    return { ok: removed };
  });

  app.get("/api/moderation/blocked", async (req, reply) => {
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId 为必填" });
    return { blocked: getBlockedUsers(userId) };
  });

  // ===== 静音 =====
  app.post("/api/moderation/mute", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; targetUserId?: string; reason?: string };
    const userId = (body.userId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();
    if (!userId || !targetUserId) {
      return reply.code(400).send({ error: "userId 与 targetUserId 为必填" });
    }
    if (userId === targetUserId) {
      return reply.code(400).send({ error: "不能静音自己" });
    }
    const rel = muteUser(userId, targetUserId, body.reason?.trim());
    return reply.code(201).send({ relation: rel });
  });

  app.delete("/api/moderation/mute", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; targetUserId?: string };
    const userId = (body.userId ?? "").trim();
    const targetUserId = (body.targetUserId ?? "").trim();
    if (!userId || !targetUserId) {
      return reply.code(400).send({ error: "userId 与 targetUserId 为必填" });
    }
    const removed = unmuteUser(userId, targetUserId);
    return { ok: removed };
  });

  app.get("/api/moderation/muted", async (req, reply) => {
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId 为必填" });
    return { muted: getMutedUsers(userId) };
  });

  // ===== 举报 =====
  app.post("/api/moderation/report", async (req, reply) => {
    const body = (req.body ?? {}) as {
      reporterId?: string;
      targetType?: string;
      targetId?: string;
      reason?: string;
      detail?: string;
    };
    const reporterId = (body.reporterId ?? "").trim();
    const targetId = (body.targetId ?? "").trim();
    const reason = (body.reason ?? "").trim();
    const targetType = (body.targetType ?? "") as ReportTargetType;
    if (!reporterId || !targetId || !reason) {
      return reply.code(400).send({ error: "reporterId, targetId, reason 为必填" });
    }
    if (!REPORT_TARGET_TYPES.has(targetType)) {
      return reply.code(400).send({ error: "targetType 必须是 user/content/avatar 之一" });
    }
    const report = createReport({
      reporterId,
      targetType,
      targetId,
      reason,
      detail: body.detail?.trim() || undefined,
    });
    return reply.code(201).send({ report });
  });

  app.get("/api/moderation/reports", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const query = req.query as { status?: string };
    const status = REPORT_STATUSES.has(query.status ?? "")
      ? (query.status as ReportStatus)
      : undefined;
    return { reports: listReports(status) };
  });

  app.put("/api/moderation/reports/:id/status", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: string };
    const status = (body.status ?? "") as ReportStatus;
    if (!REPORT_STATUSES.has(status)) {
      return reply.code(400).send({ error: "status 必须是 pending/reviewing/resolved/dismissed 之一" });
    }
    const existing = getReport(id);
    if (!existing) return reply.code(404).send({ error: "举报不存在" });
    const updated = updateReportStatus(id, status);
    return { report: updated };
  });
}
