import { Suspense, useLayoutEffect, useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Billboard, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { ArrowLeft, MessagesSquare, Users } from 'lucide-react'
import { Plaza } from './Plaza'
import { useIdentity, hashColor, getCelebrity } from './identity'
import type { WSMessage, WSUser } from '@balabala/shared'
import './plaza-3d.css'

const BUILDINGS = [
  { id: 'court', name: '法庭', x: 0, z: -14, isCourt: true },
  { id: 'talkshow', name: '脱口秀', x: 12.12, z: -7, isCourt: false },
  { id: 'werewolf', name: '狼人杀', x: 12.12, z: 7, isCourt: false },
  { id: 'bar', name: '酒吧', x: 0, z: 14, isCourt: false },
  { id: 'gym', name: '健身房', x: -12.12, z: 7, isCourt: false },
  { id: 'library', name: '图书馆', x: -12.12, z: -7, isCourt: false },
] as const

const HIT_RADIUS = 6
const CAMERA_Y = 16

type Marker = { id: number; x: number; z: number; born: number }

/** A remote player tracked in the plaza. Positions are lerped toward targetX/targetZ. */
type RemotePlayer = {
  userId: string
  nickname: string
  avatarType: string
  avatarRef: string
  x: number
  z: number
  rotation: number
  targetX: number
  targetZ: number
}

function PlazaModel({ onPick }: { onPick: (e: ThreeEvent<MouseEvent>) => void }) {
  const { scene } = useGLTF('/models/balabala_plaza.glb', false, true)
  useLayoutEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.raycast = () => {}
      }
    })
  }, [scene])
  return <primitive object={scene} onClick={onPick} />
}

