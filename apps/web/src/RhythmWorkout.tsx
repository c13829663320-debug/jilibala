// P0：AI 教练 + 节奏点击带练（最小可用版）
// 三阶段：选教练/计划 -> 节奏点击（圆点摆到中央绿区时按空格/点击）-> 评分 S/A/B/C。
// 教练语音通过 /api/gym/workout/*/speak 取文本，再走既有 TTS 播放。
import { useCallback, useEffect, useRef, useState } from 'react'
import { playTts } from './tts'

const ACCENT = '#4fb3a5'
const BRAND_YELLOW = '#FFD60A'
const BG = '#0A0A0A'

export interface GymCoach {
  id: string; name: string; emoji: string; style: string; persona: string
}
export interface GymWorkoutPreset {
  id: string; name: string; emoji: string; targetReps: number; equipment: string
}
export interface GymWorkoutResult {
  score: number; grade: 'S' | 'A' | 'B' | 'C'
  rhythmHitRate: number; reps: number; targetReps: number; coachComment: string
}

type Stage = 'select' | 'workout' | 'finish'

const TRACK_W = 320          // 轨道宽度 px
const GREEN_HALF = 26        // 中央绿区半宽 px
const PERIOD_MS = 1100       // 圆点往返周期

export function RhythmWorkout({ userId, preview, onExit }: {
  userId: string
  preview?: 'coaches' | 'workout' | null
  onExit?: () => void
}) {
  const [stage, setStage] = useState<Stage>(preview === 'workout' ? 'workout' : 'select')
  const [coaches, setCoaches] = useState<GymCoach[]>([])
  const [presets, setPresets] = useState<GymWorkoutPreset[]>([])
  const [coachId, setCoachId] = useState('rock')
  const [presetId, setPresetId] = useState('pushup')

  const [sessionId, setSessionId] = useState('')
  const [reps, setReps] = useState(0)
  const [target, setTarget] = useState(20)
  const [coachName, setCoachName] = useState('')
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null)
  const [result, setResult] = useState<GymWorkoutResult | null>(null)
  const [coachText, setCoachText] = useState('')

  const dotRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const startTs = useRef<number>(0)
  const repsRef = useRef(0)
  const sessionRef = useRef('')
  const lastSpeakRep = useRef(0)

  // 拉取教练与计划
  useEffect(() => {
    if (preview === 'workout') {
      setTarget(20); setCoachName('巨石教练')
      return
    }
    fetch('/api/gym/coaches')
      .then((r) => r.json())
      .then((d) => { setCoaches(d.coaches ?? []); setPresets(d.presets ?? []) })
      .catch(() => { /* 后端未就绪 */ })
  }, [preview])

  const speak = useCallback(async (session: string, ev: 'start' | 'rep_good' | 'rep_miss' | 'halfway' | 'finish') => {
    if (preview === 'workout') return
    try {
      const res = await fetch(`/api/gym/workout/${encodeURIComponent(session)}/speak`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: ev }),
      })
      const d = await res.json() as { text?: string }
      if (d.text) { setCoachText(d.text); void playTts(d.text) }
    } catch { /* ignore */ }
  }, [preview])

  // 开始训练
  const begin = useCallback(async () => {
    const preset = presets.find((p) => p.id === presetId)
    const coach = coaches.find((c) => c.id === coachId)
    if (preview === 'workout') {
      setTarget(20); setCoachName('巨石教练'); setStage('workout'); return
    }
    if (!preset || !coach) return
    try {
      const res = await fetch('/api/gym/workout/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planId: preset.id, coachId: coach.id }),
      })
      const s = await res.json() as { sessionId: string; plan: { targetReps: number }; coach: { name: string } }
      sessionRef.current = s.sessionId
      setSessionId(s.sessionId)
      setTarget(s.plan.targetReps)
      setCoachName(s.coach.name)
      setStage('workout')
      void speak(s.sessionId, 'start')
    } catch { /* ignore */ }
  }, [presets, presets, coaches, coachId, presetId, userId, speak, preview])

  // 节奏圆点动画
  useEffect(() => {
    if (stage !== 'workout') return
    startTs.current = performance.now()
    const loop = (t: number) => {
      const phase = ((t - startTs.current) % PERIOD_MS) / PERIOD_MS // 0..1
      const x = Math.sin(phase * Math.PI * 2) // -1..1
      if (dotRef.current) dotRef.current.style.transform = `translateX(${x * (TRACK_W / 2 - 14)}px)`
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [stage])

  // 结束训练
  const finish = useCallback(async () => {
    if (preview === 'workout') {
      setResult({ score: 92, grade: 'S', rhythmHitRate: 0.9, reps: 20, targetReps: 20, coachComment: '完美的节奏！你就是行走的计时器！' })
      setStage('finish'); return
    }
    const sid = sessionRef.current
    if (!sid) { setStage('finish'); return }
    try {
      const res = await fetch(`/api/gym/workout/${encodeURIComponent(sid)}/finish`, { method: 'POST' })
      const r = await res.json() as GymWorkoutResult
      setResult(r)
      setStage('finish')
      void speak(sid, 'finish')
    } catch { setStage('finish') }
  }, [speak, preview])

  // 一次节奏点击
  const hit = useCallback(async () => {
    if (stage !== 'workout') return
    const el = dotRef.current
    if (!el) return
    // 读取圆点当前位移判断是否在绿区
    const match = /translateX\(([-\d.]+)px\)/.exec(el.style.transform)
    const x = match ? Number(match[1]) : 0
    const isGood = Math.abs(x) <= GREEN_HALF

    const newReps = repsRef.current + 1
    repsRef.current = newReps
    setReps(newReps)
    setFlash(isGood ? 'hit' : 'miss')
    window.setTimeout(() => setFlash(null), 220)

    if (!preview) {
      const sid = sessionRef.current
      if (sid) {
        try {
          await fetch(`/api/gym/workout/${encodeURIComponent(sid)}/hit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hit: isGood }),
          })
        } catch { /* ignore */ }
        // 教练语音：每隔几个 reps 报一次
        if (isGood && newReps - lastSpeakRep.current >= 3) {
          lastSpeakRep.current = newReps
          void speak(sid, newReps === Math.floor(target / 2) ? 'halfway' : 'rep_good')
        } else if (!isGood && newReps % 3 === 0) {
          void speak(sid, 'rep_miss')
        }
      }
    }
    if (newReps >= target) void finish()
  }, [stage, target, speak, finish, preview])

  // 空格键触发
  useEffect(() => {
    if (stage !== 'workout') return
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); void hit() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, hit])

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: BG, zIndex: 9000,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit', color: '#EDEDF0',
  }

  // ===== 选择阶段 =====
  if (stage === 'select') {
    return (
      <div style={overlay}>
        <button onClick={onExit} style={exitBtn}>✕ 退出</button>
        <h2 style={{ margin: 0, fontSize: 22, color: BRAND_YELLOW }}>🔥 节奏带练</h2>
        <p style={{ color: 'rgba(237,237,240,0.5)', fontSize: 13, margin: '6px 0 18px' }}>选一位 AI 教练，跟着节拍做动作</p>

        <div style={sectionTitle}>① 选教练</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          {(coaches.length ? coaches : [
            { id: 'rock', name: '巨石教练', emoji: '🪨', style: '硬核激励派', persona: '' },
            { id: 'yogi', name: '瑜伽大师', emoji: '🧘', style: '呼吸引导派', persona: '' },
            { id: 'pal', name: '邻家教练', emoji: '🙋', style: '轻松陪伴派', persona: '' },
          ]).map((c) => (
            <button key={c.id} onClick={() => setCoachId(c.id)} style={card(coachId === c.id)}>
              <div style={{ fontSize: 34 }}>{c.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: ACCENT }}>{c.style}</div>
            </button>
          ))}
        </div>

        <div style={sectionTitle}>② 选动作</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          {(presets.length ? presets : [
            { id: 'pushup', name: '俯卧撑', emoji: '💪', targetReps: 20 },
            { id: 'squat', name: '深蹲', emoji: '🦵', targetReps: 20 },
            { id: 'plank', name: '平板支撑', emoji: '🧎', targetReps: 30 },
          ]).map((p) => (
            <button key={p.id} onClick={() => setPresetId(p.id)} style={card(presetId === p.id)}>
              <div style={{ fontSize: 30 }}>{p.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(237,237,240,0.5)' }}>目标 {p.targetReps} 次</div>
            </button>
          ))}
        </div>

        <button onClick={() => void begin()} style={{ ...bigBtn, background: BRAND_YELLOW, color: '#000' }}>
          开始训练
        </button>
      </div>
    )
  }

  // ===== 训练阶段 =====
  if (stage === 'workout') {
    return (
      <div style={overlay}>
        <div style={{ fontSize: 13, color: 'rgba(237,237,240,0.5)', marginBottom: 6 }}>
          {coachName} 在你旁边 · 圆点摆到中央绿区时按空格/点击
        </div>
        <div style={{ fontSize: 56, fontWeight: 800, color: flash === 'hit' ? ACCENT : flash === 'miss' ? '#ff5566' : '#EDEDF0' }}>
          {reps}<span style={{ fontSize: 22, color: 'rgba(237,237,240,0.4)' }}>/{target}</span>
        </div>

        {/* 节奏轨道 */}
        <div style={{
          position: 'relative', width: TRACK_W, height: 56, marginTop: 18, marginBottom: 18,
          background: '#141414', borderRadius: 28, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {/* 中央绿区 */}
          <div style={{
            position: 'absolute', left: `calc(50% - ${GREEN_HALF}px)`, top: 0, width: GREEN_HALF * 2, height: '100%',
            background: 'rgba(79,179,165,0.25)', borderRadius: 28,
          }} />
          {/* 摆动圆点 */}
          <div ref={dotRef} style={{
            position: 'absolute', left: '50%', top: '50%', width: 22, height: 22, marginTop: -11, marginLeft: -11,
            borderRadius: '50%', background: BRAND_YELLOW, boxShadow: '0 0 12px rgba(255,214,10,0.8)',
          }} />
        </div>

        <button onClick={() => void hit()} style={{ ...bigBtn, background: flash === 'hit' ? ACCENT : flash === 'miss' ? '#ff5566' : '#EDEDF0', color: '#000' }}>
          做动作（空格）
        </button>

        {/* 进度条 */}
        <div style={{ width: TRACK_W, height: 6, background: '#1a1a1a', borderRadius: 3, marginTop: 18 }}>
          <div style={{ width: `${Math.round((reps / target) * 100)}%`, height: '100%', background: ACCENT, borderRadius: 3 }} />
        </div>
        {coachText && <div style={{ marginTop: 14, fontSize: 13, color: BRAND_YELLOW, maxWidth: 320, textAlign: 'center' }}>“{coachText}”</div>}
      </div>
    )
  }

  // ===== 完成阶段 =====
  return (
    <div style={overlay}>
      <div style={{ fontSize: 56 }}>{result?.grade === 'S' ? '🏆' : result?.grade === 'A' ? '🎉' : result?.grade === 'B' ? '👍' : '💪'}</div>
      <div style={{ fontSize: 48, fontWeight: 800, color: BRAND_YELLOW }}>{result?.grade ?? 'C'}</div>
      <div style={{ fontSize: 14, color: 'rgba(237,237,240,0.6)' }}>得分 {result?.score ?? 0} · 节奏命中率 {Math.round((result?.rhythmHitRate ?? 0) * 100)}%</div>
      <div style={{ marginTop: 14, padding: '12px 18px', background: '#141414', borderRadius: 10, maxWidth: 340, fontSize: 14 }}>
        {coachName}：{result?.coachComment ?? '训练完成！'}
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button onClick={() => { setStage('select'); setReps(0); repsRef.current = 0; setResult(null) }} style={bigBtn}>再来一组</button>
        {onExit && <button onClick={onExit} style={{ ...bigBtn, background: '#1a1a1a', color: '#EDEDF0' }}>返回健身房</button>}
      </div>
    </div>
  )
}

const exitBtn: React.CSSProperties = {
  position: 'absolute', top: 14, right: 14, background: '#1a1a1a', color: '#EDEDF0',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: ACCENT, marginBottom: 8 }
const card = (active: boolean): React.CSSProperties => ({
  width: 120, padding: '14px 8px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
  border: active ? `2px solid ${BRAND_YELLOW}` : '1px solid #2c3a33',
  background: active ? 'rgba(255,214,10,0.08)' : '#0F0F0F', color: '#EDEDF0',
})
const bigBtn: React.CSSProperties = {
  padding: '12px 28px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700,
}
