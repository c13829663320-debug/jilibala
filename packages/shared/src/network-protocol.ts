// ===== 多人网络专项 · 共享协议基座 =====
// 统一消息信封、会话/Token、房间权限、错误码、重连、心跳、状态同步类型。
// 所有分片（传输/重连/权限/同步/WebRTC）均基于此基座扩展，禁止各自定义冲突的基础类型。

// ---------------------------------------------------------------------------
// 1. 统一消息信封（Envelope）
// ---------------------------------------------------------------------------

/** 客户端→服务端 或 服务端→客户端 的统一消息信封。 */
export interface NetEnvelope<T = unknown> {
  /** 单调递增序号（ per direction ），用于去重、乱序检测与丢包补偿。 */
  seq: number;
  /** 会话 ID：连接建立时由服务端签发，重连时携带以恢复会话。 */
  sessionId?: string;
  /** 客户端时间戳（ms epoch），服务端可用于 RTT 估算。 */
  ts?: number;
  /** 消息体类型标签。 */
  type: string;
  /** 消息体。 */
  payload: T;
}

/** 服务端对客户端消息的确认（ACK）。 */
export interface NetAck {
  /** 被确认消息的 seq。 */
  ackSeq: number;
  /** 服务端接收时间戳。 */
  serverTs: number;
}

// ---------------------------------------------------------------------------
// 2. 会话与 Token
// ---------------------------------------------------------------------------

/** 会话状态。 */
export type SessionState = "active" | "reconnecting" | "expired" | "closed";

/** 服务端签发的会话凭证（随 welcome 返回，客户端持久化用于重连）。 */
export interface SessionToken {
  sessionId: string;
  userId: string;
  roomId: string;
  /** 签发时间（ms epoch）。 */
  issuedAt: number;
  /** 过期时间（ms epoch）。重连窗口内有效，默认 120s。 */
  expiresAt: number;
}

/** 客户端重连请求 payload。 */
export interface ReconnectRequest {
  sessionId: string;
  /** 客户端最后收到的服务端消息 seq，用于服务端补发。 */
  lastServerSeq: number;
  /** 客户端最后发送的未确认 seq 列表起点。 */
  lastClientSeq: number;
}

/** 服务端重连响应 payload。 */
export interface ReconnectResponse {
  accepted: boolean;
  sessionId: string;
  /** 若 accepted=false，给出原因。 */
  reason?: "session_expired" | "room_closed" | "kicked" | "room_full" | "unknown";
  /** 补发的在途消息（按 seq 排序）。 */
  missedMessages?: Array<NetEnvelope>;
  /** 当前房间内用户快照。 */
  users?: Array<unknown>;
  /** 重连进度 0-1，用于前端进度提示。 */
  progress?: number;
}

/** 重连进度事件（服务端→客户端，在补发过程中分批推送）。 */
export interface ReconnectProgress {
  stage: "resuming" | "replaying" | "syncing_state" | "done";
  progress: number; // 0-1
  message?: string;
}

// ---------------------------------------------------------------------------
// 3. 房间权限
// ---------------------------------------------------------------------------

/** 房间内用户角色。 */
export type RoomRole = "owner" | "member";

/** 房间权限配置（扩展 SocialRoom）。 */
export interface RoomPermissions {
  /** 是否锁定（锁定后仅房主可邀请/放行，其他人无法加入）。 */
  locked: boolean;
  /** 是否私密（私密房不出现在公开列表，需房间码 + 密码加入）。 */
  isPrivate: boolean;
  /** 房间密码（仅 isPrivate=true 时有效；服务端存储，不回传给普通成员）。 */
  password?: string;
  /** 人数上限。 */
  maxPlayers: number;
  /** 房主 userId。 */
  ownerId: string;
}

/** 踢人请求。 */
export interface KickRequest {
  targetUserId: string;
  reason?: string;
}

/** 转移房主请求。 */
export interface TransferOwnerRequest {
  newOwnerId: string;
}

/** 锁房/解锁请求。 */
export interface LockRoomRequest {
  locked: boolean;
}

/** 修改房间密码请求。 */
export interface SetPasswordRequest {
  password: string | null; // null = 清除密码
}

/** 房间权限相关 WS 消息（服务端广播）。 */
export type RoomPermissionEvent =
  | { type: "room_owner_changed"; oldOwnerId: string; newOwnerId: string }
  | { type: "room_kicked"; targetUserId: string; reason?: string; byUserId: string }
  | { type: "room_locked"; locked: boolean; byUserId: string }
  | { type: "room_password_changed"; hasPassword: boolean; byUserId: string }
  | { type: "room_max_players_changed"; maxPlayers: number; byUserId: string };

// ---------------------------------------------------------------------------
// 4. 错误码
// ---------------------------------------------------------------------------

export const NetErrorCode = {
  OK: 0,
  MISSING_PARAMS: 1001,
  INVALID_ROOM: 1002,
  ROOM_NOT_FOUND: 1003,
  ROOM_FULL: 1004,
  ROOM_LOCKED: 1005,
  WRONG_PASSWORD: 1006,
  NOT_OWNER: 1007,
  TARGET_NOT_FOUND: 1008,
  SESSION_EXPIRED: 2001,
  SESSION_RECONNECT_FAILED: 2002,
  KICKED: 2003,
  RATE_LIMITED: 3001,
  MESSAGE_TOO_LARGE: 3002,
  INTERNAL_ERROR: 5000,
} as const;

export type NetErrorCodeValue = (typeof NetErrorCode)[keyof typeof NetErrorCode];

/** 结构化错误消息。 */
export interface NetError {
  code: NetErrorCodeValue;
  message: string;
  /** 关联的请求 seq（若有）。 */
  reqSeq?: number;
}

