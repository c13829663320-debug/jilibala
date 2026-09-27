// ===== M14 关2：节奏关 RhythmTap =====
// 音符从右往左滚，到达中线时按空格/点击。Perfect ±50ms / Good ±150ms / Miss 0，连击加成。
// 判定与计分全部由 GymOrchestrator 裁决（复用 shared 纯函数）。
import { useEffect, useRef, useState, useCallback } from 'react'
import type { GymOrchestrator } from './engine'

interface Note { id: number; spawnAt: number; hitTime: number; judged: boolean; grade?: 'perfect' | 'good' | 'miss' }

interface Props {
  orch: GymOrchestrator
  durationSec?: number
}

const SPAWN_MS = 800
const TRAVEL_MS = 600

export default function RhythmGame({ orch, durationSec = 45 }: Props) {
  const [remaining, setRemaining] = useState(durationSec)
  const [, setFrame] = useState(0)
  const [gradePop, setGradePop] = useState<{ text: string; color: string; id: number } | null>(null)

  const doneRef = useRef(false)
  const notes = useRef<Note[]>([])
  const noteId = useRef(0)
  const startTime = useRef(0)
  const popId = useRef(0)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    orch.completeStation()
  }, [orch])

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
      notes.current.push({ id: ++noteId.current, spawnAt: now, hitTime: now + TRAVEL_MS, judged: false })
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
      // 自动漏判：音符过中线超过 150ms 仍未处理 → 引擎判 Miss（combo 清零）
      for (const n of notes.current) {
        if (!n.judged && now - n.hitTime > 150) {
          n.judged = true
          const res = orch.rhythmTap(now - n.hitTime)
          n.grade = res.grade
        }
      }
      setFrame((f) => f + 1)
      if (left <= 0) finish()
      else raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [durationSec, finish, orch])

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
    best.judged = true
    const res = orch.rhythmTap(now - best.hitTime)
    best.grade = res.grade
    if (res.grade === 'perfect') popGrade(`PERFECT +${res.points}`, '#ffd600')
    else if (res.grade === 'good') popGrade(`GOOD +${res.points}`, '#4fb3a5')
    else popGrade('MISS', '#e08a8a')
  }, [orch])

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
  const combo = orch.state.rhythm.combo

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
