// ===== transport.ts 纯逻辑单测：心跳/会话/补发/平滑断开/恢复，不启动真实 WS =====
import { describe, expect, it } from "vitest";
import { TransportEngine, DEFAULT_TRANSPORT_CONFIG } from "./transport.js";

/** 假时钟：可控 ms。 */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

/** 假 socket：只需要 readyState（engine 不直接发送，由 ws.ts 注入）。 */
function fakeSocket() {
  return { readyState: 1 } as unknown as import("ws").WebSocket;
}

describe("TransportEngine 会话与心跳", () => {
  it("issueSession：签发 token 字段完整 + welcome 下发 HeartbeatConfig", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session, token, heartbeat } = eng.issueSession("u1", "social:ABC", fakeSocket());

    expect(session.sessionId).toBeTruthy();
    expect(token.sessionId).toBe(session.sessionId);
    expect(token.userId).toBe("u1");
    expect(token.roomId).toBe("social:ABC");
    expect(token.issuedAt).toBe(clock.now());
    expect(token.expiresAt).toBe(clock.now() + DEFAULT_TRANSPORT_CONFIG.sessionTtlMs);
    expect(heartbeat).toEqual({
      pingIntervalMs: DEFAULT_TRANSPORT_CONFIG.pingIntervalMs,
      timeoutMs: DEFAULT_TRANSPORT_CONFIG.heartbeatTimeoutMs,
      reconnectWindowMs: DEFAULT_TRANSPORT_CONFIG.reconnectWindowMs,
    });
    expect(session.state).toBe("active");
  });

  it("applyPing：刷新最后 ping 时间，pong 回带 clientSeq/serverTs/playerCount", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "plaza", fakeSocket());
    clock.advance(10_000);
    const pong = eng.applyPing(session, 7, 3);
    expect(pong.clientSeq).toBe(7);
    expect(pong.serverTs).toBe(clock.now());
    expect(pong.playerCount).toBe(3);
    // 刚 ping 过，不应被判超时
    expect(eng.findTimedOutSessions(clock.now())).toHaveLength(0);
  });

  it("findTimedOutSessions：超过 heartbeatTimeoutMs 未 ping 才判定掉线", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "plaza", fakeSocket());
    // 44s 还在阈值内
    clock.advance(44_000);
    expect(eng.findTimedOutSessions(clock.now())).toHaveLength(0);
    // 46s 超过 45s 默认阈值
    clock.advance(2_000);
    const timedOut = eng.findTimedOutSessions(clock.now());
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].sessionId).toBe(session.sessionId);
  });

  it("自定义配置：心跳超时可覆盖", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now, config: { heartbeatTimeoutMs: 5_000 } });
    eng.issueSession("u1", "plaza", fakeSocket());
    clock.advance(4_000);
    expect(eng.findTimedOutSessions(clock.now())).toHaveLength(0);
    clock.advance(2_000);
    expect(eng.findTimedOutSessions(clock.now())).toHaveLength(1);
  });
});

describe("TransportEngine 在途消息补发", () => {
  it("bufferBroadcast：单调 seq，replaySince 取 lastServerSeq 之后", () => {
    const eng = new TransportEngine();
    const s1 = eng.bufferBroadcast("social:R1", { type: "chat", text: "a" });
    const s2 = eng.bufferBroadcast("social:R1", { type: "chat", text: "b" });
    const s3 = eng.bufferBroadcast("social:R1", { type: "chat", text: "c" });
    expect([s1, s2, s3]).toEqual([1, 2, 3]);

    // 客户端最后收到 seq=1，补发 2、3
    const missed = eng.replaySince("social:R1", 1);
    expect(missed.map((m) => m.seq)).toEqual([2, 3]);
    // 已经追到最新：无缺失
    expect(eng.replaySince("social:R1", 3)).toHaveLength(0);
  });

  it("环形缓冲：超过 replayBufferSize 丢弃最旧", () => {
    const eng = new TransportEngine({ config: { replayBufferSize: 3 } });
    eng.bufferBroadcast("plaza", { n: 1 });
    eng.bufferBroadcast("plaza", { n: 2 });
    eng.bufferBroadcast("plaza", { n: 3 });
    eng.bufferBroadcast("plaza", { n: 4 }); // 挤掉 seq=1
    const missed = eng.replaySince("plaza", 0);
    expect(missed.map((m) => m.seq)).toEqual([2, 3, 4]);
  });
});

describe("TransportEngine 平滑断开与恢复", () => {
  it("beginGraceful：进入 reconnecting，保留窗口内不被 findExpiredGraceSessions 判定", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "social:R1", fakeSocket());
    clock.advance(10_000);
    const deadline = eng.beginGraceful(session);
    expect(session.state).toBe("reconnecting");
    expect(session.socket).toBeNull();
    expect(deadline).toBe(clock.now() + DEFAULT_TRANSPORT_CONFIG.reconnectWindowMs);

    // 窗口内：未过期
    clock.advance(DEFAULT_TRANSPORT_CONFIG.reconnectWindowMs - 1_000);
    expect(eng.findExpiredGraceSessions(clock.now())).toHaveLength(0);
    // 超过窗口：应被清理
    clock.advance(2_000);
    expect(eng.findExpiredGraceSessions(clock.now())).toHaveLength(1);
  });

  it("tryResume：窗口内恢复成功，重挂 socket 并补发缺失消息", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "social:R1", fakeSocket());
    // 离开期间房间广播了两条
    eng.bufferBroadcast("social:R1", { type: "chat", text: "mid1" });
    eng.bufferBroadcast("social:R1", { type: "chat", text: "mid2" });

    eng.beginGraceful(session);
    clock.advance(5_000); // 5s 后重连（窗口内）

    const newSocket = fakeSocket();
    const out = eng.tryResume({ sessionId: session.sessionId, newSocket, lastServerSeq: 0 });
    expect(out.accepted).toBe(true);
    expect(out.session?.state).toBe("active");
    expect(out.session?.socket).toBe(newSocket);
    // lastServerSeq=0 -> 两条都补发
    expect(out.missed.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("tryResume：已超过重连窗口 -> 拒绝并销毁会话", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "social:R1", fakeSocket());
    eng.beginGraceful(session);
    clock.advance(DEFAULT_TRANSPORT_CONFIG.reconnectWindowMs + 1_000);
    const out = eng.tryResume({ sessionId: session.sessionId, newSocket: fakeSocket(), lastServerSeq: 0 });
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("session_expired");
    expect(eng.getSession(session.sessionId)).toBeUndefined();
  });

  it("tryResume：未知 sessionId -> 拒绝", () => {
    const eng = new TransportEngine();
    const out = eng.tryResume({ sessionId: "nope", newSocket: fakeSocket(), lastServerSeq: 0 });
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("session_expired");
  });

  it("destroySession：从注册表与用户索引中移除", () => {
    const clock = fakeClock();
    const eng = new TransportEngine({ now: clock.now });
    const { session } = eng.issueSession("u1", "plaza", fakeSocket());
    expect(eng.getSessionByUser("plaza", "u1")).toBeDefined();
    eng.destroySession(session);
    expect(eng.getSession(session.sessionId)).toBeUndefined();
    expect(eng.getSessionByUser("plaza", "u1")).toBeUndefined();
  });
});