function RingMarker({ marker, onDone }: { marker: Marker; onDone: (id: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => {
    const age = (performance.now() - marker.born) / 1000
    const t = Math.min(age / 1.2, 1)
    if (meshRef.current) {
      const s = 0.6 + t * 1.8
      meshRef.current.scale.set(s, s, 1)
    }
    if (matRef.current) matRef.current.opacity = 1 - t
    if (t >= 1) onDone(marker.id)
  })
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[marker.x, 0.03, marker.z]}>
      <ringGeometry args={[0.7, 1.0, 32]} />
      <meshBasicMaterial ref={matRef} color="#4fb3a5" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function CameraRig({ target, lookAt }: { target: MutableRefObject<THREE.Vector3>; lookAt: MutableRefObject<THREE.Vector3> }) {
  const { camera } = useThree()
  useFrame((_, delta) => {
    const t = Math.min(delta * 2.5, 1)
    camera.position.lerp(target.current, t)
    camera.lookAt(lookAt.current)
  })
  return null
}

/** Single remote player avatar: colored capsule + floating name label. */
function RemoteAvatar({ userId, playersRef }: { userId: string; playersRef: MutableRefObject<Map<string, RemotePlayer>> }) {
  const groupRef = useRef<THREE.Group>(null)
  const player = playersRef.current.get(userId)

  // Resolve display color and name
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

  useFrame(() => {
    const p = playersRef.current.get(userId)
    if (!p || !groupRef.current) return
    const g = groupRef.current
    g.position.x = THREE.MathUtils.lerp(g.position.x, p.targetX, 0.12)
    g.position.z = THREE.MathUtils.lerp(g.position.z, p.targetZ, 0.12)
    g.rotation.y = p.rotation
  })

  if (!player) return null

  return (
    <group ref={groupRef} position={[player.x, 0, player.z]}>
      {/* capsule body */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <capsuleGeometry args={[0.25, 0.6, 8, 16]} />
        <meshStandardMaterial color={avatarColor} roughness={0.4} metalness={0.1} />
      </mesh>
      {/* floating name label */}
      <Billboard position={[0, 1.6, 0]}>
        <Text fontSize={0.28} color="#FFFFFF" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#000000" raycast={() => null}>
          {displayName}
        </Text>
      </Billboard>
    </group>
  )
}

interface PlazaSceneProps {
  onEnterCourt: () => void
  onEnterTalkshow: () => void
  onEnterWerewolf: () => void
  onEnterBar: () => void
  onEnterLibrary: () => void
  onEnterGym: () => void
  toast: (msg: string) => void
  playersRef: MutableRefObject<Map<string, RemotePlayer>>
  remoteUserIds: string[]
  onMove: (x: number, z: number) => void
}

function PlazaScene({ onEnterCourt, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym, toast, playersRef, remoteUserIds, onMove, tapRef }: PlazaSceneProps & { tapRef: MutableRefObject<{ downX: number; downY: number; downT: number }> }) {
  const targetRef = useRef(new THREE.Vector3(0, CAMERA_Y, 22))
  const lookRef = useRef(new THREE.Vector3(0, 0, 0))
  const [markers, setMarkers] = useState<Marker[]>([])
  const [hovered, setHovered] = useState<string | null>(null)

  const hitBuilding = (x: number, z: number) => {
    for (const b of BUILDINGS) {
      const dx = x - b.x
      const dz = z - b.z
      if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) return b
    }
    return null
  }

  /** 区分 tap 与 drag：pointerup 相对 pointerdown 位移 >10px 或时长 >400ms 视为拖动，不触发 tap。 */
  const isTap = (e: ThreeEvent<MouseEvent | PointerEvent>): boolean => {
    const n = e.nativeEvent as PointerEvent
    const dx = (n.clientX ?? 0) - tapRef.current.downX
    const dy = (n.clientY ?? 0) - tapRef.current.downY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const dt = performance.now() - tapRef.current.downT
    return dist < 10 && dt < 400
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isTap(e)) return
    e.stopPropagation()
    const b = hitBuilding(e.point.x, e.point.z)
    if (b) {
      if (b.id === 'court') onEnterCourt()
      else if (b.id === 'talkshow') onEnterTalkshow()
      else if (b.id === 'werewolf') onEnterWerewolf()
      else if (b.id === 'bar') onEnterBar()
      else if (b.id === 'library') onEnterLibrary()
      else if (b.id === 'gym') onEnterGym()
      return
    }
    targetRef.current.set(e.point.x, CAMERA_Y, e.point.z)
    lookRef.current.set(e.point.x, 0, e.point.z)
    const id = Date.now() + Math.random()
    setMarkers((arr) => [...arr, { id, x: e.point.x, z: e.point.z, born: performance.now() }])
    // Sync position to other users via WS
    onMove(e.point.x, e.point.z)
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const b = hitBuilding(e.point.x, e.point.z)
    const id = b ? b.id : null
    setHovered((prev) => (prev === id ? prev : id))
  }

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[12, 22, 10]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <PlazaModel onPick={handleClick} />
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} onClick={handleClick} onPointerMove={handleMove}>
        <planeGeometry args={[90, 90]} />
        <meshBasicMaterial side={THREE.DoubleSide} depthWrite={false} colorWrite={false} />
      </mesh>
      {BUILDINGS.map((b) => (
        <Billboard key={b.id} position={[b.x, 5, b.z]}>
          <Text fontSize={hovered === b.id ? 0.95 : 0.75} color={hovered === b.id ? '#FFFFFF' : '#4fb3a5'} anchorX="center" anchorY="middle" outlineWidth={0.03} outlineColor="#000000" raycast={() => null}>
            {b.name}
          </Text>
        </Billboard>
      ))}
      {markers.map((m) => (
        <RingMarker key={m.id} marker={m} onDone={(id) => setMarkers((arr) => arr.filter((x) => x.id !== id))} />
      ))}
      {/* Remote players */}
      {remoteUserIds.map((uid) => (
        <RemoteAvatar key={uid} userId={uid} playersRef={playersRef} />
      ))}
      <CameraRig target={targetRef} lookAt={lookRef} />
    </>
  )
}

