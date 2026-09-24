// M11: 健身房 — 完整 UI 壳
// 五大功能：AI 健身教练 / 器械互动 / 名人教练带练 / 多人云健身 / 训练记录。
// WebSocket 连接 gym:lobby，同步在线玩家、打卡广播与加油飘字。
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Users, Sparkles, Dumbbell, Megaphone, Medal, MessageSquare,
  Play, Flag, Volume2, RefreshCw, Trophy, Quote, CheckCircle2,
} from 'lucide-react'
import {
  CELEBRITIES, getCelebrity, resolveCharacterVoice,
  type GymEquipmentId, type GymExercise, type GymGoal, type GymPlan,
  type GymAchievement, type GymCheckinRecord, type GymStats, type WSMessage,
} from '@balabala/shared'
import { useIdentity } from './identity'
import { useReconnectingWebSocket, wsStatusLabel } from './useReconnectingWebSocket'
import { TtsPlayButton } from './TtsPlayButton'
import type { GymPlayer, GymCheer } from './GymView'
import './gym.css'

const GymView = lazy(() => import('./GymView'))

type Tab = 'coach' | 'equipment' | 'celebrity' | 'multiplayer' | 'records'

const httpHeaders = { 'Content-Type': 'application/json' }
const ACCENT = '#4fb3a5'

// ===== 器械元数据 =====
const EQUIPMENT_INFO: Record<GymEquipmentId, { name: string; kind: 'reps' | 'time'; target: number; tips: string; safety: string }> = {
  treadmill: { name: '跑步机', kind: 'time', target: 20, tips: '保持稳定步伐，手臂自然摆动，目视前方。', safety: '逐步提速，停下时先按减速键。' },
  dumbbell: { name: '哑铃架', kind: 'reps', target: 12, tips: '核心收紧，手腕保持中立，控制下放速度。', safety: '选择能标准完成的重量，不要憋气。' },
  bench_press: { name: '杠铃卧推', kind: 'reps', target: 10, tips: '肩胛后缩下沉，杠铃下放至胸中部，推起时呼气。', safety: '务必有保护，杠铃不要弹胸。' },
  yoga_mat: { name: '瑜伽垫', kind: 'time', target: 20, tips: '深呼吸，动作缓慢，感受肌肉拉伸。', safety: '不要过度拉伸，以舒适为度。' },
  rowing: { name: '划船机', kind: 'time', target: 20, tips: '先蹬腿再后仰，最后拉桨回握。', safety: '背部保持平直，不要弯腰。' },
  bike: { name: '动感单车', kind: 'time', target: 20, tips: '站姿与坐姿交替，踏频保持稳定。', safety: '调节车把高度，避免膝盖内扣。' },
}

const GOALS: Array<{ id: GymGoal; label: string; emoji: string }> = [
  { id: 'muscle', label: '增肌', emoji: '💪' },
  { id: 'fat_loss', label: '减脂', emoji: '🔥' },
  { id: 'stretch', label: '拉伸', emoji: '🧘' },
  { id: 'endurance', label: '耐力', emoji: '🏃' },
  { id: 'strength', label: '力量', emoji: '🏋️' },
]
const LEVELS = [
  { id: 'beginner', label: '入门' },
  { id: 'intermediate', label: '进阶' },
  { id: 'advanced', label: '高阶' },
] as const

// 玩家在器械旁的锚点（与 GymView 布局对应）
const EQUIPMENT_ANCHOR: Record<GymEquipmentId, { x: number; z: number }> = {
  treadmill: { x: -4.2, z: -2.6 },
  dumbbell: { x: 0, z: -3.6 },
  bench_press: { x: 4.2, z: -2.6 },
  rowing: { x: -4.6, z: 2.4 },
  bike: { x: -1.6, z: 3.3 },
  yoga_mat: { x: 3.8, z: 2.7 },
}

