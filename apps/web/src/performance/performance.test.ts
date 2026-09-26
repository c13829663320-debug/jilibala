// R4-06 性能治理纯逻辑单测（node 环境，无 DOM/three 运行时）。
import { describe, it, expect, vi } from 'vitest'
import {
  detectDeviceTier,
  shouldPreload,
  preloadAssets,
  PLAZA_PRIORITY_ASSETS,
  type AssetSpec,
} from './asset-preloader'
import {
  ModelUnloadManager,
  resetModelUnloadManager,
} from './model-unload-manager'
import {
  createCleanupRegistry,
  shouldCull,
  maxPixelRatio,
  shadowQualityFor,
} from './use-cleanup'

const TEX_HI: AssetSpec = { url: '/big-4k.jpg', kind: 'texture', highRes: true }
const MODEL: AssetSpec = { url: '/plaza.glb', kind: 'model' }
const FONT: AssetSpec = { url: '/title.woff2', kind: 'font' }

function okFetch(): (url: string) => Promise<unknown> {
  return async (url) => ({ url, ok: true })
}

describe('asset-preloader 设备分级', () => {
  it('CPU 核数 < 4 → low', () => {
    expect(detectDeviceTier({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe('low')
  })
  it('deviceMemory < 4GB → low', () => {
    expect(detectDeviceTier({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe('low')
  })
  it('高端设备 → high，不降画质', () => {
    expect(detectDeviceTier({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe('high')
  })
  it('shouldPreload：低配跳过 highRes 纹理，高配加载', () => {
    expect(shouldPreload(TEX_HI, 'low')).toBe(false)
    expect(shouldPreload(TEX_HI, 'high')).toBe(true)
    expect(shouldPreload(MODEL, 'low')).toBe(true)
  })
})

describe('asset-preloader 预加载编排', () => {
  it('上报进度：loaded/total/done 正确递增', async () => {
    const events: Array<{ loaded: number; total: number; done: boolean }> = []
    await preloadAssets([MODEL, FONT], {
      device: { hardwareConcurrency: 8, deviceMemory: 8 },
      fetchImpl: okFetch(),
      onProgress: (p) => events.push({ loaded: p.loaded, total: p.total, done: p.done }),
    })
    const last = events[events.length - 1]
    expect(last.total).toBe(2)
    expect(last.loaded).toBe(2)
    expect(last.done).toBe(true)
  })

  it('低配设备跳过 highRes 纹理，计入 skipped 但仍算完成', async () => {
    const { loaded, skipped } = await preloadAssets([MODEL, TEX_HI], {
      device: { hardwareConcurrency: 2, deviceMemory: 2 },
      fetchImpl: okFetch(),
    })
    expect(skipped).toContain('/big-4k.jpg')
    expect(loaded).toContain('/plaza.glb')
    expect(loaded).not.toContain('/big-4k.jpg')
  })

  it('预加载默认清单非空', () => {
    expect(PLAZA_PRIORITY_ASSETS.length).toBeGreaterThan(0)
    expect(PLAZA_PRIORITY_ASSETS.some((a) => a.highRes)).toBe(true)
  })

  it('单个资源失败不中断整体预加载', async () => {
    const fetchImpl = async (url: string) => {
      if (url === '/fail.glb') throw new Error('boom')
      return { ok: true }
    }
    const { loaded } = await preloadAssets(
      [{ url: '/fail.glb', kind: 'model' }, MODEL],
      { device: { hardwareConcurrency: 8, deviceMemory: 8 }, fetchImpl },
    )
    expect(loaded).toHaveLength(2)
  })

  it('取消信号 abort 后不再继续拉取', async () => {
    const signal = { aborted: true }
    const fetchImpl = vi.fn(okFetch())
    await preloadAssets([MODEL, FONT], {
      device: { hardwareConcurrency: 8, deviceMemory: 8 },
      fetchImpl,
      signal,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('model-unload-manager 引用计数', () => {
  it('acquire/release：引用归零才真正 dispose', () => {
    const mgr = new ModelUnloadManager()
    const dispose = vi.fn()
    mgr.acquire('geo:plaza', dispose)
    mgr.release('geo:plaza')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(mgr.refCount('geo:plaza')).toBe(0)
  })

  it('共享资源：第二次 acquire 共享引用，release 一次不 dispose', () => {
    const mgr = new ModelUnloadManager()
    const dispose = vi.fn()
    mgr.acquire('shared:ground', dispose)
    mgr.acquire('shared:ground', () => { throw new Error('不应调用第二个 dispose') })
    expect(mgr.refCount('shared:ground')).toBe(2)
    // 第一次 release：还有 1 个引用，不 dispose
    expect(mgr.release('shared:ground')).toBe(false)
    expect(dispose).not.toHaveBeenCalled()
    // 第二次 release：归零，dispose 一次
    expect(mgr.release('shared:ground')).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('重复释放防护：disposeAll 幂等，不会二次 dispose', () => {
    const mgr = new ModelUnloadManager()
    const d1 = vi.fn()
    mgr.acquire('a', d1)
    mgr.disposeAll()
    mgr.disposeAll()
    expect(d1).toHaveBeenCalledTimes(1)
    expect(mgr.isDisposed('a')).toBe(true)
  })

  it('unloadGroup：只释放该建筑组，共享资源保留', () => {
    const mgr = new ModelUnloadManager()
    const buildingDispose = vi.fn()
    const sharedDispose = vi.fn()
    // 共享地面：被广场(default)与建筑A同时引用
    mgr.acquire('ground', sharedDispose, { group: 'plaza' })
    mgr.acquire('ground', sharedDispose, { group: 'building:a' })
    // 建筑A独占模型
    mgr.acquire('buildingA:mesh', buildingDispose, { group: 'building:a' })
    const released = mgr.unloadBuilding('a')
    // 建筑独占模型被释放；ground 仍被 plaza 引用不释放
    expect(released).toContain('buildingA:mesh')
    expect(released).not.toContain('ground')
    expect(buildingDispose).toHaveBeenCalledTimes(1)
    expect(sharedDispose).not.toHaveBeenCalled()
    expect(mgr.refCount('ground')).toBe(1)
  })

  it('release 未登记的 key 返回 false，不抛错', () => {
    const mgr = new ModelUnloadManager()
    expect(mgr.release('nope')).toBe(false)
  })

  it('resetModelUnloadManager 重置全局单例', () => {
    resetModelUnloadManager()
    expect(true).toBe(true)
  })
})

describe('use-cleanup 注册表与渲染辅助', () => {
  it('cleanup 执行所有注册函数', () => {
    const reg = createCleanupRegistry()
    const a = vi.fn()
    const b = vi.fn()
    reg.add(a)
    reg.add(b)
    expect(reg.size()).toBe(2)
    reg.cleanup()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(reg.size()).toBe(0)
  })

  it('cleanup 中单个函数抛错不影响其余执行', () => {
    const reg = createCleanupRegistry()
    const after = vi.fn()
    reg.add(() => { throw new Error('boom') })
    reg.add(after)
    reg.cleanup()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('shouldCull：距离超出阈值 → true（视锥外剔除）', () => {
    // 相机在 (0,0)，物体在 (10,0)，cullDistance=5 → 剔除
    expect(shouldCull(10, 0, 0, 0, 5)).toBe(true)
    // 物体在 (3,0) → 不剔除
    expect(shouldCull(3, 0, 0, 0, 5)).toBe(false)
  })

  it('maxPixelRatio：high 封顶 1.5，low 封顶 1', () => {
    expect(maxPixelRatio('high', 2)).toBe(1.5)
    expect(maxPixelRatio('high', 1)).toBe(1)
    expect(maxPixelRatio('low', 3)).toBe(1)
  })

  it('shadowQualityFor：low 关软阴影/降贴图，high 保持高质量', () => {
    expect(shadowQualityFor('low')).toEqual({ mapSize: 1024, enabled: true, soft: false })
    expect(shadowQualityFor('high')).toEqual({ mapSize: 2048, enabled: true, soft: true })
  })
})
