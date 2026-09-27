// R5: 未成年人保护 · 年龄声明弹窗 + 青少年模式标识
// 首次进入时自报年龄段（localStorage + 后端 session）。
// 隐私：不收集真实姓名/手机号；用户 ID 为随机 UUID（见 identity.tsx）。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useIdentity } from '../identity'

export type AgeBand = 'under14' | 'minor14to17' | 'adult'

const LS_AGE = 'balabala.ageBand'

type AgeGateValue = {
  band: AgeBand | 'unset'
  minor: boolean
  ugcAllowed: boolean
  nightRestricted: boolean
  message?: string
}

const AgeGateContext = createContext<AgeGateValue>({
  band: 'unset', minor: false, ugcAllowed: true, nightRestricted: false,
})

export function useAgeGate() {
  return useContext(AgeGateContext)
}

function readStoredBand(): AgeBand | null {
  try {
    const v = window.localStorage.getItem(LS_AGE)
    if (v === 'under14' || v === 'minor14to17' || v === 'adult') return v
  } catch { /* ignore */ }
  return null
}

export function AgeGateProvider({ children }: { children: ReactNode }) {
  const { user } = useIdentity()
  const [band, setBand] = useState<AgeBand | 'unset'>(() => readStoredBand() ?? 'unset')
  const [status, setStatus] = useState<{ ugcAllowed: boolean; nightRestricted: boolean; message?: string }>({
    ugcAllowed: true, nightRestricted: false,
  })
  const [showModal, setShowModal] = useState(false)

  // 首次：已登录但未声明年龄 → 弹窗
  useEffect(() => {
    if (!user) return
    if (band === 'unset') { setShowModal(true); return }
    void syncStatus(user.userId, band)
  }, [user, band])

  async function syncStatus(userId: string, b: AgeBand) {
    try {
      const res = await fetch(`/api/age-gate/status?userId=${encodeURIComponent(userId)}`)
      if (res.ok) {
        const data = await res.json() as { ugcAllowed: boolean; nightRestricted: boolean; message?: string }
        setStatus(data)
      }
    } catch { /* offline: 用本地推断 */ }
  }

  async function declare(b: AgeBand) {
    if (!user) return
    try {
      await fetch('/api/age-gate/declare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, band: b }),
      })
    } catch { /* 仍在本地记录，避免反复弹窗 */ }
    try { window.localStorage.setItem(LS_AGE, b) } catch { /* ignore */ }
    setBand(b)
    setShowModal(false)
    await syncStatus(user.userId, b)
  }

  const minor = band === 'under14' || band === 'minor14to17'
  const value: AgeGateValue = {
    band,
    minor,
    ugcAllowed: band === 'under14' ? false : status.ugcAllowed,
    nightRestricted: status.nightRestricted,
    message: status.message,
  }

  return (
    <AgeGateContext.Provider value={value}>
      {children}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100001, background: 'rgba(10,10,10,0.96)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 28,
            maxWidth: 420, width: '100%', color: '#f4f2ec',
          }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>请确认你的年龄段</h2>
            <p style={{ margin: '0 0 20px', color: '#9a9c92', fontSize: 13, lineHeight: 1.6 }}>
              为保护未成年人，未满 14 岁的用户仅可浏览内容；青少年用户将开启青少年模式。我们不会收集你的真实姓名或手机号。
            </p>
            {([
              { id: 'under14' as const, label: '未满 14 岁', desc: '仅可浏览，建议家长陪同' },
              { id: 'minor14to17' as const, label: '14 - 17 岁', desc: '青少年模式，夜间提示休息' },
              { id: 'adult' as const, label: '18 岁及以上', desc: '正常使用全部功能' },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void declare(opt.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 10,
                  padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid #444', background: '#0d0d0d', color: '#f4f2ec',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 600 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: '#8a8d82', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </AgeGateContext.Provider>
  )
}

/** 青少年模式标识小标签。 */
export function MinorBadge() {
  const { minor } = useAgeGate()
  if (!minor) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: '#4fb3a5', background: 'rgba(79,179,165,0.12)',
      border: '1px solid rgba(79,179,165,0.4)', borderRadius: 999, padding: '1px 8px', marginLeft: 6,
    }}>
      青少年模式
    </span>
  )
}
