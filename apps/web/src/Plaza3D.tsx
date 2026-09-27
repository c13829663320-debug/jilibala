import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, MessagesSquare, Users, Mic, MicOff, Copy, Check, LogOut, Hand } from 'lucide-react'
import { Plaza } from './Plaza'
import { useIdentity } from './identity'
import type { EmoteType, ReportCategory, SocialRoom, WSMessage, WSUser } from '@balabala/shared'
import SafeCanvas from './SafeCanvas'
import {
  createWorldRuntime, buildColliders,
  type BuildingId, type RemotePlayer, type WorldManifest, type WorldRuntime,
} from './world'
import { collectiblesForScene, loadCollected } from './world/collectibles'
import { BUILDING_INTERIORS } from './world/interior/building-interiors'
import PerformanceHUD, { PerfCollector, isPerfEnabled } from './world/PerformanceHUD'
import PlayerController from './world/PlayerController'
import CameraRig from './world/CameraRig'
import WorldScene from './world/WorldScene'
import Interaction from './world/Interaction'
import Minimap from './world/Minimap'
import MobileControls, { isTouchDevice } from './world/MobileControls'
import SceneSelect from './world/SceneSelect'
import { SCENE_LABELS } from './onboarding/onboardingProgress'
import { useSpatialVoice } from './voice/useSpatialVoice'
import { getRoomPassword, clearRoomPassword } from './room-permissions/roomAuthStore'
import { useSafety } from './safety/use-safety'
import PlayerContextMenu, { type PlayerTarget } from './safety/PlayerContextMenu'
import TextShoutLayer, { type ActiveShout } from './voice/text-shout'
import MicPermissionGuide from './voice/MicPermissionGuide'
import {
  VoiceFallbackMachine,
  type VoiceFallbackState,
} from './voice/voice-fallback'
import {
  initialWsErrorState,
  reduceWsError,
  wsBannerText,
  canMutate,
  type WsErrorState,
} from './error-boundary/ws-error-handler'
import './plaza-3d.css'
import './onboarding/onboarding.css'
import { detectDeviceTier, preloadAssets, PLAZA_PRIORITY_ASSETS } from './performance/asset-preloader'
import { getModelUnloadManager } from './performance/model-unload-manager'
import { maxPixelRatio, shadowQualityFor } from './performance/use-cleanup'

/** 数字键 1-7 → 手势 */
const KEY_EMOTES: Record<string, EmoteType> = {
  '1': 'wave', '2': 'nod', '3': 'shake', '4': 'point', '5': 'clap', '6': 'laugh', '7': 'surprised',
}

/** 本地说话强度上报节流（与服务端 TALKING_BROADCAST_MS 对齐） */
const TALKING_REPORT_MS = 120

function buildWsUrl(room: string, userId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const base = `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(userId)}&room=${encodeURIComponent(room)}`
  // R4-02: 密码房——从 auth store 读取临时密码
  const pw = getRoomPassword()
  if (pw) return `${base}&password=${encodeURIComponent(pw)}`
  return base
}

