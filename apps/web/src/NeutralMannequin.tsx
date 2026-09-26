import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshStandardMaterial } from 'three'

interface NeutralMannequinProps {
  /** Display name (accepted for parity with MemberPlaceholder; the parent seat draws the label). */
  name?: string
  /** When true, the torso gets a faint warm emissive pulse (paired with SeatRing). */
  active?: boolean
  /** judge = slightly taller + deeper gray; party = default proportions. Never uses blue/red/gold. */
  variant?: 'judge' | 'party'
  /** seated = 大腿水平(沿+z 朝法庭)、小腿垂直、躯干直，坐在椅上；脚仍落在 group 原点(地面/平台面)。 */
  seated?: boolean
}

/**
 * M13: neutral, realistic dress-form mannequin used as a fallback when a seat
 * has no celebrity GLB.
 *
 * Standing design parameters:
 *  - Height ~1.7 scene units (judge variant ~1.8 via 1.06 scale), feet at local
 *    y=0 so it lands on the seat surface the same way NormalizedCourtroomModel
 *    does (1.7-unit normalized celebrity bodies).
 *
 * Seated design parameters (judge / plaintiff / defendant 坐在桌后):
 *  - 椅面高 local y≈0.45；大腿水平沿 +z(朝法庭方向)伸到膝盖 z≈0.45；
 *    小腿垂直落到脚 local y≈0.03；躯干直立；坐姿头高 ≈1.3。
 *  - group 原点仍在平台/地面面(脚接地)，不悬空、不穿进桌椅。
 *
 * Matte warm-gray material (body #7a746c / judge #6a645c, head #6b6560 /
 * judge #5d5752). Low saturation, no high-saturation blue/red/gold.
 * Bald minimal head (sphere only, no facial features) like a store mannequin.
 * judge vs party differ only in shade + height, never in hue.
 */
