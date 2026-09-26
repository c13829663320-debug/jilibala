// ===== R4-08: 主题房间 / 活动公告测试 =====
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureThemeRoomsForTest,
  resetThemeRoomsForTest,
  tick,
  getActiveAnnouncements,
  getTemplateCount,
  THEME_ROOM_TTL_MS,
} from "./theme-rooms.js";
import { _resetSocialRoomsForTest, getAllSocialRooms } from "./room-routes.js";

function writeTemplates(dir: string): void {
  writeFileSync(
    join(dir, "theme-rooms.json"),
    JSON.stringify({
      templates: [
        { key: "a", title: "法庭夜话", description: "desc-a", scene: "court", tags: ["#法庭"], maxPlayers: 10 },
        { key: "b", title: "狼人之夜", description: "desc-b", scene: "werewolf", tags: ["#狼人"], maxPlayers: 12 },
      ],
    }),
    "utf8",
  );
}

/** 取一个对齐到整点的时间戳（某天 10:00:00）。 */
function at(hour: number): number {
  const d = new Date(2026, 8, 27, hour, 0, 0, 0); // 2026-09-27
  return d.getTime();
}

describe("theme-rooms (R4-08)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theme-"));
    mkdirSync(dir, { recursive: true });
    writeTemplates(dir);
    _resetSocialRoomsForTest();
    configureThemeRoomsForTest(dir);
  });

  afterEach(() => {
    resetThemeRoomsForTest();
    _resetSocialRoomsForTest();
  });

  it("加载模板成功", () => {
    expect(getTemplateCount()).toBe(2);
  });

  it("tick 在整点创建主题房间并返回公告（带房间码）", () => {
    const a = tick(at(10));
    expect(a).not.toBeNull();
    expect(a!.title).toBe("法庭夜话");
    expect(a!.roomCode).toBeTruthy();
    expect(a!.tags).toEqual(["#法庭"]);
    // 已出现在大厅房间列表
    const rooms = getAllSocialRooms();
    expect(rooms.some((r) => r.code === a!.roomCode)).toBe(true);
  });

  it("同一小时重复 tick 不重复创建", () => {
    const first = tick(at(10));
    const second = tick(at(10) + 30 * 60 * 1000); // 10:30
    expect(second).toBeNull();
    expect(getActiveAnnouncements(at(10) + 30 * 60 * 1000)).toHaveLength(1);
    expect(getActiveAnnouncements(at(10) + 30 * 60 * 1000)[0].roomCode).toBe(first!.roomCode);
  });

  it("跨小时轮播到下一个模板", () => {
    const a1 = tick(at(10));
    const a2 = tick(at(11));
    expect(a2).not.toBeNull();
    // 10 点用模板 a，11 点用模板 b（轮播）
    expect(a1!.title).toBe("法庭夜话");
    expect(a2!.title).toBe("狼人之夜");
  });

  it("getActiveAnnouncements 仅返回未过期公告", () => {
    tick(at(10));
    // 10:59 仍有效
    expect(getActiveAnnouncements(at(10) + 59 * 60 * 1000)).toHaveLength(1);
    // 11:01 已过期（10 点房间 endsAt = 11:00）
    expect(getActiveAnnouncements(at(11) + 1 * 60 * 1000)).toHaveLength(0);
  });

  it("公告 startsAt/endsAt 跨度为 1 小时", () => {
    const a = tick(at(10));
    const start = new Date(a!.startsAt).getTime();
    const end = new Date(a!.endsAt).getTime();
    expect(end - start).toBe(THEME_ROOM_TTL_MS);
    expect(start).toBe(at(10));
  });

  it("多小时后累积多条公告，过期的被清理", () => {
    tick(at(10));
    tick(at(11));
    // 11:30 时：10 点房间已过期，11 点房间有效
    const active = getActiveAnnouncements(at(11) + 30 * 60 * 1000);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("狼人之夜");
  });

  it("模板文件缺失时 tick 不抛错", () => {
    const empty = mkdtempSync(join(tmpdir(), "theme-empty-"));
    configureThemeRoomsForTest(empty);
    expect(() => tick(at(10))).not.toThrow();
    expect(getActiveAnnouncements(at(10))).toEqual([]);
  });
});
