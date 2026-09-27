/**
 * 开放世界 · R5 首启聚焦标记
 * ------------------------------------------------------------------
 * 在推荐建筑入口地面放一个脉冲发光圆环 + 上下浮动的箭头，
 * 告诉新手「点这里 / 走进这里」。
 *
 * 纯 three 原生几何体（ring + cone），不使用任何 WebGL2 专属扩展，
 * swiftshader 软件渲染下也能正常绘制。
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface FocusMarkerProps {
  /** 入口世界坐标（地面）。 */
  x: number
  z: number
  /** 环半径，默认 2.2。 */
  radius?: number
}

export default function FocusMarker({ x, z, radius = 2.2 }: FocusMarkerProps) {
  const ringRef = useRef<THREE.Mesh>(null)
  const arrowRef = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // 圆环呼吸缩放
    if (ringRef.current) {
      const s = 1 + Math.sin(t * 3) * 0.12
      ringRef.current.scale.set(s, s, 1)
      const mat = ringRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.9 + Math.sin(t * 3) * 0.4
    }
    // 箭头上下浮动
    if (arrowRef.current) {
      arrowRef.current.position.y = 4.2 + Math.sin(t * 2.2) * 0.35
      arrowRef.current.rotation.y = t * 1.2
    }
  })

  return (
    <group position={[x, 0, z]}>
      {/* 地面脉冲圆环 */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[radius, radius + 0.5, 48]} />
        <meshStandardMaterial
          color="#FFD600"
          emissive="#FFD600"
          emissiveIntensity={1}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 浮动箭头（圆锥尖端朝上再翻转，指向地面建筑） */}
      <group ref={arrowRef}>
        <mesh position={[0, 0, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.5, 1.1, 20]} />
          <meshStandardMaterial color="#FFD600" emissive="#FFD600" emissiveIntensity={0.7} />
        </mesh>
      </group>
    </group>
  )
}