export default function NeutralMannequin({ active = false, variant = 'party', seated = false }: NeutralMannequinProps) {
  const matRef = useRef<MeshStandardMaterial | null>(null)
  const isJudge = variant === 'judge'
  const bodyColor = isJudge ? '#6a645c' : '#7a746c'
  const headColor = isJudge ? '#5d5752' : '#6b6560'
  const scale = isJudge ? 1.06 : 1.0

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const t = clock.getElapsedTime()
    // Subtle warm glow only; the active state is already carried by SeatRing + SpeakerSpotlight.
    matRef.current.emissiveIntensity = active ? 0.18 + Math.sin(t * 3) * 0.05 : 0.0
  })

  const bodyMat = <meshStandardMaterial color={bodyColor} roughness={0.85} metalness={0.05} />

  return (
    <group scale={scale}>
      {seated ? (
        <>
          {/* 臀部/椅面：local y≈0.45 */}
          <mesh castShadow position={[0, 0.46, 0.02]}>
            <boxGeometry args={[0.34, 0.14, 0.34]} />
            {bodyMat}
          </mesh>
          {/* 大腿：水平沿 +z，从髋 z=0 到膝 z≈0.45（cylinder 默认 y 轴，绕 x 转 90° 躺平） */}
          <mesh castShadow position={[-0.09, 0.46, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.075, 0.07, 0.46, 12]} />
            {bodyMat}
          </mesh>
          <mesh castShadow position={[0.09, 0.46, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.075, 0.07, 0.46, 12]} />
            {bodyMat}
          </mesh>
          {/* 小腿：垂直，从膝(y≈0.46,z=0.45) 到踝(y≈0.05,z=0.45) */}
          <mesh castShadow position={[-0.09, 0.25, 0.46]}>
            <cylinderGeometry args={[0.06, 0.05, 0.42, 12]} />
            {bodyMat}
          </mesh>
          <mesh castShadow position={[0.09, 0.25, 0.46]}>
            <cylinderGeometry args={[0.06, 0.05, 0.42, 12]} />
            {bodyMat}
          </mesh>
          {/* 脚：平放在地面，脚尖朝 +z */}
          <mesh castShadow position={[-0.09, 0.04, 0.5]}>
            <boxGeometry args={[0.11, 0.06, 0.22]} />
            {bodyMat}
          </mesh>
          <mesh castShadow position={[0.09, 0.04, 0.5]}>
            <boxGeometry args={[0.11, 0.06, 0.22]} />
            {bodyMat}
          </mesh>
          {/* 躯干：直立，从 y≈0.53 到 y≈1.15（坐姿躯干略前倾，肩膀朝桌面方向） */}
          <mesh castShadow position={[0, 0.84, 0.0]}>
            <cylinderGeometry args={[0.18, 0.15, 0.62, 16]} />
            <meshStandardMaterial
              ref={matRef}
              color={bodyColor}
              roughness={0.85}
              metalness={0.05}
              emissive="#ffd0a0"
              emissiveIntensity={active ? 0.18 : 0}
            />
          </mesh>
          {/* 手臂：自然向前搭在膝/桌面方向 */}
          <mesh castShadow position={[-0.22, 0.78, 0.18]} rotation={[Math.PI / 3.2, 0, 0.1]}>
            <cylinderGeometry args={[0.05, 0.04, 0.55, 10]} />
            {bodyMat}
          </mesh>
          <mesh castShadow position={[0.22, 0.78, 0.18]} rotation={[Math.PI / 3.2, 0, -0.1]}>
            <cylinderGeometry args={[0.05, 0.04, 0.55, 10]} />
            {bodyMat}
          </mesh>
          {/* 颈 */}
          <mesh castShadow position={[0, 1.16, 0]}>
            <cylinderGeometry args={[0.055, 0.06, 0.1, 10]} />
            <meshStandardMaterial color={headColor} roughness={0.85} metalness={0.05} />
          </mesh>
          {/* 光头（无面部），坐姿头高 ≈1.3 */}
          <mesh castShadow position={[0, 1.29, 0]}>
            <sphereGeometry args={[0.105, 16, 16]} />
            <meshStandardMaterial color={headColor} roughness={0.85} metalness={0.05} />
          </mesh>
        </>
      ) : (
        <>
          {/* legs: y 0 -> 0.78 */}
          <mesh castShadow position={[-0.09, 0.39, 0]}>
            <cylinderGeometry args={[0.07, 0.06, 0.78, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.85} metalness={0.05} />
          </mesh>
          <mesh castShadow position={[0.09, 0.39, 0]}>
            <cylinderGeometry args={[0.07, 0.06, 0.78, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.85} metalness={0.05} />
          </mesh>
          {/* torso: y 0.78 -> 1.40, carries the active emissive pulse */}
          <mesh castShadow position={[0, 1.09, 0]}>
            <cylinderGeometry args={[0.18, 0.14, 0.62, 16]} />
            <meshStandardMaterial
              ref={matRef}
              color={bodyColor}
              roughness={0.85}
              metalness={0.05}
              emissive="#ffd0a0"
              emissiveIntensity={active ? 0.18 : 0}
            />
          </mesh>
          {/* arms: hang from shoulders ~1.40 down to ~0.80 */}
          <mesh castShadow position={[-0.24, 1.08, 0]} rotation={[0, 0, 0.12]}>
            <cylinderGeometry args={[0.05, 0.04, 0.6, 10]} />
            <meshStandardMaterial color={bodyColor} roughness={0.85} metalness={0.05} />
          </mesh>
          <mesh castShadow position={[0.24, 1.08, 0]} rotation={[0, 0, -0.12]}>
            <cylinderGeometry args={[0.05, 0.04, 0.6, 10]} />
            <meshStandardMaterial color={bodyColor} roughness={0.85} metalness={0.05} />
          </mesh>
          {/* neck */}
          <mesh castShadow position={[0, 1.44, 0]}>
            <cylinderGeometry args={[0.055, 0.06, 0.1, 10]} />
            <meshStandardMaterial color={headColor} roughness={0.85} metalness={0.05} />
          </mesh>
          {/* bald head, no facial features */}
          <mesh castShadow position={[0, 1.58, 0]}>
            <sphereGeometry args={[0.105, 16, 16]} />
            <meshStandardMaterial color={headColor} roughness={0.85} metalness={0.05} />
          </mesh>
        </>
      )}
    </group>
  )
}
