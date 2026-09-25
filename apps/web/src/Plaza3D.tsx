import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, MessagesSquare, Users } from 'lucide-react'
import { Plaza } from './Plaza'
import { useIdentity } from './identity'
import type { WSMessage, WSUser } from '@balabala/shared'
import SafeCanvas from './SafeCanvas'
import {
  createWorldRuntime, buildColliders,
  type BuildingId, type RemotePlayer, type WorldManifest, type WorldRuntime,
} from './world'
import PlayerController from './world/PlayerController'
import CameraRig from './world/CameraRig'
import WorldScene from './world/WorldScene'
import Interaction from './world/Interaction'
import Minimap from './world/Minimap'
import MobileControls, { isTouchDevice } from './world/MobileControls'
import SceneSelect from './world/SceneSelect'
import { SCENE_LABELS } from './onboarding/onboardingProgress'
import './plaza-3d.css'
import './onboarding/onboarding.css'

function buildWsUrl(room: string, userId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`
}

export default function Plaza3D({ onBack, onEnterCourt, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym, recommendedScene }: {
  onBack: () => void
  onEnterCourt: () => void
  onEnterTalkshow?: () => void
  onEnterWerewolf?: () => void
  onEnterBar?: () => void
  onEnterLibrary?: () => void
  onEnterGym?: () => void
  /** 新手引导推荐的场景建筑 id；有则在广场上显示「新手推荐」角标。 */
  recommendedScene?: BuildingId
}) {
  const { user } = useIdentity()
  const [showDiscuss, setShowDiscuss] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | null>(null)
  const [onlineCount, setOnlineCount] = useState(1)

  // ===== 开放世界运行时（mutable ref，高频读写不走 React state） =====
  const [world] = useState<WorldRuntime>(() => createWorldRuntime())
  const [colliders] = useState(() => buildColliders())
  const [manifest, setManifest] = useState<WorldManifest | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)

  // ===== WS 远端玩家存储 =====
  const playersRef = useRef(new Map<string, RemotePlayer>())
  const [remoteUserIds, setRemoteUserIds] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const shouldReconnect = useRef(true)

  const toast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200)
  }, [])

  // ===== 加载世界资产清单（失败则全程序化占位） =====
  useEffect(() => {
    let alive = true
    fetch('/models/world/world-manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<WorldManifest>) : null))
      .then((m) => { if (alive) setManifest(m) })
      .catch(() => { if (alive) setManifest(null) })
    return () => { alive = false }
  }, [])

  // ===== WS 多人同步 =====
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

  useEffect(() => {
    if (!user?.userId) return
    if (showDiscuss) return
    shouldReconnect.current = true

    const connect = () => {
      const ws = new WebSocket(buildWsUrl('plaza', user.userId))
      wsRef.current = ws

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
  }, [user?.userId, showDiscuss, upsertPlayer, removePlayer, toast])

  // ===== 节流 WS 位置上报（PlayerController 每帧回调） =====
  const handleSync = useCallback((x: number, z: number, rotation: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'move', x, z, rotation }))
  }, [])

  // ===== 建筑 id → onEnter 回调映射 =====
  const enterHandlers = useCallback(
    (id: BuildingId) => {
      switch (id) {
        case 'court': onEnterCourt(); break
        case 'talkshow': (onEnterTalkshow ?? (() => toast('脱口秀剧场即将开放')))(); break
        case 'werewolf': (onEnterWerewolf ?? (() => toast('狼人杀馆即将开放')))(); break
        case 'bar': (onEnterBar ?? (() => toast('酒吧辩论即将开放')))(); break
        case 'library': (onEnterLibrary ?? (() => toast('图书馆即将开放')))(); break
        case 'gym': (onEnterGym ?? (() => toast('健身房即将开放')))(); break
      }
    },
    [onEnterCourt, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym, toast],
  )

  // ===== 传送（小地图 / 场景选择） =====
  const teleport = useCallback((x: number, z: number) => {
    world.player.x = x
    world.player.z = z
    world.player.y = 0
    world.player.velocityY = 0
    world.player.onGround = true
    toast('已传送')
  }, [world, toast])

  const touch = isTouchDevice()

  return (
    <div className="plaza-3d-root">
      <SafeCanvas shadows camera={{ position: [0, 10, 22], fov: 60, near: 0.1, far: 500 }} dpr={[1, 1.5]}>
        <Suspense fallback={null}>
          <WorldScene
            world={world}
            manifest={manifest}
            playersRef={playersRef}
            remoteUserIds={remoteUserIds}
          />
          <PlayerController world={world} colliders={colliders} onSync={handleSync} />
          <CameraRig world={world} colliders={colliders} />
          <Interaction world={world} onEnter={enterHandlers} onPrompt={setPrompt} toast={toast} />
        </Suspense>
      </SafeCanvas>

      {/* 顶部栏 */}
      <div className="plaza-3d-topbar">
        <button className="plaza-3d-back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="plaza-3d-title">开放世界广场</div>
        <img className="plaza-3d-logo" src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" />
      </div>

      {/* 在线人数 */}
      <div className="plaza-3d-online">
        <Users size={13} /> 在线 {onlineCount} 人
      </div>

      {/* 新手推荐角标：指向兴趣选择后推荐的那栋建筑，点一下直接进 */}
      {recommendedScene && (
        <button
          type="button"
          className="ob-recommend-badge"
          onClick={() => enterHandlers(recommendedScene)}
        >
          ⭐ 新手推荐：{SCENE_LABELS[recommendedScene]} ↗
        </button>
      )}

      {/* 交互提示（走近建筑/NPC/水晶时显示） */}
      {prompt && <div className="plaza-3d-prompt">{prompt}</div>}

      {/* 桌面操作提示 */}
      {!touch && (
        <div className="plaza-3d-hint">
          WASD 移动 · Shift 奔跑 · Space 跳跃 · 鼠标拖拽环视 · 滚轮缩放 · E 交互
        </div>
      )}

      {/* 讨论区按钮 */}
      <button className="plaza-3d-discuss" onClick={() => setShowDiscuss(true)}>
        <MessagesSquare size={16} /> 讨论区
      </button>

      {/* 小地图 + 场景选择（DOM 覆盖层） */}
      <Minimap world={world} onTeleport={teleport} />
      <SceneSelect onTeleport={teleport} />

      {/* 移动端控件 */}
      {touch && <MobileControls world={world} />}

      {/* toast */}
      {toastMsg && <div className="plaza-3d-toast">{toastMsg}</div>}

      {/* 讨论区覆盖层 */}
      {showDiscuss && (
        <div className="plaza-3d-discuss-overlay">
          <Plaza onBack={() => setShowDiscuss(false)} />
        </div>
      )}
    </div>
  )
}
