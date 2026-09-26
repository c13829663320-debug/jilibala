// ===== Round4 R4-04: WebSocket 连接错误处理（纯逻辑，可单测）=====
//
// 职责（纯函数部分；浏览器接线在 Plaza3D / 全局 banner 里完成）：
//  - 指数退避计算：1s → 2s → 4s → 8s → 16s → 30s（封顶）
//  - 连接状态机：connected / connecting / reconnecting / offline
//  - 离线只读模式判定：连续失败超过阈值后进入 offline，UI 进入只读
//    （不能发消息/移动，仅浏览），支持手动重连按钮。
//
// 本文件不 import 浏览器 API，Node 环境直接单测。

export type WsLinkStatus = 'connected' | 'connecting' | 'reconnecting' | 'offline'

export interface WsErrorState {
  status: WsLinkStatus
  /** 已连续失败次数（每次 close/error 后 +1；open 后归零） */
  retryCount: number
  /** 下一次重连应等待的毫秒数（按指数退避计算） */
  nextRetryInMs: number
  /** 最近一次错误描述（用于横幅文案） */
  lastError: string | null
  /** 是否处于离线只读模式（true 时禁止发消息/移动，仅浏览） */
  readOnly: boolean
}

export const WS_BACKOFF_BASE_MS = 1000
export const WS_BACKOFF_MAX_MS = 30_000
/** 连续失败达到此次数后进入 offline（只读），不再自动重连，等用户手动点。 */
export const WS_OFFLINE_AFTER_FAILURES = 5

export function initialWsErrorState(): WsErrorState {
  return {
    status: 'connecting',
    retryCount: 0,
    nextRetryInMs: WS_BACKOFF_BASE_MS,
    lastError: null,
    readOnly: false,
  }
}

/**
 * 指数退避：attempt 从 1 开始。
 *   attempt=1 → 1000ms
 *   attempt=2 → 2000ms
 *   attempt=3 → 4000ms
 *   attempt=4 → 8000ms
 *   attempt=5 → 16000ms
 *   attempt>=6 → 30000ms（封顶）
 */
export function computeBackoffDelay(
  attempt: number,
  baseMs: number = WS_BACKOFF_BASE_MS,
  maxMs: number = WS_BACKOFF_MAX_MS,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt))
  const delay = baseMs * Math.pow(2, safeAttempt - 1)
  return Math.min(delay, maxMs)
}

export type WsErrorEvent =
  /** 握手成功（onopen） */
  | { type: 'OPEN' }
  /** 连接断开 / 出错（onclose / onerror），附带可选错误描述 */
  | { type: 'CLOSE'; error?: string }
  /** 用户点「立即重连」按钮 */
  | { type: 'MANUAL_RETRY' }
  /** 主动断开（离开房间/卸载），不再重连 */
  | { type: 'STOP' }

/** 纯 reducer。 */
export function reduceWsError(
  state: WsErrorState,
  event: WsErrorEvent,
  offlineAfter: number = WS_OFFLINE_AFTER_FAILURES,
): WsErrorState {
  switch (event.type) {
    case 'OPEN':
      // 连上即清零：重连计数、退避、错误文案，退出只读。
      return {
        status: 'connected',
        retryCount: 0,
        nextRetryInMs: WS_BACKOFF_BASE_MS,
        lastError: null,
        readOnly: false,
      }

    case 'CLOSE': {
      const retryCount = state.retryCount + 1
      const nextRetryInMs = computeBackoffDelay(retryCount)
      // 失败次数超过阈值 → offline 只读；否则继续 reconnecting 自动重试。
      const giveUp = retryCount >= offlineAfter
      return {
        status: giveUp ? 'offline' : 'reconnecting',
        retryCount,
        nextRetryInMs,
        lastError: event.error ?? '连接断开',
        readOnly: giveUp,
      }
    }

    case 'MANUAL_RETRY':
      // 手动重连：立刻进入 connecting，退避计时清零（重连成功后自然归零）。
      // 仍保持 readOnly=true，直到真的 OPEN 才解除——避免假在线。
      return {
        ...state,
        status: 'connecting',
        nextRetryInMs: WS_BACKOFF_BASE_MS,
        lastError: null,
      }

    case 'STOP':
      return {
        status: 'offline',
        retryCount: state.retryCount,
        nextRetryInMs: 0,
        lastError: state.lastError,
        readOnly: true,
      }

    default:
      return state
  }
}

/** 顶部黄色横幅文案（null = 不显示）。遵循品牌色：明黄 #FFD600 底。 */
export function wsBannerText(state: WsErrorState): string | null {
  switch (state.status) {
    case 'reconnecting':
      return `网络中断，正在自动重连…（第 ${state.retryCount} 次，${Math.round(state.nextRetryInMs / 1000)}s 后）`
    case 'connecting':
      return '正在连接广场…'
    case 'offline':
      return '已离线 · 广场只读模式（不能发言/移动，仅浏览）— 点此手动重连'
    case 'connected':
      return null
    default:
      return null
  }
}

/** 是否允许发消息/移动（只读模式下禁止）。 */
export function canMutate(state: WsErrorState): boolean {
  return state.status === 'connected'
}

/*
 * 需真机确认：
 *  - [ ] 断网后浏览器实际触发 onclose 的时机与退避节奏（本文件只算时间，定时器在调用方）
 *  - [ ] 恢复网络后 OPEN 事件是否如期到来、只读是否解除
 */
