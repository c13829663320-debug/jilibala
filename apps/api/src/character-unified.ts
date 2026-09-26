// ===== 分片6: 统一人物档案层 =====
// 把「预置名人（CELEBRITIES）」与「公开自定义人物（custom_characters）」
// 归一为同一个 CharacterProfile 视图，供统一列表 / 搜索 / 筛选 / 详情使用。
// 纯函数（组合数据），可单测；follower 计数由 follow-db 注入。
import { basename } from "node:path";
import { CELEBRITIES, getCelebrity, type CharacterProfile } from "@balabala/shared";
import { getCustomCharacter, getPublicCustomCharacters } from "./db.js";

/** 默认头像（自定义人物未上传头像时回退）。 */
const FALLBACK_PORTRAIT = "/portraits/celebrities/_default.jpg";

/** 把自定义人物存储的相对路径转换为可访问的静态资源 URL（与 character-resolver 一致）。 */
function toAssetUrl(id: string, stored: string): string | undefined {
  if (!stored) return undefined;
  const file = basename(stored);
  if (!file || file === ".." || file === ".") return undefined;
  return `/api/custom-characters/assets/${id}/${file}`;
}

/** follower 计数注入器（默认恒 0，便于纯函数测试）。 */
export type FollowerCountFn = (characterId: string) => number;

/** 预置名人 → CharacterProfile（剔除 persona/greeting）。 */
function celebrityToProfile(id: string, followers: FollowerCountFn): CharacterProfile | undefined {
  const c = getCelebrity(id);
  if (!c) return undefined;
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    intro: c.intro,
    tags: c.tags,
    portrait: c.portrait,
    model: c.model,
    voice: c.voice,
    source: "celebrity",
    field: c.field,
    era: c.era,
    followers: followers(c.id),
    visibility: "public",
  };
}

/** 自定义人物记录 → CharacterProfile（剔除 persona/greeting）。私有人物不进入公开统一列表。 */
function customToProfile(
  rec: {
    id: string; userId: string; name: string; title: string; intro: string;
    tags: string[]; modelPath: string; portraitPath: string; voice: string;
    visibility: string;
  },
  followers: FollowerCountFn,
): CharacterProfile {
  return {
    id: rec.id,
    name: rec.name,
    title: rec.title,
    intro: rec.intro,
    tags: rec.tags,
    portrait: toAssetUrl(rec.id, rec.portraitPath) ?? FALLBACK_PORTRAIT,
    model: toAssetUrl(rec.id, rec.modelPath),
    voice: rec.voice || undefined,
    source: "custom",
    author: rec.userId || undefined,
    followers: followers(rec.id),
    visibility: rec.visibility === "public" ? "public" : "private",
  };
}

/**
 * 构建统一人物列表：名人全量 + 公开自定义人物。
 * 纯函数：follower 计数通过注入函数获取，便于测试时打桩。
 * @param opts.includePrivateCustom 仅在「我的人物」等场景为 true；默认 false（公开列表）。
 */
export function buildUnifiedProfiles(opts: {
  followers?: FollowerCountFn;
  includePrivateCustom?: boolean;
} = {}): CharacterProfile[] {
  const followers: FollowerCountFn = opts.followers ?? (() => 0);
  const out: CharacterProfile[] = [];

  for (const c of CELEBRITIES) {
    const p = celebrityToProfile(c.id, followers);
    if (p) out.push(p);
  }

  const customs = getPublicCustomCharacters(500);
  for (const rec of customs) {
    out.push(customToProfile(rec, followers));
  }
  void opts.includePrivateCustom; // 公开列表默认不纳入私有；预留扩展
  return out;
}

/**
 * 解析单个人物为统一档案（自动判断名人 / 自定义）。
 * 自定义人物若为私有，且调用方传入 ownerId 且为创建者，仍返回；否则返回 undefined。
 */
export function resolveUnifiedProfile(
  id: string,
  opts: { followers?: FollowerCountFn; viewerId?: string } = {},
): CharacterProfile | undefined {
  const followers: FollowerCountFn = opts.followers ?? (() => 0);
  if (id.startsWith("custom-")) {
    const rec = getCustomCharacter(id);
    if (!rec) return undefined;
    if (rec.visibility === "private" && opts.viewerId !== rec.userId) return undefined;
    return customToProfile(rec, followers);
  }
  return celebrityToProfile(id, followers);
}

/** 关键词搜索：在 name/title/intro/tags 上做不区分大小写包含匹配。纯函数。 */
export function searchUnified(list: CharacterProfile[], q: string): CharacterProfile[] {
  const keyword = q.trim().toLowerCase();
  if (!keyword) return list;
  return list.filter((c) => {
    const haystack = [c.name, c.title, c.intro, ...c.tags].join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
}

/** 标签筛选：返回 tags 中包含指定标签的人物。纯函数。 */
export function filterByTag(list: CharacterProfile[], tag: string): CharacterProfile[] {
  const t = tag.trim();
  if (!t) return list;
  return list.filter((c) => c.tags.some((x) => x === t));
}

/** 来源筛选：all / celebrity / custom。纯函数。 */
export function filterBySource(list: CharacterProfile[], source: string): CharacterProfile[] {
  if (source === "celebrity") return list.filter((c) => c.source === "celebrity");
  if (source === "custom") return list.filter((c) => c.source === "custom");
  return list;
}

/** 分页。纯函数。 */
export function paginate<T>(list: T[], page: number, limit: number): { items: T[]; total: number; page: number; limit: number } {
  const total = list.length;
  const p = Math.max(1, Math.round(page) || 1);
  const rawLimit = Math.round(limit);
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;
  const l = Math.min(Math.max(1, safeLimit), 100);
  const start = (p - 1) * l;
  return { items: list.slice(start, start + l), total, page: p, limit: l };
}

/** 提取列表中出现过的全部标签（带出现次数，按热度倒序）。 */
export function collectTags(list: CharacterProfile[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of list) {
    for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
