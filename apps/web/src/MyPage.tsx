import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Award, Bell, Camera, ChevronRight, Clock3, Download, Dumbbell, Film, FolderOpen,
  Gavel, MessageSquare, PenLine, Scale, Settings, Sparkles, ThumbsUp, Trash2,
  Users, Volume2, BadgeCheck, MessageCircle,
} from 'lucide-react'
import type { CertRecord as ApiCertRecord, MsgRecord as ApiMsgRecord, GymStats, GymAchievement } from '@balabala/shared'
import { useIdentity } from './identity'
import { useVoiceEnabled } from './voice-settings'
import './profile.css'

/* ---------- types ---------- */
type MyVerdict = {
  title?: string
  quote?: string
  charge?: string
  sentence?: string
  facts?: string
  plaintiffClaim?: string
  defense?: string
  judgeNote?: string
  caseNo?: string
}
type MyArchive = { id: string; input: string; createdAt?: string; updatedAt?: string; verdict?: MyVerdict }
type MyContent = {
  id: string; type: string; author: string; title: string; body?: string
  likes: number; dislikes: number; views: number
  comments: Array<{ id: string; author: string; text: string; createdAt: string }>
  createdAt: string
}
type CertRecord = {
  id: string; caseId: string; caseTitle: string
  verdict: string; charge?: string; date: string
}
type MsgRecord = {
  id: string; kind: 'court' | 'comment' | 'cert' | 'system'
  title: string; summary: string; time: string; read: boolean
}

export type MyPageProps = {
  onBack: () => void
  onCourt: (input?: string) => void
  onPlaza: () => void
  onVideo?: () => void
  onEnterGym?: () => void
  /** 自定义人物工坊（CustomCharacterStudio） */
  onCustomCharacter?: () => void
  /** 照片转 3D 分身（AvatarStudio，bodyLimit 20MB 已由后端处理） */
  onAvatarStudio?: () => void
  /** 案卷库（历史庭审记录） */
  onArchive?: () => void
}

/* ---------- storage helpers ---------- */
const LS_SOUND = 'balabala.sound'

const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch { return fallback }
}
const writeJSON = (key: string, value: unknown) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}
const fmtDate = (value?: string) => {
  if (!value) return '刚刚'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '近期'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}
const fmtDay = (value?: string) => {
  if (!value) return '——'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '——'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}
