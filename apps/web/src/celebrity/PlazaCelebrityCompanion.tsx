// ===== R5: 广场偶遇陪伴（骨架） =====
// 管理「哪位名人正在跟随玩家逛广场」的状态；3D 渲染接线留最小接口。
// 云端无 WebGL：实际跟随渲染需真机确认，本组件只负责状态机 + 暴露给 Plaza3D 的订阅。
import { useCallback, useEffect, useState } from 'react'
import type { PlazaEncounter } from '@balabala/shared'

export interface CompanionState {
  /** 正在陪伴的名人 id；null = 无跟随。 */
  celebrityId: string | null
  encounter: PlazaEncounter | null
}

export interface PlazaCelebrityCompanionApi extends CompanionState {
  /** 玩家在广场偶遇并主动邀请 TA 陪伴。 */
  startCompanion: (celebrityId: string, greeting?: string) => void
  /** 结束陪伴（TA 离开广场）。 */
  stopCompanion: () => void
}

/**
 * 广场名人陪伴状态机。Plaza3D 渲染层订阅本 hook 的返回值：
 * 当 celebrityId 非空时，在玩家身后一个身位生成该名人化身并做简单跟随插值；
 * 本 hook 不直接碰 three，只提供状态与最小坐标（position 随玩家移动由 3D 层维护）。
 */
export function usePlazaCelebrityCompanion(): PlazaCelebrityCompanionApi {
  const [state, setState] = useState<CompanionState>({ celebrityId: null, encounter: null })

  const startCompanion = useCallback((celebrityId: string, greeting?: string) => {
    const encounter: PlazaEncounter = {
      encounterId: `enc-${Date.now()}`,
      celebrityId,
      spawnedAt: new Date().toISOString(),
      // 最小接线：3D 层据此把名人放在玩家身后；这里给一个中性初始位。
      position: { x: 0, y: 0, z: -1.5 },
      state: 'accompanying',
      greeting,
    }
    setState({ celebrityId, encounter })
  }, [])

  const stopCompanion = useCallback(() => {
    setState((prev) => ({
      celebrityId: null,
      encounter: prev.encounter ? { ...prev.encounter, state: 'finished' as const } : null,
    }))
  }, [])

  // 离开页面时清空陪伴状态，避免下次进入还挂着。
  useEffect(() => () => setState({ celebrityId: null, encounter: null }), [])

  return { ...state, startCompanion, stopCompanion }
}

/** 独立导出的展示用浮层（可选）：显示正在陪伴你的名人。 */
export function PlazaCelebrityHud({
  celebrityName,
  greeting,
  onStop,
}: {
  celebrityName: string
  greeting?: string
  onStop: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 50,
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(20,24,40,0.9)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        fontSize: 13,
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{celebrityName} 正在陪你逛广场</div>
      {greeting && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{greeting}</div>}
      <button
        type="button"
        onClick={onStop}
        style={{ marginTop: 8, fontSize: 12, padding: '4px 10px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer' }}
      >
        道别离开
      </button>
    </div>
  )
}

export default usePlazaCelebrityCompanion
