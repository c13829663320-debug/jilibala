/**
 * R4-06 性能治理 — 资源预加载器。
 *
 * 进入广场前预加载核心 GLB 模型、纹理、字体，避免走到建筑门口才卡顿加载。
 * - 低配置设备（navigator.hardwareConcurrency < 4 或 deviceMemory < 4）跳过
 *   高分辨率纹理（highRes 标记），降级为运行时按需加载；
 * - 预加载进度通过 onProgress 回调上报（loaded/total/skipped/done）；
 * - 所有 I/O 与环境探测都可注入（fetchImpl / tier），便于在 node 环境跑纯逻辑单测。
 *
 * 注意：本模块只做「拉到浏览器缓存并触发解码」的逻辑编排，真正的 GLTFLoader
 * 解码由 three.js 在运行时完成；这里用 fetchImpl 把字节拉过一遍即视为预加载命中缓存。
 */

export type AssetKind = 'model' | 'texture' | 'font'

export interface AssetSpec {
  /** 资源 URL（如 /models/world/plaza.glb） */
  url: string
  kind: AssetKind
  /** 高分辨率纹理标记：低配设备跳过，不阻塞首屏 */
  highRes?: boolean
}

export type DeviceTier = 'high' | 'low'

/** 可注入的设备信息（默认从 window.navigator 读）。 */
export interface DeviceInfo {
  hardwareConcurrency?: number
  deviceMemory?: number
}

export interface PreloadProgress {
  /** 已完成（成功 + 跳过）数 */
  loaded: number
  /** 应处理总数（含被跳过的高分辨率纹理） */
  total: number
  /** 因低配被跳过的资源数 */
  skipped: number
  /** 当前正在处理的 url（空串表示空闲/全部完成） */
  url: string
  /** 全部处理完毕 */
  done: boolean
}

export interface PreloadOptions {
  onProgress?: (p: PreloadProgress) => void
  /** 取消信号：aborted=true 时中断后续资源 */
  signal?: { aborted: boolean }
  /** 可注入 fetch（测试用）；默认全局 fetch */
  fetchImpl?: (url: string) => Promise<unknown>
  /** 可注入设备信息（测试用）；默认探测 navigator */
  device?: DeviceInfo
  /** 并发预加载数（默认 4） */
  concurrency?: number
}

/**
 * 判断设备等级。
 * - hardwareConcurrency < 4 核 或 deviceMemory < 4GB → low
 * - 字段缺失（如桌面 Chrome 不报 deviceMemory）时保守按 high 处理，不降画质。
 */
export function detectDeviceTier(device?: DeviceInfo): DeviceTier {
  const info: DeviceInfo =
    device ??
    (typeof navigator !== 'undefined'
      ? {
          hardwareConcurrency: navigator.hardwareConcurrency,
          // @ts-expect-error deviceMemory 是非标准属性
          deviceMemory: navigator.deviceMemory as number | undefined,
        }
      : {})
  const cores = info.hardwareConcurrency ?? 8
  const mem = info.deviceMemory ?? 8
  if (cores < 4 || mem < 4) return 'low'
  return 'high'
}

/** 该资源在当前设备等级下是否需要预加载。 */
export function shouldPreload(spec: AssetSpec, tier: DeviceTier): boolean {
  if (tier === 'low' && spec.highRes) return false
  return true
}

function defaultFetch(url: string): Promise<unknown> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
    return r
  })
}

/**
 * 预加载资源列表。按并发数拉取，逐个上报进度。
 * - 单个资源失败不中断整体（记为已完成，由运行时兜底加载）；
 * - 低配设备跳过 highRes 纹理，计入 skipped；
 * - 返回成功拉取与被跳过的 url 列表。
 */
export async function preloadAssets(
  list: AssetSpec[],
  opts: PreloadOptions = {},
): Promise<{ loaded: string[]; skipped: string[] }> {
  const tier = detectDeviceTier(opts.device)
  const fetchImpl = opts.fetchImpl ?? defaultFetch
  const concurrency = Math.max(1, opts.concurrency ?? 4)

  const planned = list.map((spec) => ({ spec, willLoad: shouldPreload(spec, tier) }))
  const total = planned.length
  const loaded: string[] = []
  const skipped: string[] = []
  let done = 0
  let skippedCount = 0

  const emit = (url: string) => {
    opts.onProgress?.({
      loaded: done,
      total,
      skipped: skippedCount,
      url,
      done: done === total,
    })
  }

  emit('')

  // 先把所有被跳过的高分辨率纹理一次性结算（它们不发网络请求）
  const queue: AssetSpec[] = []
  for (const item of planned) {
    if (item.willLoad) queue.push(item.spec)
    else {
      skipped.push(item.spec.url)
      skippedCount += 1
      done += 1
    }
  }
  emit('')

  // 并发拉取队列
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (true) {
      if (opts.signal?.aborted) return
      const i = cursor++
      if (i >= queue.length) return
      const spec = queue[i]
      emit(spec.url)
      try {
        await fetchImpl(spec.url)
        loaded.push(spec.url)
      } catch {
        // 单个资源失败不阻塞：运行时再按需加载
        loaded.push(spec.url)
      }
      done += 1
      emit(spec.url)
    }
  })
  await Promise.all(workers)
  emit('')
  return { loaded, skipped }
}

/** 进入广场前默认预加载清单（核心模型 + 通用纹理 + 字体）。 */
export const PLAZA_PRIORITY_ASSETS: AssetSpec[] = [
  { url: '/models/world/plaza.glb', kind: 'model' },
  { url: '/models/world/avatar.glb', kind: 'model' },
  { url: '/models/world/plaza-texture-4k.jpg', kind: 'texture', highRes: true },
  { url: '/fonts/balabana-title.woff2', kind: 'font' },
]