// ---------------------------------------------------------------------------
// 5. 心跳
// ---------------------------------------------------------------------------

/** 心跳配置（服务端→客户端，在 welcome 中下发）。 */
export interface HeartbeatConfig {
  /** 客户端 ping 间隔（ms），默认 15000。 */
  pingIntervalMs: number;
  /** 服务端超时时间（ms），超过未收到 ping 判定掉线，默认 45000。 */
  timeoutMs: number;
  /** 掉线后会话保留时长（ms），默认 120000。 */
  reconnectWindowMs: number;
}

/** 客户端 ping payload。 */
export interface PingPayload {
  /** 客户端序号。 */
  clientSeq: number;
}

/** 服务端 pong payload。 */
export interface PongPayload {
  /** 对应 ping 的 clientSeq。 */
  clientSeq: number;
  /** 服务端时间戳。 */
  serverTs: number;
  /** 当前连接用户数（房间内）。 */
  playerCount?: number;
}

// ---------------------------------------------------------------------------
// 6. 实时状态同步
// ---------------------------------------------------------------------------

/** 玩家完整状态（用于 presence 广播与快照）。 */
export interface PlayerState {
  userId: string;
  x: number;
  z: number;
  rotation: number;
  /** 说话强度 0-1。 */
  talkingIntensity?: number;
  /** 动画状态。 */
  animation?: string;
  /** 表情。 */
  expression?: string;
  /** 头部注视目标。 */
  headTarget?: { x: number; z: number } | null;
  /** 服务端时间戳（ms），用于插值计算。 */
  serverTs?: number;
}

/** 状态同步配置（服务端→客户端下发）。 */
export interface StateSyncConfig {
  /** 服务端广播频率（Hz），默认 10。 */
  serverTickHz: number;
  /** 客户端发送频率上限（Hz），默认 15。 */
  clientSendMaxHz: number;
  /** 插值延迟（ms），默认 100。 */
  interpolationDelayMs: number;
  /** 外推最大时长（ms），超过则冻结，默认 250。 */
  maxExtrapolationMs: number;
  /** 位置裁剪阈值（单位），超过则 snap，默认 50。 */
  positionClipThreshold: number;
  /** 单条 presence 消息最大字节数。 */
  maxMessageBytes: number;
}

/** 客户端移动/状态更新 payload。 */
export interface ClientStateUpdate {
  x: number;
  z: number;
  rotation: number;
  talkingIntensity?: number;
  animation?: string;
  expression?: string;
  headTarget?: { x: number; z: number } | null;
}

/** 服务端 presence 广播 payload。 */
export interface ServerPresence {
  /** 房间内其他玩家的状态（不含自己）。 */
  players: PlayerState[];
  /** 服务端时间戳。 */
  serverTs: number;
}

// ---------------------------------------------------------------------------
// 7. WebRTC 信令扩展
// ---------------------------------------------------------------------------

/** WebRTC 连接状态。 */
export type RtcConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/** ICE 服务器配置（服务端→客户端下发，含 TURN）。 */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** WebRTC 降级通知（语音不可用，回落文字）。 */
export interface RtcFallbackNotify {
  from: string;
  to: string;
  reason: "ice_failed" | "no_media" | "timeout" | "user_disabled";
  /** 是否建议回落文字聊天。 */
  suggestText: boolean;
}

/** WebRTC 信令重试请求。 */
export interface RtcRetryRequest {
  from: string;
  to: string;
  attempt: number;
  /** 重试原因。 */
  reason: string;
}

// ---------------------------------------------------------------------------
// 8. WebRTC 健壮性扩展（信令状态机 / TURN 下发 / 失败重试 / 文字回落）
// ---------------------------------------------------------------------------

/**
 * 服务端维护的每对用户信令状态（按房间内用户对聚合）。
 * - offering：A 已发 offer 给 B，等待 B 的 answer
 * - answering：B 已收到 offer，正在回 answer（服务端在转发 offer 后置位）
 * - connected：answer 已交换，ICE 协商完成/进行中
 * - failed：一方 bye / fallback / 连续失败，需重新 offer
 */
export type RtcPairState = "offering" | "answering" | "connected" | "failed";

/** rtc_error 错误码（结构化，便于客户端按码决策）。 */
export const RtcErrorCode = {
  /** 目标用户不在房间（离线/已离开）。 */
  TARGET_OFFLINE: "rtc_target_offline",
  /** 双方同时发 offer（glare 冲突），后到的 offer 被拒。 */
  OFFER_CONFLICT: "rtc_offer_conflict",
  /** 在 answer 到达前同一方重复发 offer（重试风暴），被节流。 */
  DUPLICATE_OFFER: "rtc_duplicate_offer",
  /** 服务端内部错误。 */
  INTERNAL: "rtc_internal",
} as const;

export type RtcErrorCodeValue = (typeof RtcErrorCode)[keyof typeof RtcErrorCode];

/** 服务端→发起方的信令错误（目标不在线 / 冲突等），替代静默丢弃。 */
export interface RtcErrorNotify {
  from: string;
  to: string;
  code: RtcErrorCodeValue;
  message: string;
  /** 关联的发起方消息 seq（若有）。 */
  reqSeq?: number;
}

/** 降级原因（与 RtcFallbackNotify.reason 对齐）。 */
export type RtcFallbackReason =
  | "ice_failed"
  | "no_media"
  | "timeout"
  | "user_disabled";

/**
 * rtc_sdp / rtc_ice / rtc_retry / rtc_fallback 信令消息统一携带的路由元信息。
 * seq 为发起方单调递增序号，供服务端去重/排重（可选，旧客户端可不带，向后兼容）。
 */
export interface RtcRoutingMeta {
  from: string;
  to: string;
  /** 发起方信令序号（可选）。 */
  seq?: number;
}
