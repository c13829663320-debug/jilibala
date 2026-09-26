// ===== Round4 R4-03：安全模块状态管理（静音 / 屏蔽 / 举报） =====
// 纯逻辑层，不依赖 React / DOM，可在 Node 环境直接单测。
//
// 语义：
//   mute（静音）  → 阻止该玩家语音播放，但仍可见其化身和文字消息
//   block（屏蔽） → 隐藏化身、不接收其文字、不接收其语音（完全不可见）
//   report（举报）→ 生成一条本地记录 + 产出要发往服务端的 WS 载荷
//
// 关系：block 是 mute 的超集——被屏蔽者天然也听不到（即使没单独 mute）。
// 持久化：静音/屏蔽列表写入 localStorage（key=balabala_safety_state，JSON）。
// 浏览器外可注入内存存储适配器，便于单测。
import type { ReportCategory, ReportPayload } from '@balabala/shared'

/** localStorage 持久化 key（与需求约定一致） */
export const SAFETY_STORAGE_KEY = 'balabala_safety_state'

/** 一条本地留存的举报记录（审计用；真正的服务端记录在 reports.log） */
export interface ReportRecord {
  targetUserId: string
  targetNickname?: string
  reason: string
  category: ReportCategory
  room: string
  /** ISO 时间戳 */
  reportedAt: string
}

/** 持久化的安全状态 */
export interface SafetyState {
  /** 被静音的用户 id（仍可见/可读，仅禁声） */
  muted: string[]
  /** 被屏蔽的用户 id（完全不可见） */
  blocked: string[]
  /** 本地举报记录（最多保留最近 N 条） */
  reports: ReportRecord[]
}

/** 存储适配器（localStorage / 测试内存实现） */
export interface SafetyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 本地举报记录上限（防止无限增长） */
const MAX_LOCAL_REPORTS = 100

/** 合法举报分类白名单 */
const VALID_CATEGORIES: ReadonlySet<ReportCategory> = new Set([
  'harassment', 'spam', 'abuse', 'cheating', 'other',
])

/** 取浏览器 localStorage（不可用返回 null） */
function browserStorage(): SafetyStorage | null {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined') {
    return (globalThis as { localStorage: Storage }).localStorage
  }
  return null
}

/** 深拷贝初始状态 */
function emptyState(): SafetyState {
  return { muted: [], blocked: [], reports: [] }
}

function normalizeId(id: string): string {
  return (id ?? '').trim()
}

/** 校验并规整举报分类（非法 → 'other'） */
export function normalizeCategory(cat: string): ReportCategory {
  return (VALID_CATEGORIES as ReadonlySet<string>).has(cat) ? (cat as ReportCategory) : 'other'
}

export type SafetyManager = ReturnType<typeof createSafetyManager>

/**
 * 创建安全管理器实例。
 * @param storage 存储适配器；默认浏览器 localStorage；测试可传内存实现。
 * @param reporterUserId 本地用户 id（举报记录里的举报人）。
 * @param storageKey 持久化 key，默认 balabala_safety_state。
 */
