import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CELEBRITIES, getCelebrity, type User } from '@balabala/shared'
import { Sparkles } from 'lucide-react'
import { fetchMyCharacters, type UiCharacter } from './custom-characters'

const LS_USER_ID = 'balabala.userId'

type AvatarType = User['avatarType']

type IdentityPhase = 'loading' | 'setup' | 'ready'

interface IdentityContextValue {
  user: User | null
  phase: IdentityPhase
  /** true when we're waiting for the user to complete the setup modal */
  isNew: boolean
  updateProfile: (nickname: string, avatarType: AvatarType, avatarRef: string) => Promise<void>
}

const IdentityContext = createContext<IdentityContextValue>({
  user: null,
  phase: 'loading',
  isNew: false,
  updateProfile: async () => {},
})

export function useIdentity() {
  return useContext(IdentityContext)
}

/* ---------- avatar color helpers ---------- */
function hashColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 55%)`
}

/* ---------- setup modal ---------- */
function SetupModal({ userId, onSubmit }: { userId?: string; onSubmit: (nickname: string, avatarType: AvatarType, avatarRef: string) => Promise<void> }) {
  const [nickname, setNickname] = useState('')
  const [avatarType, setAvatarType] = useState<AvatarType>('capsule')
  const [celebrityId, setCelebrityId] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [customCharId, setCustomCharId] = useState('')
  const [myCharacters, setMyCharacters] = useState<UiCharacter[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 拉取「我的人物」，供自定义化身选择
  useEffect(() => {
    if (!userId) return
    let alive = true
    fetchMyCharacters(userId).then((list) => { if (alive) setMyCharacters(list) })
    return () => { alive = false }
  }, [userId])

  const handleSubmit = async () => {
    const name = nickname.trim() || '我'
    if (avatarType === 'celebrity' && !celebrityId) {
      setError('请选择一位名人作为化身')
      return
    }
    if (avatarType === 'custom' && myCharacters.length > 0 && !customCharId && !customPrompt.trim()) {
      setError('请选择一个自定义人物作为化身，或填写描述')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const avatarRef =
        avatarType === 'celebrity' ? celebrityId
        : avatarType === 'custom' ? (customCharId || customPrompt.trim())
        : ''
      await onSubmit(name, avatarType, avatarRef)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建身份失败')
    } finally {
      setSubmitting(false)
    }
  }

  const capsuleColors = ['#FFD600', '#FF6B6B', '#4ECDC4', '#A78BFA', '#60A5FA', '#F472B6', '#34D399', '#FB923C']

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(10,10,10,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 32,
        maxWidth: 480, width: '100%', color: '#f4f2ec', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FFD600', fontSize: 13, fontWeight: 600, letterSpacing: 2, marginBottom: 8 }}>
            <Sparkles size={14} /> WELCOME TO BALA BALA
          </div>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>创建你的身份</h2>
          <p style={{ margin: '8px 0 0', color: '#9a9c92', fontSize: 14 }}>起个昵称，选一个化身，开始趣味庭审之旅。</p>
        </div>

        {/* nickname */}
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 13, color: '#9a9c92', marginBottom: 6 }}>昵称</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={12}
            placeholder="给自己起个名字…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 8,
              border: '1px solid #444', background: '#0d0d0d', color: '#f4f2ec', fontSize: 15, outline: 'none',
            }}
          />
        </label>

        {/* avatar type */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 13, color: '#9a9c92', marginBottom: 8 }}>选择化身</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              { id: 'capsule' as const, label: '胶囊' },
              { id: 'celebrity' as const, label: '名人' },
              { id: 'custom' as const, label: '自定义' },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAvatarType(opt.id)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                  border: avatarType === opt.id ? '1px solid #FFD600' : '1px solid #444',
                  background: avatarType === opt.id ? 'rgba(255,214,0,0.08)' : '#0d0d0d',
                  color: avatarType === opt.id ? '#FFD600' : '#9a9c92', fontSize: 14, fontWeight: 600,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* capsule preview */}
        {avatarType === 'capsule' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, justifyContent: 'center' }}>
            {capsuleColors.map((c) => (
              <div key={c} style={{
                width: 36, height: 52, borderRadius: 18, background: c, opacity: 0.85,
                border: '2px solid transparent',
              }} />
            ))}
            <p style={{ width: '100%', textAlign: 'center', fontSize: 12, color: '#6a6d64', margin: '8px 0 0' }}>默认彩色胶囊，进入广场后自动分配颜色</p>
          </div>
        )}

        {/* celebrity picker */}
        {avatarType === 'celebrity' && (
          <div style={{
            maxHeight: 200, overflowY: 'auto', marginBottom: 16, padding: 8,
            background: '#0d0d0d', borderRadius: 8, border: '1px solid #333',
          }}>
            {CELEBRITIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCelebrityId(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
                  borderRadius: 6, cursor: 'pointer', border: 'none', textAlign: 'left',
                  background: celebrityId === c.id ? 'rgba(255,214,0,0.1)' : 'transparent',
                  color: '#f4f2ec', marginBottom: 2,
                }}
              >
                <img src={c.portrait} alt={c.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#6a6d64' }}>{c.title}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* custom prompt / 我的人物选择 */}
        {avatarType === 'custom' && (
          <div style={{ marginBottom: 16 }}>
            {myCharacters.length > 0 && (
              <div style={{
                maxHeight: 200, overflowY: 'auto', marginBottom: 10, padding: 8,
                background: '#0d0d0d', borderRadius: 8, border: '1px solid #333',
              }}>
                <div style={{ fontSize: 11, color: '#6a6d64', marginBottom: 6, padding: '0 4px' }}>选择你的自定义人物作为化身</div>
                {myCharacters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCustomCharId(c.id); setCustomPrompt('') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer', border: 'none', textAlign: 'left',
                      background: customCharId === c.id ? 'rgba(255,214,0,0.1)' : 'transparent',
                      color: '#f4f2ec', marginBottom: 2,
                    }}
                  >
                    {c.portrait ? (
                      <img src={c.portrait} alt={c.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#3a2f5a', fontSize: 13, color: '#FFD600' }}>{c.name[0]}</span>
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: '#6a6d64' }}>{c.title}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <input
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); if (e.target.value) setCustomCharId('') }}
              maxLength={60}
              placeholder={myCharacters.length > 0 ? '或描述你的专属化身（可选）…' : '描述你的专属化身（可选）…'}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 8,
                border: '1px solid #444', background: '#0d0d0d', color: '#f4f2ec', fontSize: 14, outline: 'none',
              }}
            />
            <p style={{ fontSize: 12, color: '#6a6d64', margin: '6px 0 0' }}>
              {myCharacters.length > 0 ? '选中后将以你的自定义人物形象进入广场。' : '暂不强制生成 3D 模型，后续可在分身工坊完善。'}
            </p>
          </div>
        )}

        {error && <div style={{ color: '#FF6B6B', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</div>}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: submitting ? '#555' : '#FFD600', color: '#1a1a1a', fontSize: 15, fontWeight: 700,
          }}
        >
          {submitting ? '创建中…' : '进入广场'}
        </button>
      </div>
    </div>
  )
}

/* ---------- provider ---------- */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [phase, setPhase] = useState<IdentityPhase>('loading')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const createUser = useCallback(async (nickname: string, avatarType: AvatarType, avatarRef: string) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, avatarType, avatarRef }),
    })
    if (!res.ok) throw new Error('创建身份失败')
    const data = await res.json() as User & { userId: string }
    const newUser: User = {
      userId: data.userId,
      nickname: data.nickname,
      avatarType: data.avatarType,
      avatarRef: data.avatarRef,
      createdAt: data.createdAt,
    }
    try { window.localStorage.setItem(LS_USER_ID, newUser.userId) } catch { /* ignore */ }
    if (mountedRef.current) {
      setUser(newUser)
      setPhase('ready')
    }
  }, [])

  // On mount: read userId, fetch profile
  useEffect(() => {
    let storedId = ''
    try { storedId = window.localStorage.getItem(LS_USER_ID) ?? '' } catch { /* ignore */ }
    if (!storedId) {
      if (mountedRef.current) setPhase('setup')
      return
    }
    fetch(`/api/users/${encodeURIComponent(storedId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (mountedRef.current) setPhase('setup')
          return
        }
        if (!res.ok) throw new Error('加载用户资料失败')
        const data = await res.json() as User
        if (mountedRef.current) {
          setUser(data)
          setPhase('ready')
        }
      })
      .catch(() => { if (mountedRef.current) setPhase('setup') })
  }, [])

  const updateProfile = useCallback(async (nickname: string, avatarType: AvatarType, avatarRef: string) => {
    if (!user) return
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.userId, nickname, avatarType, avatarRef }),
    })
    if (!res.ok) throw new Error('更新资料失败')
    const data = await res.json() as User
    if (mountedRef.current) setUser(data)
  }, [user])

  const value: IdentityContextValue = {
    user,
    phase,
    isNew: phase === 'setup',
    updateProfile,
  }

  return (
    <IdentityContext.Provider value={value}>
      {children}
      {phase === 'setup' && <SetupModal userId={user?.userId} onSubmit={createUser} />}
    </IdentityContext.Provider>
  )
}

export { hashColor, getCelebrity }
