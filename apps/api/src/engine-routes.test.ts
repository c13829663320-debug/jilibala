// ===== 新引擎 REST 路由测试（狼人杀 + 酒吧）=====
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerEngineRoutes } from "./engine-routes.js";

function makeApp() {
  const app = Fastify();
  registerEngineRoutes(app);
  return app;
}

describe("引擎路由 · 酒吧", () => {
  it("new → pick_angle → 3 回合后 finished", async () => {
    const app = makeApp();
    const newRes = await app.inject({
      method: "POST",
      url: "/api/engine/bar/new",
      payload: { topic: "测试辩题", playerSide: "pro" },
    });
    expect(newRes.statusCode).toBe(200);
    const { id, snapshot } = newRes.json() as any;
    expect(id).toMatch(/^bar-/);
    expect(snapshot.topic).toBe("测试辩题");
    expect(snapshot.round).toBe(1);
    expect(snapshot.balance.player).toBe(50);

    // 打 3 回合
    for (let r = 1; r <= 3; r += 1) {
      const actRes = await app.inject({
        method: "POST",
        url: `/api/engine/bar/${id}/act`,
        payload: { kind: "pick_angle", angle: "data", text: `第${r}回合用数据反驳，统计显示80%的人同意` },
      });
      expect(actRes.statusCode).toBe(200);
      const body = actRes.json() as any;
      expect(body.snapshot.transcript.length).toBe(r * 2);
    }
    const final = (await app.inject({ method: "GET", url: `/api/engine/bar/${id}` })).json() as any;
    expect(final.snapshot.finished).toBe(true);
    expect(final.snapshot.result).not.toBeNull();
  });

  it("bar-daily 返回挑战", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/engine/bar-daily" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("title");
  });
});

describe("引擎路由 · 狼人杀", () => {
  it("new → 夜晚行动 → 白天 → 投票 → 推进", async () => {
    const app = makeApp();
    const newRes = await app.inject({
      method: "POST",
      url: "/api/engine/werewolf/new",
      payload: { forceHumanRole: "seer" },
    });
    expect(newRes.statusCode).toBe(200);
    const { id, snapshot } = newRes.json() as any;
    expect(id).toMatch(/^ww-/);
    expect(snapshot.myRole).toBe("seer");
    expect(snapshot.pendingAction).toBe("night_check");

    // 预言家查验座位 1
    const actRes = await app.inject({
      method: "POST",
      url: `/api/engine/werewolf/${id}/act`,
      payload: { kind: "night_check", target: 1 },
    });
    expect(actRes.statusCode).toBe(200);
    const afterNight = actRes.json() as any;
    // 夜晚结束后应进入 speech 或已结束
    expect(["speech", "ended"]).toContain(afterNight.snapshot.sub);
    expect(afterNight.snapshot.seerResults?.length ?? 0).toBeGreaterThanOrEqual(1);

    if (afterNight.snapshot.sub === "speech") {
      // 打一个动作牌
      await app.inject({
        method: "POST",
        url: `/api/engine/werewolf/${id}/act`,
        payload: { kind: "day_action", action: { kind: "pass" } },
      });
      // 结束发言 → 投票
      const voteRes = await app.inject({
        method: "POST",
        url: `/api/engine/werewolf/${id}/act`,
        payload: { kind: "day_vote", target: 1 },
      });
      expect(voteRes.statusCode).toBe(200);
    }
  });

  it("私密视角：?seat=1 不泄露身份", async () => {
    const app = makeApp();
    const newRes = await app.inject({
      method: "POST",
      url: "/api/engine/werewolf/new",
      payload: { forceHumanRole: "seer" },
    });
    const { id } = newRes.json() as any;
    const res = await app.inject({ method: "GET", url: `/api/engine/werewolf/${id}?seat=1` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.snapshot.myRole).toBeUndefined();
    expect(body.snapshot.seerResults).toBeUndefined();
  });

  it("werewolf-daily 返回挑战", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/engine/werewolf-daily" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("title");
  });
});
