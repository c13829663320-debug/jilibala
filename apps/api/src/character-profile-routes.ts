// ===== 分片6: 统一人物档案 + 关注 REST API =====
// GET  /api/characters/unified?source=all&q=&tag=&page=1&limit=20  统一列表
// GET  /api/characters/:id/profile                                  统一详情
// POST /api/characters/:id/follow                                   关注（body: userId）
// DELETE /api/characters/:id/follow                                  取消关注
// GET  /api/characters/following?userId=xxx                         我关注的人物
// GET  /api/players/:userId/profile                                 玩家公开档案
import type { FastifyInstance } from "fastify";
import type { CharacterProfile, PlayerPublicProfile } from "@balabala/shared";
import {
  buildUnifiedProfiles,
  resolveUnifiedProfile,
  searchUnified,
  filterByTag,
  filterBySource,
  paginate,
  collectTags,
} from "./character-unified.js";
import {
  followCharacter,
  unfollowCharacter,
  getFollow,
  getFollowingCharacterIds,
  getFollowerCount,
  getFollowingCount,
} from "./character-follow-db.js";
import { getCustomCharactersByUser, getUser } from "./db.js";

export function registerCharacterProfileRoutes(app: FastifyInstance): void {
  // ===== 统一列表（静态路径，注册在 :id 之前以确保优先匹配）=====
  app.get("/api/characters/unified", async (req) => {
    const query = req.query as {
      source?: string; q?: string; tag?: string; page?: string; limit?: string;
    };
    let list = buildUnifiedProfiles({ followers: getFollowerCount });
    list = filterBySource(list, query.source ?? "all");
    if (query.q) list = searchUnified(list, query.q);
    if (query.tag) list = filterByTag(list, query.tag);
    const result = paginate(list, Number(query.page ?? 1), Number(query.limit ?? 20));
    return {
      ...result,
      tags: collectTags(buildUnifiedProfiles({ followers: getFollowerCount })),
    };
  });

  // ===== 我关注的人物（静态路径）=====
  app.get("/api/characters/following", async (req, reply) => {
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId 为必填" });
    const ids = getFollowingCharacterIds(userId);
    const characters: CharacterProfile[] = [];
    for (const id of ids) {
      const p = resolveUnifiedProfile(id, { followers: getFollowerCount, viewerId: userId });
      if (p) characters.push(p);
    }
    return { userId, characters, total: characters.length };
  });

  // ===== 统一详情 =====
  app.get("/api/characters/:id/profile", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { userId?: string };
    const profile = resolveUnifiedProfile(id, {
      followers: getFollowerCount,
      viewerId: (query.userId ?? "").trim() || undefined,
    });
    if (!profile) return reply.code(404).send({ error: "人物不存在或为私有" });
    // 附带当前用户是否已关注
    const viewerId = (query.userId ?? "").trim();
    const followed = viewerId ? Boolean(getFollow(viewerId, id)) : false;
    return { profile, followed };
  });

  // ===== 关注 / 取消关注 =====
  app.post("/api/characters/:id/follow", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId 为必填" });
    // 目标人物必须存在（公开可见）才允许关注
    const target = resolveUnifiedProfile(id, { followers: getFollowerCount });
    if (!target) return reply.code(404).send({ error: "人物不存在" });
    followCharacter(userId, id);
    return { ok: true, followers: getFollowerCount(id) };
  });

  app.delete("/api/characters/:id/follow", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ error: "userId 为必填" });
    const removed = unfollowCharacter(userId, id);
    return { ok: removed, followers: getFollowerCount(id) };
  });

  // ===== 玩家公开档案 =====
  app.get("/api/players/:userId/profile", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const user = getUser(userId);
    if (!user) return reply.code(404).send({ error: "玩家不存在" });
    // 该玩家创建的人物数（含私有——仅统计数量，不泄露内容）
    const myChars = getCustomCharactersByUser(userId);
    const profile: PlayerPublicProfile = {
      userId: user.userId,
      nickname: user.nickname,
      avatarType: user.avatarType,
      avatarRef: user.avatarRef,
      createdAt: user.createdAt,
      customCharacterCount: myChars.length,
      followingCount: getFollowingCount(userId),
    };
    return { profile };
  });
}