export default function Plaza3D({ onBack, onEnterCourt, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym, recommendedScene, roomId = 'plaza', onLeaveRoom }: {
  onBack: () => void
  onEnterCourt: () => void
  onEnterTalkshow?: () => void
  onEnterWerewolf?: () => void
  onEnterBar?: () => void
  onEnterLibrary?: () => void
  onEnterGym?: () => void
  /** 新手引导推荐的场景建筑 id；有则在广场上显示「新手推荐」角标。 */
  recommendedScene?: BuildingId
  /** 社交房间 id（social:<code>）；默认 'plaza' 为全局开放广场。 */
  roomId?: string
  /** 社交房间时显示「离开房间」按钮，返回大厅；全局广场不显示。 */
  onLeaveRoom?: () => void
}) {
  const { user } = useIdentity()
  const isSocialRoom = roomId !== 'plaza'
  const [showDiscuss, setShowDiscuss] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | null>(null)
  const [onlineCount, setOnlineCount] = useState(1)
  const [roomInfo, setRoomInfo] = useState<SocialRoom | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  // ===== R4-04: 文字喊话气泡（userId → 活跃喊话）=====
  const [shouts, setShouts] = useState<Map<string, ActiveShout>>(() => new Map())
  // ===== R4-04: 语音→文字 回落状态机 =====
  const voiceMachineRef = useRef(new VoiceFallbackMachine())
  const [voiceFallback, setVoiceFallback] = useState<VoiceFallbackState>(voiceMachineRef.current.getState())
  const dispatchVoice = useCallback((ev: Parameters<VoiceFallbackMachine['send']>[0]) => {
    setVoiceFallback(voiceMachineRef.current.send(ev))
  }, [])
  const [shoutDraft, setShoutDraft] = useState('')
  // ===== R4-04: WS 连接错误状态（离线只读 / 横幅 / 手动重连）=====
  const [wsErr, setWsErr] = useState<WsErrorState>(() => initialWsErrorState())
  const dispatchWs = useCallback((ev: Parameters<typeof reduceWsError>[1]) => {
    setWsErr((s) => reduceWsError(s, ev))
  }, [])
  const [reconnectTick, setReconnectTick] = useState(0)
  // R4-04: 离线只读——keydown/高频回调里读 ref，避免 effect 反复重订阅
  const wsOnlineRef = useRef(true)
  useEffect(() => {
    wsOnlineRef.current = canMutate(wsErr)
  }, [wsErr])

  // ===== 开放世界运行时（mutable ref，高频读写不走 React state） =====
  const [world] = useState<WorldRuntime>(() => createWorldRuntime())
  const [colliders] = useState(() => buildColliders())
  const [manifest, setManifest] = useState<WorldManifest | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)

  // ===== 广场收集品计数（DOM 覆盖层显示 x/6） =====
  const plazaCollectibles = useMemo(() => collectiblesForScene('plaza'), [])
  const [plazaCollectedCount, setPlazaCollectedCount] = useState(() => {
    const set = loadCollected()
    return plazaCollectibles.filter((c) => set.has(c.id)).length
  })
  useEffect(() => {
    const refresh = () => {
      const set = loadCollected()
      setPlazaCollectedCount(plazaCollectibles.filter((c) => set.has(c.id)).length)
    }
    window.addEventListener('balabala:collectible', refresh)
    return () => window.removeEventListener('balabala:collectible', refresh)
  }, [plazaCollectibles])

  // ===== 3D 室内模式：进入建筑时渲染对应室内场景（?interior=court 可直接进入） =====
  const [activeInterior, setActiveInterior] = useState<BuildingId | null>(() => {
    const p = new URLSearchParams(window.location.search).get('interior')
    return (p && ['court','talkshow','werewolf','bar','gym','library'].includes(p)) ? p as BuildingId : null
  })

  // ===== R4-06 性能治理：设备分级 / 像素比上限 / 阴影降级 =====
  // 高配置设备保持原画质；低配设备（<4 核 / <4GB）压像素比、降阴影、跳过高分辨率纹理。
  const deviceTier = useMemo(() => detectDeviceTier(), [])
  const dprCap = useMemo(
    () => maxPixelRatio(deviceTier, typeof window !== 'undefined' ? window.devicePixelRatio : 1),
    [deviceTier],
  )
  const shadowQ = useMemo(() => shadowQualityFor(deviceTier), [deviceTier])

  // R4-06 泄漏治理 #1：WS onmessage 里 setTimeout(气泡/emote 复位) 在组件卸载后仍会
  // setState → 注册到统一集合，effect 清理时全部 clearTimeout。
  const pendingTimers = useRef<Set<number>>(new Set())
  const trackTimer = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      pendingTimers.current.delete(id)
      fn()
    }, ms)
    pendingTimers.current.add(id)
    return id
  }, [])

  // R4-06 性能治理：进入广场前预加载核心模型/纹理/字体；卸载时统一 dispose 3D 资源。
  useEffect(() => {
    let alive = true
    const mgr = getModelUnloadManager()
    // 预加载（失败静默，运行时按需兜底）
    void preloadAssets(PLAZA_PRIORITY_ASSETS, {
      device: typeof navigator !== 'undefined' ? navigator : undefined,
      onProgress: (p) => { if (!alive) return void 0; void p },
    }).catch(() => { /* noop */ })
    return () => {
      alive = false
      // 清掉所有在途气泡/emote 定时器（泄漏治理 #1）
      pendingTimers.current.forEach((id) => window.clearTimeout(id))
      pendingTimers.current.clear()
      // 释放本广场加载的几何体/材质/纹理（共享资源引用计数保护）
      try { mgr.disposeAll() } catch { /* noop */ }
    }
  }, [])

  // ===== WS 远端玩家存储 =====
  const playersRef = useRef(new Map<string, RemotePlayer>())
  const [remoteUserIds, setRemoteUserIds] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const shouldReconnect = useRef(true)
  const wsFailuresRef = useRef(0)
  // 本地玩家位置（供空间音频 AudioListener 使用）
  const localPosRef = useRef({ x: world.player.x, z: world.player.z })
  // 本地说话强度上报节流
  const lastTalkingSentRef = useRef(-1)
  const localTalkingLevelRef = useRef(0)

  // ===== R4-03 安全模块：静音/屏蔽/举报 =====
  // 被静音/屏蔽的 peer 集合（ref 传给 useSpatialVoice，tick 内读取以禁用远端语音）
  const mutedPeersRef = useRef<Set<string>>(new Set())
  // 当前弹出上下文菜单的目标玩家（null = 关闭）
  const [menuState, setMenuState] = useState<{ target: PlayerTarget; x: number; y: number } | null>(null)
  const safety = useSafety({
    userId: user?.userId,
    roomId,
    send: (msg) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    },
  })

  // 同步静音/屏蔽集合 → mutedPeersRef（屏蔽者天然也禁声）
  useEffect(() => {
    mutedPeersRef.current = new Set([...safety.state.muted, ...safety.state.blocked])
  }, [safety.state.muted, safety.state.blocked])

  // 供 WS onmessage 闭包读取的实时安全判定（避免 effect 重连）
  const safetyRef = useRef(safety)
  useEffect(() => { safetyRef.current = safety }, [safety])

  /** 点击远端化身 → 弹出上下文菜单 */
  const handleRemotePlayerSelect = useCallback((uid: string, clientX: number, clientY: number) => {
    if (uid === user?.userId) return
    const p = playersRef.current.get(uid)
    setMenuState({ target: { userId: uid, nickname: p?.nickname ?? '玩家' }, x: clientX, y: clientY })
  }, [user?.userId])

  /** 过滤掉被屏蔽的远端玩家（不渲染化身、不显示在列表） */
  const visibleUserIds = useMemo(
    () => remoteUserIds.filter((id) => safety.canSeeAvatar(id)),
    [remoteUserIds, safety],
  )

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
    // 切换房间时清空上一个房间的远端玩家
    playersRef.current.clear()
    setRemoteUserIds([])
    setRoomInfo(null)

    const connect = () => {
      const ws = new WebSocket(buildWsUrl(roomId, user.userId))
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
                if (typeof p.talkingIntensity === 'number') existing.talkingIntensity = p.talkingIntensity
                if (p.expression) existing.expression = p.expression as RemotePlayer['expression']
              }
            }
            break
          }
          case 'chat':
            // R4-03 安全：被屏蔽者的文字消息直接丢弃
            if (safetyRef.current.canReceiveText(msg.userId)) {
              toast(`${msg.nickname}: ${msg.text}`)
            }
            break
          case 'error':
            break
        }

        // —— 社交临场感 / 房间扩展消息（不在 WSMessage 联合内，宽松解析） ——
        const m = msg as unknown as {
          type: string
          userId?: string
          nickname?: string
          emote?: EmoteType
          durationMs?: number
          intensity?: number
          room?: SocialRoom
          playerCount?: number
          text?: string
        }
        // —— R4-04: 文字喊话 → 在该玩家头顶 3D 气泡显示 3s ——
        if (m.type === 'text_shout' && m.userId && typeof m.text === 'string') {
          const now = performance.now()
          const id = `${m.userId}-${now}`
          setShouts((prev) => {
            const next = new Map(prev)
            next.set(m.userId!, {
              id,
              userId: m.userId!,
              nickname: m.nickname ?? '',
              text: m.text!,
              createdAt: now,
              expiresAt: now + 3000,
            })
            return next
          })
          trackTimer(() => {
            setShouts((prev) => {
              const cur = prev.get(m.userId!)
              if (!cur || cur.id !== id) return prev
              const next = new Map(prev)
              next.delete(m.userId!)
              return next
            })
          }, 3000)
        } else if (m.type === 'emote' && m.userId && m.emote) {
          const p = playersRef.current.get(m.userId)
          if (p) {
            p.emote = m.emote
            // 由动画机按默认时长自动回归；超时后清掉标记以便同手势可重复触发
            const dur = m.durationMs ?? 1500
            trackTimer(() => {
              if (playersRef.current.get(m.userId!)?.emote === m.emote) {
                playersRef.current.get(m.userId!)!.emote = undefined
              }
            }, dur)
          }
        } else if (m.type === 'talking' && m.userId && typeof m.intensity === 'number') {
          const p = playersRef.current.get(m.userId)
          if (p) p.talkingIntensity = m.intensity
        } else if (m.type === 'room_info' && m.room) {
          setRoomInfo(m.room)
          setOnlineCount(m.room.playerCount)
        } else if (m.type === 'room_player_update' && typeof m.playerCount === 'number') {
          setOnlineCount(m.playerCount)
        }
      }

      ws.onopen = () => {
        wsFailuresRef.current = 0
        dispatchWs({ type: 'OPEN' })
      }
      ws.onclose = () => {
        wsRef.current = null
        wsFailuresRef.current += 1
        dispatchWs({ type: 'CLOSE' })
        // R4-04: 指数退避自动重连（1s→2s→…→30s）；失败 5 次后进入离线只读，等手动重连
        if (shouldReconnect.current && wsFailuresRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, wsFailuresRef.current - 1), 30000)
          reconnectTimer.current = window.setTimeout(connect, delay)
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
  }, [user?.userId, showDiscuss, roomId, upsertPlayer, removePlayer, toast, dispatchWs, reconnectTick, trackTimer])

  // R4-04: 手动重连（离线横幅按钮）——重置失败计数并重跑连接 effect
  const manualReconnect = useCallback(() => {
    wsFailuresRef.current = 0
    dispatchWs({ type: 'MANUAL_RETRY' })
    setReconnectTick((n) => n + 1)
  }, [dispatchWs])

  // ===== 节流 WS 位置上报（PlayerController 每帧回调） =====
  const handleSync = useCallback((x: number, z: number, rotation: number) => {
    localPosRef.current.x = x
    localPosRef.current.z = z
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'move', x, z, rotation }))
  }, [])

  // ===== 建筑 id → 进入 3D 室内 =====
  const enterHandlers = useCallback(
    (id: BuildingId) => {
      setActiveInterior(id)
    },
    [],
  )

  // ===== 传送（小地图 / 场景选择） =====
  const teleport = useCallback((x: number, z: number) => {
    world.player.x = x
    world.player.z = z
    world.player.y = 0
    world.player.velocityY = 0
    world.player.onGround = true
    localPosRef.current.x = x
    localPosRef.current.z = z
    toast('已传送')
  }, [world, toast])

  // ===== 空间语音（WebRTC mesh + 距离订阅 + 3D 空间音频） =====
  const voice = useSpatialVoice({
    wsRef,
    userId: user?.userId ?? '',
    roomId,
    playersRef,
    localPosRef,
    enabled: true,
    // R4-03：静音/屏蔽者的远端语音在 tick 内禁用
    mutedPeersRef,
  })

  // 本地说话强度 → 节流广播给远端（驱动远端口型）
  useEffect(() => {
    localTalkingLevelRef.current = voice.isSpeaking ? 0.4 : 0
    const id = window.setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const v = localTalkingLevelRef.current
      if (v === lastTalkingSentRef.current) return
      lastTalkingSentRef.current = v
      ws.send(JSON.stringify({ type: 'talking', intensity: v }))
    }, TALKING_REPORT_MS)
    return () => window.clearInterval(id)
  }, [voice.isSpeaking])

  // 远端说话强度衰减：停止接收后让口型自然闭合
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const p of playersRef.current.values()) {
        if (p.talkingIntensity && p.talkingIntensity > 0) {
          p.talkingIntensity = Math.max(0, p.talkingIntensity - 0.08)
        }
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [])

  // ===== 本地手势：数字键 1-7 发送 emote；空格 push-to-talk =====
  const pushToTalkRef = useRef(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框里触发
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const emote = KEY_EMOTES[e.key]
      if (emote) {
        // R4-04: 离线只读模式下禁止发手势
        if (!wsOnlineRef.current) return
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'emote', emote, durationMs: 1500 }))
        }
        return
      }
      // 空格 = push-to-talk 按住说
      if (e.code === 'Space' && voice.pushToTalk && !e.repeat) {
        e.preventDefault()
        pushToTalkRef.current = true
        voice.setPushing(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && voice.pushToTalk && pushToTalkRef.current) {
        pushToTalkRef.current = false
        voice.setPushing(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [voice])

  const [micRequested, setMicRequested] = useState(false)
  const handleMicButton = useCallback(async () => {
    // 首次点击：在用户手势里请求麦克风授权
    if (!micRequested) {
      const ok = await voice.requestMic()
      if (ok) {
        setMicRequested(true)
        voice.setMuted(false)
        dispatchVoice({ type: 'MIC_GRANTED' })
      } else {
        // R4-04: 麦克风失败 → 回落文字喊话 + 引导弹窗
        const err = voice.error ?? ''
        if (err.includes('未检测到') || err.includes('占用') || err.includes('不支持')) {
          dispatchVoice({ type: 'MIC_NO_DEVICE' })
        } else {
          dispatchVoice({ type: 'MIC_DENIED' })
        }
      }
      return
    }
    // 已授权：切换静音；关麦时回落文字喊话
    voice.setMuted(!voice.muted)
    dispatchVoice({ type: 'USER_MUTE_CHANGED', muted: !voice.muted })
  }, [voice, micRequested, dispatchVoice])

  // R4-04: 发送文字喊话（语音回落时的沟通方式）
  const sendShout = useCallback(() => {
    const text = shoutDraft.trim()
    if (!text) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast('离线中，暂时发不出去')
      return
    }
    ws.send(JSON.stringify({ type: 'text_shout', text }))
    setShoutDraft('')
  }, [shoutDraft, toast])

  const copyCode = useCallback(async () => {
    if (!roomInfo?.code) return
    try {
      await navigator.clipboard.writeText(roomInfo.code)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1500)
    } catch { /* noop */ }
  }, [roomInfo?.code])

  const touch = isTouchDevice()

  // ===== 3D 室内模式：进入建筑后全屏渲染室内场景，退出返回广场 =====
  if (activeInterior) {
    const Interior = BUILDING_INTERIORS[activeInterior]
    return (
      <Suspense fallback={
        <div style={{ width: '100vw', height: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFD600' }}>
          加载 {SCENE_LABELS[activeInterior]} 室内...
        </div>
      }>
        <Interior onExit={() => setActiveInterior(null)} />
      </Suspense>
    )
  }

  return (
    <div className="plaza-3d-root">
      <SafeCanvas shadows={shadowQ.enabled} camera={{ position: [0, 10, 22], fov: 60, near: 0.1, far: 500 }} dpr={[1, dprCap]}>
        <Suspense fallback={null}>
          <WorldScene
            world={world}
            manifest={manifest}
            playersRef={playersRef}
            remoteUserIds={visibleUserIds}
            localPosRef={localPosRef}
            onRemotePlayerSelect={handleRemotePlayerSelect}
          />
          <PlayerController world={world} colliders={colliders} onSync={handleSync} />
          <CameraRig world={world} colliders={colliders} />
          <Interaction world={world} onEnter={enterHandlers} onPrompt={setPrompt} toast={toast} />
          {isPerfEnabled(window.location.search, window.localStorage) && <PerfCollector />}
          {/* R4-04: 头顶文字喊话气泡（3D 世界空间，随玩家移动 3s 淡出） */}
          <TextShoutLayer shouts={shouts} playersRef={playersRef} />
        </Suspense>
      </SafeCanvas>

      {/* 性能 HUD（?perf=1 或 localStorage 开启） */}
      {isPerfEnabled(window.location.search, window.localStorage) && <PerformanceHUD />}

      {/* R4-04: WS 离线/重连横幅（顶部明黄色，离线时点按手动重连） */}
      {wsBannerText(wsErr) && (
        <div
          onClick={wsErr.status === 'offline' ? manualReconnect : undefined}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99998,
            background: '#FFD600', color: '#111', padding: '8px 16px',
            fontSize: 13, fontWeight: 700, textAlign: 'center',
            cursor: wsErr.status === 'offline' ? 'pointer' : 'default',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {wsBannerText(wsErr)}
        </div>
      )}

      {/* 顶部栏 */}
      <div className="plaza-3d-topbar">
        <button className="plaza-3d-back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="plaza-3d-title">{isSocialRoom ? (roomInfo?.name ?? '多人房间') : '开放世界广场'}</div>
        <img className="plaza-3d-logo" src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" />
      </div>

      {/* 房间信息条（社交房间）：房间名 + 房间码 + 在线人数 + 离开 */}
      {isSocialRoom && (
        <div className="mp-roominfo-bar">
          <span className="mp-roominfo-count"><Users size={13} /> {onlineCount} 人在线</span>
          {roomInfo && (
            <button className="mp-roominfo-code" onClick={copyCode} title="复制房间码">
              {codeCopied ? <Check size={13} /> : <Copy size={13} />}
              房间码 {roomInfo.code}
            </button>
          )}
          {onLeaveRoom && (
            <button className="mp-roominfo-leave" onClick={onLeaveRoom}>
              <LogOut size={13} /> 离开房间
            </button>
          )}
        </div>
      )}

      {/* 在线人数（仅全局广场显示；社交房间用上方信息条） */}
      {!isSocialRoom && (
        <div className="plaza-3d-online">
          <Users size={13} /> 在线 {onlineCount} 人
        </div>
      )}

      {/* 广场收集品计数（x/6） */}
      <div className="plaza-3d-collect" title="广场收集品">
        💎 {plazaCollectedCount}/{plazaCollectibles.length}
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

      {/* 语音控制浮层（右下角，讨论区按钮上方） */}
      <div className="voice-overlay">
        {voice.error && <div className="voice-error">{voice.error}</div>}
        <div className="voice-controls">
          <button
            className={`voice-mic-btn ${voice.isSpeaking ? 'is-speaking' : ''} ${voice.muted ? 'is-muted' : ''}`}
            onClick={() => void handleMicButton()}
            title={voice.muted ? '取消静音' : (micRequested ? '静音' : '开启麦克风')}
          >
            {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <label className="voice-ptt">
            <input
              type="checkbox"
              checked={voice.pushToTalk}
              onChange={(e) => voice.setPushToTalk(e.target.checked)}
            />
            <span className="voice-ptt-label"><Hand size={13} /> 按键说</span>
          </label>
        </div>
        {voice.pushToTalk && (
          <div className="voice-ptt-hint">按住 <b>空格</b> 说话</div>
        )}
        {/* R4-04: 语音不可用时的文字喊话输入框 */}
        {voiceFallback.mode === 'text' && (
          <div style={{
            marginTop: 8, display: 'flex', gap: 6, width: 220,
            background: 'rgba(0,0,0,0.7)', border: '1px solid #FFD600',
            borderRadius: 10, padding: 6,
          }}>
            <input
              value={shoutDraft}
              onChange={(e) => setShoutDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendShout() }}
              placeholder="文字喊话…"
              maxLength={60}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 0,
                outline: 0, color: '#FFD600', fontSize: 13,
              }}
            />
            <button
              onClick={sendShout}
              style={{
                border: 0, borderRadius: 6, background: '#FFD600', color: '#111',
                fontWeight: 700, fontSize: 12, padding: '4px 10px', cursor: 'pointer',
              }}
            >
              喊
            </button>
          </div>
        )}
      </div>

      {/* R4-04: 麦克风权限引导弹窗 */}
      {voiceFallback.showMicGuide && (
        <MicPermissionGuide
          reason={voiceFallback.reason === 'mic_denied' ? 'denied' : 'webrtc_failed'}
          onClose={() => dispatchVoice({ type: 'DISMISS_GUIDE' })}
          onRetry={() => {
            dispatchVoice({ type: 'USER_RETRY_VOICE' })
            setMicRequested(false)
          }}
          onUseText={() => dispatchVoice({ type: 'USER_CHOOSE_TEXT' })}
        />
      )}

      {/* 手势快捷键提示 */}
      {!touch && (
        <div className="mp-emote-hint">
          手势：1挥手 2点头 3摇头 4指向 5鼓掌 6大笑 7惊讶
        </div>
      )}

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

      {/* R4-03：玩家上下文菜单（静音/屏蔽/举报/查看档案） */}
      {menuState && (
        <PlayerContextMenu
          target={menuState.target}
          x={menuState.x}
          y={menuState.y}
          isMuted={safety.isMuted(menuState.target.userId)}
          isBlocked={safety.isBlocked(menuState.target.userId)}
          onToggleMute={() => safety.toggleMute(menuState.target.userId)}
          onToggleBlock={() => safety.toggleBlock(menuState.target.userId)}
          onReport={(category: ReportCategory, reason: string) => {
            safety.report(menuState.target.userId, reason, category, menuState.target.nickname)
            toast('已提交举报，感谢反馈')
          }}
          onViewProfile={() => toast('查看档案（即将开放）')}
          onClose={() => setMenuState(null)}
        />
      )}
    </div>
  )
}
