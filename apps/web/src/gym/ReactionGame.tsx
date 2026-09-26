// ===== M14 关1：反应关 ReactionTap =====
// 30s 内随机位置出现绿色圆圈，1.5s 内点中；命中越快分越高，漏点/点空 -1 滴血（共3滴）。
import { useEffect, useRef, useState, useCallback } from 'react'
import { scoreReactionHit, type StationResult } from '@balabala/shared'

interface FloatText { id: number; x: number; y: number; text: string; color: string }
interface Target { id: number; x: number; y: number; spawnAt: number }

interface Props {
  durationSec?: number
  maxLives?: number
  onComplete: (r: StationResult) => void
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

export default function ReactionGame({ durationSec = 30, maxLives = 3, onComplete }: Props) {
  const [remaining, setRemaining] = useState(durationSec)
  const [lives, setLives] = useState(maxLives)
  const [score, setScore] = useState(0)
  const [target, setTarget] = useState<Target | null>(null)
  const [floats, setFloats] = useState<FloatText[]>([])

  const doneRef = useRef(false)
  const hitCount = useRef(0)
  const missCount = useRef(0)
  const bestMs = useRef<number | undefined>(undefined)
  const scoreRef = useRef(0)
  const livesRef = useRef(maxLives)
  const targetRef = useRef<Target | null>(null)
  const missTimer = useRef<number | null>(null)
  const floatId = useRef(0)
  const spawnRef = useRef<() => void>(() => {})

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    if (missTimer.current) window.clearTimeout(missTimer.current)
    onComplete({
      kind: 'reaction',
      hits: hitCount.current,
      misses: missCount.current,
      bestMs: bestMs.current,
      score: scoreRef.current,
    })
  }, [onComplete])

  const spawn = useCallback(() => {
    if (doneRef.current || targetRef.current) return
    const t: Target = {
      id: Date.now() + Math.random(),
      x: rand(12, 88), // %
      y: rand(18, 82),
      spawnAt: performance.now(),
    }
    targetRef.current = t
    setTarget(t)
    // 1500ms 未点中 → 漏点掉血，然后安排下一个圈
    missTimer.current = window.setTimeout(() => {
      missCount.current += 1
      setLives((l) => {
        livesRef.current = l - 1
        return l - 1
      })
      targetRef.current = null
      setTarget(null)
      if (livesRef.current <= 0) { finish(); return }
      window.setTimeout(() => spawnRef.current(), rand(600, 1200))
    }, 1500)
  }, [finish])
  spawnRef.current = spawn

  // 主计时 + 生成循环
  useEffect(() => {
    const start = performance.now()
    const tick = window.setInterval(() => {
      const elapsed = performance.now() - start
      const left = Math.max(0, durationSec * 1000 - elapsed)
      setRemaining(Math.ceil(left / 1000))
      if (left <= 0) { window.clearInterval(tick); finish(); return }
      // 没有目标时，按随机间隔生成
      if (!targetRef.current) {
        // 立即生成第一个，之后由命中/漏点后安排
      }
    }, 100)
    // 开局立即出第一个圈
    const first = window.setTimeout(spawn, 500)
    return () => { window.clearInterval(tick); window.clearTimeout(first); if (missTimer.current) window.clearTimeout(missTimer.current) }
  }, [durationSec, finish, spawn])

  const addFloat = (x: number, y: number, text: string, color: string) => {
    const id = ++floatId.current
    setFloats((f) => [...f, { id, x, y, text, color }])
    window.setTimeout(() => setFloats((f) => f.filter((it) => it.id !== id)), 800)
  }

  const hitTarget = (e: React.MouseEvent) => {
    e.stopPropagation()
    const t = targetRef.current
    if (!t || doneRef.current) return
    if (missTimer.current) window.clearTimeout(missTimer.current)
    const reactionMs = performance.now() - t.spawnAt
    const pts = scoreReactionHit(reactionMs)
    scoreRef.current += pts
    hitCount.current += 1
    if (bestMs.current === undefined || reactionMs < bestMs.current) bestMs.current = reactionMs
    setScore(scoreRef.current)
    const arena = e.currentTarget.closest('.react-arena') as HTMLElement | null
    const rect = arena?.getBoundingClientRect()
    const px = rect ? ((e.clientX - rect.left) / rect.width) * 100 : t.x
    addFloat(px, t.y, `+${pts}`, '#4fb3a5')
    addFloat(px, t.y - 8, `${Math.round(reactionMs)}ms`, '#ededf0')
    targetRef.current = null
    setTarget(null)
    // 下一个圈随机间隔
    window.setTimeout(() => spawnRef.current(), rand(600, 1200))
  }

  const missTap = () => {
    if (doneRef.current) return
    // 点空（场上无圈时）扣血
    if (targetRef.current) return
    missCount.current += 1
    setLives((l) => { livesRef.current = l - 1; return l - 1 })
    if (livesRef.current <= 0) finish()
  }

  return (
    <div className="cc-stage">
      <div className="cc-station-label">第 1 关 · 反应力 REACTION</div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', marginBottom: 10 }}>
        <span className="cc-countdown">{remaining}s</span>
        <span className="cc-lives">{'❤️'.repeat(Math.max(0, lives))}{'🖤'.repeat(Math.max(0, maxLives - lives))}</span>
      </div>
      <div style={{ fontSize: 16, color: '#ffd600', fontWeight: 800 }}>分数 {score}</div>
      <div className="react-arena" onMouseDown={missTap}>
        {target && (
          <div
            className="react-target"
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
            onMouseDown={hitTarget}
          />
        )}
        {floats.map((f) => (
          <div key={f.id} className="cc-float" style={{ left: `${f.x}%`, top: `${f.y}%`, color: f.color }}>
            {f.text}
          </div>
        ))}
      </div>
      <div className="cc-hint">绿圈出现后 1.5 秒内点中，越快分越高；漏点或点空掉 1 滴血（共 3 滴）。</div>
    </div>
  )
}
