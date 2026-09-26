// ===== 多人网络专项 · 传输层与会话/重连引擎 =====
// 服务端权威：心跳超时判定、会话签发/恢复、在途广播补发、平滑断开窗口。
// 本模块只持有纯状态机 + 纯函数判定，不直接发 socket；副作用（广播/删除/房主转移）
// 由 ws.ts 通过 Hooks 注入，便于在 vitest 中用假 socket 单测。
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  HeartbeatConfig,
  NetEnvelope,
  PongPayload,
  ReconnectProgress,
  SessionToken,
} from "@balabala/shared";

// ---------------------------------------------------------------------------
// 配置与默认值
// ---------------------------------------------------------------------------

export interface TransportConfig {
  /** 客户端 ping 建议间隔（ms），welcome 下发。 */
  pingIntervalMs: number;
  /** 超过该时长未收到 ping 判定掉线（服务端权威）。 */
  heartbeatTimeoutMs: number;
  /** 掉线后席位/会话保留窗口（ms）。 */
  reconnectWindowMs: number;
  /** SessionToken 有效期（ms），重连窗口内有效。 */
  sessionTtlMs: number;
  /** 每房间在途广播缓冲条数（按 seq 环形）。 */
  replayBufferSize: number;
  /** 单条入站消息最大字节数，超过直接拒绝。 */
  maxMessageBytes: number;
}

export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  pingIntervalMs: 15_000,
  heartbeatTimeoutMs: 45_000,
  reconnectWindowMs: 120_000,
  sessionTtlMs: 120_000,
  replayBufferSize: 50,
  maxMessageBytes: 16 * 1024,
};

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------

export type LiveSessionState = "active" | "reconnecting" | "closed";

export interface TransportSession {
  sessionId: string;
  userId: string;
  roomId: string;
  state: LiveSessionState;
  /** 当前活跃 socket；reconnecting 期间为 null（席位仍保留）。 */
  socket: WebSocket | null;
  /** 最近一次收到 ping 的时间戳。 */
  lastPingAt: number;
  /** 加入房间时间（用于房主转移时挑选最早成员）。 */
  joinedAt: number;
  issuedAt: number;
  expiresAt: number;
  /** state=reconnecting 时的硬截止；超过即真正移除。 */
  reconnectDeadlineAt: number;
  /** 该客户端最后已应用的服务端广播 seq。 */
  lastServerSeq: number;
}

export interface BufferedBroadcast {
  seq: number;
  message: unknown;
}

interface ReplayBuffer {
  nextSeq: number;
  entries: BufferedBroadcast[];
}

export type RejectReason = "session_expired" | "room_closed" | "kicked" | "room_full" | "unknown";

export interface ResumeOutcome {
  accepted: boolean;
  reason?: RejectReason;
  session?: TransportSession;
  /** lastServerSeq 之后缺失的在途广播（按 seq 升序）。 */
  missed: BufferedBroadcast[];
  heartbeat: HeartbeatConfig;
}

/** 引擎副作用钩子（由 ws.ts 注入，便于测试替换）。 */
export interface TransportHooks {
  /** 心跳超时：强制踢掉 half-open socket（会触发 close -> 平滑断开）。 */
  onHeartbeatTimeout(session: TransportSession): void;
  /** 平滑窗口结束：真正移除席位、广播 user_left、必要时转移房主。 */
  onGraceExpired(session: TransportSession): void;
}

type Clock = () => number;

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

export class TransportEngine {
  config: TransportConfig;
  private now: Clock;
  private hooks: TransportHooks;

  private readonly sessions = new Map<string, TransportSession>();
  /** `${roomId}\n${userId}` -> sessionId（同一用户同房间仅一个会话）。 */
  private readonly byUserKey = new Map<string, string>();
  private readonly buffers = new Map<string, ReplayBuffer>();

