// ============================================================================
// PickupableProps —— 开放世界中可拾取的 CC0 道具（R4-09）
// ----------------------------------------------------------------------------
// 在广场周围布置若干可拾取道具；玩家靠近（< 2m）时高亮，按 E / 点击拾取，
// 道具跟随到玩家手持位置；再按一次放下。
// 云端无 GPU：3D 渲染仅在真机/浏览器生效，距离/状态/手持位置由 use-pickup
// 的纯函数单测覆盖。
// ============================================================================
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { MutableRefObject } from 'react'
import type { PlacedProp } from '@balabala/shared'
import { getPropById } from '../props/prop-library'
import {
  computeDropPosition,
  computeHoldPosition,
  createPickupState,
  interact,
  refreshNearby,
  type PickupableItem,
} from '../props/use-pickup'
import PropItem from '../props/PropItem'
import type { WorldRuntime } from './types'

/** 广场上预置的可拾取道具（实例化位置，世界坐标）。 */
const DEMO_PROPS: Array<{ propId: string; position: [number, number, number] }> = [
  { propId: 'book', position: [2, 0, 4] },
  { propId: 'lamp', position: [-3, 0, 5] },
  { propId: 'dumbbell', position: [4, 0, -3] },
  { propId: 'microphone', position: [-4, 0, -2] },
  { propId: 'chessboard', position: [0, 0, 8] },
  { propId: 'bench', position: [8, 0, 8] },
]

interface PickupablePropsProps {
  world: WorldRuntime
  /** 本地玩家位置 ref（用于 LOD/拾取距离判定） */
  localPosRef?: MutableRefObject<{ x: number; z: number }>
}

export default function PickupableProps({ world, localPosRef }: PickupablePropsProps) {
  // 运行时放置状态（mutable ref，不走 React 重渲染）
  const placedRef = useRef<PlacedProp[]>(
    DEMO_PROPS.map((p, i) => ({
      instanceId: `demo-${i}`,
      propId: p.propId,
      position: p.position,
      rotation: [0, 0, 0],
    })),
  )
  const stateRef = useRef(createPickupState())
  const heldInstanceRef = useRef<string | null>(null)
  const heldGroupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    const player = world.player
    const items: PickupableItem[] = placedRef.current.map((p) => ({
      propId: p.propId,
      instanceId: p.instanceId,
      x: p.position[0],
      z: p.position[2],
      pickable: getPropById(p.propId)?.pickable ?? false,
    }))

    // 交互键（E / 点击）：拾取 / 放下
    if (world.input.interactQueued) {
      world.input.interactQueued = false
      const before = stateRef.current
      stateRef.current = interact(before)
      if (!before.heldPropId && stateRef.current.heldPropId) {
        // 刚拾取：记录实例 id
        const near = items.find((i) => i.propId === stateRef.current.heldPropId)
        heldInstanceRef.current = near?.instanceId ?? null
      } else if (before.heldPropId && !stateRef.current.heldPropId) {
        // 刚放下：把道具落回玩家身前地面
        const drop = computeDropPosition(player.x, player.z, player.rotation)
        if (heldInstanceRef.current) {
          const target = placedRef.current.find((p) => p.instanceId === heldInstanceRef.current)
          if (target) target.position = [drop.x, 0, drop.z]
        }
        heldInstanceRef.current = null
      }
    }

    // 刷新附近可拾取提示
    stateRef.current = refreshNearby(stateRef.current, player.x, player.z, items)

    // 更新手持道具世界坐标
    if (heldGroupRef.current) {
      const hold = computeHoldPosition(player.x, player.z, player.rotation)
      heldGroupRef.current.position.set(hold.x, hold.y, hold.z)
    }

    // 同步本地玩家位置（LOD）
    if (localPosRef) {
      localPosRef.current.x = player.x
      localPosRef.current.z = player.z
    }
  })

  const state = stateRef.current
  const heldPropId = state.heldPropId
  const heldDef = heldPropId ? getPropById(heldPropId) : undefined
  const heldInstanceId = heldInstanceRef.current

  return (
    <group>
      {placedRef.current
        .filter((p) => p.instanceId !== heldInstanceId)
        .map((p) => {
          const def = getPropById(p.propId)
          if (!def) return null
          const near = state.nearPropId === p.propId && state.phase === 'nearby'
          return (
            <PropItem
              key={p.instanceId}
              prop={def}
              position={p.position}
              rotation={p.rotation}
              highlight={near}
            />
          )
        })}

      {/* 手持道具（跟随玩家） */}
      {heldDef && (
        <group ref={heldGroupRef}>
          <PropItem prop={heldDef} />
        </group>
      )}
    </group>
  )
}

/** 供外部引用：广场预置道具清单。 */
export function getDemoPropList(): Array<{ propId: string; position: [number, number, number] }> {
  return DEMO_PROPS
}
