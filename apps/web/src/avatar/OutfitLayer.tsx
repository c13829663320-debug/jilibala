// ===== OutfitLayer：R3F 服装层 =====
// 按 OutfitState 中的 clothing 槽位（top/bottom/shoes）渲染独立 mesh，
// material.color 直接绑定到已穿戴物品的颜色——换色时 React 响应式更新。
// 不绘制身体本体（由父级 mannequin 提供），只穿「衣服壳」。
import { getItem, type OutfitState } from './outfit-system'

interface OutfitLayerProps {
  outfit: OutfitState
  /** 整体缩放（与父级人体比例对齐），默认 1 */
  scale?: number
}

/**
 * 服装层位置参考站立人体（头≈y1.6，脚≈y0）。
 * 只渲染已穿戴的 top/bottom/shoes；head/手持配饰由 AccessorySlot 负责。
 */
export function OutfitLayer({ outfit, scale = 1 }: OutfitLayerProps) {
  const top = outfit.top
  const bottom = outfit.bottom
  const shoes = outfit.shoes

  return (
    <group scale={scale}>
      {/* —— 上衣：包裹躯干的略大圆柱壳 —— */}
      {top && (
        <mesh position={[0, 1.06, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.16, 0.62, 16]} />
          <meshStandardMaterial color={top.color} roughness={0.7} metalness={0.05} />
        </mesh>
      )}

      {/* —— 下装：胯部/大腿上段壳 —— */}
      {bottom && getItem(bottom.itemId)?.kind === 'skirt' ? (
        <mesh position={[0, 0.78, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.26, 0.3, 16]} />
          <meshStandardMaterial color={bottom.color} roughness={0.75} metalness={0.05} />
        </mesh>
      ) : (
        bottom && (
          <>
            <mesh position={[-0.09, 0.6, 0]} castShadow>
              <cylinderGeometry args={[0.075, 0.065, 0.45, 12]} />
              <meshStandardMaterial color={bottom.color} roughness={0.75} metalness={0.05} />
            </mesh>
            <mesh position={[0.09, 0.6, 0]} castShadow>
              <cylinderGeometry args={[0.075, 0.065, 0.45, 12]} />
              <meshStandardMaterial color={bottom.color} roughness={0.75} metalness={0.05} />
            </mesh>
          </>
        )
      )}

      {/* —— 鞋子：两只小盒子放在脚面 —— */}
      {shoes && (
        <>
          <mesh position={[-0.09, 0.05, 0.03]} castShadow>
            <boxGeometry args={[0.12, 0.08, 0.24]} />
            <meshStandardMaterial color={shoes.color} roughness={0.5} metalness={0.1} />
          </mesh>
          <mesh position={[0.09, 0.05, 0.03]} castShadow>
            <boxGeometry args={[0.12, 0.08, 0.24]} />
            <meshStandardMaterial color={shoes.color} roughness={0.5} metalness={0.1} />
          </mesh>
        </>
      )}
    </group>
  )
}
