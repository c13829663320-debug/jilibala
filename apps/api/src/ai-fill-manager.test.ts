// ===== R4-05: ai-fill-manager 测试（纯内存，无网络/DB/LLM）=====
import { describe, expect, it } from "vitest";
import { AiFillManager } from "./ai-fill-manager.js";

describe("ai-fill-manager: 初始 AI 填充", () => {
  it("registerSlot：注册后默认是 AI 担任，昵称=AI 兜底名", () => {
    const m = new AiFillManager();
    const s = m.registerSlot("plaintiff", "原告", "AI 原告");
    expect(s.playerType).toBe("ai");
    expect(s.nickname).toBe("AI 原告");
    expect(s.userId).toBeUndefined();
    expect(m.aiCount()).toBe(1);
    expect(m.humanCount()).toBe(0);
  });

  it("registerSlot 重复注册不覆盖已有 slot", () => {
    const m = new AiFillManager();
    m.registerSlot("a", "甲", "AI 甲");
    m.humanJoin("a", "u1", "真人甲");
    m.registerSlot("a", "甲", "被忽略的新名");
    const s = m.get("a")!;
    expect(s.playerType).toBe("human");
    expect(s.nickname).toBe("真人甲");
  });
});

describe("ai-fill-manager: 真人替换 AI", () => {
  it("humanJoin：真人认领 slot，playerType 变 human，昵称更新", () => {
    const m = new AiFillManager();
    m.registerSlot("defendant", "被告", "AI 被告");
    const s = m.humanJoin("defendant", "u-9", "我是被告");
    expect(s!.playerType).toBe("human");
    expect(s!.userId).toBe("u-9");
    expect(s!.nickname).toBe("我是被告");
    expect(m.isHuman("defendant")).toBe(true);
    expect(m.humanCount()).toBe(1);
    expect(m.aiCount()).toBe(0);
  });

  it("humanJoin 未注册 slot：返回 undefined，不抛错", () => {
    const m = new AiFillManager();
    expect(m.humanJoin("ghost", "u1", "x")).toBeUndefined();
  });

  it("humanJoin 同一用户占多个位：旧位自动让位给 AI", () => {
    const m = new AiFillManager();
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.registerSlot("defendant", "被告", "AI 被告");
    m.humanJoin("plaintiff", "u1", "张三");
    // 同一 u1 坐到被告位
    m.humanJoin("defendant", "u1", "张三");
    expect(m.isHuman("defendant")).toBe(true);
    expect(m.get("plaintiff")!.playerType).toBe("ai");
    expect(m.get("plaintiff")!.nickname).toBe("AI 原告");
    expect(m.humanCount()).toBe(1);
  });

  it("humanJoin 第二个人占同一位：替换原真人", () => {
    const m = new AiFillManager();
    m.registerSlot("witness", "证人", "AI 证人");
    m.humanJoin("witness", "u1", "先手");
    m.humanJoin("witness", "u2", "后手");
    const s = m.get("witness")!;
    expect(s.userId).toBe("u2");
    expect(s.nickname).toBe("后手");
    expect(m.slotOfUser("u1")).toBeUndefined();
  });
});

describe("ai-fill-manager: 真人离开 AI 接管", () => {
  it("humanLeave：真人离开后 AI 重新接管，昵称恢复 AI 兜底名", () => {
    const m = new AiFillManager();
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.humanJoin("plaintiff", "u1", "真人原告");
    const back = m.humanLeave("plaintiff")!;
    expect(back.playerType).toBe("ai");
    expect(back.userId).toBeUndefined();
    expect(back.nickname).toBe("AI 原告");
    expect(m.humanCount()).toBe(0);
  });

  it("humanLeave 未注册 slot：返回 undefined", () => {
    const m = new AiFillManager();
    expect(m.humanLeave("nope")).toBeUndefined();
  });
});

describe("ai-fill-manager: 超时检测", () => {
  it("markActive 后 isHumanTimedOut 在窗口内为 false", () => {
    let t = 1000;
    const m = new AiFillManager({ now: () => t });
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.humanJoin("plaintiff", "u1", "真人");
    t = 1000 + 9_000; // 走了 9s
    m.markActive("u1");
    t = 1000 + 9_000 + 5_000; // 再走 5s（距活动 5s < 15s）
    expect(m.isHumanTimedOut("u1", 15_000)).toBe(false);
  });

  it("isHumanTimedOut：超过阈值返回 true", () => {
    let t = 0;
    const m = new AiFillManager({ now: () => t });
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.humanJoin("plaintiff", "u1", "真人"); // lastActiveAt = 0
    t = 20_000;
    expect(m.isHumanTimedOut("u1", 15_000)).toBe(true);
  });

  it("AI slot 永不超时；未活动过的真人不算超时", () => {
    let t = 1000;
    const m = new AiFillManager({ now: () => t });
    m.registerSlot("defendant", "被告", "AI 被告");
    // AI slot：没有 userId
    expect(m.isHumanTimedOut("nobody", 1_000)).toBe(false);
  });
});

describe("ai-fill-manager: 列表与标识", () => {
  it("list：按注册顺序返回全部 slot 拷贝", () => {
    const m = new AiFillManager();
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.registerSlot("defendant", "被告", "AI 被告");
    m.registerSlot("witness", "证人", "AI 证人");
    m.humanJoin("defendant", "u1", "真人被告");
    const list = m.list();
    expect(list.map((s) => s.slotId)).toEqual(["plaintiff", "defendant", "witness"]);
    expect(list[1].playerType).toBe("human");
  });

  it("toParticipants：导出带 playerType 的参与列表（真人徽章数据）", () => {
    const m = new AiFillManager();
    m.registerSlot("plaintiff", "原告", "AI 原告");
    m.registerSlot("defendant", "被告", "AI 被告");
    m.humanJoin("plaintiff", "u1", "真人原告");
    const parts = m.toParticipants();
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ slotId: "plaintiff", playerType: "human", nickname: "真人原告", userId: "u1" });
    expect(parts[1]).toMatchObject({ slotId: "defendant", playerType: "ai", nickname: "AI 被告" });
    expect(parts[1].userId).toBeUndefined();
  });

  it("slotOfUser：按 userId 反查 slot", () => {
    const m = new AiFillManager();
    m.registerSlot("witness", "证人", "AI 证人");
    m.humanJoin("witness", "u-7", "目击证人");
    expect(m.slotOfUser("u-7")?.slotId).toBe("witness");
    expect(m.slotOfUser("ghost")).toBeUndefined();
  });
});
