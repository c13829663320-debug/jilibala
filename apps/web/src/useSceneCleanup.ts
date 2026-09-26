import { useEffect, type RefObject } from 'react'
import * as THREE from 'three'

/**
 * 遍历 THREE.Object3D，dispose 几何体、材质、纹理。
 * 注意：不 dispose 共享资源（如环境贴图），由调用方控制。
 */
export function disposeObject(root: THREE.Object3D | null | undefined) {
  if (!root) return
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      if (mesh.geometry) {
        try { mesh.geometry.dispose() } catch { /* noop */ }
      }
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
      const disposeMat = (m: THREE.Material) => {
        // 释放材质上引用的纹理
        const matAny = m as unknown as Record<string, unknown>
        for (const key of Object.keys(matAny)) {
          const val = matAny[key]
          if (val && (val as THREE.Texture).isTexture) {
            try { (val as THREE.Texture).dispose() } catch { /* noop */ }
          }
        }
        try { m.dispose() } catch { /* noop */ }
      }
      if (Array.isArray(material)) material.forEach(disposeMat)
      else if (material) disposeMat(material)
    }
  })
}

/**
 * 3D 场景 unmount 清理 hook。
 * 用法：
 *   const sceneRef = useRef<THREE.Group>(null)
 *   useSceneCleanup(sceneRef, ['/models/xxx.glb'])
 *   // 动态路径（如名人模型 URL）：传函数，cleanup 时读取最新值
 *   useSceneCleanup(sceneRef, () => celebrities.map(c => c.model).filter(Boolean))
 *
 * - dispose sceneRef 子树下所有 geometry/material/texture
 * - 调用 drei useGLTF.clear() 清理指定模型缓存（防止复用已 dispose 的资源）
 * - 只遍历 sceneRef 子树，不影响 Canvas 共享的 Environment/Lightformer 等资源
 */
export function useSceneCleanup(
  sceneRef: RefObject<THREE.Object3D | null>,
  gltfPaths: string[] | (() => string[]) = [],
) {
  useEffect(() => {
    return () => {
      disposeObject(sceneRef.current ?? null)
      // 清理 drei 的 GLTF 缓存（避免下次进入场景复用已 dispose 的资源）
      // 动态 import 以避免在非 3D 场景下打包进 drei。
      const paths = typeof gltfPaths === 'function' ? gltfPaths() : gltfPaths
      if (paths.length) {
        import('@react-three/drei').then(({ useGLTF }) => {
          for (const p of paths) {
            if (!p) continue
            try { useGLTF.clear(p) } catch { /* noop */ }
          }
        }).catch(() => { /* noop */ })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
