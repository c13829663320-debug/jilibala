// ===== M14：90 秒三关电路总编排器 =====
// 状态机：selector → 三关依次 → results。每关结束异步请求名人教练点评（不阻塞下一关）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCelebrity } from '@balabala/shared'
import {
  circuitTotalScore, getCircuitTier, CIRCUIT_STATIONS,
  type StationResult,
} from '@balabala/shared'
import CircuitSelector from './CircuitSelector'
import ReactionGame from './ReactionGame'
import RhythmGame from './RhythmGame'
import PowerGame from './PowerGame'
import CircuitResults from './CircuitResults'
import CoachSidebar, { type CoachNote } from './CoachSidebar'
import { X } from 'lucide-react'
import './circuit.css'

interface Props {
  userId: string
  celebrityId: string
  onCelebrityChange: (id: string) => void
  onCheckin: (payload: {
    exerciseName?: string; setsCompleted: number; repsCompleted: number
    durationSeconds: number; note?: string
  }) => Promise<unknown>
  onExit: () => void
}

type Screen = 'selector' | 'station' | 'results'

export default function CircuitChallenge({ userId, celebrityId, onCelebrityChange, onCheckin, onExit }: Props) {
  const [screen, setScreen] = useState<Screen>('selector')
  const [stationIndex, setStationIndex] = useState(0)
  const [results, setResults] = useState<StationResult[]>([])
  const [notes, setNotes] = useState<CoachNote[]>([])
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const checkinFired = useRef(false)

  const celebrity = getCelebrity(celebrityId)
  const total = useMemo(() => circuitTotalScore(results), [results])
  const tier = useMemo(() => getCircuitTier(total), [total])

  // 每关结束：异步请求教练点评，不阻塞下一关
  const requestCoachNote = useCallback((celebrityIdArg: string, r: StationResult) => {
    setNotes((prev) => [...prev, { kind: r.kind, text: '', name: '', status: 'loading' }])
    fetch('/api/gym/circuit/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ celebrityId: celebrityIdArg, station: r }),
    })
      .then((res) => (res.ok ? res.json() as Promise<{ note: string; name: string }> : null))
      .then((data) => {
        setNotes((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.status === 'loading') {
            last.text = data?.note ?? '不错，继续！'
            last.name = data?.name ?? ''
            last.status = 'done'
          }
          return next
        })
      })
      .catch(() => {
        setNotes((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.status === 'loading') { last.text = '不错，继续！'; last.status = 'done' }
          return next
        })
      })
  }, [])

  const handleStationComplete = useCallback((r: StationResult) => {
    setResults((prev) => [...prev, r])
    // 异步点评（fire-and-forget，不阻塞下一关）
    requestCoachNote(celebrityId, r)
    if (stationIndex >= CIRCUIT_STATIONS.length - 1) {
      setScreen('results')
    } else {
      setStationIndex((i) => i + 1)
    }
  }, [stationIndex, celebrityId, requestCoachNote])

  // 进入结算屏后自动打卡一次（总分写进 note）
  useEffect(() => {
    if (screen !== 'results' || checkinFired.current) return
    checkinFired.current = true
    setChecking(true)
    const stationNames = results.map((r) => CIRCUIT_STATIONS.find((s) => s.kind === r.kind)?.title).join('+')
    void onCheckin({
      exerciseName: `三关电路（${stationNames}）`,
      setsCompleted: 1,
      repsCompleted: results.length,
      durationSeconds: 90,
      note: `电路挑战总分 ${total} · 段位 ${getCircuitTier(total)}`,
    }).then(() => setChecked(true)).finally(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  const start = () => { setStationIndex(0); setResults([]); setNotes([]); setScreen('station') }

  return (
    <div className="cc-root">
      <div className="cc-topbar">
        <span className="cc-topbar__title">⚡ 90s 三关电路</span>
        {screen === 'station' && (
          <span style={{ fontSize: 12, color: '#4fb3a5' }}>
            第 {stationIndex + 1}/{CIRCUIT_STATIONS.length} 关 · {CIRCUIT_STATIONS[stationIndex].title}
          </span>
        )}
        <span className="cc-topbar__score">{total} 分</span>
        <button onClick={onExit} style={{ background: 'transparent', border: '1px solid #333', color: '#ccc', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', display: 'inline-flex' }}>
          <X size={14} />
        </button>
      </div>

      <div className="cc-body">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {screen === 'selector' && (
            <CircuitSelector celebrity={celebrity} onCelebrityChange={onCelebrityChange} onStart={start} />
          )}

          {screen === 'station' && stationIndex === 0 && (
            <ReactionGame key="s0" onComplete={handleStationComplete} />
          )}
          {screen === 'station' && stationIndex === 1 && (
            <RhythmGame key="s1" onComplete={handleStationComplete} />
          )}
          {screen === 'station' && stationIndex === 2 && (
            <PowerGame key="s2" onComplete={handleStationComplete} />
          )}

          {screen === 'results' && (
            <CircuitResults
              results={results} total={total} tier={tier}
              checking={checking} checked={checked}
              onCheckin={() => { checkinFired.current = true; setChecking(true);
                void onCheckin({ exerciseName: '三关电路', setsCompleted: 1, repsCompleted: results.length, durationSeconds: 90, note: `电路挑战总分 ${total} · 段位 ${tier}` })
                  .then(() => setChecked(true)).finally(() => setChecking(false)) }}
              onExit={onExit}
            />
          )}
        </div>

        <CoachSidebar celebrity={celebrity} notes={notes} />
      </div>
    </div>
  )
}
