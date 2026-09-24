import { Suspense, useLayoutEffect, useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Billboard, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { ArrowLeft, MessagesSquare, Users, Mic, MicOff } from 'lucide-react'
import { Plaza } from './Plaza'
import { useIdentity, hashColor, getCelebrity } from './identity'
import type { WSMessage, WSUser, EmoteType, AvatarExpression } from '@balabala/shared'
import { RemoteAvatar, type PresencePlayer } from './avatar/RemoteAvatar'
import type { AvatarRig } from './avatar/avatar-rig'
import { EmoteWheel } from './avatar/EmoteWheel'
import { useEmote } from './avatar/useEmote'
import { useAvatarLipSync } from './avatar/useAvatarLipSync'
import { useSpatialVoice } from './voice/useSpatialVoice'
import { useVoiceEnabled } from './voice-settings'
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

/** A remote player tracked in the plaza. Positions are lerped toward targetX/targetZ.
 *  临场感字段（talkingIntensity/emote/expression）全部可选，向后兼容旧客户端。 */
type RemotePlayer = PresencePlayer & {
  animation?: string
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

interface PlazaSceneProps {
  onEnterCourt: () => void
  onEnterTalkshow: () => void
  onEnterWerewolf: () => void
  onEnterBar: () => void
  onEnterLibrary: () => void
  onEnterGym: () => void
  toast: (msg: string) => void
  playersRef: MutableRefObject<Map<string, PresencePlayer>>
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
  // 本地玩家世界坐标（供空间音频衰减 / 头部注视使用）
  const localPosRef = useRef({ x: 0, z: 0 })
  // 全局语音开关（与 voice-settings 联动）
  const [voiceEnabled] = useVoiceEnabled()
  // 本地麦克风电平分析器（自建，用于驱动 talking 强度上报）
  const [localAnalyser, setLocalAnalyser] = useState<AnalyserNode | null>(null)
  const localAudioCtxRef = useRef<AudioContext | null>(null)
  // talking 消息发送节流（100ms）
  const lastTalkingSendRef = useRef(0)
  // 本地口型不需要渲染 rig（广场不渲染本地 avatar），用空 ref 占位
  const dummyRigRef = useRef<AvatarRig | null>(null)

  // ===== 空间语音（另一个 Agent 实现的 useSpatialVoice）=====
  const voice = useSpatialVoice({
    wsRef,
    userId: user?.userId ?? 'plaza',
    roomId: 'plaza',
    playersRef: playersRef as MutableRefObject<Map<string, { x: number; z: number }>>,
    localPosRef,
    enabled: voiceEnabled,
  })

  // ===== emote 发送/接收 =====
  const { sendEmote, handleEmoteMessage } = useEmote({
    wsRef,
    playersRef: playersRef as MutableRefObject<Map<string, PresencePlayer>>,
    localUserId: user?.userId ?? '',
  })

  // ===== 本地口型电平 → WS talking（mic 模式，rig 占位）=====
  useAvatarLipSync({
    source: 'mic',
    analyser: localAnalyser,
    rigRef: dummyRigRef,
    onIntensity: (level) => {
      const now = performance.now()
      if (now - lastTalkingSendRef.current < 100) return // 客户端节流 100ms
      lastTalkingSendRef.current = now
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && level > 0.02) {
        ws.send(JSON.stringify({ type: 'talking', intensity: level }))
      }
    },
  })

  /** 点击麦克风：首次请求麦克风授权并自建电平分析器；之后切换静音 */
  const handleMicToggle = useCallback(async () => {
    if (voice.muted) {
      // 取消静音：若尚未建分析器，先请求麦克风
      if (!localAnalyser) {
        const ok = await voice.requestMic()
        if (ok) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const ctx = new AudioContext()
            const src = ctx.createMediaStreamSource(stream)
            const an = ctx.createAnalyser()
            an.fftSize = 1024
            src.connect(an)
            localAudioCtxRef.current = ctx
            setLocalAnalyser(an)
          } catch {
            /* 无麦克风设备，降级为纯文字 */
          }
        }
      }
      voice.setMuted(false)
    } else {
      voice.setMuted(true)
    }
  }, [voice, localAnalyser])

  const toast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200)
  }, [])

  const upsertPlayer = useCallback((u: WSUser) => {
    const existing = playersRef.current.get(u.userId)
    playersRef.current.set(u.userId, {
      // 保留已有临场感字段（talkingIntensity/emote/expression），仅刷新位置与身份
      ...existing,
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
    if (showDiscuss) return
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
                // 同步临场感扩展字段（向后兼容：旧客户端不发则不动）
                if (p.talkingIntensity !== undefined) existing.talkingIntensity = p.talkingIntensity
                if (p.animation !== undefined) existing.animation = p.animation
                if (p.expression !== undefined) existing.expression = p.expression as AvatarExpression
              }
            }
            break
          }
          case 'talking': {
            // 远端玩家说话强度：更新口型驱动源
            const p = playersRef.current.get(msg.userId)
            if (p) p.talkingIntensity = msg.intensity
            break
          }
          case 'emote': {
            // 远端玩家表情动作：更新动画状态，超时后自动清除
            handleEmoteMessage({ userId: msg.userId, emote: msg.emote, durationMs: msg.durationMs })
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
  }, [user?.userId, showDiscuss, upsertPlayer, removePlayer, toast, handleEmoteMessage])

  // Send move message when the player clicks the ground
  const handleMove = useCallback((x: number, z: number) => {
    // 维护本地坐标（供空间音频/头部注视）
    localPosRef.current.x = x
    localPosRef.current.z = z
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
          playersRef={playersRef as MutableRefObject<Map<string, PresencePlayer>>}
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
        <img className="plaza-3d-logo" src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" />
      </div>
      <div className="plaza-3d-online" style={{
        position: 'absolute', top: 56, left: 16, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(20,18,10,0.8)', border: '1px solid #4fb3a5', borderRadius: 20,
        padding: '4px 12px', color: '#4fb3a5', fontSize: 12, fontWeight: 600,
      }}>
        <Users size={13} /> 在线 {onlineCount} 人
      </div>
      {/* 麦克风按钮（静音/取消静音，首次点击请求授权） */}
      <button
        onClick={handleMicToggle}
        title={voice.muted ? '取消静音（开启语音）' : '静音'}
        style={{
          position: 'absolute', top: 56, right: 16, zIndex: 10,
          width: 36, height: 36, borderRadius: '50%',
          border: '1px solid #4fb3a5',
          background: voice.muted ? 'rgba(20,18,10,0.8)' : 'rgba(79,179,165,0.3)',
          color: voice.muted ? '#4fb3a5' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
      {/* Emote 表情动作轮盘 */}
      <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
        <EmoteWheel onSelect={(emote) => sendEmote(emote)} />
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
