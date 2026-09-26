// ===== R4-01: 会话 token 持久化 + 重连状态机 =====
//
// - sessionToken 按 userId+room 维度持久化（localStorage，SSR/隐私模式下降级内存）。
// - 状态机：fresh → connecting → live ⇄ reconnecting（指数退避）→ given_up。
// - 纯 TS，不依赖 React/WS，可单测。
//
// 与 useReconnectingWebSocket / Plaza3D 的接线（何时把 token 拼进 URL、
// 收到 session_resumed 后如何恢复相机位置）需在真机 WebGL 联调确认，
// 云端无 GPU。

export type ReconnectPhase =
  | 'fresh'         // 尚未连接
  | 'connecting'    // 正在握手
  | 'live'          // 连接正常
  | 'reconnecting'  // 断线，按退避等待重连
  | 'given_up'      // 达到上限/主动放弃

/** 会话 token 存储抽象（便于测试注入内存实现）。 */
export interface SessionTokenStore {
  get(userId: string, roomId: string): string | null
  set(userId: string, roomId: string, token: string): void
  clear(userId: string, roomId: string): void
}

const KEY = (userId: string, roomId: string) => `balabala.session.${userId}.${roomId}`

/** localStorage 实现，不可用时降级为内存 Map。 */
export function createLocalStorageTokenStore(): SessionTokenStore {
  const memory = new Map<string, string>()
  let storage: Storage | null = null
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    storage = null
  }
  return {
    get(userId, roomId) {
      const k = KEY(userId, roomId)
      try { return storage?.getItem(k) ?? memory.get(k) ?? null }
      catch { return memory.get(k) ?? null }
    },
    set(userId, roomId, token) {
      const k = KEY(userId, roomId)
      memory.set(k, token)
      try { storage?.setItem(k, token) } catch { /* 忽略配额/隐私模式 */ }
    },
    clear(userId, roomId) {
      const k = KEY(userId, roomId)
      memory.delete(k)
      try { storage?.removeItem(k) } catch { /* noop */ }
    },
  }
}

export interface ReconnectionManagerOptions {
  userId: string
  roomId: string
  /** 首次重连延迟（ms），默认 1000。 */
  initialDelayMs?: number
  /** 退避上限（ms），默认 30000。 */
  maxDelayMs?: number
  /** 最大重连次数，超过进入 given_up；默认 Infinity（由调用方决定何时放弃）。 */
  maxRetries?: number
  store?: SessionTokenStore
}

export class ReconnectionManager {
  readonly userId: string
  readonly roomId: string
  phase: ReconnectPhase = 'fresh'
  retryCount = 0

  private readonly initialDelayMs: number
  private readonly maxDelayMs: number
  private readonly maxRetries: number
  private readonly store: SessionTokenStore

  constructor(opts: ReconnectionManagerOptions) {
    this.userId = opts.userId
    this.roomId = opts.roomId
    this.initialDelayMs = opts.initialDelayMs ?? 1000
    this.maxDelayMs = opts.maxDelayMs ?? 30_000
    this.maxRetries = opts.maxRetries ?? Number.POSITIVE_INFINITY
    this.store = opts.store ?? createLocalStorageTokenStore()
  }

  /** 持久化服务端下发的 session_token。 */
  rememberToken(token: string): void {
    if (token) this.store.set(this.userId, this.roomId, token)
  }

  /** 重连时取用已存 token（可能为 null → 全新入场）。 */
  recalledToken(): string | null {
    return this.store.get(this.userId, this.roomId)
  }

  clearToken(): void {
    this.store.clear(this.userId, this.roomId)
  }

  onConnecting(): void {
    this.phase = 'connecting'
  }

  /** 握手成功。isResumed=true 表示服务端走了 session_resumed（位置已恢复）。 */
  onOpen(isResumed: boolean): void {
    this.phase = 'live'
    this.retryCount = 0
    void isResumed
  }

  /** 检测到断线：进入重连态，返回本次退避延迟。超过 maxRetries 进入 given_up。 */
  onDisconnect(): number {
    if (this.phase === 'given_up') return this.maxDelayMs
    this.phase = 'reconnecting'
    this.retryCount += 1
    if (this.retryCount > this.maxRetries) {
      this.phase = 'given_up'
      return this.maxDelayMs
    }
    return this.nextDelayMs()
  }

  /** 当前重试对应的指数退避延迟（1s→2s→4s…封顶）。 */
  nextDelayMs(): number {
    const exp = this.initialDelayMs * 2 ** Math.max(0, this.retryCount - 1)
    return Math.min(exp, this.maxDelayMs)
  }

  giveUp(): void {
    this.phase = 'given_up'
  }

  reset(): void {
    this.phase = 'fresh'
    this.retryCount = 0
  }
}
