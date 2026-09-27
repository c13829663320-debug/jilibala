// ===== R5: 未成年人保护 · 年龄门测试 =====
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetAgeGateForTest,
  bandFromAge,
  declareAge,
  isMinorBlockedFromUGC,
  isNightRestrictedHour,
  ageGateStatus,
} from "./age-gate.js";

afterEach(() => {
  _resetAgeGateForTest();
  delete process.env.MINOR_NIGHT_START;
  delete process.env.MINOR_NIGHT_END;
});

describe("bandFromAge 年龄段推导", () => {
  it("未满 14 → under14", () => {
    expect(bandFromAge(10)).toBe("under14");
    expect(bandFromAge(0)).toBe("under14");
  });
  it("14-17 → minor14to17", () => {
    expect(bandFromAge(14)).toBe("minor14to17");
    expect(bandFromAge(17)).toBe("minor14to17");
  });
  it("18+ → adult", () => {
    expect(bandFromAge(18)).toBe("adult");
    expect(bandFromAge(40)).toBe("adult");
  });
});

describe("UGC 发布限制", () => {
  it("未满14岁禁止发布 UGC", () => {
    declareAge("kid1", { age: 12 });
    expect(isMinorBlockedFromUGC("kid1")).toBe(true);
    const s = ageGateStatus("kid1");
    expect(s.ugcAllowed).toBe(false);
    expect(s.minor).toBe(true);
  });

  it("14-17 可发布 UGC", () => {
    declareAge("teen1", { age: 15 });
    expect(isMinorBlockedFromUGC("teen1")).toBe(false);
    expect(ageGateStatus("teen1").ugcAllowed).toBe(true);
  });

  it("成年人不受限", () => {
    declareAge("adult1", { age: 30 });
    expect(isMinorBlockedFromUGC("adult1")).toBe(false);
    expect(ageGateStatus("adult1").minor).toBe(false);
  });

  it("未声明年龄默认放行（按 adult 处理）", () => {
    expect(isMinorBlockedFromUGC("nobody")).toBe(false);
  });
});

describe("青少年夜间时段", () => {
  it("默认 22:00-06:00 跨午夜窗口判定", () => {
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 23, 0))).toBe(true); // 23点
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 2, 0))).toBe(true);  // 凌晨2点
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 12, 0))).toBe(false); // 中午
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 21, 0))).toBe(false); // 21点
  });

  it("可通过环境变量配置夜间窗口", () => {
    process.env.MINOR_NIGHT_START = "20";
    process.env.MINOR_NIGHT_END = "7";
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 21, 0))).toBe(true); // 21点在20-7窗口
    expect(isNightRestrictedHour(new Date(2026, 8, 27, 12, 0))).toBe(false);
  });

  it("14-17 用户夜间状态提示，under14 不提示夜间", () => {
    declareAge("teen2", { age: 16 });
    const night = ageGateStatus("teen2", new Date(2026, 8, 27, 23, 0));
    expect(night.nightRestricted).toBe(true);
    expect(night.message).toMatch(/休息/);

    declareAge("kid2", { age: 10 });
    const kidStatus = ageGateStatus("kid2", new Date(2026, 8, 27, 23, 0));
    expect(kidStatus.nightRestricted).toBe(false);
    expect(kidStatus.message).toMatch(/浏览/);
  });
});
