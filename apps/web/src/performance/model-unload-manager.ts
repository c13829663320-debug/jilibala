/**
 * R4-06 性能治理 — 模型按需卸载管理器。
 *
 * 离开场景/建筑时调用 Three.js dispose() 释放几何体、材质、纹理；
 * 对已加载资源做**引用计数**：同一 key 的共享资源（如公共地面、共享材质）
 * 只在最后一个使用者 release 时才真正 dispose，避免重复释放 / 他处仍在用却被释放。
 *
 * - 纯 TypeScript，不依赖 THREE 运行时：dispose 通过注入的 disposeFn 执行，
 *   这样在 node 环境（vitest）下可以用假函数验证引用计数与重复释放防护；
 * - 切建筑时按 group 批量卸载：unloadBuilding(prevId) 释放该建筑独占资源，
 *   共享资源因仍被广场本体引用而计数不归零、不被释放。
 */

export type DisposeFn = () => void

interface ResourceEntry {
  /** 当前引用计数 */
  count: number
  /** 真正的释放函数（Three.js dispose 编排） */
  dispose: DisposeFn
  /** 引用该资源的分组集合（建筑 id / 场景 id），共享资源可被多组同时持有 */
  groups: Set<string>
  /** 调试标签 */
  label: string
}

export interface AcquireOptions {
  /** 所属分组（建筑 id）；切建筑时整组 release。 */
  group?: string
  label?: string
}

export class ModelUnloadManager {
  private resources = new Map<string, ResourceEntry>()
  /** 记录是否已 dispose 过，重复 dispose 直接忽略（防二次释放） */
  private disposedKeys = new Set<string>()

  /**
   * 登记/引用一个资源。
   * - 首次出现：记录 disposeFn，count=1；
   * - 已存在：count+1，新传入的 disposeFn 被忽略（共享资源只认第一个释放逻辑）。
   */
  acquire(key: string, disposeFn: DisposeFn, opts: AcquireOptions = {}): void {
    const group = opts.group ?? 'default'
    const existing = this.resources.get(key)
    if (existing) {
      existing.count += 1
      existing.groups.add(group)
      return
    }
    this.resources.set(key, {
      count: 1,
      dispose: disposeFn,
      groups: new Set([group]),
      label: opts.label ?? key,
    })
    this.disposedKeys.delete(key)
  }

  /** 减少引用计数；归零时真正 dispose。返回是否触发了实际释放。 */
  release(key: string): boolean {
    const entry = this.resources.get(key)
    if (!entry) return false
    entry.count -= 1
    if (entry.count > 0) return false
    // 引用归零：真正释放（幂等——若已 dispose 过则跳过）
    this.resources.delete(key)
    if (this.disposedKeys.has(key)) return true
    this.disposedKeys.add(key)
    try {
      entry.dispose()
    } catch {
      /* dispose 异常不影响管理器状态 */
    }
    return true
  }

  /** 当前引用计数（未登记返回 0）。 */
  refCount(key: string): number {
    return this.resources.get(key)?.count ?? 0
  }

  /** 某 key 是否已真正 dispose 过（防重复释放测试用）。 */
  isDisposed(key: string): boolean {
    return this.disposedKeys.has(key)
  }

  /**
   * 切换建筑：卸载上一建筑的独占资源。
   * 遍历所有属于该 group 的资源并 release 一次——共享资源因仍被广场持有、
   * 计数 >1 而不会被真正释放。
   */
  unloadGroup(group: string): string[] {
    const released: string[] = []
    for (const [key, entry] of Array.from(this.resources)) {
      if (!entry.groups.has(group)) continue
      entry.groups.delete(group)
      if (this.release(key)) released.push(key)
    }
    return released
  }

  /** 卸载指定建筑模型（unloadGroup 的语义别名，便于阅读调用点）。 */
  unloadBuilding(buildingId: string): string[] {
    return this.unloadGroup(`building:${buildingId}`)
  }

  /** 全部卸载（组件 unmount / 离开广场时）。 */
  disposeAll(): string[] {
    const released: string[] = []
    for (const key of Array.from(this.resources.keys())) {
      if (this.release(key)) released.push(key)
    }
    return released
  }

  /** 当前登记资源数（调试/测试用）。 */
  get size(): number {
    return this.resources.size
  }
}

/** 全局单例：整个广场共享同一个卸载管理器。 */
let globalManager: ModelUnloadManager | null = null
export function getModelUnloadManager(): ModelUnloadManager {
  if (!globalManager) globalManager = new ModelUnloadManager()
  return globalManager
}
/** 测试重置单例。 */
export function resetModelUnloadManager(): void {
  globalManager = null
}