type WorkoutSession = {
  kind: 'reps' | 'time'
  label: string
  target: number
  current: number
  equipment?: GymEquipmentId
  planId?: string
  exerciseId?: string
  exerciseName?: string
  sets: number
  durationSeconds: number
}

export default function GymShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()
  const userId = user?.userId ?? ''

  // ===== UI 状态 =====
  const [tab, setTab] = useState<Tab>('coach')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // ===== 多人 =====
  const [players, setPlayers] = useState<Record<string, GymPlayer>>({})
  const [online, setOnline] = useState(1)
  const [recentCheckins, setRecentCheckins] = useState<Array<{ userId: string; nickname: string; exerciseName: string; createdAt: string }>>([])
  const [cheers, setCheers] = useState<GymCheer[]>([])
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)
  const cheerId = useRef(0)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  // ===== AI 教练 =====
  const [goal, setGoal] = useState<GymGoal>('muscle')
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  const [duration, setDuration] = useState(30)
  const [plan, setPlan] = useState<GymPlan | null>(null)
  const [doneExercises, setDoneExercises] = useState<Record<string, boolean>>({})
  const [planComplete, setPlanComplete] = useState(false)

  // ===== 器械互动 =====
  const [selectedEquip, setSelectedEquip] = useState<GymEquipmentId | null>(null)

  // ===== 名人教练 =====
  const [celebId, setCelebId] = useState(CELEBRITIES[0].id)
  const [celebReply, setCelebReply] = useState('')
  const [celebName, setCelebName] = useState('')
  const [savedQuote, setSavedQuote] = useState('')
  const [challengeActive, setChallengeActive] = useState(false)

  // ===== 训练进行中 =====
  const [session, setSession] = useState<WorkoutSession | null>(null)

  // ===== 记录 =====
  const [stats, setStats] = useState<GymStats | null>(null)
  const [achievements, setAchievements] = useState<GymAchievement[]>([])
  const [checkins, setCheckins] = useState<GymCheckinRecord[]>([])
  const [lastCheckinId, setLastCheckinId] = useState<string | null>(null)

  // ===== WS =====
  const wsUrl = useCallback(() => {
    if (!userId) return null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(userId)}&room=gym:lobby`
  }, [userId])

  const { status, send } = useReconnectingWebSocket({
    url: wsUrl,
    enabled: Boolean(userId),
    onMessage: (raw) => {
      let msg: WSMessage
      try { msg = JSON.parse(raw) as WSMessage } catch { return }
      switch (msg.type) {
        case 'gym_state': {
          const mine = msg.users.filter((u) => u.userId !== userId)
          const map: Record<string, GymPlayer> = {}
          for (const u of mine) map[u.userId] = { userId: u.userId, nickname: u.nickname, x: u.x, z: u.z, rotation: u.rotation, activity: u.activity }
          setPlayers(map)
          setOnline(msg.users.length)
          setRecentCheckins(msg.recentCheckins ?? [])
          break
        }
        case 'gym_user_joined': {
          const u = msg.user
          if (u.userId === userId) break
          setPlayers((prev) => ({ ...prev, [u.userId]: { userId: u.userId, nickname: u.nickname, x: u.x, z: u.z, rotation: u.rotation } }))
          setOnline((n) => n + 1)
          break
        }
        case 'gym_user_left': {
          setPlayers((prev) => { const next = { ...prev }; delete next[msg.userId]; return next })
          setOnline((n) => Math.max(1, n - 1))
          break
        }
        case 'presence':
        case 'gym_presence': {
          setPlayers((prev) => {
            const next = { ...prev }
            for (const p of msg.users) {
              if (p.userId === userId) continue
              const old = next[p.userId] ?? { userId: p.userId, nickname: '玩家', x: p.x, z: p.z, rotation: p.rotation }
              next[p.userId] = { ...old, ...p }
            }
            return next
          })
          break
        }
        case 'chat':
        case 'gym_cheer': {
          const id = `cheer-${Date.now()}-${cheerId.current++}`
          setCheers((prev) => [...prev.slice(-5), { id, text: msg.text, nickname: msg.nickname, born: Date.now() }])
          flash(`${msg.nickname} 说：${msg.text}`)
          window.setTimeout(() => setCheers((prev) => prev.filter((c) => c.id !== id)), 3200)
          break
        }
        case 'gym_checkin_broadcast': {
          if (msg.userId === userId) break
          flash(`🎉 ${msg.nickname} 完成了「${msg.exerciseName}」`)
          setRecentCheckins((prev) => [{ userId: msg.userId, nickname: msg.nickname, exerciseName: msg.exerciseName, createdAt: msg.createdAt }, ...prev].slice(0, 8))
          break
        }
        default:
          break
      }
    },
  })

  const wsStatusText = wsStatusLabel(status, 0)

  // 发送本地位置（节流）
  const lastPresence = useRef(0)
  const sendPresence = useCallback((equip?: GymEquipmentId, activity?: string) => {
    const now = Date.now()
    if (now - lastPresence.current < 250) return
    lastPresence.current = now
    const anchor = equip ? EQUIPMENT_ANCHOR[equip] : { x: 0, z: 0 }
    void send(JSON.stringify({ type: 'move', x: anchor.x, z: anchor.z, rotation: 0, activity: activity ?? (equip ? EQUIPMENT_INFO[equip].name : '休息') }))
  }, [send])

  // ===== 数据加载 =====
  const loadStats = useCallback(async () => {
    if (!userId) return
    try {
      const [s, a] = await Promise.all([
        fetch(`/api/gym/stats/${encodeURIComponent(userId)}`).then((r) => (r.ok ? r.json() as Promise<GymStats> : null)),
        fetch(`/api/gym/achievements/${encodeURIComponent(userId)}`).then((r) => (r.ok ? r.json() as Promise<{ achievements: GymAchievement[] }> : null)),
      ])
      if (s) setStats(s)
      if (a) setAchievements(a.achievements ?? [])
    } catch { /* 后端未就绪 */ }
  }, [userId])

  const loadCheckins = useCallback(async () => {
    if (!userId) return
    try {
      const r = await fetch(`/api/gym/checkins?userId=${encodeURIComponent(userId)}&limit=20`)
      if (r.ok) { const d = await r.json() as { checkins: GymCheckinRecord[] }; setCheckins(d.checkins ?? []) }
    } catch { /* ignore */ }
  }, [userId])

  useEffect(() => { void loadStats() }, [loadStats])
  useEffect(() => { void loadCheckins() }, [loadCheckins])

  // ===== 打卡 =====
  const doCheckin = useCallback(async (payload: {
    planId?: string; exerciseId?: string; exerciseName?: string
    equipment?: GymEquipmentId; setsCompleted: number; repsCompleted: number
    durationSeconds: number; note?: string
  }) => {
    if (!userId) return null
    try {
      const res = await fetch('/api/gym/checkins', {
        method: 'POST', headers: httpHeaders,
        body: JSON.stringify({ userId, ...payload }),
      })
      const data = await res.json() as { checkin?: GymCheckinRecord; stats?: GymStats; newAchievements?: GymAchievement[] }
      if (!res.ok || !data.checkin) throw new Error('打卡失败')
      setLastCheckinId(data.checkin.id)
      if (data.stats) setStats(data.stats)
      if (data.newAchievements && data.newAchievements.length) {
        flash(`🏅 解锁新成就：${data.newAchievements.map((a) => a.name).join('、')}`)
      }
      void loadStats(); void loadCheckins()
      return data.checkin
    } catch (e) {
      setError(e instanceof Error ? e.message : '打卡失败')
      return null
    }
  }, [userId, flash, loadStats, loadCheckins])

  // ===== 训练计时（ref 镜像，副作用不放进 setState updater）=====
  const sessionRef = useRef<WorkoutSession | null>(null)
  sessionRef.current = session
  useEffect(() => {
    if (!session) return
    const step = () => {
      const prev = sessionRef.current
      if (!prev) return
      if (prev.kind === 'reps') {
        const next = prev.current + 1
        if (next >= prev.target) {
          void doCheckin({
            planId: prev.planId, exerciseId: prev.exerciseId, exerciseName: prev.exerciseName,
            equipment: prev.equipment, setsCompleted: prev.sets, repsCompleted: prev.target,
            durationSeconds: prev.durationSeconds,
          })
          setSession(null)
          return
        }
        setSession({ ...prev, current: next })
      } else {
        const next = prev.current - 1
        if (next <= 0) {
          void doCheckin({
            planId: prev.planId, exerciseId: prev.exerciseId, exerciseName: prev.exerciseName,
            equipment: prev.equipment, setsCompleted: 1, repsCompleted: 0,
            durationSeconds: prev.target,
          })
          setSession(null)
          return
        }
        setSession({ ...prev, current: next })
      }
    }
    const tick = window.setInterval(step, session.kind === 'reps' ? 280 : 1000)
    return () => window.clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session != null, doCheckin])

  const startSession = (s: Omit<WorkoutSession, 'current'>) => {
    setSession({ ...s, current: s.kind === 'reps' ? 0 : s.target })
    if (s.equipment) sendPresence(s.equipment, s.label)
  }

  // ===== 功能1：AI 教练 =====
  const generatePlan = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/gym/plans', {
        method: 'POST', headers: httpHeaders,
        body: JSON.stringify({ goal, level, durationMinutes: duration, userId }),
      })
      const data = await res.json() as { plan?: GymPlan; message?: string }
      if (!res.ok || !data.plan) throw new Error(data.message ?? '生成计划失败')
      setPlan(data.plan)
      setDoneExercises({})
      setPlanComplete(false)
    } catch (e) { setError(e instanceof Error ? e.message : '生成计划失败') }
    finally { setBusy(false) }
  }

  const startExercise = (ex: GymExercise) => {
    if (!plan) return
    activePlanExerciseRef.current = ex.id
    const equip = ex.equipment ?? 'dumbbell'
    const kind = EQUIPMENT_INFO[equip].kind
    startSession({
      kind,
      label: ex.name,
      target: kind === 'reps' ? ex.reps : Math.max(10, Math.round(ex.restSeconds * 2)),
      equipment: equip,
      planId: plan.id,
      exerciseId: ex.id,
      exerciseName: ex.name,
      sets: ex.sets,
      durationSeconds: 0,
    })
  }

  // 记录当前正在进行的计划动作，训练结束后自动标记完成
  const activePlanExerciseRef = useRef<string | null>(null)
  const wasRunningRef = useRef(false)
  useEffect(() => {
    const running = session !== null
    if (wasRunningRef.current && !running) {
      // 训练刚结束（自然完成或放弃），若属于计划动作则标记完成
      const exId = activePlanExerciseRef.current
      if (exId) markExerciseDone(exId)
      activePlanExerciseRef.current = null
    }
    wasRunningRef.current = running
  }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  const markExerciseDone = (exId: string) => {
    setDoneExercises((prev) => {
      const next = { ...prev, [exId]: true }
      if (plan && Object.keys(next).length >= plan.exercises.length) setPlanComplete(true)
      return next
    })
  }

  // ===== 功能2：器械互动 =====
  const startEquipment = (equip: GymEquipmentId) => {
    const info = EQUIPMENT_INFO[equip]
    startSession({
      kind: info.kind,
      label: info.name,
      target: info.target,
      equipment: equip,
      exerciseName: info.name,
      sets: 1,
      durationSeconds: info.kind === 'time' ? info.target : 0,
    })
  }

  // ===== 功能3：名人教练 =====
  const celebrityCoach = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/gym/celebrity-coach', {
        method: 'POST', headers: httpHeaders,
        body: JSON.stringify({ celebrityId: celebId, message: '给我一句健身打气的话', goal }),
      })
      const data = await res.json() as { reply?: string; name?: string; message?: string }
      if (!res.ok || !data.reply) throw new Error(data.message ?? '没有回复')
      setCelebReply(data.reply)
      setCelebName(data.name ?? getCelebrity(celebId)?.name ?? '')
    } catch (e) { setError(e instanceof Error ? e.message : '教练暂时不在') }
    finally { setBusy(false) }
  }

  const celebrityChallenge = async () => {
    // 名人挑战：跟练 20 个深蹲（reps 计数）
    const celeb = getCelebrity(celebId)
    setChallengeActive(true)
    startSession({
      kind: 'reps', label: `${celeb?.name ?? '教练'}的挑战：20 个深蹲`,
      target: 20, exerciseName: '深蹲挑战', sets: 1, durationSeconds: 0,
    })
  }

  // ===== 功能4：加油 =====
  const sendCheer = () => {
    const text = pickCheer()
    void send(JSON.stringify({ type: 'chat', text }))
    const id = `cheer-${Date.now()}-${cheerId.current++}`
    setCheers((prev) => [...prev.slice(-5), { id, text, nickname: user?.nickname ?? '我', born: Date.now() }])
    window.setTimeout(() => setCheers((prev) => prev.filter((c) => c.id !== id)), 3200)
  }
  const CHEERS = ['加油！你可以的！', '再来一组！', '坚持住！', '太自律了！', '燃起来！']
  const pickCheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)]

  // ===== 发布到广场 =====
  const publishCheckin = async (checkinId: string) => {
    try {
      const celeb = getCelebrity(celebId)
      const res = await fetch('/api/gym/publish', {
        method: 'POST', headers: httpHeaders,
        body: JSON.stringify({
          userId, checkinId,
          topics: ['健身房', GOALS.find((g) => g.id === goal)?.label ?? '健身'],
          celebrityCoach: celeb?.name,
          quote: savedQuote || undefined,
        }),
      })
      if (!res.ok) throw new Error('发布失败')
      flash('已发布到广场')
    } catch { flash('发布失败') }
  }

  const remotePlayers = useMemo(() => Object.values(players), [players])
  const doneCount = plan ? plan.exercises.filter((e) => doneExercises[e.id]).length : 0
  const progressPct = plan ? Math.round((doneCount / Math.max(1, plan.exercises.length)) * 100) : 0

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'coach', label: 'AI 教练', icon: <Dumbbell size={14} /> },
    { id: 'equipment', label: '器械', icon: <Play size={14} /> },
    { id: 'celebrity', label: '名人带练', icon: <Megaphone size={14} /> },
    { id: 'multiplayer', label: '云健身', icon: <Users size={14} /> },
    { id: 'records', label: '记录', icon: <Medal size={14} /> },
  ]

  return (
    <div className="gym-root">
      <img src="/scenes/gym.png" alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.18, zIndex: 0, pointerEvents: 'none' }} />
      <header className="gym-header">
        <button onClick={onBack} style={iconBtn}><ArrowLeft size={16} /></button>
        <Dumbbell size={18} color={ACCENT} />
        <strong style={{ letterSpacing: 1 }}>健身房</strong>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>挥洒汗水 · 自律即自由</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={onlineBadge}><Users size={12} /> {online} 人在线</span>
          {onPlaza && <button onClick={onPlaza} style={ghostBtn}>广场</button>}
        </div>
      </header>

      {wsStatusText && <div style={{ background: '#4fb3a5', color: '#0A0A0A', fontSize: 12, padding: '4px 16px', textAlign: 'center' }}>{wsStatusText}</div>}

      <div className="gym-body">
        {/* 左侧控制面板 */}
        <aside className="gym-panel">
          <div className="gym-tabbar">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ===== 功能1：AI 健身教练 ===== */}
          {tab === 'coach' && (
            <div>
              <div className="gym-card">
                <div style={labelText}>选择训练目标</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                  {GOALS.map((g) => (
                    <button key={g.id} className={`gym-chip ${goal === g.id ? 'is-active' : ''}`} onClick={() => setGoal(g.id)}>
                      {g.emoji} {g.label}
                    </button>
                  ))}
                </div>
                <div style={labelText}>水平</div>
                <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                  {LEVELS.map((l) => (
                    <button key={l.id} className={`gym-chip ${level === l.id ? 'is-active' : ''}`} onClick={() => setLevel(l.id)}>{l.label}</button>
                  ))}
                </div>
                <div style={labelText}>时长（分钟）：{duration}</div>
                <input type="range" min={15} max={90} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ width: '100%' }} />
                <button onClick={() => void generatePlan()} disabled={busy} style={primaryBtn}>
                  <Sparkles size={13} /> {busy ? '制定中…' : '生成训练计划'}
                </button>
              </div>

              {plan && (
                <div className="gym-card">
                  <div style={{ color: ACCENT, fontWeight: 700, fontSize: 15 }}>{plan.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)', margin: '4px 0 8px' }}>{plan.description} · 约 {plan.estimatedMinutes} 分钟</div>
                  <div className="gym-progress" style={{ marginBottom: 10 }}><div className="gym-progress__fill" style={{ width: `${progressPct}%` }} /></div>
                  <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.48)', marginBottom: 8 }}>已完成 {doneCount}/{plan.exercises.length}</div>
                  {plan.exercises.map((ex, i) => {
                    const done = doneExercises[ex.id]
                    return (
                      <div key={ex.id} className={`gym-exercise ${done ? 'is-done' : ''}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <b style={{ fontSize: 13 }}>{i + 1}. {ex.name}</b>
                          {done
                            ? <CheckCircle2 size={15} color={ACCENT} />
                            : <button style={miniBtn} onClick={() => startExercise(ex)}>开始一组</button>}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.48)', marginTop: 4 }}>
                          {ex.sets} 组 × {ex.reps} 次 · 休息 {ex.restSeconds}s · 器械 {EQUIPMENT_INFO[ex.equipment ?? 'dumbbell'].name}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'rgba(237,237,240,0.7)', marginTop: 4 }}>要领：{ex.tips}</div>
                        <div style={{ fontSize: 11.5, color: '#e0a0a0', marginTop: 2 }}>安全：{ex.safety}</div>
                      </div>
                    )
                  })}
                  {planComplete && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'rgba(79,179,165,0.13)', textAlign: 'center' }}>
                      <Trophy size={18} color={ACCENT} style={{ margin: '0 auto 4px' }} />
                      <div style={{ fontSize: 13, color: ACCENT }}>🎉 整套计划完成！太赞了</div>
                      {lastCheckinId && <button style={{ ...secBtn, marginTop: 6 }} onClick={() => void publishCheckin(lastCheckinId)}><Flag size={12} /> 发布到广场</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== 功能2：器械互动 ===== */}
          {tab === 'equipment' && (
            <div>
              <div className="gym-card">
                <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.48)' }}>点击 3D 场景中的器械，或从下方选择一个开始训练。</div>
              </div>
              {(Object.keys(EQUIPMENT_INFO) as GymEquipmentId[]).map((eq) => {
                const info = EQUIPMENT_INFO[eq]
                return (
                  <div key={eq} className={`gym-exercise ${selectedEquip === eq ? 'is-current' : ''}`}
                    onClick={() => { setSelectedEquip(eq); sendPresence(eq) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b style={{ fontSize: 13 }}>{info.name}</b>
                      <button style={miniBtn} onClick={(e) => { e.stopPropagation(); setSelectedEquip(eq); startEquipment(eq) }}>开始训练</button>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.48)', marginTop: 3 }}>
                      {info.kind === 'reps' ? `目标 ${info.target} 次` : `时长 ${info.target} 秒`}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'rgba(237,237,240,0.7)', marginTop: 3 }}>要领：{info.tips}</div>
                    <div style={{ fontSize: 11.5, color: '#e0a0a0' }}>安全：{info.safety}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ===== 功能3：名人教练 ===== */}
          {tab === 'celebrity' && (
            <div>
              <div className="gym-card">
                <div style={labelText}>选一位自律榜样带你练</div>
                {CELEBRITIES.slice(0, 6).map((c) => (
                  <button key={c.id} className={`gym-celeb-pick ${celebId === c.id ? 'is-active' : ''}`} onClick={() => setCelebId(c.id)}>
                    <img src={c.portrait} alt={c.name} />
                    <span><b>{c.name}</b><br /><small style={{ color: 'rgba(237,237,240,0.48)' }}>{c.title}</small></span>
                  </button>
                ))}
                <button onClick={() => void celebrityCoach()} disabled={busy} style={primaryBtn}>
                  <Volume2 size={13} /> {busy ? '教练思考中…' : '求一句健身打气'}
                </button>
              </div>
              {celebReply && (
                <div className="gym-card">
                  <div style={{ color: ACCENT, fontSize: 12, marginBottom: 6 }}>{celebName} 说：</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(237,237,240,0.9)' }}>“{celebReply}”</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <TtsPlayButton text={celebReply} voice={resolveCharacterVoice(celebId)} />
                    <button style={secBtn} onClick={() => { setSavedQuote(celebReply); flash('已保存金句，发布时带上它') }}>
                      <Quote size={12} /> 收藏金句
                    </button>
                    <button style={secBtn} onClick={() => void celebrityChallenge()}>
                      <Flag size={12} /> 接受挑战（20 深蹲）
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 功能4：多人云健身 ===== */}
          {tab === 'multiplayer' && (
            <div>
              <div className="gym-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>在线健身伙伴（{remotePlayers.length + 1}）</b>
                  <button style={primaryBtn} onClick={sendCheer}><Megaphone size={13} /> 加油</button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="gym-player-row"><b style={{ color: ACCENT }}>{user?.nickname ?? '我'}</b><span style={{ color: 'rgba(237,237,240,0.48)' }}>· 正在健身房</span></div>
                  {remotePlayers.map((p) => (
                    <div key={p.userId} className="gym-player-row">
                      <b>{p.nickname}</b><span style={{ color: 'rgba(237,237,240,0.48)' }}>{p.activity ? `· ${p.activity}` : '· 训练中'}</span>
                      <button style={{ ...miniBtn, marginLeft: 'auto' }} onClick={() => void send(JSON.stringify({ type: 'chat', text: `${p.nickname} 加油！` }))}>回加油</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="gym-card">
                <div style={labelText}>最近打卡</div>
                {recentCheckins.length === 0 && <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>还没有人打卡，做第一个！</div>}
                {recentCheckins.map((r, i) => (
                  <div key={i} className="gym-player-row"><b>{r.nickname}</b> 完成了「{r.exerciseName}」</div>
                ))}
              </div>
            </div>
          )}

          {/* ===== 功能5：训练记录 ===== */}
          {tab === 'records' && (
            <div>
              <div className="gym-stat-grid">
                <div className="gym-stat"><div className="gym-stat__num">{stats?.currentStreak ?? 0}</div><div className="gym-stat__label">连续天数</div></div>
                <div className="gym-stat"><div className="gym-stat__num">{stats?.longestStreak ?? 0}</div><div className="gym-stat__label">最长连续</div></div>
                <div className="gym-stat"><div className="gym-stat__num">{stats?.totalCheckins ?? 0}</div><div className="gym-stat__label">累计打卡</div></div>
                <div className="gym-stat"><div className="gym-stat__num">{stats?.totalMinutes ?? 0}</div><div className="gym-stat__label">累计分钟</div></div>
              </div>
              <div className="gym-card">
                <div style={labelText}>成就徽章</div>
                <div className="gym-badge-grid">
                  {achievements.map((a) => (
                    <div key={a.id} className={`gym-badge ${a.unlockedAt ? 'is-unlocked' : ''}`}>
                      <div className="gym-badge__emoji">{a.emoji}</div>
                      <div className="gym-badge__name">{a.name}</div>
                    </div>
                  ))}
                  {achievements.length === 0 && <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)', gridColumn: '1/-1' }}>完成打卡解锁成就</div>}
                </div>
              </div>
              <div className="gym-card">
                <div style={labelText}>最近打卡</div>
                {checkins.map((c) => (
                  <div key={c.id} className="gym-checkin-row">
                    <div>
                      <b>{c.exerciseName ?? '训练'}</b>
                      <div style={{ color: 'rgba(237,237,240,0.48)', fontSize: 11 }}>
                        {c.setsCompleted}组 · {c.repsCompleted > 0 ? `${c.repsCompleted}次` : `${c.durationSeconds}秒`} · {new Date(c.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button style={miniBtn} onClick={() => void publishCheckin(c.id)}>发布广场</button>
                  </div>
                ))}
                {checkins.length === 0 && <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.48)' }}>还没有打卡记录</div>}
              </div>
            </div>
          )}

          {error && <div style={{ color: '#e08a8a', fontSize: 12, marginTop: 8 }}>{error}</div>}
          {note && <div style={{ color: ACCENT, fontSize: 12 }}>{note}</div>}
        </aside>

        {/* 右侧：3D 场景 */}
        <main style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(237,237,240,0.48)' }}>健身房布置中…</div>}>
            <GymView
              onSelect={(eq) => { setSelectedEquip(eq); setTab('equipment'); sendPresence(eq) }}
              players={remotePlayers}
              cheers={cheers}
            />
          </Suspense>
          <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 11, color: 'rgba(237,237,240,0.3)' }}>
            拖动旋转 · 滚轮缩放 · 点击器械开始训练
          </div>

          {/* 训练大数字浮层 */}
          {session && (
            <div className="gym-workout-overlay">
              <div className="gym-workout-label">{session.label}</div>
              <div className="gym-workout-num">
                {session.kind === 'reps' ? `${session.current}/${session.target}` : `${session.current}s`}
              </div>
              <button style={{ ...secBtn, pointerEvents: 'auto' }} onClick={() => setSession(null)}>放弃本组</button>
            </div>
          )}
          {toast && <div className="gym-toast">{toast}</div>}
        </main>
      </div>
    </div>
  )
}

// ===== 样式常量 =====
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#EDEDF0', borderRadius: 8, padding: '5px 9px', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = { ...iconBtn, fontSize: 12, color: 'rgba(237,237,240,0.7)' }
const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '7px 4px', borderRadius: 9, cursor: 'pointer', fontSize: 12,
  border: active ? `1px solid ${ACCENT}` : '1px solid #2c3a33',
  background: active ? 'rgba(79,179,165,0.13)' : '#0F0F0F',
  color: active ? ACCENT : '#a8c0b0',
})
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, cursor: 'pointer',
  border: 'none', background: '#EDEDF0', color: '#0A0A0A', fontSize: 13, fontWeight: 700, marginTop: 10,
}
const secBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(79,179,165,0.42)', background: 'transparent', color: ACCENT, fontSize: 12,
}
const miniBtn: React.CSSProperties = {
  ...secBtn, padding: '3px 9px', fontSize: 11, marginTop: 0,
}
const labelText: React.CSSProperties = { fontSize: 12, color: 'rgba(237,237,240,0.48)', marginBottom: 6 }
const onlineBadge: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: ACCENT,
  background: 'rgba(79,179,165,0.13)', borderRadius: 12, padding: '2px 10px',
}
