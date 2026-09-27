/**
 * 开放世界 · 按需加载 / 卸载机制
 * ------------------------------------------------------------------
 * 六座建筑室内模型都很大（~2.7MB glb/座）。玩家不可能同时身处所有建筑，
 * 因此：
 *   - 进入某建筑前用 React.lazy 按需分包（见 interior/building-interiors.ts）
 *   - 模型用 useGLTF.preload(url) 预热；离开室内时 useGLTF.clear(url) 卸载，
 *     释放 geometry / material / texture 显存
 *   - useOnDemandLoad(assetId, enabled, url)：enabled=true 预加载，false 卸载
 *   - AssetLoadTracker 记录每次 preload/dispose，可断言「无泄漏」
 *
 * 注意：本模块在浏览器运行时 import drei；纯部分（AssetLoadTracker）不依赖 three。
 */
import { useEffect, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import type * as THREE from 'three'

// ---------- 加载/卸载日志与泄漏追踪（纯逻辑，可单测） ----------
export type AssetAction = 'preload' | 'dispose'

export interface AssetEvent {
  assetId: string
  action: AssetAction
  at: number
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'disposed'

/**
 * 记录资产生命周期：preload 计数 +1，dispose 计数 -1。
 * 所有 preload 最终都应配对 dispose，否则 hasLeak() 为 true（内存未释放）。
 */
export class AssetLoadTracker {
  private active = new Map<string, number>()
  private events: AssetEvent[] = []

  preload(assetId: string, now: number = Date.now()): void {
    this.active.set(assetId, (this.active.get(assetId) ?? 0) + 1)
    this.events.push({ assetId, action: 'preload', at: now })
  }

  dispose(assetId: string, now: number = Date.now()): void {
    const n = this.active.get(assetId) ?? 0
    this.active.set(assetId, Math.max(0, n - 1))
    this.events.push({ assetId, action: 'dispose', at: now })
  }

  /** 当前仍驻留内存（已 preload 未 dispose）的资产 id */
  loadedAssets(): string[] {
    return [...this.active.entries()]
      .filter(([, n]) => n > 0)
      .map(([id]) => id)
  }

  /** 任一笔 preload 未配对 dispose → 有泄漏 */
  hasLeak(): boolean {
    return this.loadedAssets().length > 0
  }

  get log(): readonly AssetEvent[] {
    return this.events
  }

  reset(): void {
    this.active.clear()
    this.events = []
  }
}

/** 全局单例：跨场景共享，便于退出世界时统一审计 */
export const globalAssetTracker = new AssetLoadTracker()

// ---------- three 资源释放工具 ----------
/**
 * 遍历 Object3D，dispose 其 geometry / material / texture。
 * 退出室内场景时调用，确保 GPU 显存被回收（useGLTF.clear 只清 drei 缓存，
 * 这里兜底释放已挂载到 scene 的资源）。
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!mat) continue
      const rec = mat as THREE.MeshStandardMaterial
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
        const tex = rec[key] as THREE.Texture | null
        if (tex) tex.dispose()
      }
      mat.dispose()
    }
  })
}

// ---------- React Hook ----------
export interface OnDemandResult {
  status: LoadStatus
  loaded: string[]
}

/**
 * 按需加载某资产：
 *   - enabled=true  → useGLTF.preload(url) 预热 + 标记 ready
 *   - enabled=false → useGLTF.clear(url) 卸载 + 标记 disposed
 * 卸载时自动 dispose drei 的 glb 缓存，释放内存。
 */
export function useOnDemandLoad(
  assetId: string,
  enabled: boolean,
  url?: string,
  tracker: AssetLoadTracker = globalAssetTracker,
): OnDemandResult {
  const [status, setStatus] = useState<LoadStatus>(enabled && url ? 'loading' : 'idle')

  useEffect(() => {
    if (!url) return
    if (enabled) {
      setStatus('loading')
      useGLTF.preload(url)
      tracker.preload(assetId)
      setStatus('ready')
      // 卸载在 cleanup / 下次 effect false 分支里完成
      return () => {
        useGLTF.clear(url)
        tracker.dispose(assetId)
      }
    }
    // enabled=false：主动卸载
    useGLTF.clear(url)
    tracker.dispose(assetId)
    setStatus('disposed')
    return undefined
  }, [assetId, enabled, url, tracker])

  return { status, loaded: tracker.loadedAssets() }
}