function buildWsUrl(room: string, userId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`
}

export default function Plaza3D({ onBack, onEnterCourt, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym }: {
  onBack: () => void
  onEnterCourt: () => void
  onEnterTalkshow?: () => void
  onEnterWerewolf?: () => void
  onEnterBar?: () => void
  onEnterLibrary?: () => void
  onEnterGym?: () => void
}) {
  const { user } = useIdentity()
  const [showDiscuss, setShowDiscuss] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | null>(null)
  const [onlineCount, setOnlineCount] = useState(1)

  // Remote players store: ref for high-frequency position updates, state for join/leave
  const playersRef = useRef(new Map<string, RemotePlayer>())
  const [remoteUserIds, setRemoteUserIds] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const shouldReconnect = useRef(true)
  // 触屏 tap 与 drag 区分：记录 pointerdown 的位置/时间
  const tapRef = useRef({ downX: 0, downY: 0, downT: 0 })

  const toast = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200)
  }

  const upsertPlayer = useCallback((u: WSUser) => {
    const existing = playersRef.current.get(u.userId)
    playersRef.current.set(u.userId, {
      userId: u.userId,
      nickname: u.nickname,
      avatarType: u.avatarType,
      avatarRef: u.avatarRef,
      x: existing?.x ?? u.x,
      z: existing?.z ?? u.z,
      rotation: u.rotation,
      targetX: u.x,
      targetZ: u.z,
    })
    setRemoteUserIds((prev) => (prev.includes(u.userId) ? prev : [...prev, u.userId]))
  }, [])

  const removePlayer = useCallback((userId: string) => {
    playersRef.current.delete(userId)
    setRemoteUserIds((prev) => prev.filter((id) => id !== userId))
  }, [])

  // WS connection lifecycle
  useEffect(() => {
    if (!user?.userId) return
    shouldReconnect.current = true

    const connect = () => {
      const ws = new WebSocket(buildWsUrl('plaza', user.userId))
      wsRef.current = ws

      ws.onopen = () => { /* connected */ }

      ws.onmessage = (ev) => {
        let msg: WSMessage
        try { msg = JSON.parse(ev.data) as WSMessage } catch { return }
        switch (msg.type) {
          case 'welcome': {
            playersRef.current.clear()
            const others = msg.users.filter((u) => u.userId !== user.userId)
            for (const u of others) upsertPlayer(u)
            setRemoteUserIds(others.map((u) => u.userId))
            setOnlineCount(msg.users.length)
            break
          }
          case 'user_joined':
            upsertPlayer(msg.user)
            setOnlineCount((n) => n + 1)
            break
          case 'user_left':
            removePlayer(msg.userId)
            setOnlineCount((n) => Math.max(1, n - 1))
            break
          case 'presence': {
            for (const p of msg.users) {
              const existing = playersRef.current.get(p.userId)
              if (existing) {
                existing.targetX = p.x
                existing.targetZ = p.z
                existing.rotation = p.rotation
              }
            }
            break
          }
          case 'chat':
            toast(`${msg.nickname}: ${msg.text}`)
            break
          case 'error':
            break
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (shouldReconnect.current) {
          reconnectTimer.current = window.setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => { ws.close() }
    }

    connect()

    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [user?.userId, upsertPlayer, removePlayer, toast])

  // Send move message when the player clicks the ground
  const handleMove = useCallback((x: number, z: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'move', x, z, rotation: 0 }))
  }, [])

  // ===== 场景卸载：清理 GLTF 缓存，避免内存泄漏 =====
  useEffect(() => {
    return () => {
      try { useGLTF.clear('/models/balabala_plaza.glb') } catch { /* noop */ }
    }
  }, [])

  return (
    <div className="plaza-3d-root"
      onPointerDown={(e) => { tapRef.current.downX = e.clientX; tapRef.current.downY = e.clientY; tapRef.current.downT = performance.now() }}>
      <SafeCanvas shadows camera={{ position: [0, CAMERA_Y, 22], fov: 50, near: 0.1, far: 200 }} dpr={[1, 1.5]}>
        <PlazaScene
          onEnterCourt={onEnterCourt}
          onEnterTalkshow={onEnterTalkshow ?? (() => toast('脱口秀剧场即将开放'))}
          onEnterWerewolf={onEnterWerewolf ?? (() => toast('狼人杀馆即将开放'))}
          onEnterBar={onEnterBar ?? (() => toast('酒吧辩论即将开放'))}
          onEnterLibrary={onEnterLibrary ?? (() => toast('图书馆即将开放'))}
          onEnterGym={onEnterGym ?? (() => toast('健身房即将开放'))}
          toast={toast}
          playersRef={playersRef}
          remoteUserIds={remoteUserIds}
          onMove={handleMove}
          tapRef={tapRef}
        />
      </SafeCanvas>
      <div className="plaza-3d-topbar">
        <button className="plaza-3d-back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="plaza-3d-title">广场</div>
        <img className="plaza-3d-logo" src="/brand/balabala-mark-dark.jpg" alt="BalaBala" />
      </div>
      <div className="plaza-3d-online" style={{
        position: 'absolute', top: 56, left: 16, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(20,18,10,0.8)', border: '1px solid #4fb3a5', borderRadius: 20,
        padding: '4px 12px', color: '#4fb3a5', fontSize: 12, fontWeight: 600,
      }}>
        <Users size={13} /> 在线 {onlineCount} 人
      </div>
      <div className="plaza-3d-hint">点击地面移动 · 点击建筑进入</div>
      <button className="plaza-3d-discuss" onClick={() => setShowDiscuss(true)}>
        <MessagesSquare size={16} /> 讨论区
      </button>
      {toastMsg && <div className="plaza-3d-toast">{toastMsg}</div>}
      {showDiscuss && (
        <div className="plaza-3d-discuss-overlay">
          <Plaza onBack={() => setShowDiscuss(false)} />
        </div>
      )}
    </div>
  )
}
