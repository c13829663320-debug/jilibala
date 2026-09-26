// ===== R4-08: 广场定时主题房间与活动公告 =====
// 每小时整点按 apps/api/data/theme-rooms.json 模板轮播创建一个公开主题房间
// （通过 room-routes.createSystemRoom 写入社交房间表，自动出现在大厅列表）。
// 活动公告 GET /api/announcements 返回当前仍在有效期内（1 小时）的主题房间。
//
// 时间驱动通过 tick(nowMs) 显式推进，便于用 fake timer 在测试中验证整点逻辑；
// 生产由 startScheduler() 注册一个 setInterval。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Announcement, RoomScene } from "@balabala/shared";
import { createSystemRoom } from "./room-routes.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(SRC_DIR, "..", "data");

export const THEME_ROOM_TTL_MS = 60 * 60 * 1000; // 主题房间持续 1 小时

interface ThemeTemplate {
  key: string;
  title: string;
  description: string;
  scene: RoomScene;
  tags: string[];
  maxPlayers: number;
}

interface ActiveTheme extends Announcement {
  templateKey: string;
}

let dataDir = DEFAULT_DATA_DIR;
let templates: ThemeTemplate[] = [];
/** hourKey(yyyy-mm-dd-hh) -> 已创建的主题房间 */
const activeByHour = new Map<string, ActiveTheme>();
let schedulerTimer: NodeJS.Timeout | null = null;

function loadTemplates(): ThemeTemplate[] {
  try {
    const raw = readFileSync(resolve(dataDir, "theme-rooms.json"), "utf8");
    const parsed = JSON.parse(raw) as { templates?: unknown };
    if (Array.isArray(parsed.templates)) {
      return parsed.templates.filter((t): t is ThemeTemplate => {
        const o = t as ThemeTemplate;
        return o && typeof o.key === "string" && typeof o.title === "string";
      });
    }
  } catch (e) {
    console.warn("[theme-rooms] 加载 theme-rooms.json 失败:", e);
  }
  return [];
}

/** 测试用：切换数据目录并清空运行态。 */
export function configureThemeRoomsForTest(dir: string): void {
  dataDir = dir;
  templates = loadTemplates();
  activeByHour.clear();
}

/** 测试用：恢复默认。 */
export function resetThemeRoomsForTest(): void {
  dataDir = DEFAULT_DATA_DIR;
  templates = loadTemplates();
  activeByHour.clear();
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function hourKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day}-${h}`;
}

/** 对齐到当前整点的开始时间戳。 */
function topOfHour(nowMs: number): number {
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * 推进一次调度。若当前整点尚未创建主题房间，则按轮选取模板创建。
 * 返回本次新建的公告（无新建返回 null）。
 */
export function tick(nowMs: number = Date.now()): Announcement | null {
  if (templates.length === 0) return null;
  const key = hourKey(nowMs);
  if (activeByHour.has(key)) return null;

  const hourIndex = Math.floor(nowMs / THEME_ROOM_TTL_MS);
  const tpl = templates[hourIndex % templates.length];
  const startsAt = topOfHour(nowMs);
  const endsAt = startsAt + THEME_ROOM_TTL_MS;

  const room = createSystemRoom({
    name: `${tpl.title}`,
    scene: tpl.scene,
    maxPlayers: tpl.maxPlayers,
  });

  const announcement: ActiveTheme = {
    id: `theme-${key}-${tpl.key}`,
    title: tpl.title,
    description: tpl.description,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    roomCode: room.code,
    tags: tpl.tags,
    templateKey: tpl.key,
  };
  activeByHour.set(key, announcement);
  return announcement;
}

/**
 * 返回当前仍在有效期内的活动公告（按开始时间倒序）。
 * 顺带惰性清理过期记录。
 */
export function getActiveAnnouncements(nowMs: number = Date.now()): Announcement[] {
  const out: ActiveTheme[] = [];
  for (const [key, a] of activeByHour) {
    if (new Date(a.endsAt).getTime() <= nowMs) {
      activeByHour.delete(key);
      continue;
    }
    out.push(a);
  }
  return out
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map(({ templateKey: _tk, ...rest }) => {
      void _tk;
      return rest;
    });
}

/** 当前加载的模板数量（测试/运维用）。 */
export function getTemplateCount(): number {
  return templates.length;
}

/**
 * 生产入口：每整点检查一次。到下一个整点时由 setInterval 驱动。
 * 测试不调用本函数（直接 tick）。
 */
export function startScheduler(): void {
  if (schedulerTimer) return;
  // 立即先跑一次，再每 5 分钟检查一次（整点必定命中）
  tick(Date.now());
  schedulerTimer = setInterval(() => tick(Date.now()), 5 * 60 * 1000);
  schedulerTimer.unref?.();
}

// 模块加载时即读模板（生产环境）；测试会用 configureThemeRoomsForTest 覆盖。
if (existsSync(resolve(DEFAULT_DATA_DIR, "theme-rooms.json"))) {
  templates = loadTemplates();
}
