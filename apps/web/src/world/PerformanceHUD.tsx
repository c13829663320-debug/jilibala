/**
 * 开放世界 · 性能监控 HUD
 * ------------------------------------------------------------------
 * 在不打断玩家的前提下，实时量化渲染开销，方便在真机上回归性能预算
 * （见 art-spec.ts PERF_BUDGET）。
 *
 * 两件套（因为 useThree/useFrame 只能在 <Canvas> 内用，而 DOM 浮层要在 Canvas 外）：
 *   - <PerfCollector/>   放进 <Canvas> 内部：每帧读 gl.info.render，算 FPS，写入 perfStore
 *   - <PerformanceHUD/>  放在 <Canvas> 外（DOM 覆盖层）：以 ~4Hz 读 perfStore 渲染浮层
 *
 * 显示开关：URL 加 ?perf=1，或 localStorage['balabala.perfHud']='1'。
 *
 * 纯函数（isPerfEnabled / computeFps / formatCount / readRenderInfo / FpsWindow）
 * 不依赖 WebGL，可在 node 环境直接单测。
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PERF_BUDGET } from './art-spec'

// ---------- 开关（纯函数，可测） ----------
export const PERF_STORAGE_KEY = 'balabala.perfHud'

/** 从 location.search 里解析 ?perf=1 */
export function perfParamOn(search: string): boolean {
  return /[?&]perf=1\b/.test(search)
}

/** localStorage 是否开启（'1' / 'true' 视为开）。storage 可注入便于测试。 */
export function perfStorageOn(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  if (!storage) return false
  const v = storage.getItem(PERF_STORAGE_KEY)
  return v === '1' || v === 'true'
}

/** 是否显示性能 HUD：URL ?perf=1 或 localStorage 开关任一为真。 */
export function isPerfEnabled(
  search: string,
  storage: Pick<Storage, 'getItem'> | undefined,
): boolean {
  return perfParamOn(search) || perfStorageOn(storage)
}

// ---------- FPS 采样（纯函数） ----------
export interface RenderInfo {
  calls: number
  triangles: number
  points: number
  lines: number
}

/** 从 three 的 renderer.info.render 读取单帧 draw call / 三角形数（纯数据映射）。 */
export function readRenderInfo(
  info: { render?: { calls?: number; triangles?: number; points?: number; lines?: number } },
): RenderInfo {
  return {
    calls: info.render?.calls ?? 0,
    triangles: info.render?.triangles ?? 0,
    points: info.render?.points ?? 0,
    lines: info.render?.lines ?? 0,
  }
}

/** 滚动时间窗 FPS 计算器：喂入每帧 delta（秒），输出平滑 FPS。 */
export class FpsWindow {
  private samples: number[] = []
  constructor(private readonly maxSamples = 30) {}

  sample(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
    this.samples.push(deltaSeconds)
    if (this.samples.length > this.maxSamples) this.samples.shift()
  }

  /** 最近 N 帧的平均 FPS；样本不足时返回 0。 */
  fps(): number {
    if (this.samples.length === 0) return 0
    const sum = this.samples.reduce((a, b) => a + b, 0)
    const avg = sum / this.samples.length
    if (avg <= 0) return 0
    return 1 / avg
  }

  reset(): void {
    this.samples = []
  }
}

/** 由 delta 数组直接算 FPS（无状态，便于单测）。 */
export function computeFps(deltas: number[]): number {
  if (deltas.length === 0) return 0
  const sum = deltas.reduce((a, b) => a + b, 0)
  const avg = sum / deltas.length
  return avg > 0 ? 1 / avg : 0
}

/** 大数字缩写：1234 -> "1.2k"，1_500_000 -> "1.50M"。 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${Math.round(n)}`
}

// ---------- 跨 Canvas / DOM 共享的运行时数据（mutable，不走 React state） ----------
export interface PerfSnapshot extends RenderInfo {
  fps: number
  textures: number
}

export const perfStore: PerfSnapshot = {
  fps: 0,
  calls: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  textures: 0,
}

// ---------- Canvas 内采集器（放进 <Canvas>） ----------
export function PerfCollector() {
  const { gl } = useThree()
  const fpsRef = useRef(new FpsWindow(30))

  useFrame((_, delta) => {
    fpsRef.current.sample(delta)
    const info = readRenderInfo(gl.info)
    perfStore.fps = Math.round(fpsRef.current.fps())
    perfStore.calls = info.calls
    perfStore.triangles = info.triangles
    perfStore.points = info.points
    perfStore.lines = info.lines
    // gl.info.memory.textures：当前显存里的贴图数
    perfStore.textures = gl.info?.memory?.textures ?? 0
  })

  return null
}

// ---------- DOM 覆盖层（放在 <Canvas> 外） ----------
interface PerformanceHUDProps {
  /** 采样刷新间隔 ms，默认 250（4Hz，避免每帧重渲染 DOM） */
  intervalMs?: number
}

export default function PerformanceHUD({ intervalMs = 250 }: PerformanceHUDProps) {
  const [, force] = useState(0)
  const enabled = isPerfEnabled(
    typeof window !== 'undefined' ? window.location.search : '',
    typeof window !== 'undefined' ? window.localStorage : undefined,
  )

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => force((n) => n + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs])

  if (!enabled) return null

  const overBudget =
    perfStore.calls > PERF_BUDGET.plazaMaxDrawCalls
      ? 'color:#ff6b6b'
      : 'color:#7dd87d'

  return (
    <div
      style={{
        position: 'fixed',
        top: 36,
        right: 12,
        zIndex: 300,
        background: 'rgba(10,10,10,0.78)',
        color: '#9fef9f',
        font: '11px/1.5 ui-monospace, Menlo, monospace',
        padding: '6px 10px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
        border: '1px solid #2a2a2a',
      }}
    >
      {`FPS ${perfStore.fps}
drawCalls ${perfStore.calls}  ${overBudget}
triangles ${formatCount(perfStore.triangles)}
textures ${perfStore.textures}
budget ≤${PERF_BUDGET.plazaMaxDrawCalls}dc`}
    </div>
  )
}
