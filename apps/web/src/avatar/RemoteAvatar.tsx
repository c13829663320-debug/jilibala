// ===== 升级版远端 Avatar =====
// 替换 Plaza3D 内联的 RemoteAvatar：在胶囊/头/下颌/手臂的程序化结构上，
// 由 talkingIntensity 驱动口型、由 emote 驱动动画状态机、由 expression 驱动表情。
// 说话时头部转向最近的其他玩家；头顶有音量指示条。
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { AvatarExpression, EmoteType } from '@balabala/shared'
import { createRig, applyPose, setExpression, setMouthOpen, type AvatarRig } from './avatar-rig'
import { createAnimationMachine, getPose, type AnimState } from './animation-state-machine'
import { levelToMouthOpen, smoothIntensity } from './lip-sync'
import { computeLodTier, lodProfile, type LodTier } from './avatar-lod'
import { hashColor, getCelebrity } from '../identity'
import type { CrowdRenderTier } from '@balabala/shared'

/** RemoteAvatar 所需的玩家结构（Plaza3D 的 RemotePlayer 兼容此结构） */
export interface PresencePlayer {
  userId: string
  nickname: string
  avatarType: string
  avatarRef: string
  x: number
  z: number
  rotation: number
  targetX: number
  targetZ: number
  /** 说话强度 0~1 */
  talkingIntensity?: number
  /** 当前 emote（收到后设置，超时清除） */
  emote?: EmoteType
  /** emote 结束时间戳（performance.now 域） */
  emoteUntil?: number
  /** 表情 */
  expression?: AvatarExpression
}

interface RemoteAvatarProps {
  userId: string
  playersRef: MutableRefObject<Map<string, PresencePlayer>>
  /** 本地玩家位置（用于 LOD 距离分级）；不传则始终 high */
  localPosRef?: MutableRefObject<{ x: number; z: number }>
  /** 点击化身时触发（弹出玩家上下文菜单） */
  onSelect?: (userId: string, clientX: number, clientY: number) => void
  /** R5: 人群上限给出的降级档位（billboard 强制公告板，capsule 强制简化体）；不传按距离 LOD */
  crowdTier?: CrowdRenderTier
}

