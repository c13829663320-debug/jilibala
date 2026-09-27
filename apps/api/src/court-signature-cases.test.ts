// ===== 名人招牌案件库数据完整性 =====
import { describe, expect, it } from "vitest";
import { CELEBRITY_COURT_CASES, getSignatureCase, randomSignatureCase } from "./court-signature-cases.js";

describe("CELEBRITY_COURT_CASES", () => {
  it("至少 6 个案件", () => {
    expect(CELEBRITY_COURT_CASES.length).toBeGreaterThanOrEqual(6);
  });

  it("每个案件字段完整", () => {
    for (const c of CELEBRITY_COURT_CASES) {
      expect(c.id).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.celebrityDefendant.id).toBeTruthy();
      expect(c.celebrityDefendant.name).toBeTruthy();
      expect(c.celebrityPlaintiff.id).toBeTruthy();
      expect(c.celebrityPlaintiff.name).toBeTruthy();
      expect(c.theme).toBeTruthy();
      expect(c.facts.length).toBeGreaterThanOrEqual(3);
      expect(c.disputePoints.length).toBe(3);
      expect(c.evidence.length).toBeGreaterThanOrEqual(3);
      expect(c.dramaticMoments.length).toBeGreaterThanOrEqual(3);
      expect(c.juryBias).toBeGreaterThanOrEqual(-50);
      expect(c.juryBias).toBeLessThanOrEqual(50);
      // 证据结构
      for (const ev of c.evidence) {
        expect(ev.id).toBeTruthy();
        expect(ev.text).toBeTruthy();
        expect(["plaintiff", "defendant"]).toContain(ev.side);
        expect(ev.power).toBeGreaterThanOrEqual(1);
        expect(ev.power).toBeLessThanOrEqual(10);
      }
    }
  });

  it("案件 id 唯一", () => {
    const ids = CELEBRITY_COURT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getSignatureCase 命中 / 未命中", () => {
    expect(getSignatureCase(CELEBRITY_COURT_CASES[0].id)?.title).toBe(CELEBRITY_COURT_CASES[0].title);
    expect(getSignatureCase("nope")).toBeNull();
  });

  it("randomSignatureCase 总能返回一个案件", () => {
    expect(randomSignatureCase(() => 0).id).toBe(CELEBRITY_COURT_CASES[0].id);
    expect(randomSignatureCase(() => 0.999)).toBeTruthy();
  });
});
