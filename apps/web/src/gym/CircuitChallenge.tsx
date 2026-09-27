// ===== M14：90 秒三关电路总编排器 =====
// 状态机由 GymOrchestrator（extends BaseOrchestrator）驱动：
// selector → reaction → rhythm → power → results。每关结束异步请求名人教练点评（不阻塞）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCelebrity, getCircuitTier, CIRCUIT_STATIONS, type StationResult } from '@balabala/shared'
import { GymOrchestrator } from './engine'
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
  // 引擎实例跨渲染稳定（同一局不重建，保证新手引导进度连续）。
  const orchRef = useRef<GymOrchestrator | null>(null)
  if (!orchRef.current) orchRef.current = new GymOrchestrator()
  const orch = orchRef.current

  const [screen, setScreen] = useState<Screen>('selector')
  const [stationIndex, setStationIndex] = useState(0)
  const [notes, setNotes] = useState<CoachNote[]>([])
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [, setTick] = useState(0)
  const checkinFired = useRef(false)

  const celebrity = getCelebrity(celebrityId)

  // 每关结束：异步请求教练点评（fire-and-forget，不阻塞下一关）
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

  // 订阅引擎事件：通用 tick 重渲染 + 关间流转 + 教练点评触发。
  useEffect(() => {
    const unsubTick = orch.on('*', () => setTick((t) => t + 1))
    const unsubDone = orch.on('station_completed', (ev) => {
      const result = (ev.payload as { result: StationResult }).result
      requestCoachNote(celebrityId, result)
    })
    const unsubResult = orch.on('game_result', () => {
      setScreen('results')
    })
    return () => { unsubTick(); unsubDone(); unsubResult() }
  }, [orch, celebrityId, requestCoachNote])

  // 关卡推进：关完成后由引擎发出 station_started（非末关），据此切下一关组件。
  useEffect(() => {
    const unsub = orch.on('station_started', (ev) => {
      setStationIndex((ev.payload as { index: number }).index)
    })
    return unsub
  }, [orch])

  // 首局：进入电路预览即开始新手引导（intro 步）。
  useEffect(() => {
    orch.startTutorial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const results = orch.state.stationResults
  const completedTotal = results.reduce((s, r) => s + r.score, 0)
  const tier = getCircuitTier(completedTotal)

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
      durationSeconds: 100,
      note: `电路挑战总分 ${completedTotal} · 段位 ${tier}`,
    }).then(() => setChecked(true)).finally(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  const start = () => {
    orch.setupChallenger(celebrityId, userId, '我')
    orch.startCircuit()
    setStationIndex(0)
    setScreen('station')
  }

  const tutorialStep = orch.tutorial.getCurrentStep()
  const tutorialNext = () => {
    orch.tutorial.next()
    if (orch.tutorial.isCompleted) orch.markTutorialDone()
    // intro 步的主按钮 = 开始训练：推进引导并开局
    if (tutorialStep?.id === 'gym-intro') start()
  }
  const tutorialSkip = () => {
    orch.skipTutorial()
    orch.markTutorialDone()
    if (tutorialStep?.id === 'gym-intro') start()
  }

  return (
    <div className="cc-root">
      <div className="cc-topbar">
        <span className="cc-topbar__title">⚡ 90s 三关电路</span>
        {screen === 'station' && (
          <span style={{ fontSize: 12, color: '#4fb3a5' }}>
            第 {stationIndex + 1}/{CIRCUIT_STATIONS.length} 关 · {CIRCUIT_STATIONS[stationIndex].title}
          </span>
        )}
        <span className="cc-topbar__score">{screen === 'results' ? completedTotal : orch.currentTotal()} 分</span>
        <button onClick={onExit} style={{ background: 'transparent', border: '1px solid #333', color: '#ccc', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', display: 'inline-flex' }}>
          <X size={14} />
        </button>
      </div>

      <div className="cc-body">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {screen === 'selector' && (
            <CircuitSelector
              celebrity={celebrity}
              dailyChallenge={orch.dailyChallenge}
              onCelebrityChange={onCelebrityChange}
              onStart={start}
            />
          )}

          {screen === 'station' && stationIndex === 0 && (
            <ReactionGame key="s0" orch={orch} />
          )}
          {screen === 'station' && stationIndex === 1 && (
            <RhythmGame key="s1" orch={orch} />
          )}
          {screen === 'station' && stationIndex === 2 && (
            <PowerGame key="s2" orch={orch} />
          )}

          {screen === 'results' && (
            <CircuitResults
              results={results} total={completedTotal} tier={tier}
              checking={checking} checked={checked}
              onCheckin={() => { checkinFired.current = true; setChecking(true);
                void onCheckin({ exerciseName: '三关电路', setsCompleted: 1, repsCompleted: results.length, durationSeconds: 100, note: `电路挑战总分 ${completedTotal} · 段位 ${tier}` })
                  .then(() => setChecked(true)).finally(() => setChecking(false)) }}
              onExit={onExit}
            />
          )}
        </div>

        <CoachSidebar celebrity={celebrity} notes={notes} />
      </div>

      {/* 新手引导浮层（可跳过，不阻断复玩） */}
      {tutorialStep && (
        <div className="cc-tutorial">
          <div className="cc-tutorial__card">
            <div style={{ fontSize: 12, color: '#4fb3a5', letterSpacing: 2 }}>新手引导 · {orch.tutorial.currentStepIndex + 1}/{orch.tutorial.steps.length}</div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0' }}>{tutorialStep.title}</div>
            <div style={{ fontSize: 13.5, color: 'rgba(237,237,240,0.8)', lineHeight: 1.6 }}>{tutorialStep.description}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="cc-btn--ghost cc-btn" style={{ padding: '6px 12px' }} onClick={tutorialSkip}>跳过引导</button>
              <button className="cc-btn" style={{ padding: '6px 12px' }} onClick={tutorialNext}>
                {tutorialStep.id === 'gym-intro' ? '⚡ 开始训练' : '我知道了'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
