// ============================================================================
// PropItem —— 单个 CC0 道具的 3D 渲染（react-three/fiber）
// ----------------------------------------------------------------------------
// 按 PropDefinition.parts 组合 three.js 基础形状（Box/Cylinder/Cone/Sphere），
// 不依赖外部 GLB。云端无 GPU，此组件仅在真机/浏览器中渲染，逻辑由 prop-library
// 与 use-pickup 的纯函数单测覆盖。
// ============================================================================
import type { PropDefinition, PropGeometryPart } from '@balabala/shared'

interface PropItemProps {
  prop: PropDefinition
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** 可拾取提示高亮（靠近玩家时描边/发光） */
  highlight?: boolean
  scale?: number
}

/** 把部件形状映射为 three.js 几何体标签。 */
function Geometry({ part }: { part: PropGeometryPart }) {
  switch (part.shape) {
    case 'box':
      return <boxGeometry args={part.args as [number, number, number]} />
    case 'cylinder':
      return <cylinderGeometry args={part.args as [number, number, number, number]} />
    case 'cone':
      return <coneGeometry args={part.args as [number, number, number, number]} />
    case 'sphere':
      return <sphereGeometry args={part.args as [number, number, number, number]} />
    case 'torus':
      return <torusGeometry args={part.args as [number, number, number, number]} />
    case 'plane':
      return <planeGeometry args={part.args as [number, number]} />
    default:
      return null
  }
}

export default function PropItem({
  prop,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  highlight = false,
  scale = 1,
}: PropItemProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {prop.parts.map((part, i) => (
        <mesh
          key={i}
          position={part.position}
          rotation={part.rotation ?? [0, 0, 0]}
          castShadow
          receiveShadow
        >
          <Geometry part={part} />
          <meshStandardMaterial
            color={part.color}
            roughness={0.7}
            metalness={0.1}
            emissive={part.emissive ?? (highlight ? '#FFD600' : '#000000')}
            emissiveIntensity={part.emissiveIntensity ?? (highlight ? 0.35 : 0)}
          />
        </mesh>
      ))}
    </group>
  )
}
