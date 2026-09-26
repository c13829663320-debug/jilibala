// ===== Round4 R4-04: 统一 fetch 封装（超时 / 重试 / 错误提示）=====
//
// 所有业务侧 fetch 走这里：
//  - 超时 10s（AbortController）
//  - 失败自动重试 2 次，指数退避（300ms → 600ms）
//  - 仅对「可重试错误」重试：网络层错误 / 5xx / 429；4xx（除 429）直接抛
//  - 错误统一抛 ApiError，调用方 catch 后弹 toast
//
// 本文件在浏览器与 Node 测试环境均可用（不直接读 window，fetch 由调用环境提供）。

export class ApiError extends Error {
  /** HTTP 状态码（网络层错误时为 undefined） */
  status?: number
  /** 是否可重试（网络错误 / 5xx / 429） */
  retriable: boolean
  constructor(message: string, opts: { status?: number; retriable?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status
    this.retriable = opts.retriable ?? false
  }
}

export interface ApiClientOptions extends Omit<RequestInit, 'signal'> {
  /** 单次请求超时 ms，默认 10000 */
  timeoutMs?: number
  /** 额外重试次数（不含首次），默认 2 */
  retries?: number
  /** 重试基础退避 ms，默认 300 */
  retryBaseMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 判断状态码是否值得重试 */
function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * 统一 API fetch。超时 / 自动重试 / 错误归一。
 * 成功返回 Response（调用方自行 .json()）；失败抛 ApiError。
 */
export async function apiFetch(path: string, options: ApiClientOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, retries = 2, retryBaseMs = 300, ...init } = options

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(path, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return res
      // 不可重试的 4xx 直接抛（429 除外，它可重试）
      if (!isRetriableStatus(res.status)) {
        throw new ApiError(`请求失败（${res.status}）`, { status: res.status, retriable: false })
      }
      lastErr = new ApiError(`服务暂时不可用（${res.status}）`, { status: res.status, retriable: true })
    } catch (err) {
      clearTimeout(timer)
      // 已经是我们自己抛的 ApiError 直接记下来
      if (err instanceof ApiError) {
        if (!err.retriable) throw err
        lastErr = err
      } else if ((err as Error)?.name === 'AbortError') {
        lastErr = new ApiError(`请求超时（${timeoutMs / 1000}s）`, { retriable: true })
      } else {
        lastErr = new ApiError('网络连接失败', { retriable: true })
      }
    }
    // 还有重试机会 → 指数退避后再来
    if (attempt < retries) {
      await sleep(retryBaseMs * Math.pow(2, attempt))
    }
  }
  throw lastErr instanceof ApiError ? lastErr : new ApiError('请求失败', { retriable: true })
}

/** 便捷 JSON 版本：自动解析 JSON，失败抛 ApiError。 */
export async function apiGetJson<T>(path: string, options?: ApiClientOptions): Promise<T> {
  const res = await apiFetch(path, options)
  return (await res.json()) as T
}

/** 便捷 POST JSON 版本。 */
export async function apiPostJson<T>(path: string, body: unknown, options?: ApiClientOptions): Promise<T> {
  const res = await apiFetch(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    body: JSON.stringify(body),
  })
  return (await res.json()) as T
}
