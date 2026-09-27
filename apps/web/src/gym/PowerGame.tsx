// ===== M14 关3：力量关 PowerHold =====
// 蓄力条 0→100 匀速 1.2s 一轮循环，按住后在绿色区[80,90]松开，3 次取最好。
// 判定与计分由 GymOrchestrator 裁决（复用 shared 纯函数）。
import { useEffect, useRef, useState, useCallback } from 'react'
import type { GymOrchestrator } from './engine'

interface Props {
  orch: GymOrchestrator
  attempts?: number
}

const CYCLE_MS = 1200
const ZONE_LO = 80
const ZONE_HI = 90

export default function PowerGame({ orch, attempts = 3 }: Props) {
  const [, setFrame] = useState(0)
  const [pct, setPct] = useState(0)
  const [pop, setPop] = useState<{ text: string; color: string; id: number } | null>(null)

  const doneRef = useRef(false)
  const startRef = useRef(0)
  const armed = useRef(false)
  const popId = useRef(0)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    orch.completeStation()
  }, [orch])

  useEffect(() => {
    startRef.current = performance.now()
    let raf = 0
    const loop = () => {
      if (doneRef.current) return
      const p = ((performance.now() - startRef.current) % CYCLE_MS) / CYCLE_MS * 100
      setPct(p)
      setFrame((f) => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const doRelease = useCallback(() => {
    if (doneRef.current || !armed.current) return
    armed.current = false
    const p = ((performance.now() - startRef.current) % CYCLE_MS) / CYCLE_MS * 100
    const { power, isBest } = orch.powerRelease(p)
    const id = ++popId.current
    const inZone = p >= ZONE_LO && p <= ZONE_HI
    setPop({ text: `${Math.round(p)}% → ${power} 力量${isBest ? ' · 新纪录!' : ''}`, color: inZone ? '#4fe6a5' : '#ffd600', id })
    window.setTimeout(() => setPop((g) => (g?.id === id ? null : g)), 900)
    if (orch.state.power.attempts >= attempts) {
      window.setTimeout(finish, 700)
    }
  }, [orch, attempts, finish])

  const doArm = useCallback(() => {
    if (doneRef.current) return
    armed.current = true
  }, [])

  // 键盘空格：按住=蓄力，松开=释放
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); doArm() } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); doRelease() } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [doArm, doRelease])

  const best = orch.state.power.bestPower
  const round = Math.min(attempts, orch.state.power.attempts + 1)

  return (
    <div
      className="cc-stage"
      onPointerDown={doArm}
      onPointerUp={doRelease}
      style={{ userSelect: 'none', touchAction: 'none' }}
    >
      <div className="cc-station-label">第 3 关 · 力量 POWER</div>
      <div style={{ fontSize: 14, color: '#4fb3a5', marginBottom: 8 }}>第 {round}/{attempts} 次 · 最好 {best}</div>
      <div className="power-bar">
        <div className="power-bar__fill" style={{ width: `${pct}%` }} />
        <div className="power-bar__zone" style={{ left: `${ZONE_LO}%`, width: `${ZONE_HI - ZONE_LO}%` }} />
        <div className="power-bar__cursor" style={{ left: `${pct}%` }} />
      </div>
      <div style={{ height: 40, marginTop: 16 }}>
        {pop && <div key={pop.id} className="cc-grade" style={{ color: pop.color }}>{pop.text}</div>}
      </div>
      <div className="cc-hint">按住 <b>鼠标</b> 或 <b>空格</b>，在蓄力条进入<b style={{ color: '#4fe6a5' }}>绿色区 80-90%</b> 时松开。3 次取最好。</div>
    </div>
  )
}
