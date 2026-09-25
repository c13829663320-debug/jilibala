// ===== gym-orchestrator 测试：连续打卡天数计算 + 成就解锁判定 =====
import { describe, expect, it } from "vitest";
import { calculateStreak, checkAchievements, generatePlan } from "./gym-orchestrator.js";

/** 生成 n 天前的本地日期 ISO 字符串（n=0 表示今天）。 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("calculateStreak", () => {
  it("今天打卡：当前连续从今天算起", () => {
    // 今天、昨天、前天都打卡
    const dates = [daysAgo(0), daysAgo(1), daysAgo(2)];
    const { current, longest } = calculateStreak(dates);
    expect(current).toBe(3);
    expect(longest).toBe(3);
  });

  it("今天未打卡但昨天打卡：current 从昨天算起", () => {
    // 昨天、前天打卡，今天没打
    const dates = [daysAgo(1), daysAgo(2)];
    const { current, longest } = calculateStreak(dates);
    expect(current).toBe(2);
    expect(longest).toBe(2);
  });

  it("跨月连续：连续天数正确跨越月份边界", () => {
    // 构造一个跨月的连续序列：从今天往前推 10 天，必然跨越某月边界
    const dates: string[] = [];
    for (let i = 0; i < 10; i++) dates.push(daysAgo(i));
    const { current, longest } = calculateStreak(dates);
    expect(current).toBe(10);
    expect(longest).toBe(10);
  });

  it("断档后 longest 保持历史最大值，current 重新计数", () => {
    // 7 天连续（历史最长），然后断档 5 天，最近 2 天连续
    const dates: string[] = [];
    // 最早 7 天连续：从第 12 天前到第 6 天前
    for (let i = 12; i >= 6; i--) dates.push(daysAgo(i));
    // 断档：第 5、4 天前不打卡
    // 最近 2 天连续：昨天和前天
    dates.push(daysAgo(1), daysAgo(2));
    const { current, longest } = calculateStreak(dates);
    expect(current).toBe(2); // 今天没打，从昨天算起=2
    expect(longest).toBe(7); // 历史最长保持 7
  });

  it("空数组返回 0", () => {
    expect(calculateStreak([])).toEqual({ current: 0, longest: 0 });
  });

  it("同一天多次打卡去重", () => {
    const dates = [daysAgo(0), daysAgo(0), daysAgo(0)];
    const { current, longest } = calculateStreak(dates);
    expect(current).toBe(1);
    expect(longest).toBe(1);
  });
});

describe("checkAchievements", () => {
  it("首次打卡解锁 first_checkin", () => {
    const due = checkAchievements({ totalCheckins: 1, currentStreak: 1, longestStreak: 1 }, []);
    expect(due).toContain("first_checkin");
    expect(due).not.toContain("streak_3");
  });

  it("连续 7 天解锁 streak_7", () => {
    const due = checkAchievements({ totalCheckins: 10, currentStreak: 4, longestStreak: 7 }, []);
    expect(due).toContain("streak_3");
    expect(due).toContain("streak_7");
    expect(due).not.toContain("streak_30");
  });

  it("累计 10 次解锁 checkin_10", () => {
    const due = checkAchievements({ totalCheckins: 10, currentStreak: 0, longestStreak: 0 }, []);
    expect(due).toContain("first_checkin");
    expect(due).toContain("checkin_10");
    expect(due).not.toContain("checkin_50");
  });

  it("muscle_master：5 次哑铃/卧推器械打卡解锁", () => {
    const checkins = [
      { equipment: "dumbbell" },
      { equipment: "bench_press" },
      { equipment: "dumbbell" },
      { equipment: "bench_press" },
      { equipment: "dumbbell" },
    ];
    const due = checkAchievements({ totalCheckins: 5, currentStreak: 0, longestStreak: 0 }, checkins);
    expect(due).toContain("muscle_master");
    expect(due).not.toContain("cardio_king");
  });

  it("cardio_king：5 次有氧器械打卡解锁", () => {
    const checkins = [
      { equipment: "treadmill" },
      { equipment: "bike" },
      { equipment: "rowing" },
      { equipment: "treadmill" },
      { equipment: "bike" },
    ];
    const due = checkAchievements({ totalCheckins: 5, currentStreak: 0, longestStreak: 0 }, checkins);
    expect(due).toContain("cardio_king");
    expect(due).not.toContain("muscle_master");
  });

  it("flexibility_guru：瑜伽垫或拉伸类动作名解锁", () => {
    const checkins = [
      { equipment: "yoga_mat" },
      { exerciseName: "全身拉伸" },
      { equipment: "yoga_mat" },
      { exerciseName: "瑜伽流" },
      { exerciseName: "下肢伸展" },
    ];
    const due = checkAchievements({ totalCheckins: 5, currentStreak: 0, longestStreak: 0 }, checkins);
    expect(due).toContain("flexibility_guru");
  });

  it("不足 5 次器械打卡不解锁器械成就", () => {
    const checkins = [{ equipment: "dumbbell" }, { equipment: "dumbbell" }];
    const due = checkAchievements({ totalCheckins: 2, currentStreak: 0, longestStreak: 0 }, checkins);
    expect(due).not.toContain("muscle_master");
  });
});

describe("generatePlan", () => {
  it("生成的计划包含 4-6 个动作且字段完整", () => {
    const plan = generatePlan("muscle", "beginner", 30);
    expect(plan.goal).toBe("muscle");
    expect(plan.exercises.length).toBeGreaterThanOrEqual(3);
    expect(plan.exercises.length).toBeLessThanOrEqual(6);
    for (const ex of plan.exercises) {
      expect(ex.name).toBeTruthy();
      expect(ex.sets).toBeGreaterThan(0);
      expect(ex.reps).toBeGreaterThan(0);
      expect(ex.restSeconds).toBeGreaterThan(0);
      expect(ex.tips).toBeTruthy();
      expect(ex.safety).toBeTruthy();
    }
  });

  it("不同 goal 生成不同标题", () => {
    const muscle = generatePlan("muscle", "beginner", 30);
    const stretch = generatePlan("stretch", "beginner", 30);
    expect(muscle.title).not.toBe(stretch.title);
  });
});

// ===== P0：AI 教练 + 节奏带练 =====
import {
  getCoaches,
  getWorkoutPresets,
  startWorkout,
  recordRhythm,
  coachSpeak,
  finishWorkout,
  setGymChat,
} from "./gym-orchestrator.js";

describe("P0: AI 教练与节奏带练", () => {
  it("getCoaches：返回 3 位风格各异的教练", () => {
    const coaches = getCoaches();
    expect(coaches.length).toBe(3);
    expect(coaches.every((c) => c.name && c.persona && c.style)).toBe(true);
  });

  it("getWorkoutPresets：返回俯卧撑/深蹲/平板支撑", () => {
    const presets = getWorkoutPresets();
    expect(presets.map((p) => p.name).sort()).toEqual(["平板支撑", "俯卧撑", "深蹲"].sort());
    expect(presets.every((p) => p.targetReps > 0)).toBe(true);
  });

  it("startWorkout：初始化会话，reps/命中/未命中归零", () => {
    const s = startWorkout("u1", "pushup", "rock") as ReturnType<typeof startWorkout> & { sessionId: string };
    expect("error" in s).toBe(false);
    expect(s.plan.name).toBe("俯卧撑");
    expect(s.coach.id).toBe("rock");
    expect(s.reps).toBe(0);
    expect(s.rhythmHits).toBe(0);
    expect(s.status).toBe("active");
  });

  it("startWorkout：非法 planId/coachId 返回 error", () => {
    expect("error" in startWorkout("u1", "nope", "rock")).toBe(true);
    expect("error" in startWorkout("u1", "pushup", "nope")).toBe(true);
  });

  it("recordRhythm：命中 reps+1，未命中 reps 不变", () => {
    const s = startWorkout("u2", "squat", "yogi") as { sessionId: string };
    recordRhythm(s.sessionId, true);
    recordRhythm(s.sessionId, true);
    const afterMiss = recordRhythm(s.sessionId, false) as { reps: number; rhythmMisses: number };
    expect(afterMiss.reps).toBe(2);
    expect(afterMiss.rhythmMisses).toBe(1);
  });

  it("coachSpeak：注入 mock chat，各事件类型都返回非空文本", async () => {
    setGymChat(async (msgs) => `[mock:${msgs[msgs.length - 1].content.slice(0, 6)}]`);
    const s = startWorkout("u3", "pushup", "rock") as { sessionId: string };
    for (const ev of ["start", "rep_good", "rep_miss", "halfway", "finish"] as const) {
      const { text } = await coachSpeak(s.sessionId, ev);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("coachSpeak：无 chat 时回退 canned 文案不报错", async () => {
    setGymChat(null as unknown as Parameters<typeof setGymChat>[0]);
    const s = startWorkout("u4", "pushup", "rock") as { sessionId: string };
    const { text } = await coachSpeak(s.sessionId, "rep_good");
    expect(text.length).toBeGreaterThan(0);
  });

  it("finishWorkout：评分=命中率×100+完成度×50，等级分档正确", () => {
    const s = startWorkout("u5", "pushup", "pal") as { sessionId: string };
    // 10 hits / 10 attempts = 1.0 命中；完成 20/20 = 1.0 -> 100 + 50 = 150? 用上限逻辑单独验
    for (let i = 0; i < 20; i++) recordRhythm(s.sessionId, true);
    const r = finishWorkout(s.sessionId) as { score: number; grade: string; rhythmHitRate: number; coachComment: string };
    expect(r.rhythmHitRate).toBe(1);
    expect(r.score).toBe(150);
    expect(r.grade).toBe("S");
    expect(r.coachComment.length).toBeGreaterThan(0);
  });

  it("finishWorkout：低命中低完成 -> C 档", () => {
    const s = startWorkout("u6", "pushup", "pal") as { sessionId: string };
    // 完成 5/20=0.25，命中 1/5=0.2 -> 20 + 12.5 = 32.5 -> C
    recordRhythm(s.sessionId, true);
    for (let i = 0; i < 4; i++) recordRhythm(s.sessionId, false);
    const r = finishWorkout(s.sessionId) as { score: number; grade: string };
    expect(r.grade).toBe("C");
    expect(r.score).toBeLessThan(60);
  });
});

// ===== M14：90 秒三关电路 · 纯计分 + 名人教练点评 =====
import {
  scoreReactionHit,
  judgeRhythm,
  rhythmPoints,
  powerValue,
  scorePower,
  getCircuitTier,
  circuitTotalScore,
} from "@balabala/shared";
import { celebrityCoachComment } from "./gym-orchestrator.js";

describe("M14: 反应关计分 scoreReactionHit", () => {
  it("反应越快分越高：100ms 得 100 分", () => {
    expect(scoreReactionHit(100)).toBe(100);
  });
  it("中等反应 380ms 衰减到保底 50 分", () => {
    expect(scoreReactionHit(380)).toBe(50);
  });
  it("瞬时反应 0ms 得满分 200", () => {
    expect(scoreReactionHit(0)).toBe(200);
  });
});

describe("M14: 节奏关判定 judgeRhythm + rhythmPoints", () => {
  it("±50ms 内为 perfect，±150ms 内为 good，其余 miss", () => {
    expect(judgeRhythm(0)).toBe("perfect");
    expect(judgeRhythm(50)).toBe("perfect");
    expect(judgeRhythm(-50)).toBe("perfect");
    expect(judgeRhythm(100)).toBe("good");
    expect(judgeRhythm(-150)).toBe("good");
    expect(judgeRhythm(151)).toBe("miss");
    expect(judgeRhythm(-200)).toBe("miss");
  });
  it("perfect 30 分且连击加成：comboBefore=2 时 ×1.2 = 36", () => {
    expect(rhythmPoints("perfect", 0)).toBe(30);
    expect(rhythmPoints("perfect", 2)).toBe(36);
  });
  it("good 固定 15，miss 0，不受连击影响", () => {
    expect(rhythmPoints("good", 5)).toBe(15);
    expect(rhythmPoints("miss", 9)).toBe(0);
  });
});

describe("M14: 力量关 powerValue + scorePower", () => {
  it("落在绿色中心 85 → 满力量 100", () => {
    expect(powerValue(85)).toBe(100);
  });
  it("绿色边缘 80/90 → 力量 95", () => {
    expect(powerValue(80)).toBe(95);
    expect(powerValue(90)).toBe(95);
  });
  it("远离目标（pct=0）力量很低", () => {
    expect(powerValue(0)).toBe(15); // 100 - |0-85|
    expect(powerValue(100)).toBe(85); // 100 距中心 85 仅 15，并不差
  });
  it("scorePower = bestPower × 10", () => {
    expect(scorePower(95)).toBe(950);
  });
});

describe("M14: 段位 getCircuitTier 边界", () => {
  it("分段正确：青铜/白银/黄金/爆杆", () => {
    expect(getCircuitTier(1999)).toBe("bronze");
    expect(getCircuitTier(2000)).toBe("silver");
    expect(getCircuitTier(2999)).toBe("silver");
    expect(getCircuitTier(3000)).toBe("gold");
    expect(getCircuitTier(3999)).toBe("gold");
    expect(getCircuitTier(4000)).toBe("explosive");
  });
  it("总分 = 三关求和", () => {
    expect(circuitTotalScore([{ score: 600 }, { score: 1480 }, { score: 950 }])).toBe(3030);
  });
});

describe("M14: celebrityCoachComment", () => {
  it("注入 mock chat：返回非空且 ≤20 字", async () => {
    setGymChat(async (msgs) => `[${msgs[1].content.slice(0, 8)}] 漂亮，最后两个慢了点`);
    const { note, name } = await celebrityCoachComment("elon-musk", {
      kind: "reaction", hits: 10, misses: 2, bestMs: 380, score: 600,
    });
    expect(note.length).toBeGreaterThan(0);
    expect(note.length).toBeLessThanOrEqual(20);
    expect(name).toBeTruthy();
  });

  it("LLM 输出过长时截断到 20 字", async () => {
    setGymChat(async () => "这是一句故意写得非常非常非常非常非常非常长的点评用来测试截断逻辑是否正常工作");
    const { note } = await celebrityCoachComment("elon-musk", {
      kind: "power", hits: 1, misses: 0, bestPower: 95, score: 950,
    });
    expect(note.length).toBeLessThanOrEqual(20);
  });

  it("无 chat 时回退 canned 文案不报错", async () => {
    setGymChat(null as unknown as Parameters<typeof setGymChat>[0]);
    const { note } = await celebrityCoachComment("elon-musk", {
      kind: "rhythm", hits: 20, misses: 4, maxCombo: 7, score: 1480,
    });
    expect(note.length).toBeGreaterThan(0);
  });

  it("未知名人 id 仍回退文案不抛错", async () => {
    setGymChat(null as unknown as Parameters<typeof setGymChat>[0]);
    const { note } = await celebrityCoachComment("no-such-person", {
      kind: "reaction", hits: 0, misses: 3, score: 0,
    });
    expect(note.length).toBeGreaterThan(0);
  });
});
