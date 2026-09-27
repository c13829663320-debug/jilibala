// ===== R5: GLB 懒加载 Hook =====
//
// React Three Fiber 场景中，避免一次性 useGLTF 加载全部模型。
// 思路：
//   - 用 assetPriority 的纯函数把候选模型按「名人 > 场景 > 装饰 + 距相机近者优先」排序；
//   - 先放行首屏/视口内的一小批（initialBatch），其余进入延迟队列；
//   - 用 maxConcurrent 限制同时解码的模型数，slot 空出再放行下一个；
//   - 暴露每个 url 的 loading/error/loaded 状态，供占位/重试 UI 使用。
//
// 注意：本 hook 只决定「是否允许调用 useGLTF(url)」，真正的 GLTFLoader 解码由
// three.js / drei 完成。云端无 WebGL，实际帧率/解码耗时需真机确认。
//
// IntersectionObserver 用于 DOM 包裹的模型卡片（如人物馆缩略卡片）是否进入视口；
// 3D 场景内的「视口」由相机距离决定，直接传 camera 即可。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetPriority } from '@balabala/shared'
import { sortAssetsByPriority, type Point2 } from './assetPriority'

export type GLBLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface LazyGLBSource {
  url: string
  priority: AssetPriority
  x?: number
  z?: number
}

export interface UseLazyGLOptions {
  /** 本地相机/玩家世界坐标，用于距离排序。 */
  camera?: Point2
  /** 同时允许解码的模型数（默认 2）。 */
  maxConcurrent?: number
  /** 首屏立即放行的数量（默认 4，约等于视口内）。 */
  initialBatch?: number
}

export interface LazyGLBController {
  /** 某 url 当前加载状态。 */
  statusOf: (url: string) => GLBLoadStatus
  /** 是否允许现在渲染 useGLTF(url)（已放行）。 */
  shouldLoad: (url: string) => boolean
  /** 已放行的 url 集合（用于条件渲染模型组件）。 */
  admitted: ReadonlySet<string>
  /** 手动把某个 url 提到最前立即放行（如用户 hover / 聚焦）。 */
  prioritize: (url: string) => void
  /** 上报某个 url 加载失败（用于错误 UI）。 */
  reportError: (url: string) => void
}

export function useLazyGLB(
  sources: readonly LazyGLBSource[],
  opts: UseLazyGLOptions = {},
): LazyGLBController {
  const { camera = { x: 0, z: 0 }, maxConcurrent = 2, initialBatch = 4 } = opts

  // 按优先级排好的有序 url 列表（memo：sources/camera 变化时重排）
  const ordered = useMemo(
    () => sortAssetsByPriority(sources, camera).map((s) => s.url),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, camera.x, camera.z],
  )

  const [statusMap, setStatusMap] = useState<Map<string, GLBLoadStatus>>(new Map())
  // 已放行（允许调用 useGLTF）的 url 集合。一旦放行不撤回，便于拉近即时切回。
  const [admitted, setAdmitted] = useState<Set<string>>(new Set())
  const admittedRef = useRef<Set<string>>(new Set())
  const statusRef = useRef<Map<string, GLBLoadStatus>>(new Map())

  // 已在飞行中（loading）的计数 ref，避免闭包陈旧
  const inflightRef = useRef(0)
  // 用户手动置顶的 url（插队到队首）
  const priorityRef = useRef<string | null>(null)

  const setStatus = useCallback((url: string, s: GLBLoadStatus) => {
    statusRef.current = new Map(statusRef.current).set(url, s)
    setStatusMap(statusRef.current)
  }, [])

  const admit = useCallback(
    (url: string) => {
      if (admittedRef.current.has(url)) return
      admittedRef.current = new Set(admittedRef.current).add(url)
      setAdmitted(admittedRef.current)
      // 标记为 loading：实际解码由子组件 useGLTF 触发
      inflightRef.current += 1
      setStatus(url, 'loading')
    },
    [setStatus],
  )

  // 放行逻辑：取有序队列中尚未放行的，补到 maxConcurrent + initialBatch 的预算内。
  const drainQueue = useCallback(() => {
    const already = admittedRef.current
    // 先放手动置顶
    if (priorityRef.current && !already.has(priorityRef.current)) {
      admit(priorityRef.current)
      priorityRef.current = null
    }
    const budget = Math.max(initialBatch, inflightRef.current) + Math.max(0, maxConcurrent - inflightRef.current)
    // 已放行数 = already.size；继续放行直到达到预算
    for (const url of ordered) {
      if (admittedRef.current.size >= Math.max(budget, initialBatch)) break
      if (!admittedRef.current.has(url)) admit(url)
    }
  }, [ordered, admit, initialBatch, maxConcurrent])

  // 初始：放行首屏一批
  useEffect(() => {
    drainQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered])

  const prioritize = useCallback(
    (url: string) => {
      if (admittedRef.current.has(url)) return
      priorityRef.current = url
      drainQueue()
    },
    [drainQueue],
  )

  const reportError = useCallback(
    (url: string) => {
      inflightRef.current = Math.max(0, inflightRef.current - 1)
      setStatus(url, 'error')
      // 出错后再补一个新的名额，让队列继续推进
      drainQueue()
    },
    [drainQueue, setStatus],
  )

  const statusOf = useCallback(
    (url: string): GLBLoadStatus => statusRef.current.get(url) ?? 'idle',
    [],
  )
  const shouldLoad = useCallback(
    (url: string): boolean => admittedRef.current.has(url),
    [],
  )

  return { statusOf, shouldLoad, admitted, prioritize, reportError }
}

/**
 * IntersectionObserver 便捷封装：返回一个 ref 回调，元素进入视口时触发 onVisible。
 * 用于 DOM 中的模型卡片；不支持 IntersectionObserver 的环境（SSR/测试）直接触发 onVisible。
 */
export function observeVisibility<T extends Element>(
  onVisible: () => void,
  rootMargin = '200px',
): (el: T | null) => void {
  let observer: IntersectionObserver | null = null
  return (el: T | null) => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      onVisible()
      return
    }
    if (observer) observer.disconnect()
    if (!el) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onVisible()
            observer?.disconnect()
          }
        }
      },
      { rootMargin },
    )
    observer.observe(el)
  }
}
