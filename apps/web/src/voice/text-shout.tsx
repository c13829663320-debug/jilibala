// ===== Round4 R4-04: 文字喊话 3D 世界空间气泡 =====
//
// 语音不可用时，玩家输入文字 → WS 广播 text_shout → 其他客户端在该玩家头顶
// 渲染一个浮动文字气泡（Billboard 永远面向相机），随玩家移动，3 秒后淡出。
//
// 用 @react-three/drei 的 Billboard + Text（与建筑名牌一致的轻量方案，不用 Html，
// 避免每个气泡都开一个 DOM 层）。

import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'

/** 一条正在显示的文字喊话 */
export interface ActiveShout {
  id: string
  userId: string
  nickname: string
  text: string
  /** 发送时间戳（performance.now 域，由收到消息时打） */
  createdAt: number
  /** 到期时间戳（createdAt + 3000ms） */
  expiresAt: number
}

interface TextShoutLayerProps {
  /** userId → 正在显示的喊话（同一玩家只保留最新一条） */
  shouts: Map<string, ActiveShout>
  /** 远端玩家位置表（每帧读 x/z，气泡跟随移动） */
  playersRef: MutableRefObject<Map<string, { x: number; z: number; nickname?: string }>>
}

/** 单个气泡：挂在玩家头顶，跟随位置 + 到期前淡出 */
function ShoutBubble({
  shout,
  playersRef,
}: {
  shout: ActiveShout
  playersRef: TextShoutLayerProps['playersRef']
}) {
  const groupRef = useRef<THREE.Group>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    const now = clock.elapsedTime * 1000
    const g = groupRef.current
    if (!g) return
    // 跟随玩家世界坐标
    const p = playersRef.current.get(shout.userId)
    const x = p?.x ?? 0
    const z = p?.z ?? 0
    g.position.set(x, 2.6, z) // 头顶约 2.6m

    // 淡出：最后 0.6s 透明度从 1 → 0
    const remain = shout.expiresAt - now
    const fadeWindow = 600
    const opacity = remain < fadeWindow ? Math.max(0, remain / fadeWindow) : 1
    if (matRef.current) matRef.current.opacity = opacity
  })

  return (
    <group ref={groupRef} position={[0, 2.6, 0]}>
      <Billboard>
        <Text
          fontSize={0.42}
          color="#FFD600"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.02}
          outlineColor="#000000"
          maxWidth={6}
          raycast={() => null}
        >
          {shout.text.length > 24 ? shout.text.slice(0, 24) + '…' : shout.text}
          <meshBasicMaterial ref={matRef} transparent opacity={1} toneMapped={false} />
        </Text>
      </Billboard>
    </group>
  )
}

/** 一层气泡：遍历当前所有活跃喊话，每个渲染一个 ShoutBubble */
export default function TextShoutLayer({ shouts, playersRef }: TextShoutLayerProps) {
  // Map 引用本身会变（Plaza3D 用 setState 更新），这里转成数组驱动渲染
  const list = useMemo(() => Array.from(shouts.values()), [shouts])
  return (
    <>
      {list.map((s) => (
        <ShoutBubble key={s.id} shout={s} playersRef={playersRef} />
      ))}
    </>
  )
}