export function RemoteAvatar({ userId, playersRef, localPosRef, onSelect, crowdTier }: RemoteAvatarProps) {
  const rootRef = useRef<THREE.Group>(null)
  const rigRef = useRef<AvatarRig | null>(null)
  const machineRef = useRef(createAnimationMachine())
  const stateAtRef = useRef(0)
  const lastStateRef = useRef<AnimState>('idle')
  const lastEmoteRef = useRef<string>('')
  const mouthRef = useRef(0)
  const barRef = useRef<THREE.Mesh>(null)
  const barMatRef = useRef<THREE.MeshBasicMaterial>(null)
  // R4-03 LOD：当前渲染层级（tier 变化时切渲染分支；原始模型数据不卸载）
  const [lodTier, setLodTier] = useState<LodTier>('high')
  const lastLodRef = useRef<LodTier>('high')
  // R5: 人群降级档位 ref（useFrame 高频读取，避免闭包陈旧）
  const crowdTierRef = useRef<CrowdRenderTier | undefined>(crowdTier)
  crowdTierRef.current = crowdTier

  const player = playersRef.current.get(userId)

  // 解析显示名与颜色（与原内联版一致）
  let displayName = '玩家'
  let avatarColor = hashColor(userId)
  if (player) {
    displayName = player.nickname
    if (player.avatarType === 'celebrity' && player.avatarRef) {
      const celeb = getCelebrity(player.avatarRef)
      if (celeb) displayName = celeb.name
    }
    avatarColor = player.avatarType === 'capsule' ? hashColor(player.userId) : '#4fb3a5'
  }

  // 挂载后创建 rig（自动探测程序化子节点）
  useLayoutEffect(() => {
    if (!rootRef.current) return
    rigRef.current = createRig(rootRef.current)
  }, [])

  useFrame(({ clock }) => {
    const p = playersRef.current.get(userId)
    const root = rootRef.current
    const rig = rigRef.current
    if (!p || !root || !rig) return
    const now = clock.elapsedTime * 1000 // ms
    const mach = machineRef.current

    // 1) 位置平滑（保留原逻辑）
    root.position.x = THREE.MathUtils.lerp(root.position.x, p.targetX, 0.12)
    root.position.z = THREE.MathUtils.lerp(root.position.z, p.targetZ, 0.12)
    root.rotation.y = p.rotation

    // 1.5) R4-03 LOD：按本地玩家距离分级；仅在 tier 变化时切渲染分支（不卸载模型数据）
    let tier: LodTier = 'high'
    if (localPosRef?.current) {
      const d = Math.hypot(root.position.x - localPosRef.current.x, root.position.z - localPosRef.current.z)
      tier = computeLodTier(d)
    }
    // R5: 人群上限降级——billboard 强制公告板，capsule 强制中距离简化体（不跑口型/表情）
    if (crowdTierRef.current === 'billboard') tier = 'billboard'
    else if (crowdTierRef.current === 'capsule') tier = tier === 'hidden' ? 'hidden' : 'medium'
    if (tier !== lastLodRef.current) {
      lastLodRef.current = tier
      setLodTier(tier)
    }
    const profile = lodProfile(tier)
    // 极远：完全隐藏；公告板：不跑动画/口型，只画名字色板
    root.visible = profile.visible
    if (!profile.visible || profile.billboard) {
      return
    }

    // 2) 同步 emote：检测到新 emote 事件则触发状态机
    if (p.emote && p.emote !== lastEmoteRef.current) {
      lastEmoteRef.current = p.emote
      mach.transition({ type: 'emote', emote: p.emote, durationMs: p.emoteUntil ? p.emoteUntil - now : undefined }, now)
      stateAtRef.current = now
    }
    if (!p.emote) lastEmoteRef.current = ''

    // 3) 说话状态：talkingIntensity 高于阈值 → talk_start，否则 talk_end
    const intensity = p.talkingIntensity ?? 0
    const speaking = intensity > 0.05
    mach.transition(speaking ? { type: 'talk_start' } : { type: 'talk_end' }, now)

    // 4) 状态机 update（emote 超时回归）
    mach.update(now)
    if (mach.state !== lastStateRef.current) {
      lastStateRef.current = mach.state
      stateAtRef.current = now
    }

    // 5) 计算姿势并应用
    const elapsed = now - stateAtRef.current
    const pose = getPose(mach.state, elapsed)

    // 说话时头部转向最近的其他玩家
    if (speaking && mach.state !== 'wave' && mach.state !== 'point') {
      // 找最近的其他玩家，说话时头部朝向对方
      let nearest: PresencePlayer | null = null
      let best = Infinity
      for (const other of playersRef.current.values()) {
        if (other.userId === userId) continue
        const dx = other.targetX - p.targetX
        const dz = other.targetZ - p.targetZ
        const d = dx * dx + dz * dz
        if (d < best) { best = d; nearest = other }
      }
      if (nearest) {
        const target = nearest as PresencePlayer
        const desiredYaw = Math.atan2(target.targetX - p.targetX, target.targetZ - p.targetZ)
        // 相对自身朝向的偏航
        pose.headTurn = THREE.MathUtils.lerp(pose.headTurn ?? 0, desiredYaw - p.rotation, 0.1)
      }
    }

    applyPose(rig, pose)

    // 6) 口型：用电平映射覆盖 jawOpen（中距离 LOD 无表情/口型）
    const mouth = levelToMouthOpen(intensity)
    mouthRef.current = smoothIntensity(mouthRef.current, mouth, 0.4)
    if (profile.expressions) {
      setExpression(rig, p.expression ?? 'neutral')
      // expression 可能写眉，不影响嘴；嘴由 setMouthOpen 单独控制
      if (pose.jawOpen) {
        // emote 自带嘴型（laugh/surprised）与说话口型取较大值
        setMouthOpen(rig, Math.max(mouthRef.current, pose.jawOpen))
      } else {
        setMouthOpen(rig, mouthRef.current)
      }
    }

    // 7) 头顶音量指示条
    if (barRef.current && barMatRef.current) {
      const h = 0.05 + intensity * 0.4
      barRef.current.scale.y = h
      barRef.current.position.y = 1.75 + h / 2
      barMatRef.current.opacity = speaking ? 0.9 : 0
    }
  })

  if (!player) return null

  if (!player) return null

  // R4-03 LOD：简化几何体细分（medium 约减半面数）；billboard 用公告板替代身体
  const simplified = lodTier === 'medium'
  const bodyCapsule: [number, number, number, number] = simplified ? [0.25, 0.6, 4, 8] : [0.25, 0.6, 8, 16]
  const headSphere: [number, number, number] = simplified ? [0.22, 8, 8] : [0.22, 16, 16]
  const showBody = lodTier === 'high' || lodTier === 'medium'
  const showBillboard = lodTier === 'billboard'

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return
    e.stopPropagation()
    const ne = e.nativeEvent as MouseEvent
    onSelect(userId, ne.clientX ?? 0, ne.clientY ?? 0)
  }

  return (
    <group ref={rootRef} position={[player.x, 0, player.z]} onClick={handleClick}>
      {/* —— 完整/简化身体（high/medium）—— 数据常驻，仅切可见性与细分 —— */}
      <group visible={showBody}>
        {/* 身体胶囊 */}
        <mesh position={[0, 0.55, 0]} castShadow>
          <capsuleGeometry args={bodyCapsule} />
          <meshStandardMaterial color={avatarColor} roughness={0.4} metalness={0.1} />
        </mesh>
        {/* 头部（rig 命名节点，自动探测） */}
        <group name="head" position={[0, 1.05, 0]}>
          <mesh castShadow>
            <sphereGeometry args={headSphere} />
            <meshStandardMaterial color={avatarColor} roughness={0.5} />
          </mesh>
          {/* 下颌（程序化：旋转张开；medium 无表情时不影响） */}
          <group name="jaw" position={[0, -0.08, 0.12]}>
            <mesh>
              <boxGeometry args={[0.22, 0.08, 0.18]} />
              <meshStandardMaterial color={avatarColor} roughness={0.5} />
            </mesh>
          </group>
        </group>
        {/* 左臂 */}
        <group name="armL" position={[-0.3, 0.85, 0]}>
          <mesh position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
            <meshStandardMaterial color={avatarColor} roughness={0.5} />
          </mesh>
        </group>
        {/* 右臂 */}
        <group name="armR" position={[0.3, 0.85, 0]}>
          <mesh position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
            <meshStandardMaterial color={avatarColor} roughness={0.5} />
          </mesh>
        </group>
        {/* 头顶音量指示条 */}
        <mesh ref={barRef} position={[0, 1.95, 0]} raycast={() => null}>
          <boxGeometry args={[0.08, 1, 0.08]} />
          <meshBasicMaterial ref={barMatRef} color="#4fb3a5" transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* 名字标签（近距离/中距离） */}
        <Billboard position={[0, 1.6, 0]}>
          <Text fontSize={0.26} color="#FFFFFF" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#000000" raycast={() => null}>
            {displayName}
          </Text>
        </Billboard>
      </group>

      {/* —— 远距离公告板（billboard）：色板 + 名字，朝向相机 —— */}
      <Billboard position={[0, 1.0, 0]} follow={showBillboard}>
        <mesh visible={showBillboard}>
          <circleGeometry args={[0.5, 16]} />
          <meshBasicMaterial color={avatarColor} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
        <Text
          position={[0, 0.7, 0]}
          fontSize={0.22}
          color="#FFFFFF"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.012}
          outlineColor="#000000"
          visible={showBillboard}
        >
          {displayName}
        </Text>
      </Billboard>
    </group>
  )
}
