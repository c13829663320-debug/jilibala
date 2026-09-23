import { Canvas, type CanvasProps } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { WebGLRenderer } from 'three'

/**
 * 统一的安全 Canvas，解决两类稳定性问题：
 *
 * 1. WebGL Context Lost 后永久黑屏：
 *    浏览器对同一进程并发 WebGL 上下文数量有上限（约 16 个），
 *    多标签页 + 反复进出 3D 场景 / 弹窗叠加 Canvas 会触发上下文被强制回收。
 *    这里监听 `webglcontextlost`，preventDefault 后通过改变 key 强制重建整个 Canvas，
 *    从而拿到全新上下文并恢复渲染（R3F 自身不会在 context lost 后自动恢复）。
 *
 * 2. 卸载时上下文未及时归还：
 *    unmount 时主动 gl.dispose() + forceContextLoss()，确保上下文立即释放、不累积。
 *
 * 其余 props（camera / dpr / shadows / children 等）原样透传给 R3F Canvas。
 */
export function SafeCanvas({ onCreated, children, ...rest }: CanvasProps) {
  const [rebootKey, setRebootKey] = useState(0)
  const glRef = useRef<WebGLRenderer | null>(null)
  // 记录最近的自动重启时间，用于防止“恢复后立刻又丢”导致的无限重启。
  const recentRebootsRef = useRef<number[]>([])

  useEffect(() => {
    return () => {
      const gl = glRef.current
      if (gl) {
        try { gl.dispose() } catch { /* noop */ }
        try { gl.forceContextLoss() } catch { /* noop */ }
      }
    }
  }, [])

  return (
    <Canvas
      key={rebootKey}
      {...rest}
      onCreated={(state) => {
        glRef.current = state.gl
        const el = state.gl.domElement
        const handleLost = (event: Event) => {
          // 允许浏览器在可能时恢复上下文（同时我们也会主动重建）。
          event.preventDefault()

          // Context 丢失后，three 的资源表对“尚未渲染就被卸载”的渲染目标不再完整，
          // drei <Environment> 的 CubeRenderTarget 卸载时会读取未初始化的帧缓冲，
          // 在 deallocateRenderTarget 抛 TypeError（reading '0'）。这里给该 renderer 的
          // properties.get 兜底：仅给未初始化帧缓冲的渲染目标补一个空数组，使释放安全。
          // 只作用于“已丢失上下文”的这个 renderer，正常流程完全不受影响。
          try {
            const propsStore = state.gl.properties as unknown as {
              __balabalaPatched?: boolean
              get: (object: unknown) => Record<string, unknown>
            }
            if (!propsStore.__balabalaPatched) {
              const originalGet = propsStore.get.bind(propsStore)
              propsStore.get = (object: unknown) => {
                const map = originalGet(object) as Record<string, unknown>
                const maybeTarget = object as { isRenderTarget?: boolean }
                if (maybeTarget?.isRenderTarget && map.__webglFramebuffer === undefined) {
                  map.__webglFramebuffer = []
                }
                return map
              }
              propsStore.__balabalaPatched = true
            }
          } catch { /* noop */ }

          const now = Date.now()
          const recent = recentRebootsRef.current.filter((t) => now - t < 10_000)
          // 10 秒窗口内最多自动重建 4 次；超过说明 GPU 确实不足，停止循环，交给用户刷新/释放标签。
          if (recent.length >= 4) {
            recentRebootsRef.current = recent
            return
          }
          recent.push(now)
          recentRebootsRef.current = recent
          window.setTimeout(() => setRebootKey((k) => k + 1), 300)
        }
        el.addEventListener('webglcontextlost', handleLost, false)
        // 透传外部 onCreated。
        onCreated?.(state)
      }}
    >
      {children}
    </Canvas>
  )
}

export default SafeCanvas
