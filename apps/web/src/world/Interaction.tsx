/**
 * 开放世界 · 交互系统
 * ------------------------------------------------------------------
 * useFrame 里每帧检测玩家附近的：
 *   - 建筑入口（< INTERACT_DIST）→ 提示「按 E 进入 XX」，按 E 触发 onEnter
 *   - NPC（< 3）→ 提示「按 E 交谈」，按 E 弹一段对话 toast
 *   - 水晶收集物（< 2.5）→ 提示「按 E 拾取」，按 E 收集并消失
 * 提示文案通过 onPrompt 回调抛给 DOM 层显示（只在变化时回调，避免每帧 setState）。
 */
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { BuildingId, WorldRuntime } from './types'
import { BUILDINGS, INTERACT_DIST } from './config'
import { distSq } from './collision'

interface InteractionProps {
  world: WorldRuntime
  onEnter: (id: BuildingId) => void
  onPrompt: (prompt: string | null) => void
  toast: (msg: string) => void
}

// 散布 NPC（占位胶囊 + 名字）
const NPCS = [
  { id: 'n1', x: 12, z: 5, name: '路人甲', line: '欢迎来到叽里呱啦广场！中央喷泉后面就是法庭。' },
  { id: 'n2', x: -10, z: -8, name: '辩论爱好者', line: '狼人杀馆今晚有局，你去吗？往东北方向走。' },
  { id: 'n3', x: 20, z: 20, name: '读书人', line: '图书馆在西北角，里面有不少金句笔记。' },
]

// 水晶收集物
const CRYSTALS = [
  { id: 'c1', x: -8, z: 12 },
  { id: 'c2', x: 15, z: -15 },
  { id: 'c3', x: -20, z: -25 },
  { id: 'c4', x: 25, z: 10 },
]

export default function Interaction({ world, onEnter, onPrompt, toast }: InteractionProps) {
  const [collected, setCollected] = useState<Set<string>>(new Set())
  const collectedRef = useRef(collected)
  collectedRef.current = collected
  const lastPrompt = useRef<string | null>(null)

  useFrame(() => {
    const p = world.player
    let prompt: string | null = null
    let nearBuilding: BuildingId | null = null
    let nearNpc: (typeof NPCS)[number] | null = null
    let nearCrystal: (typeof CRYSTALS)[number] | null = null

    // 1. 最近建筑入口
    let bestB = INTERACT_DIST * INTERACT_DIST
    for (const b of BUILDINGS) {
      const d = distSq(p.x, p.z, b.entranceX, b.entranceZ)
      if (d < bestB) { bestB = d; nearBuilding = b.id }
    }

    // 2. 最近 NPC
    let bestN = 3 * 3
    for (const n of NPCS) {
      const d = distSq(p.x, p.z, n.x, n.z)
      if (d < bestN) { bestN = d; nearNpc = n }
    }

    // 3. 最近未收集水晶
    let bestC = 2.5 * 2.5
    for (const c of CRYSTALS) {
      if (collectedRef.current.has(c.id)) continue
      const d = distSq(p.x, p.z, c.x, c.z)
      if (d < bestC) { bestC = d; nearCrystal = c }
    }

    // 提示优先级：建筑 > NPC > 水晶
    if (nearBuilding) {
      const b = BUILDINGS.find((x) => x.id === nearBuilding)!
      prompt = `按 E 进入 ${b.name}`
    } else if (nearNpc) {
      prompt = `按 E 与 ${nearNpc.name} 交谈`
    } else if (nearCrystal) {
      prompt = '按 E 拾取水晶'
    }

    // 只在提示变化时通知 DOM 层
    if (prompt !== lastPrompt.current) {
      lastPrompt.current = prompt
      onPrompt(prompt)
    }

    // 4. 消费交互输入
    if (world.input.interactQueued) {
      world.input.interactQueued = false
      if (nearBuilding) {
        onEnter(nearBuilding)
      } else if (nearNpc) {
        toast(`${nearNpc.name}：${nearNpc.line}`)
      } else if (nearCrystal) {
        setCollected((prev) => {
          const next = new Set(prev)
          next.add(nearCrystal.id)
          return next
        })
        toast('✨ 拾取名为「灵感」的水晶！')
      }
    }
  })

  return (
    <group>
      {/* NPC 占位胶囊 */}
      {NPCS.map((n) => (
        <group key={n.id} position={[n.x, 0, n.z]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <capsuleGeometry args={[0.25, 0.55, 8, 16]} />
            <meshStandardMaterial color="#4fb3a5" roughness={0.5} />
          </mesh>
          <Billboard position={[0, 1.5, 0]}>
            <Text fontSize={0.26} color="#4fb3a5" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#000" raycast={() => null}>
              {n.name}
            </Text>
          </Billboard>
        </group>
      ))}

      {/* 水晶收集物（已收集则隐藏） */}
      {CRYSTALS.filter((c) => !collected.has(c.id)).map((c) => (
        <Crystal key={c.id} position={[c.x, 0, c.z]} />
      ))}
    </group>
  )
}

/** 一颗会发光、上下浮动的水晶 */
function Crystal({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.position.y = 0.8 + Math.sin(t * 2) * 0.15
    ref.current.rotation.y = t * 1.2
  })
  return (
    <mesh ref={ref} position={position}>
      <octahedronGeometry args={[0.35, 0]} />
      <meshStandardMaterial color="#FFD600" emissive="#FFD600" emissiveIntensity={0.8} roughness={0.2} metalness={0.3} />
    </mesh>
  )
}
