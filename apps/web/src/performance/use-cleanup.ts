/**
 * R4-06 内存泄漏治理 — 统一清理 hook。
 *
 * 把「订阅 / 定时器 / 动画帧 / 事件监听」的清理集中到一个注册表，
 * 组件卸载时一次性全部执行，避免 useEffect 里逐个手写 return 漏写导致泄漏。
 *
 * 核心 createCleanupRegistry() 是纯逻辑（不依赖 React），便于 node 环境单测；
 * useCleanup() 是它在 React 里的薄封装。
 */
import { useEffect, useMemo, useRef, useCallback } from 'react'

export type CleanupFn = () => void

export interface CleanupRegistry {
  /** 注册一个清理函数（卸载时执行） */
  add: (fn: CleanupFn) => void
  /** 注册 setInterval，返回 id；自动 clearInterval */
  addInterval: (fn: () => void, ms: number) => number
  /** 注册 setTimeout，自动 clearTimeout */
  addTimeout: (fn: () => void, ms: number) => number
  /** 注册 requestAnimationFrame，自动 cancelAnimationFrame */
  addRaf: (cb: (t: number) => void) => number
  /** 注册 window/节点事件监听，自动 removeEventListener */
  addEventListener: (
    target: { addEventListener: (...a: unknown[]) => void; removeEventListener: (...a: unknown[]) => void },
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => void
  /** 立即执行所有已注册清理（通常由 hook 在 unmount 调用） */
  cleanup: () => void
  /** 已注册清理项数量（调试/测试） */
  size: () => number
}

/**
 * 创建一个清理注册表。所有 timer/raf/listener 都把「启动 + 注册清理」打包，
 * 调用方只管启动，卸载时 registry.cleanup() 全清。
 */
export function createCleanupRegistry(): CleanupRegistry {
  const fns: CleanupFn[] = []

  const add: CleanupRegistry['add'] = (fn) => {
    fns.push(fn)
  }

  const addInterval: CleanupRegistry['addInterval'] = (fn, ms) => {
    const id = setInterval(fn, ms)
    fns.push(() => clearInterval(id))
    return id as unknown as number
  }

  const addTimeout: CleanupRegistry['addTimeout'] = (fn, ms) => {
    const id = setTimeout(fn, ms)
    fns.push(() => clearTimeout(id))
    return id as unknown as number
  }

  const addRaf: CleanupRegistry['addRaf'] = (cb) => {
    const id = requestAnimationFrame(cb)
    fns.push(() => cancelAnimationFrame(id))
    return id
  }

  const addEventListener: CleanupRegistry['addEventListener'] = (target, type, listener, options) => {
    target.addEventListener(type, listener as EventListener, options as AddEventListenerOptions)
    fns.push(() =>
      target.removeEventListener(type, listener as EventListener, options as EventListener),
    )
  }

  const cleanup = () => {
    while (fns.length) {
      const fn = fns.pop()!
      try {
        fn()
      } catch {
        /* 单个清理失败不影响其余 */
      }
    }
  }

  return { add, addInterval, addTimeout, addRaf, addEventListener, cleanup, size: () => fns.length }
}

/**
 * React hook：组件存活期间持有一个注册表，卸载时自动 cleanup。
 *
 *   const reg = useCleanup()
 *   useEffect(() => {
 *     reg.addInterval(() => tick(), 100)
 *     reg.addEventListener(window, 'resize', onResize)
 *   }, [])
 */
export function useCleanup(): CleanupRegistry {
  const ref = useRef<CleanupRegistry | null>(null)
  if (!ref.current) ref.current = createCleanupRegistry()
  const registry = ref.current

  useEffect(() => {
    // 卸载时清理；effect 每次重跑不重复清理（registry 跨 render 存活）
    return () => {
      registry.cleanup()
    }
  }, [registry])

  return registry
}

/**
 * 视锥剔除辅助：把视锥外物体 visible=false（渲染线程省 draw call）。
 * 纯函数，接收 { visible } 集合，返回应可见的 key 集合——组件据此批量切换。
 * 这里给出几何判断：物体到相机的水平距离超出 far 则不可见。
 */
export function shouldCull(
  objX: number,
  objZ: number,
  camX: number,
  camZ: number,
  cullDistance: number,
): boolean {
  const dx = objX - camX
  const dz = objZ - camZ
  return dx * dx + dz * dz > cullDistance * cullDistance
}

/**
 * 像素比上限：Math.min(devicePixelRatio, 1.5)。
 * 高配置设备在 2x 屏上仍只取 1.5 倍，平衡清晰度与 fill-rate；
 * 低配置设备进一步压到 1。
 */
export function maxPixelRatio(tier: 'high' | 'low', devicePixelRatio = 1): number {
  const cap = tier === 'low' ? 1 : 1.5
  return Math.min(devicePixelRatio, cap)
}

/**
 * 阴影质量按设备等级降级：
 * - high: 2048 阴影贴图，PCFSoft
 * - low: 1024，基础阴影，或直接关阴影。
 */
export function shadowQualityFor(tier: 'high' | 'low'): { mapSize: number; enabled: boolean; soft: boolean } {
  if (tier === 'low') return { mapSize: 1024, enabled: true, soft: false }
  return { mapSize: 2048, enabled: true, soft: true }
}