const shortText = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n)}…` : text)

/**
 * 读取用户选择的图片，居中裁剪并缩放到 256×256，统一铺白底，
 * 输出 JPEG dataURL（约 20–50KB），可直接作为 User.avatarRef 持久化。
 */
const fileToAvatarDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('读取图片失败'))
  reader.onload = () => {
    const img = new Image()
    img.onerror = () => reject(new Error('图片解码失败'))
    img.onload = () => {
      const S = 256
      const canvas = document.createElement('canvas')
      canvas.width = S; canvas.height = S
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('画布不可用')); return }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, S, S)
      const scale = Math.max(S / img.width, S / img.height)
      const w = img.width * scale, h = img.height * scale
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
})

/** Map API CertRecord to the local display shape (SVG uses `date`). */
const mapCert = (c: ApiCertRecord): CertRecord => ({
  id: c.id, caseId: c.caseId, caseTitle: c.caseTitle,
  verdict: c.verdict, charge: c.charge, date: c.createdAt,
})
/** Map API MsgRecord to the local display shape (UI uses `time`). */
const mapMsg = (m: ApiMsgRecord): MsgRecord => ({
  id: m.id, kind: m.kind, title: m.title, summary: m.summary,
  time: m.createdAt, read: m.read,
})

/* ---------- certificate SVG（趣味纪念证书，保留金色印章视觉） ---------- */
function CertificateSvg({ cert }: { cert: CertRecord }) {
  const logo = '/brand/balabala-mark-clean.jpg'
  return (
    <svg className="cert-svg" viewBox="0 0 900 1200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cert-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14120a" />
          <stop offset="1" stopColor="#0a0906" />
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#cert-bg)" />
      <rect x="34" y="34" width="832" height="1132" fill="none" stroke="#FFD600" strokeWidth="6" />
      <rect x="52" y="52" width="796" height="1096" fill="none" stroke="#FFD600" strokeWidth="1.5" opacity="0.7" />
      {[
        [60, 60], [840, 60], [60, 1140], [840, 1140],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="10" fill="none" stroke="#FFD600" strokeWidth="2" />
      ))}
      <image href={logo} x="390" y="110" width="120" height="120" preserveAspectRatio="xMidYMid meet" />
      <text x="450" y="290" textAnchor="middle" fill="#FFD600" fontSize="30" fontFamily="ui-monospace, monospace" letterSpacing="6">BALA BALA FUN COURT</text>
      <text x="450" y="340" textAnchor="middle" fill="#f4f2ec" fontSize="46" fontWeight="700">叽里呱啦趣味法庭颁发</text>
      <line x1="250" y1="380" x2="650" y2="380" stroke="#FFD600" strokeWidth="1" opacity="0.6" />
      <text x="450" y="440" textAnchor="middle" fill="#9a9c92" fontSize="22">兹证明下列案件已经完成趣味庭审</text>
      <text x="450" y="540" textAnchor="middle" fill="#f4f2ec" fontSize="40" fontWeight="700">{shortText(cert.caseTitle, 22)}</text>
      <text x="450" y="610" textAnchor="middle" fill="#FFD600" fontSize="26" fontStyle="italic">“{shortText(cert.verdict, 40)}”</text>
      {cert.charge && (
        <text x="450" y="680" textAnchor="middle" fill="#7e8178" fontSize="20">罪名认定：{shortText(cert.charge, 30)}</text>
      )}
      <text x="450" y="760" textAnchor="middle" fill="#7e8178" fontSize="20">判决日期：{fmtDay(cert.date)}</text>
      <text x="450" y="810" textAnchor="middle" fill="#7e8178" fontSize="20">证书编号：{cert.id}</text>
      <g transform="translate(450, 930)">
        <circle r="70" fill="none" stroke="#FFD600" strokeWidth="3" opacity="0.85" />
        <circle r="56" fill="none" stroke="#FFD600" strokeWidth="1" opacity="0.5" />
        <text y="-8" textAnchor="middle" fill="#FFD600" fontSize="22" fontWeight="700">叽里呱啦</text>
        <text y="22" textAnchor="middle" fill="#FFD600" fontSize="14" fontFamily="ui-monospace, monospace">· SEAL ·</text>
      </g>
      <text x="450" y="1080" textAnchor="middle" fill="#6a6d64" fontSize="16">本证书由 AI 趣味法庭生成，仅供娱乐纪念</text>
    </svg>
  )
}

/* ---------- main component ---------- */
export default function MyPage({ onBack, onCourt, onPlaza, onVideo, onEnterGym, onCustomCharacter, onAvatarStudio, onArchive }: MyPageProps) {
  const { user, updateProfile } = useIdentity()
  const userId = user?.userId ?? ''
  const [tab, setTab] = useState<'cases' | 'posts' | 'certs' | 'msgs' | 'settings'>('cases')
  const username = user?.nickname ?? '我'
  const [sound, setSound] = useState(() => (readJSON(LS_SOUND, 'on') as string) === 'on')
  const [voiceEnabled, setVoiceEnabled] = useVoiceEnabled()
  const [archives, setArchives] = useState<MyArchive[]>([])
  const [posts, setPosts] = useState<MyContent[]>([])
  const [loadingCases, setLoadingCases] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [openCaseId, setOpenCaseId] = useState<string | null>(null)
  const [certs, setCerts] = useState<CertRecord[]>([])
  const [msgs, setMsgs] = useState<MsgRecord[]>([])
  const [previewCert, setPreviewCert] = useState<CertRecord | null>(null)
  const [toast, setToast] = useState('')
  const [nameDraft, setNameDraft] = useState(username)
  const [gymStats, setGymStats] = useState<GymStats | null>(null)
  const [gymBadges, setGymBadges] = useState<GymAchievement[]>([])
  // 头像上传
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const isPhotoAvatar = user?.avatarType === 'photo' && Boolean(user.avatarRef)

  const onPickAvatar = async (file?: File) => {
    if (!file || !user) return
    setAvatarBusy(true)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      await updateProfile(user.nickname, 'photo', dataUrl)
      flash('头像已更新')
    } catch {
      flash('头像上传失败')
    } finally { setAvatarBusy(false) }
  }
  const resetAvatar = async () => {
    if (!user) return
    try { await updateProfile(user.nickname, 'capsule', ''); flash('已恢复默认头像') } catch { flash('操作失败') }
  }

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2000)
  }, [])

  // Sync nameDraft once the user profile loads
  useEffect(() => { if (user?.nickname) setNameDraft(user.nickname) }, [user?.nickname])

  /* load my cases */
  const loadCases = useCallback(async () => {
    if (!userId) return
    setLoadingCases(true)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/cases`)
      if (!res.ok) throw new Error('案卷加载失败')
      setArchives(await res.json() as MyArchive[])
    } catch {
      setArchives([])
    } finally { setLoadingCases(false) }
  }, [userId])

  /* load my published contents */
  const loadPosts = useCallback(async () => {
    if (!userId) return
    setLoadingPosts(true)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/contents`)
      if (!res.ok) throw new Error('内容加载失败')
      const json = await res.json() as { contents?: MyContent[] }
      const list = Array.isArray(json) ? (json as unknown as MyContent[]) : (json.contents ?? [])
      setPosts(list)
    } catch {
      setPosts([])
    } finally { setLoadingPosts(false) }
  }, [userId])

  /* load my certificates */
  const loadCerts = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/certificates`)
      if (!res.ok) return
      const list = await res.json() as ApiCertRecord[]
      setCerts(list.map(mapCert))
    } catch { /* ignore */ }
  }, [userId])

  /* load my messages */
  const loadMsgs = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/messages`)
      if (!res.ok) return
      const list = await res.json() as ApiMsgRecord[]
      setMsgs(list.map(mapMsg))
    } catch { /* ignore */ }
  }, [userId])

  useEffect(() => { void loadCases() }, [loadCases])
  useEffect(() => { void loadPosts() }, [loadPosts])
  useEffect(() => { void loadCerts() }, [loadCerts])
  useEffect(() => { void loadMsgs() }, [loadMsgs])

  /* load gym stats & achievements */
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      try {
        const [s, a] = await Promise.all([
          fetch(`/api/gym/stats/${encodeURIComponent(userId)}`).then((r) => (r.ok ? r.json() as Promise<GymStats> : null)),
          fetch(`/api/gym/achievements/${encodeURIComponent(userId)}`).then((r) => (r.ok ? r.json() as Promise<{ achievements: GymAchievement[] }> : null)),
        ])
        if (cancelled) return
        if (s) setGymStats(s)
        if (a) setGymBadges(a.achievements ?? [])
      } catch { /* 后端未就绪 */ }
    })()
    return () => { cancelled = true }
  }, [userId])

  const unread = useMemo(() => msgs.filter((m) => !m.read).length, [msgs])

  /* 等级：按参与庭审 / 证书 / 发布 / 打卡活跃度本地派生展示（后端 User 暂无 level 字段） */
  const activityScore = archives.length * 2 + certs.length * 3 + posts.length + (gymStats?.totalCheckins ?? 0)
  const level = Math.min(12, 1 + Math.floor(activityScore / 5))

  const generateCert = async (record: MyArchive) => {
    if (!userId) return
    const existing = certs.find((c) => c.caseId === record.id)
    if (existing) { setPreviewCert(existing); return }
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/certificates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: record.id,
          caseTitle: record.verdict?.title || shortText(record.input, 20),
          verdict: record.verdict?.quote || record.verdict?.sentence || record.input,
          charge: record.verdict?.charge,
        }),
      })
      if (!res.ok) throw new Error('证书创建失败')
      const created = mapCert(await res.json() as ApiCertRecord)
      setCerts((prev) => [created, ...prev])
      setPreviewCert(created)
      void loadMsgs()
      flash('证书已生成')
    } catch {
      flash('证书生成失败')
    }
  }

  const markRead = async (id: string) => {
    if (!userId) return
    setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)))
    try { await fetch(`/api/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/read`, { method: 'PUT' }) } catch { /* ignore */ }
  }
  const markAllRead = async () => {
    if (!userId) return
    setMsgs((prev) => prev.map((m) => ({ ...m, read: true })))
    try { await fetch(`/api/users/${encodeURIComponent(userId)}/messages/read-all`, { method: 'PUT' }) } catch { /* ignore */ }
  }

  const saveUsername = async () => {
    const v = nameDraft.trim() || '我'
    try {
      await updateProfile(v, user?.avatarType ?? 'capsule', user?.avatarRef ?? '')
      flash('用户名已保存')
    } catch {
      flash('保存失败')
    }
  }
  const toggleSound = () => {
    const next = !sound
    setSound(next)
    writeJSON(LS_SOUND, next ? 'on' : 'off')
  }
  const clearLocal = () => {
    if (!window.confirm('确定清除本地偏好设置吗？案件、证书与消息已保存在服务端。')) return
    try { window.localStorage.removeItem(LS_SOUND) } catch { /* ignore */ }
    setSound(true)
    flash('本地偏好已清除')
  }

  const downloadCert = (cert: CertRecord) => {
    const svgEl = document.getElementById(`cert-preview-svg`)
    if (!svgEl) return
    const source = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${cert.caseTitle}-证书.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  const TABS = [
    { id: 'cases' as const, label: '我参与的', icon: Gavel },
    { id: 'posts' as const, label: '我发布的', icon: PenLine },
    { id: 'certs' as const, label: '证书', icon: Award },
    { id: 'msgs' as const, label: '消息', icon: Bell, badge: unread },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ]

  return (
    <main className="profile-page">
      <section className="profile-content">
        {/* ---------- 身份卡 ---------- */}
        <div className="profile-hero">
          <div className="profile-hero-avatar">
            {isPhotoAvatar
              ? <img src={user.avatarRef} alt={username} />
              : (username || '我').trim().slice(0, 1).toUpperCase()}
            <span className="profile-online-dot" title="在线" />
          </div>
          <div className="profile-hero-meta">
            <h1>
              {username}
              <span className="profile-hero-level">Lv.{level}</span>
              <span className="profile-hero-id">ID · {userId.slice(0, 8).toUpperCase() || '——'}</span>
            </h1>
            <p>把生活里的小事，一桩桩过成有趣的判决。</p>
          </div>
          <div className="profile-hero-stats">
            <div><strong>{archives.length}</strong><span>参与庭审</span></div>
            <div><strong>{posts.length}</strong><span>发布观点</span></div>
            <div><strong>{certs.length}</strong><span>获得证书</span></div>
          </div>
        </div>

        {/* ---------- 功能入口网格（solid 卡片） ---------- */}
        <div className="profile-actions">
          {onCustomCharacter && (
            <button type="button" className="profile-action-card" onClick={onCustomCharacter}>
              <span className="profile-action-card__icon"><Users size={18} /></span>
              <span className="profile-action-card__text"><b>自定义人物</b><small>创建 / 编辑你的专属角色</small></span>
              <ChevronRight size={16} className="profile-action-card__chev" />
            </button>
          )}
          {onAvatarStudio && (
            <button type="button" className="profile-action-card" onClick={onAvatarStudio}>
              <span className="profile-action-card__icon"><Camera size={18} /></span>
              <span className="profile-action-card__text"><b>照片转 3D</b><small>上传照片生成 3D 分身</small></span>
              <ChevronRight size={16} className="profile-action-card__chev" />
            </button>
          )}
          {onVideo && (
            <button type="button" className="profile-action-card" onClick={onVideo}>
              <span className="profile-action-card__icon"><Film size={18} /></span>
              <span className="profile-action-card__text"><b>AI 视频工坊</b><small>文生视频 / 图生视频</small></span>
              <ChevronRight size={16} className="profile-action-card__chev" />
            </button>
          )}
          <button type="button" className="profile-action-card" onClick={() => onCourt()}>
            <span className="profile-action-card__icon"><Sparkles size={18} /></span>
            <span className="profile-action-card__text"><b>AI 帮写开庭</b><small>一句话润色你的案情</small></span>
            <ChevronRight size={16} className="profile-action-card__chev" />
          </button>
          {onEnterGym && (
            <button type="button" className="profile-action-card" onClick={onEnterGym}>
              <span className="profile-action-card__icon"><Dumbbell size={18} /></span>
              <span className="profile-action-card__text">
                <b>健身打卡</b>
                <small>{gymStats ? `连续 ${gymStats.currentStreak} 天 · ${gymStats.totalCheckins} 次` : 'AI 教练计划 · 多人云健身'}</small>
              </span>
              <ChevronRight size={16} className="profile-action-card__chev" />
            </button>
          )}
          {onArchive && (
            <button type="button" className="profile-action-card" onClick={onArchive}>
              <span className="profile-action-card__icon"><FolderOpen size={18} /></span>
              <span className="profile-action-card__text"><b>案卷库</b><small>历史庭审记录与判决</small></span>
              <ChevronRight size={16} className="profile-action-card__chev" />
            </button>
          )}
        </div>

        {/* ---------- Tabs ---------- */}
        <div className="profile-tabs" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
                <Icon size={15} /> <span>{t.label}</span>
                {t.badge ? <em className="profile-tab-badge">{t.badge}</em> : null}
              </button>
            )
          })}
        </div>

        {/* ---------- Module: 我参与的 ---------- */}
        {tab === 'cases' && (
          <section className="profile-section">
            <div className="profile-section-head">
              <h2>我参与的庭审</h2>
              <button type="button" className="profile-ghost-btn" onClick={() => void loadCases()}><Clock3 size={13} /> 刷新</button>
            </div>
            {loadingCases && <div className="profile-empty" style={{ padding: 40 }}>正在整理案卷…</div>}
            {!loadingCases && archives.length === 0 && (
              <div className="profile-empty">
                <div className="profile-empty-icon"><Gavel size={22} /></div>
                <h3>还没有参与过庭审</h3>
                <p>去场景页开始一场，判决书会自动归档在这里。</p>
                <button type="button" className="profile-primary-btn" onClick={() => onCourt()}><Gavel size={14} /> 去开庭</button>
              </div>
            )}
            <div className="profile-case-list">
              {archives.map((record) => {
                const open = openCaseId === record.id
                const title = record.verdict?.title || `${shortText(record.input, 18)}案`
                const quoted = record.verdict?.quote || record.verdict?.sentence || record.input
                return (
                  <article className={`profile-case-card ${open ? 'is-open' : ''}`} key={record.id}>
                    <button type="button" className="profile-case-card__main" onClick={() => setOpenCaseId(open ? null : record.id)}>
                      <span className="profile-case-card__icon"><Gavel size={16} /></span>
                      <span className="profile-case-card__text">
                        <b>{title}</b>
                        <small>{shortText(quoted, 48)}</small>
                        <em><Clock3 size={11} /> {fmtDate(record.updatedAt ?? record.createdAt)} · {record.verdict ? '已判决' : '审理中'}</em>
                      </span>
                      <ChevronRight size={16} className={`profile-case-card__chev ${open ? 'is-flip' : ''}`} />
                    </button>
                    {open && (
                      <div className="profile-case-detail">
                        <div className="profile-case-detail__row"><span className="profile-tag">原告陈述</span><p>{record.verdict?.plaintiffClaim || shortText(record.input, 60)}</p></div>
                        {record.verdict?.defense && <div className="profile-case-detail__row"><span className="profile-tag profile-tag--alt">被告陈述</span><p>{record.verdict.defense}</p></div>}
                        {record.verdict?.judgeNote && <div className="profile-case-detail__row"><span className="profile-tag">法官寄语</span><p>“{record.verdict.judgeNote}”</p></div>}
                        {record.verdict?.charge && <div className="profile-case-detail__row"><span className="profile-tag profile-tag--alt">罪名认定</span><p>{record.verdict.charge}</p></div>}
                        <div className="profile-case-detail__verdict"><span>判决结果</span><p>{record.verdict?.sentence || quoted}</p></div>
                        <div className="profile-case-detail__actions">
                          <button type="button" className="profile-primary-btn" onClick={() => generateCert(record)}><Award size={14} /> 生成证书</button>
                          <button type="button" className="profile-ghost-btn" onClick={() => onCourt(record.input)}><Scale size={14} /> 重新庭审</button>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {/* ---------- Module: 我发布的 ---------- */}
        {tab === 'posts' && (
          <section className="profile-section">
            <div className="profile-section-head">
              <h2>我发布的内容</h2>
              <button type="button" className="profile-ghost-btn" onClick={() => void loadPosts()}><Clock3 size={13} /> 刷新</button>
            </div>
            {loadingPosts && <div className="profile-empty" style={{ padding: 40 }}>正在加载内容…</div>}
            {!loadingPosts && posts.length === 0 && (
              <div className="profile-empty">
                <div className="profile-empty-icon"><PenLine size={22} /></div>
                <h3>还没有发布内容</h3>
                <p>去广场发布第一条吧。</p>
                <button type="button" className="profile-primary-btn" onClick={onPlaza}><PenLine size={14} /> 去广场发布</button>
              </div>
            )}
            <div className="profile-post-list">
              {posts.map((post) => (
                <article className="profile-post-card" key={post.id} onClick={onPlaza}>
                  <div className="profile-post-card__head">
                    <b>{post.title}</b>
                    <span className="profile-tag profile-tag--alt">{post.type === 'closed_court' ? '已结案' : '讨论'}</span>
                  </div>
                  <p className="profile-post-card__body">{shortText(post.body || '', 80) || '（图片/案件内容）'}</p>
                  <div className="profile-post-card__meta">
                    <span><ThumbsUp size={12} /> {post.likes}</span>
                    <span><MessageCircle size={12} /> {post.comments.length}</span>
                    <span><Clock3 size={12} /> {fmtDate(post.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Module: 证书 ---------- */}
        {tab === 'certs' && (
          <section className="profile-section">
            <div className="profile-section-head">
              <h2>我的证书墙</h2>
              <span className="profile-section-count">{certs.length} 张</span>
            </div>
            {certs.length === 0 && (
              <div className="profile-empty">
                <div className="profile-empty-icon"><Award size={22} /></div>
                <h3>还没有证书</h3>
                <p>在「我参与的」里完成一次庭审，即可生成趣味纪念证书。</p>
                <button type="button" className="profile-primary-btn" onClick={() => setTab('cases')}><Gavel size={14} /> 去看看庭审</button>
              </div>
            )}
            <div className="profile-cert-grid">
              {certs.map((cert) => (
                <button type="button" className="profile-cert-card" key={cert.id} onClick={() => setPreviewCert(cert)}>
                  <div className="profile-cert-card__seal"><Award size={22} /></div>
                  <b>{shortText(cert.caseTitle, 18)}</b>
                  <em>“{shortText(cert.verdict, 26)}”</em>
                  <small>{cert.id} · {fmtDate(cert.date)}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Module: 消息 ---------- */}
        {tab === 'msgs' && (
          <section className="profile-section">
            <div className="profile-section-head">
              <h2>消息通知</h2>
              {unread > 0 && <button type="button" className="profile-ghost-btn" onClick={markAllRead}>全部已读</button>}
            </div>
            {msgs.length === 0 && (
              <div className="profile-empty">
                <div className="profile-empty-icon"><Bell size={22} /></div>
                <h3>暂无新消息</h3>
                <p>庭审完成、有人评论、证书生成时会通知你。</p>
              </div>
            )}
            <div className="profile-msg-list">
              {msgs.map((m) => {
                const Icon = m.kind === 'court' ? Gavel : m.kind === 'cert' ? Award : m.kind === 'comment' ? MessageSquare : Bell
                return (
                  <button type="button" key={m.id} className={`profile-msg-card ${m.read ? '' : 'is-unread'}`} onClick={() => markRead(m.id)}>
                    <span className="profile-msg-card__icon"><Icon size={16} /></span>
                    <span className="profile-msg-card__text">
                      <b>{m.title}{!m.read && <em className="profile-msg-dot" />}</b>
                      <small>{m.summary}</small>
                      <em><Clock3 size={11} /> {fmtDate(m.time)}</em>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ---------- Module: 设置 ---------- */}
        {tab === 'settings' && (
          <section className="profile-section">
            <div className="profile-settings-group">
              <h3><Users size={13} /> 账号</h3>
              <div className="profile-settings-row">
                <span className="profile-settings-label"><b>头像</b><small>上传图片自动裁剪为白底头像</small></span>
                <div className="profile-settings-actions">
                  <span className="profile-avatar-preview">
                    {isPhotoAvatar
                      ? <img src={user.avatarRef} alt="头像预览" />
                      : (username || '我').trim().slice(0, 1).toUpperCase()}
                  </span>
                  <button type="button" className="profile-ghost-btn" disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}>
                    {avatarBusy ? '处理中…' : '上传头像'}
                  </button>
                  {isPhotoAvatar && (
                    <button type="button" className="profile-ghost-btn" onClick={() => void resetAvatar()}>恢复默认</button>
                  )}
                  <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={(e) => { void onPickAvatar(e.target.files?.[0] ?? undefined); e.target.value = '' }} />
                </div>
              </div>
              <div className="profile-settings-row">
                <span className="profile-settings-label"><b>用户名</b><small>用于广场发布与「我发布的」归属</small></span>
                <div className="profile-settings-actions">
                  <input className="profile-settings-input" value={nameDraft} maxLength={12} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUsername() }} />
                  <button type="button" className="profile-ghost-btn" onClick={saveUsername}>保存</button>
                </div>
              </div>
            </div>

            <div className="profile-settings-group">
              <h3><Volume2 size={13} /> 语音与音效</h3>
              <div className="profile-settings-row">
                <span className="profile-settings-label"><b>全局语音朗读</b><small>开庭 / 判决自动朗读，手动点播放不受限</small></span>
                <button type="button" role="switch" aria-checked={voiceEnabled}
                  className={`profile-switch ${voiceEnabled ? 'is-on' : ''}`}
                  onClick={() => setVoiceEnabled(!voiceEnabled)}>
                  <span />
                </button>
              </div>
              <div className="profile-settings-row">
                <span className="profile-settings-label"><b>界面音效</b><small>开庭、判决与提示音</small></span>
                <button type="button" role="switch" aria-checked={sound}
                  className={`profile-switch ${sound ? 'is-on' : ''}`}
                  onClick={toggleSound}>
                  <span />
                </button>
              </div>
            </div>

            <div className="profile-settings-group">
              <h3><Trash2 size={13} /> 数据</h3>
              <div className="profile-settings-row">
                <span className="profile-settings-label"><b>清除本地偏好</b><small>案件、证书与消息已保存在服务端</small></span>
                <button type="button" className="profile-danger-btn" onClick={clearLocal}><Trash2 size={13} /> 清除</button>
              </div>
            </div>

            <div className="profile-about">
              <img src="/brand/balabala-mark.jpg" alt="叽里呱啦" />
              <div>
                <b>叽里呱啦 · BalaBala</b>
                <small>版本 0.4.0 · SOCIAL COURT</small>
                <p>把生活里的小小争议，变成一场温柔又好玩的趣味庭审。</p>
              </div>
            </div>
          </section>
        )}
      </section>

      {/* certificate preview modal */}
      {previewCert && (
        <div className="profile-modal-backdrop" onClick={() => setPreviewCert(null)}>
          <div className="profile-cert-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="profile-cert-modal__head">
              <b>证书预览</b>
              <div>
                <button type="button" className="profile-ghost-btn" onClick={() => downloadCert(previewCert)}><Download size={14} /> 下载 SVG</button>
                <button type="button" className="profile-ghost-btn" onClick={() => setPreviewCert(null)}>关闭</button>
              </div>
            </div>
            <div className="profile-cert-modal__paper">
              <div id="cert-preview-svg"><CertificateSvg cert={previewCert} /></div>
            </div>
            <p className="profile-cert-modal__tip"><BadgeCheck size={13} /> {previewCert.id} · 由叽里呱啦趣味法庭颁发</p>
          </div>
        </div>
      )}

      {toast && <div className="profile-toast"><Sparkles size={14} /> {toast}</div>}
    </main>
  )
}
