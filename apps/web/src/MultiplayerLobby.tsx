// ===== Round3: 真人多人房间大厅 =====
// 纯 DOM 全屏页（非 3D）：房间列表 / 创建房间 / 加入房间码 三个 Tab。
// 品牌色：纯黑底 #000 + 明黄 #FFD600 + 青绿 #4fb3a5。
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft, Copy, Check, RefreshCw, Users, Plus, Hash, Loader2, LogIn,
} from 'lucide-react'
import type { CreateRoomRequest, RoomScene, SocialRoom } from '@balabala/shared'
import { SCENE_LABELS } from './onboarding/onboardingProgress'
import './multiplayer-lobby.css'

type Tab = 'list' | 'create' | 'join'

const SCENE_OPTIONS: Array<{ value: RoomScene; label: string }> = [
  { value: 'plaza', label: '开放广场' },
  ...(Object.entries(SCENE_LABELS) as Array<[RoomScene, string]>).map(([value, label]) => ({ value, label })),
]

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    return `${Math.floor(diff / 86400)} 天前`
  } catch {
    return ''
  }
}

function sceneLabel(scene: RoomScene): string {
  if (scene === 'plaza') return '开放广场'
  return SCENE_LABELS[scene] ?? scene
}

export default function MultiplayerLobby({ onBack, onEnterRoom }: {
  onBack: () => void
  onEnterRoom: (roomId: string) => void
}) {
  const [tab, setTab] = useState<Tab>('list')

  // —— 房间列表状态 ——
  const [rooms, setRooms] = useState<SocialRoom[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    setListError('')
    try {
      const res = await fetch('/api/rooms')
      if (!res.ok) throw new Error('加载房间列表失败')
      const data = (await res.json()) as { rooms: SocialRoom[] }
      setRooms(data.rooms ?? [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载房间列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchRooms() }, [fetchRooms])

  // —— 创建表单状态 ——
  const [name, setName] = useState('')
  const [scene, setScene] = useState<RoomScene>('plaza')
  const [isPublic, setIsPublic] = useState(true)
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // —— 加入码状态 ——
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError('')
    const trimmed = name.trim()
    if (!trimmed) { setCreateError('请输入房间名'); return }
    setCreating(true)
    try {
      const body: CreateRoomRequest = { name: trimmed, scene, isPublic, maxPlayers }
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? '创建房间失败')
      }
      const data = (await res.json()) as { room: SocialRoom }
      onEnterRoom(data.room.id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建房间失败')
    } finally {
      setCreating(false)
    }
  }

  const handleJoinCode = async (e: FormEvent) => {
    e.preventDefault()
    setJoinError('')
    const trimmed = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(trimmed)) {
      setJoinError('请输入 6 位房间码（字母或数字）')
      return
    }
    setJoining(true)
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(trimmed)}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('房间不存在或已满')
        throw new Error('加入房间失败')
      }
      const data = (await res.json()) as { room: SocialRoom }
      onEnterRoom(data.room.id)
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : '加入房间失败')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="mp-lobby-root">
      {/* 顶部栏 */}
      <div className="mp-lobby-topbar">
        <button className="mp-lobby-back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="mp-lobby-title">多人房间</div>
        <div className="mp-lobby-badge">REAL-TIME</div>
      </div>

      {/* Tab 切换 */}
      <div className="mp-lobby-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'list'}
          className={tab === 'list' ? 'is-active' : ''}
          onClick={() => setTab('list')}
        >
          <Users size={15} /> 房间列表
        </button>
        <button
          role="tab"
          aria-selected={tab === 'create'}
          className={tab === 'create' ? 'is-active' : ''}
          onClick={() => setTab('create')}
        >
          <Plus size={15} /> 创建房间
        </button>
        <button
          role="tab"
          aria-selected={tab === 'join'}
          className={tab === 'join' ? 'is-active' : ''}
          onClick={() => setTab('join')}
        >
          <Hash size={15} /> 加入房间码
        </button>
      </div>

      <div className="mp-lobby-body">
        {/* ===== 房间列表 ===== */}
        {tab === 'list' && (
          <div className="mp-list">
            <div className="mp-list-head">
              <span className="mp-list-count">{rooms.length} 个公开房间</span>
              <button className="mp-refresh" onClick={() => void fetchRooms()} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'mp-spin' : ''} /> 刷新
              </button>
            </div>

            {listError && <div className="mp-error">{listError}</div>}

            {loading && !rooms.length ? (
              <div className="mp-empty"><Loader2 size={22} className="mp-spin" /> 正在加载房间…</div>
            ) : rooms.length === 0 ? (
              <div className="mp-empty">
                <div className="mp-empty-emoji">🎮</div>
                <b>还没有公开房间</b>
                <p>创建一个房间，邀请朋友一起进入吧。</p>
                <button className="mp-primary-btn" onClick={() => setTab('create')}>立即创建</button>
              </div>
            ) : (
              <div className="mp-room-grid">
                {rooms.map((room) => (
                  <RoomCard key={room.id} room={room} onJoin={() => onEnterRoom(room.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== 创建房间 ===== */}
        {tab === 'create' && (
          <form className="mp-form" onSubmit={handleCreate}>
            <label className="mp-field">
              <span className="mp-label">房间名称</span>
              <input
                className="mp-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：周末闲聊小窝"
                maxLength={24}
                autoFocus
              />
            </label>

            <label className="mp-field">
              <span className="mp-label">场景</span>
              <select className="mp-input" value={scene} onChange={(e) => setScene(e.target.value as RoomScene)}>
                {SCENE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            <div className="mp-row">
              <label className="mp-field mp-row-item">
                <span className="mp-label">公开房间</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPublic}
                  className={`mp-switch ${isPublic ? 'is-on' : ''}`}
                  onClick={() => setIsPublic((v) => !v)}
                >
                  <span className="mp-switch-knob" />
                </button>
                <span className="mp-switch-hint">{isPublic ? '出现在房间列表' : '仅凭房间码加入'}</span>
              </label>

              <div className="mp-field mp-row-item">
                <span className="mp-label">最大人数：<b className="mp-yellow">{maxPlayers}</b></span>
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="mp-slider"
                />
                <div className="mp-slider-scale"><span>4</span><span>16</span></div>
              </div>
            </div>

            {createError && <div className="mp-error">{createError}</div>}

            <button type="submit" className="mp-primary-btn mp-submit" disabled={creating}>
              {creating ? <Loader2 size={16} className="mp-spin" /> : <Plus size={16} />}
              {creating ? '创建中…' : '创建并进入房间'}
            </button>
          </form>
        )}

        {/* ===== 加入房间码 ===== */}
        {tab === 'join' && (
          <form className="mp-form" onSubmit={handleJoinCode}>
            <label className="mp-field">
              <span className="mp-label">6 位房间码</span>
              <input
                className="mp-input mp-code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="ABC123"
                inputMode="text"
                autoFocus
                maxLength={6}
              />
            </label>
            {joinError && <div className="mp-error">{joinError}</div>}
            <button type="submit" className="mp-primary-btn mp-submit" disabled={joining || code.length !== 6}>
              {joining ? <Loader2 size={16} className="mp-spin" /> : <LogIn size={16} />}
              {joining ? '加入中…' : '加入房间'}
            </button>
            <p className="mp-hint-text">向房间创建者索取 6 位房间码即可加入。</p>
          </form>
        )}
      </div>
    </div>
  )
}

function RoomCard({ room, onJoin }: { room: SocialRoom; onJoin: () => void }) {
  const [copied, setCopied] = useState(false)
  const full = room.playerCount >= room.maxPlayers

  const copyCode = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 不可用则忽略 */
    }
  }

  return (
    <div className="mp-room-card">
      <div className="mp-room-head">
        <b className="mp-room-name">{room.name}</b>
        <span className={`mp-room-status ${full ? 'is-full' : ''}`}>
          {full ? '已满' : `${room.playerCount}/${room.maxPlayers}`}
        </span>
      </div>
      <div className="mp-room-meta">
        <span className="mp-scene-tag">{sceneLabel(room.scene)}</span>
        <span className="mp-room-creator">房主 · {room.creatorName}</span>
      </div>
      <div className="mp-room-foot">
        <span className="mp-room-time">{formatTime(room.createdAt)}</span>
        <div className="mp-room-actions">
          <button className="mp-code-chip" onClick={copyCode} title="复制房间码">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {room.code}
          </button>
          <button className="mp-join-btn" onClick={onJoin} disabled={full}>
            {full ? '已满' : '加入'}
          </button>
        </div>
      </div>
    </div>
  )
}
