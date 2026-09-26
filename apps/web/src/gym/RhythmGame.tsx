// ===== M14 关2：节奏关 RhythmTap =====
// 音符从右往左滚，到达中线时按空格/点击。Perfect ±50ms / Good ±150ms / Miss 0，连击加成。
import { useEffect, useRef, useState, useCallback } from 'react'
import { judgeRhythm, rhythmPoints, type StationResult } from '@balabala/shared'

interface Note { id: number; spawnAt: number; hitTime: number; judged: boolean; grade?: 'perfect' | 'good' | 'miss' }

interface Props {
  durationSec?: number
  onComplete: (r: StationResult) => void
}

const SPAWN_MS = 800
const TRAVEL_MS = 600

export default function RhythmGame({ durationSec = 45, onComplete }: Props) {
  const [remaining, setRemaining] = useState(durationSec)
  const [, setFrame] = useState(0)
  const [gradePop, setGradePop] = useState<{ text: string; color: string; id: number } | null>(null)
  const [combo, setCombo] = useState(0)

  const doneRef = useRef(false)
  const notes = useRef<Note[]>([])
  const noteId = useRef(0)
  const scoreRef = useRef(0)
  const perfects = useRef(0)
  const goods = useRef(0)
  const misses = useRef(0)
  const comboRef = useRef(0)
  const maxCombo = useRef(0)
  const startTime = useRef(0)
  const popId = useRef(0)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onComplete({
      kind: 'rhythm',
      hits: perfects.current + goods.current,
      misses: misses.current,
      maxCombo: maxCombo.current,
      score: scoreRef.current,
    })
  }, [onComplete])

  const popGrade = (text: string, color: string) => {
    const id = ++popId.current
    setGradePop({ text, color, id })
    window.setTimeout(() => setGradePop((g) => (g?.id === id ? null : g)), 600)
  }

  // 生成音符（每 800ms）
  useEffect(() => {
    startTime.current = performance.now()
    const start = startTime.current
    const spawner = window.setInterval(() => {
      const now = performance.now()
      if (now - start > durationSec * 1000) { window.clearInterval(spawner); return }
      const spawnAt = now
      notes.current.push({ id: ++noteId.current, spawnAt, hitTime: spawnAt + TRAVEL_MS, judged: false })
    }, SPAWN_MS)
    return () => window.clearInterval(spawner)
  }, [durationSec])

  // 主循环：倒计时 + 自动漏判 + 重渲染
  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (doneRef.current) return
      const now = performance.now()
      const left = Math.max(0, durationSec * 1000 - (now - startTime.current))
      setRemaining(Math.ceil(left / 1000))
      // 自动漏判：音符过中线超过 150ms 仍未处理
      for (const n of notes.current) {
        if (!n.judged && now - n.hitTime > 150) {
          n.judged = true
          n.grade = 'miss'
          misses.current += 1
          comboRef.current = 0
          setCombo(0)
        }
      }
      setFrame((f) => f + 1)
      if (left <= 0) finish()
      else raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [durationSec, finish])

  const judgeInput = useCallback(() => {
    if (doneRef.current) return
    const now = performance.now()
    // 找最近的未判定音符
    let best: Note | null = null
    let bestDist = Infinity
    for (const n of notes.current) {
      if (n.judged) continue
      const d = Math.abs(now - n.hitTime)
      if (d < bestDist) { bestDist = d; best = n }
    }
    if (!best || bestDist > 200) return // 没有可打的音符
    const offset = now - best.hitTime
    const grade = judgeRhythm(offset)
    best.judged = true
    best.grade = grade
    const pts = rhythmPoints(grade, comboRef.current)
    scoreRef.current += pts
    if (grade === 'perfect') {
      perfects.current += 1
      comboRef.current += 1
      maxCombo.current = Math.max(maxCombo.current, comboRef.current)
      setCombo(comboRef.current)
      popGrade(`PERFECT +${pts}`, '#ffd600')
    } else if (grade === 'good') {
      goods.current += 1
      comboRef.current = 0
      setCombo(0)
      popGrade(`GOOD +${pts}`, '#4fb3a5')
    } else {
      misses.current += 1
      comboRef.current = 0
      setCombo(0)
      popGrade('MISS', '#e08a8a')
    }
  }, [])

  // 空格 / 点击判定
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); judgeInput() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [judgeInput])

  const now = performance.now()
  const visible = notes.current.filter((n) => {
    const p = (now - n.spawnAt) / TRAVEL_MS
    return p >= 0 && p <= 2.2
  })

  return (
    <div className="cc-stage" onPointerDown={judgeInput}>
      <div className="cc-station-label">第 2 关 · 节奏 RHYTHM</div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', marginBottom: 10 }}>
        <span className="cc-countdown">{remaining}s</span>
        {combo > 1 && <span style={{ color: '#ffd600', fontWeight: 800 }}>COMBO ×{combo}</span>}
      </div>
      <div className="rhythm-track">
        <div className="rhythm-line" />
        {visible.map((n) => {
          const p = (now - n.spawnAt) / TRAVEL_MS
          const x = 100 - p * 50 // 100% -> 50%
          return (
            <div key={n.id} className={`rhythm-note ${n.judged ? 'judged' : ''}`} style={{ left: `${x}%` }} />
          )
        })}
        {gradePop && (
          <div key={gradePop.id} className="cc-grade" style={{ color: gradePop.color, position: 'absolute', left: '50%', top: '30%', transform: 'translateX(-50%)' }}>
            {gradePop.text}
          </div>
        )}
      </div>
      <div className="cc-hint">音符滚到<b style={{ color: '#ffd600' }}>中线</b>时按 <b>空格</b> 或点击屏幕。Perfect ±50ms，连续 Perfect 有连击加成。</div>
    </div>
  )
}
