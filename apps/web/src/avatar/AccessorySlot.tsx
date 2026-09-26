// ===== AccessorySlot：配饰槽位 =====
// 程序化生成帽子/发型/眼镜/手持物等配饰（纯基础几何体），不依赖外部模型。
// 按物品 kind 选形状，颜色绑定到已穿戴颜色。
import { getItem, type EquippedItem, type OutfitSlot } from './outfit-system'

interface AccessorySlotProps {
  slot: OutfitSlot
  equipped?: EquippedItem
  scale?: number
}

/**
 * 一个配饰槽位：根据物品 kind 渲染对应基础几何体。
 * - head: cap（棒球帽）/ hat（礼帽）/ hair（丸子头）
 * - accessoryR: glasses（眼镜）/ prop（手持杯/书）
 * - accessoryL: prop（手持物）
 */
export function AccessorySlot({ slot, equipped, scale = 1 }: AccessorySlotProps) {
  if (!equipped) return null
  const item = getItem(equipped.itemId)
  if (!item) return null
  const color = equipped.color

  // —— 头部配饰：在头（y≈1.58，r=0.105）上方 ——
  if (slot === 'head') {
    if (item.kind === 'cap') {
      return (
        <group scale={scale}>
          <mesh position={[0, 1.66, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 0.07, 16]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          {/* 帽檐朝 +z */}
          <mesh position={[0, 1.64, 0.12]} castShadow>
            <boxGeometry args={[0.16, 0.02, 0.12]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        </group>
      )
    }
    if (item.kind === 'hat') {
      return (
        <group scale={scale}>
          <mesh position={[0, 1.66, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.02, 20]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.72, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.12, 16]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        </group>
      )
    }
    // hair：头顶丸子
    return (
      <mesh position={[0, 1.7, 0]} scale={scale} castShadow>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
    )
  }

  // —— 眼镜：架在脸上（头 y≈1.58，z 前方） ——
  if (item.kind === 'glasses') {
    return (
      <group scale={scale} position={[0, 1.58, 0.08]}>
        <mesh>
          <boxGeometry args={[0.16, 0.01, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.4} />
        </mesh>
        <mesh position={[-0.045, 0, 0]}>
          <boxGeometry args={[0.05, 0.04, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.2} metalness={0.4} />
        </mesh>
        <mesh position={[0.045, 0, 0]}>
          <boxGeometry args={[0.05, 0.04, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.2} metalness={0.4} />
        </mesh>
      </group>
    )
  }

  // —— 手持物：按槽位挂到左右手（手≈y0.8，x±0.24） ——
  const handX = slot === 'accessoryL' ? -0.26 : 0.26
  return (
    <group scale={scale} position={[handX, 0.78, 0.05]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.12, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
      </mesh>
    </group>
  )
}