export function createSafetyManager(options: {
  storage?: SafetyStorage | null
  reporterUserId?: string
  storageKey?: string
  room?: string
  now?: () => string
} = {}) {
  const storage = options.storage !== undefined ? options.storage : browserStorage()
  const storageKey = options.storageKey ?? SAFETY_STORAGE_KEY
  const room = options.room ?? ''
  const reporterUserId = options.reporterUserId ?? ''
  const now = options.now ?? (() => new Date().toISOString())

  // —— 内部可变状态（不可变更新后整体替换，便于 React 订阅） ——
  let state: SafetyState = load()

  function load(): SafetyState {
    if (!storage) return emptyState()
    try {
      const text = storage.getItem(storageKey)
      if (!text) return emptyState()
      const parsed = JSON.parse(text) as Partial<SafetyState>
      return {
        muted: Array.isArray(parsed.muted) ? parsed.muted.filter((x) => typeof x === 'string') : [],
        blocked: Array.isArray(parsed.blocked) ? parsed.blocked.filter((x) => typeof x === 'string') : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports.filter((r) => r && typeof r.targetUserId === 'string') : [],
      }
    } catch {
      return emptyState()
    }
  }

  function persist(): void {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* 隐私模式/存储满 → 静默失败 */
    }
  }

  function getState(): SafetyState {
    // 返回深拷贝，防止外部直接篡改内部状态
    return {
      muted: [...state.muted],
      blocked: [...state.blocked],
      reports: state.reports.map((r) => ({ ...r })),
    }
  }

  // ===== 静音 =====
  function isMuted(userId: string): boolean {
    const id = normalizeId(userId)
    return !!id && state.muted.includes(id)
  }

  function mute(userId: string): SafetyState {
    const id = normalizeId(userId)
    if (id && !state.muted.includes(id)) {
      state = { ...state, muted: [...state.muted, id] }
      persist()
    }
    return getState()
  }

  function unmute(userId: string): SafetyState {
    const id = normalizeId(userId)
    if (id && state.muted.includes(id)) {
      state = { ...state, muted: state.muted.filter((x) => x !== id) }
      persist()
    }
    return getState()
  }

  function toggleMute(userId: string): SafetyState {
    return isMuted(userId) ? unmute(userId) : mute(userId)
  }

  // ===== 屏蔽 =====
  function isBlocked(userId: string): boolean {
    const id = normalizeId(userId)
    return !!id && state.blocked.includes(id)
  }

  function block(userId: string): SafetyState {
    const id = normalizeId(userId)
    if (!id) return getState()
    let next = state.blocked.includes(id) ? state.blocked : [...state.blocked, id]
    // 屏蔽后自动从静音列表移除（屏蔽语义更强，避免状态冗余）
    const muted = state.muted.filter((x) => x !== id)
    state = { ...state, blocked: next, muted }
    persist()
    return getState()
  }

  function unblock(userId: string): SafetyState {
    const id = normalizeId(userId)
    if (id && state.blocked.includes(id)) {
      state = { ...state, blocked: state.blocked.filter((x) => x !== id) }
      persist()
    }
    return getState()
  }

  function toggleBlock(userId: string): SafetyState {
    return isBlocked(userId) ? unblock(userId) : block(userId)
  }

  // ===== 可见性 / 信息流判定（供 Plaza3D 渲染与消息过滤使用） =====
  /** 是否在 3D 场景中渲染该玩家化身（屏蔽 → 不渲染） */
  function canSeeAvatar(userId: string): boolean {
    return !isBlocked(userId)
  }

  /** 是否播放该玩家语音（静音 或 屏蔽 → 不播放） */
  function canHearVoice(userId: string): boolean {
    return !isMuted(userId) && !isBlocked(userId)
  }

  /** 是否接收该玩家文字消息（屏蔽 → 丢弃） */
  function canReceiveText(userId: string): boolean {
    return !isBlocked(userId)
  }

  // ===== 举报 =====
  /**
   * 记录一次举报：写入本地 reports，并返回要通过 WS 发送的 report_user 载荷。
   * 调用方负责把返回的 payload 通过 WebSocket 发往服务端。
   */
  function report(targetUserId: string, reason: string, category: string, targetNickname?: string): ReportPayload {
    const target = normalizeId(targetUserId)
    const cat = normalizeCategory(category)
    const trimmedReason = (reason ?? '').trim().slice(0, 500)
    const record: ReportRecord = {
      targetUserId: target,
      ...(targetNickname ? { targetNickname } : {}),
      reason: trimmedReason,
      category: cat,
      room,
      reportedAt: now(),
    }
    const reports = [record, ...state.reports].slice(0, MAX_LOCAL_REPORTS)
    state = { ...state, reports }
    persist()
    return { targetUserId: target, reason: trimmedReason, category: cat }
  }

  /** 清空全部安全状态（调试/测试用） */
  function clear(): SafetyState {
    state = emptyState()
    persist()
    return getState()
  }

  return {
    getState,
    isMuted,
    mute,
    unmute,
    toggleMute,
    isBlocked,
    block,
    unblock,
    toggleBlock,
    canSeeAvatar,
    canHearVoice,
    canReceiveText,
    report,
    clear,
    /** 当前 room（举报记录用） */
    room,
    reporterUserId,
  }
}
