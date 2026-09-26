// ===== Round4 R4-07: 消息历史缓存 =====
// 房间聊天 + 私聊消息缓存到 IndexedDB（降级 localStorage），按会话存储，最多 500 条/会话。
// 进入房间/打开私聊时先显示缓存，再从服务端拉最新合并。
// 未读消息计数持久化。

export const MAX_CACHED_PER_CONVERSATION = 500;
const UNREAD_PREFIX = 'balabala:unread:';

export interface CachedMessage {
  /** 消息唯一 ID（私聊用 messageId；房间消息用 `${timestamp}-${userId}-${seq}`）。 */
  id: string
  /** 会话 ID：私聊为 "a_b"（字典序），房间为 `room:<roomId>`。 */
  conversationId: string
  fromUserId: string
  fromNickname?: string
  text: string
  timestamp: number
  /** 房间消息附带房间码；私聊不填。 */
  roomCode?: string
}

/**
 * 纯函数：合并已有缓存与新拉取的服务端消息。
 * - 按 id 去重（新消息覆盖旧）
 * - 按 timestamp 升序
 * - 截断到 max 条（保留最新）
 */
export function mergeMessages(
  existing: CachedMessage[],
  incoming: CachedMessage[],
  max: number = MAX_CACHED_PER_CONVERSATION,
): CachedMessage[] {
  const byId = new Map<string, CachedMessage>()
  for (const m of existing) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)
  const merged = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

/** 纯函数：向会话追加一条消息并截断。 */
export function pushCachedMessage(
  list: CachedMessage[],
  msg: CachedMessage,
  max: number = MAX_CACHED_PER_CONVERSATION,
): CachedMessage[] {
  return mergeMessages(list, [msg], max)
}

/** 纯函数：计算未读 key。 */
export function unreadKey(conversationId: string): string {
  return `${UNREAD_PREFIX}${conversationId}`
}

/**
 * 抽象存储后端：IndexedDB 在浏览器端注入；测试/降级用 localStorage 或内存实现。
 */
export interface MessageStorage {
  load(conversationId: string): Promise<CachedMessage[]>
  save(conversationId: string, messages: CachedMessage[]): Promise<void>
  getUnread(conversationId: string): Promise<number>
  setUnread(conversationId: string, count: number): Promise<void>
}

/** localStorage 降级存储（同步 API 包成 Promise）。 */
export function createLocalStorageStorage(storage: Storage): MessageStorage {
  const key = (cid: string) => `balabala:msgs:${cid}`
  return {
    async load(conversationId) {
      try {
        const raw = storage.getItem(key(conversationId))
        if (!raw) return []
        const arr = JSON.parse(raw) as CachedMessage[]
        return Array.isArray(arr) ? arr : []
      } catch {
        return []
      }
    },
    async save(conversationId, messages) {
      try {
        storage.setItem(key(conversationId), JSON.stringify(messages.slice(-MAX_CACHED_PER_CONVERSATION)))
      } catch {
        /* 配额满/隐私模式：静默失败 */
      }
    },
    async getUnread(conversationId) {
      const n = Number(storage.getItem(unreadKey(conversationId)) ?? '0')
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
    },
    async setUnread(conversationId, count) {
      try {
        if (count > 0) storage.setItem(unreadKey(conversationId), String(Math.floor(count)))
        else storage.removeItem(unreadKey(conversationId))
      } catch { /* noop */ }
    },
  }
}

/** 内存存储（测试用）。 */
export function createMemoryStorage(): MessageStorage {
  const data = new Map<string, CachedMessage[]>()
  const unread = new Map<string, number>()
  return {
    async load(cid) { return data.get(cid) ?? [] },
    async save(cid, messages) { data.set(cid, messages.slice(-MAX_CACHED_PER_CONVERSATION)) },
    async getUnread(cid) { return unread.get(cid) ?? 0 },
    async setUnread(cid, count) {
      if (count > 0) unread.set(cid, count); else unread.delete(cid)
    },
  }
}

/**
 * IndexedDB 存储后端（浏览器端）。
 * 若 indexedDB 不可用（SSR/隐私模式），返回 null，调用方降级到 localStorage。
 */
export function createIndexedDbStorage(): MessageStorage | null {
  if (typeof indexedDB === 'undefined') return null
  const DB_NAME = 'balabala-social'
  const STORE = 'messages'
  let dbPromise: Promise<IDBDatabase> | null = null
  const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbPromise
  }
  const tx = async (mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) => {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const store = t.objectStore(STORE)
      const req = fn(store)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return {
    async load(conversationId) {
      try {
        const raw = await tx('readonly', (s) => s.get(conversationId)) as CachedMessage[] | undefined
        return Array.isArray(raw) ? raw : []
      } catch { return [] }
    },
    async save(conversationId, messages) {
      try { await tx('readwrite', (s) => s.put(messages.slice(-MAX_CACHED_PER_CONVERSATION), conversationId)) } catch { /* noop */ }
    },
    async getUnread(conversationId) {
      try {
        const n = Number(await tx('readonly', (s) => s.get(unreadKey(conversationId))) ?? 0)
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
      } catch { return 0 }
    },
    async setUnread(conversationId, count) {
      try {
        if (count > 0) await tx('readwrite', (s) => s.put(count, unreadKey(conversationId)))
        else await tx('readwrite', (s) => s.delete(unreadKey(conversationId)))
      } catch { /* noop */ }
    },
  }
}

/** 消息缓存门面：进入会话时 load，新消息 push+save。 */
export class MessageCache {
  private storage: MessageStorage
  constructor(storage?: MessageStorage) {
    if (storage) {
      this.storage = storage
    } else if (typeof indexedDB !== 'undefined') {
      this.storage = createIndexedDbStorage() ?? createLocalStorageStorage(window.localStorage)
    } else {
      this.storage = createMemoryStorage()
    }
  }

  /** 打开会话：先返回缓存消息用于即时渲染。 */
  async openConversation(conversationId: string): Promise<CachedMessage[]> {
    return this.storage.load(conversationId)
  }

  /** 服务端拉取后合并缓存。 */
  async refresh(conversationId: string, fresh: CachedMessage[]): Promise<CachedMessage[]> {
    const existing = await this.storage.load(conversationId)
    const merged = mergeMessages(existing, fresh)
    await this.storage.save(conversationId, merged)
    return merged
  }

  /** 收到新消息时追加并落盘。 */
  async append(conversationId: string, msg: CachedMessage): Promise<CachedMessage[]> {
    const existing = await this.storage.load(conversationId)
    const merged = pushCachedMessage(existing, msg)
    await this.storage.save(conversationId, merged)
    return merged
  }

  async getUnread(conversationId: string): Promise<number> {
    return this.storage.getUnread(conversationId)
  }
  async setUnread(conversationId: string, count: number): Promise<void> {
    await this.storage.setUnread(conversationId, count)
  }
  async incrementUnread(conversationId: string, by = 1): Promise<number> {
    const cur = await this.storage.getUnread(conversationId)
    const next = cur + by
    await this.storage.setUnread(conversationId, next)
    return next
  }
}