  constructor(opts: {
    config?: Partial<TransportConfig>;
    now?: Clock;
    hooks?: Partial<TransportHooks>;
  } = {}) {
    this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...(opts.config ?? {}) };
    this.now = opts.now ?? (() => Date.now());
    this.hooks = {
      onHeartbeatTimeout: () => {},
      onGraceExpired: () => {},
      ...(opts.hooks ?? {}),
    };
  }

  /** 测试隔离：清空全部会话与缓冲。 */
  reset(): void {
    this.sessions.clear();
    this.byUserKey.clear();
    this.buffers.clear();
  }

  heartbeatConfig(): HeartbeatConfig {
    return {
      pingIntervalMs: this.config.pingIntervalMs,
      timeoutMs: this.config.heartbeatTimeoutMs,
      reconnectWindowMs: this.config.reconnectWindowMs,
    };
  }

  private userKey(roomId: string, userId: string): string {
    return `${roomId}\n${userId}`;
  }

  // -------------------------------------------------------------------------
  // 会话签发 / 查询
  // -------------------------------------------------------------------------

  /** 为全新连接签发会话，并返回 welcome 所需的 token 与心跳配置。 */
  issueSession(userId: string, roomId: string, socket: WebSocket): {
    session: TransportSession;
    token: SessionToken;
    heartbeat: HeartbeatConfig;
  } {
    const now = this.now();
    // 同用户同房间若有残留会话（如旧连接未走优雅流程），先回收，避免悬挂。
    const staleSid = this.byUserKey.get(this.userKey(roomId, userId));
    if (staleSid) this.sessions.delete(staleSid);

    const sessionId = randomUUID();
    const session: TransportSession = {
      sessionId,
      userId,
      roomId,
      state: "active",
      socket,
      lastPingAt: now,
      joinedAt: now,
      issuedAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      reconnectDeadlineAt: 0,
      lastServerSeq: 0,
    };
    this.sessions.set(sessionId, session);
    this.byUserKey.set(this.userKey(roomId, userId), sessionId);

    const token: SessionToken = {
      sessionId,
      userId,
      roomId,
      issuedAt: now,
      expiresAt: session.expiresAt,
    };
    return { session, token, heartbeat: this.heartbeatConfig() };
  }

  getSession(sessionId: string | undefined | null): TransportSession | undefined {
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  getSessionByUser(roomId: string, userId: string): TransportSession | undefined {
    const sid = this.byUserKey.get(this.userKey(roomId, userId));
    return sid ? this.sessions.get(sid) : undefined;
  }

  // -------------------------------------------------------------------------
  // 心跳
  // -------------------------------------------------------------------------

  /** 收到客户端 ping：刷新活跃时间，构造回包 pong。 */
  applyPing(session: TransportSession, clientSeq: number | undefined, playerCount: number): PongPayload {
    session.lastPingAt = this.now();
    return {
      clientSeq: typeof clientSeq === "number" ? clientSeq : -1,
      serverTs: this.now(),
      playerCount,
    };
  }

  /** 纯函数：当前 active 但超过 heartbeatTimeoutMs 未 ping 的会话。 */
  findTimedOutSessions(now: number = this.now()): TransportSession[] {
    const out: TransportSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.state === "active" && s.socket && now - s.lastPingAt > this.config.heartbeatTimeoutMs) {
        out.push(s);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 在途广播缓冲（补发）
  // -------------------------------------------------------------------------

  /** 为一条房间广播分配单调 seq 并环形缓冲。返回分配到的 seq。 */
  bufferBroadcast(roomId: string, message: unknown): number {
    let buf = this.buffers.get(roomId);
    if (!buf) {
      buf = { nextSeq: 1, entries: [] };
      this.buffers.set(roomId, buf);
    }
    const seq = buf.nextSeq++;
    buf.entries.push({ seq, message });
    if (buf.entries.length > this.config.replayBufferSize) buf.entries.shift();
    return seq;
  }

  /** 取 lastServerSeq 之后缺失的在途广播（按 seq 升序）。 */
  replaySince(roomId: string, lastServerSeq: number): BufferedBroadcast[] {
    const buf = this.buffers.get(roomId);
    if (!buf) return [];
    return buf.entries.filter((e) => e.seq > lastServerSeq);
  }

  /** 当前房间已分配到的最大 seq（welcome/快照里可带，供客户端对齐）。 */
  lastSeq(roomId: string): number {
    return this.buffers.get(roomId)?.nextSeq ?? 1;
  }

  // -------------------------------------------------------------------------
  // 平滑断开 & 恢复
  // -------------------------------------------------------------------------

  /**
   * 进入 reconnecting 窗口：不立即删除席位，保留 RoomUser（位置/加入顺序不变）。
   * 返回 reconnectDeadlineAt；调用方据此广播 player_disconnecting。
   */
  beginGraceful(session: TransportSession): number {
    session.state = "reconnecting";
    session.socket = null;
    const now = this.now();
    session.reconnectDeadlineAt = now + this.config.reconnectWindowMs;
    return session.reconnectDeadlineAt;
  }

  /**
   * 尝试用一个新 socket 恢复会话。
   * - 仅当会话处于 reconnecting 且仍在窗口内才接受。
   * - 接受后重挂 socket、清掉窗口截止、重算在途补发。
   */
  tryResume(opts: {
    sessionId: string;
    newSocket: WebSocket;
    lastServerSeq: number;
  }): ResumeOutcome {
    const { sessionId, newSocket, lastServerSeq } = opts;
    const now = this.now();
    const heartbeat = this.heartbeatConfig();
    const session = this.sessions.get(sessionId);
    if (!session || session.state === "closed") {
      return { accepted: false, reason: "session_expired", missed: [], heartbeat };
    }
    if (session.state !== "reconnecting") {
      // 已经是 active（同用户多开）：拒绝恢复，让上层走全新连接。
      return { accepted: false, reason: "unknown", missed: [], heartbeat };
    }
    if (now > session.reconnectDeadlineAt) {
      session.state = "closed";
      this.sessions.delete(sessionId);
      this.byUserKey.delete(this.userKey(session.roomId, session.userId));
      return { accepted: false, reason: "session_expired", missed: [], heartbeat };
    }

    session.socket = newSocket;
    session.state = "active";
    session.lastPingAt = now;
    session.lastServerSeq = Math.max(session.lastServerSeq, lastServerSeq);
    const missed = this.replaySince(session.roomId, lastServerSeq);
    return { accepted: true, session, missed, heartbeat };
  }

  /** 纯函数：reconnecting 已超过窗口、需要真正移除的会话。 */
  findExpiredGraceSessions(now: number = this.now()): TransportSession[] {
    const out: TransportSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.state === "reconnecting" && now > s.reconnectDeadlineAt) out.push(s);
    }
    return out;
  }

  /** 会话真正终结（窗口过期或被清理）：从注册表移除。 */
  destroySession(session: TransportSession): void {
    session.state = "closed";
    this.sessions.delete(session.sessionId);
    this.byUserKey.delete(this.userKey(session.roomId, session.userId));
  }

  // -------------------------------------------------------------------------
  // 看门狗 tick：由 ws.ts 定期驱动，副作用走 hooks
  // -------------------------------------------------------------------------

  tick(now: number = this.now()): void {
    for (const s of this.findTimedOutSessions(now)) {
      try { this.hooks.onHeartbeatTimeout(s); } catch { /* noop */ }
    }
    for (const s of this.findExpiredGraceSessions(now)) {
      try { this.hooks.onGraceExpired(s); } catch { /* noop */ }
    }
  }
}

// ---------------------------------------------------------------------------
// 供前端/测试复用的进度事件构造
// ---------------------------------------------------------------------------

export function makeProgress(stage: ReconnectProgress["stage"], progress: number, message?: string): ReconnectProgress & { type: "reconnect_progress" } {
  return { type: "reconnect_progress", stage, progress, message };
}

/** 把一条在途广播包装成 NetEnvelope（重连补发用）。 */
export function toEnvelope(buf: BufferedBroadcast): NetEnvelope {
  const msg = buf.message as { type?: string; [k: string]: unknown };
  return {
    seq: buf.seq,
    type: String(msg?.type ?? "event"),
    payload: buf.message,
  };
}
