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
}

/**
 * M13: neutral, realistic dress-form mannequin used as a fallback when a seat
 * has no celebrity GLB.
 *
 * Design parameters:
 *  - Height ~1.7 scene units (judge variant ~1.8 via 1.06 scale), feet at local
 *    y=0 so it lands on the seat surface the same way NormalizedCourtroomModel
 *    does (1.7-unit normalized celebrity bodies).
 *  - Matte warm-gray material (body #7a746c / judge #6a645c, head #6b6560 /
 *    judge #5d5752). Low saturation, no high-saturation blue/red/gold.
 *  - Bald minimal head (sphere only, no facial features) like a store mannequin.
 *  - judge vs party differ only in shade + height, never in hue, so color never
 *    signals which side someone is on.
 */
export default function NeutralMannequin({ active = false, variant = 'party' }: NeutralMannequinProps) {
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

  return (
    <group scale={scale}>
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
    </group>
  )
}
