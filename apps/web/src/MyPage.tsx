import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Award, Bell, ChevronRight, Clock3, FileText, Gavel, Heart,
  Home, MessageSquare, PenLine, Settings, Sparkles, ThumbsUp, Trash2,
  Users, Volume2, VolumeX, Download, BadgeCheck, Scale, MessageCircle, Film,
} from 'lucide-react'
import './my-page.css'

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
}

/* ---------- storage helpers ---------- */
const LS_USER = 'balabala.username'
const LS_SOUND = 'balabala.sound'
const LS_CERTS = 'balabala.certificates'
const LS_MSGS = 'balabala.messages'
const LS_SEED = 'balabala.mypage-seeded'

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

const seedMessages = (): MsgRecord[] => {
  const now = Date.now()
  const mk = (h: number) => new Date(now - h * 3600 * 1000).toISOString()
  return [
    { id: 'sys-1', kind: 'system', title: '欢迎来到「我的」', summary: '这里汇集你的庭审、发布、证书与消息。', time: mk(1), read: false },
    { id: 'sys-2', kind: 'court', title: '庭审完成通知', summary: '完成一次趣味庭审后，判决书会自动归档在这里。', time: mk(6), read: true },
  ]
}

/* ---------- certificate SVG ---------- */
function CertificateSvg({ cert }: { cert: CertRecord }) {
  const logo = '/brand/balabala-mark-clean.jpg'
  return (
    <svg className="cert-svg" viewBox="0 0 900 1200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14120a" />
          <stop offset="1" stopColor="#0a0906" />
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#bg)" />
      <rect x="34" y="34" width="832" height="1132" fill="none" stroke="#FFD600" strokeWidth="6" />
      <rect x="52" y="52" width="796" height="1096" fill="none" stroke="#FFD600" strokeWidth="1.5" opacity="0.7" />
      {/* corner marks */}
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
export default function MyPage({ onBack, onCourt, onPlaza, onVideo }: MyPageProps) {
  const [tab, setTab] = useState<'cases' | 'posts' | 'certs' | 'msgs' | 'settings'>('cases')
  const [username, setUsername] = useState(() => readJSON(LS_USER, '我') as string)
  const [sound, setSound] = useState(() => (readJSON(LS_SOUND, 'on') as string) === 'on')
  const [archives, setArchives] = useState<MyArchive[]>([])
  const [posts, setPosts] = useState<MyContent[]>([])
  const [loadingCases, setLoadingCases] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [openCaseId, setOpenCaseId] = useState<string | null>(null)
  const [certs, setCerts] = useState<CertRecord[]>(() => readJSON(LS_CERTS, []))
  const [msgs, setMsgs] = useState<MsgRecord[]>(() => {
    if (!readJSON(LS_SEED, false)) {
      const seeded = seedMessages()
      writeJSON(LS_MSGS, seeded)
      try { window.localStorage.setItem(LS_SEED, '1') } catch { /* ignore */ }
      return seeded
    }
    return readJSON(LS_MSGS, [])
  })
  const [previewCert, setPreviewCert] = useState<CertRecord | null>(null)
  const [toast, setToast] = useState('')
  const [nameDraft, setNameDraft] = useState(username)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2000)
  }, [])

  /* load archives (cases) */
  const loadCases = useCallback(async () => {
    setLoadingCases(true)
    try {
      const res = await fetch('/api/archives')
      if (!res.ok) throw new Error('案卷加载失败')
      setArchives(await res.json() as MyArchive[])
    } catch {
      setArchives([])
    } finally { setLoadingCases(false) }
  }, [])

  /* load contents and filter by current author */
  const loadPosts = useCallback(async () => {
    setLoadingPosts(true)
    try {
      const res = await fetch('/api/contents')
      if (!res.ok) throw new Error('内容加载失败')
      const json = await res.json() as { contents?: MyContent[] }
      const list = Array.isArray(json) ? (json as unknown as MyContent[]) : (json.contents ?? [])
      setPosts(list)
    } catch {
      setPosts([])
    } finally { setLoadingPosts(false) }
  }, [])

  useEffect(() => { void loadCases() }, [loadCases])
  useEffect(() => { void loadPosts() }, [loadPosts])

  const myPosts = useMemo(
    () => posts.filter((c) => (c.author ?? '') === (username ?? '我')),
    [posts, username],
  )
  const unread = useMemo(() => msgs.filter((m) => !m.read).length, [msgs])

  const pushMessage = useCallback((kind: MsgRecord['kind'], title: string, summary: string) => {
    setMsgs((prev) => {
      const next = [{ id: crypto.randomUUID(), kind, title, summary, time: new Date().toISOString(), read: false }, ...prev]
      writeJSON(LS_MSGS, next)
      return next
    })
  }, [])

  const generateCert = (record: MyArchive) => {
    const existing = certs.find((c) => c.caseId === record.id)
    if (existing) { setPreviewCert(existing); return }
    const cert: CertRecord = {
      id: `BALA-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      caseId: record.id,
      caseTitle: record.verdict?.title || shortText(record.input, 20),
      verdict: record.verdict?.quote || record.verdict?.sentence || record.input,
      charge: record.verdict?.charge,
      date: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
    }
    const next = [cert, ...certs]
    setCerts(next)
    writeJSON(LS_CERTS, next)
    pushMessage('cert', '证书已生成', `《${cert.caseTitle}》的趣味证书已加入证书墙。`)
    setPreviewCert(cert)
    flash('证书已生成')
  }

  const markRead = (id: string) => {
    setMsgs((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, read: true } : m))
      writeJSON(LS_MSGS, next)
      return next
    })
  }
  const markAllRead = () => {
    setMsgs((prev) => {
      const next = prev.map((m) => ({ ...m, read: true }))
      writeJSON(LS_MSGS, next)
      return next
    })
  }

  const saveUsername = () => {
    const v = nameDraft.trim() || '我'
    setUsername(v)
    writeJSON(LS_USER, v)
    flash('用户名已保存')
  }
  const toggleSound = () => {
    const next = !sound
    setSound(next)
    writeJSON(LS_SOUND, next ? 'on' : 'off')
  }
  const clearLocal = () => {
    if (!window.confirm('确定清除本地案件、消息与证书数据吗？此操作不可恢复。')) return
    try {
      window.localStorage.removeItem(LS_CERTS)
      window.localStorage.removeItem(LS_MSGS)
      window.localStorage.removeItem(LS_SEED)
    } catch { /* ignore */ }
    setCerts([])
    const seeded = seedMessages()
    setMsgs(seeded)
    writeJSON(LS_MSGS, seeded)
    try { window.localStorage.setItem(LS_SEED, '1') } catch { /* ignore */ }
    flash('本地数据已清除')
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
    <main className="my-page">
      <header className="my-page__topbar">
        <button type="button" className="my-page__back" onClick={onBack}><ArrowLeft size={16} /> 返回</button>
        <div className="my-page__brand"><img src="/brand/balabala-mark-clean.jpg" alt="叽里呱啦" /><span><b>我的</b><small>BALA BALA</small></span></div>
        <div className="my-page__account"><b>{(username || '我').slice(0, 1).toUpperCase()}</b></div>
      </header>

      <nav className="my-page__tabs" aria-label="我的模块">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} type="button" className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
              <Icon size={15} /> <span>{t.label}</span>
              {t.badge ? <em className="my-page__badge">{t.badge}</em> : null}
            </button>
          )
        })}
      </nav>

      <section className="my-page__body">
        {onVideo && (
          <button type="button" className="my-video-entry" onClick={onVideo}>
            <span className="my-video-entry__icon"><Film size={18} /></span>
            <span className="my-video-entry__text"><b>AI 视频工坊</b><small>一句话生成短视频，支持文生视频 / 图生视频</small></span>
            <ChevronRight size={16} />
          </button>
        )}
        {/* ---------- Module A: 我参与的 ---------- */}
        {tab === 'cases' && (
          <div className="my-panel">
            <div className="my-panel__head"><h2>我参与的庭审</h2><button type="button" className="my-ghost-btn" onClick={() => void loadCases()}><Clock3 size={13} /> 刷新</button></div>
            {loadingCases && <div className="my-empty">正在整理案卷…</div>}
            {!loadingCases && archives.length === 0 && (
              <div className="my-empty">
                <Gavel size={28} />
                <h3>还没有参与过庭审</h3>
                <p>去场景页开始一场，判决书会自动归档在这里。</p>
                <button type="button" className="my-primary-btn" onClick={() => onCourt()}><Gavel size={14} /> 去开庭</button>
              </div>
            )}
            <div className="my-case-list">
              {archives.map((record) => {
                const open = openCaseId === record.id
                const title = record.verdict?.title || `${shortText(record.input, 18)}案`
                const quoted = record.verdict?.quote || record.verdict?.sentence || record.input
                return (
                  <article className={`my-case-card ${open ? 'is-open' : ''}`} key={record.id}>
                    <button type="button" className="my-case-card__main" onClick={() => setOpenCaseId(open ? null : record.id)}>
                      <span className="my-case-card__icon"><Gavel size={16} /></span>
                      <span className="my-case-card__text">
                        <b>{title}</b>
                        <small>{shortText(quoted, 48)}</small>
                        <em><Clock3 size={11} /> {fmtDate(record.updatedAt ?? record.createdAt)} · {record.verdict ? '已判决' : '审理中'}</em>
                      </span>
                      <ChevronRight size={16} className={`my-case-card__chev ${open ? 'is-flip' : ''}`} />
                    </button>
                    {open && (
                      <div className="my-case-detail">
                        <div className="my-case-detail__row"><span className="my-tag">原告陈述</span><p>{record.verdict?.plaintiffClaim || shortText(record.input, 60)}</p></div>
                        {record.verdict?.defense && <div className="my-case-detail__row"><span className="my-tag my-tag--alt">被告陈述</span><p>{record.verdict.defense}</p></div>}
                        {record.verdict?.judgeNote && <div className="my-case-detail__row"><span className="my-tag">法官寄语</span><p>“{record.verdict.judgeNote}”</p></div>}
                        {record.verdict?.charge && <div className="my-case-detail__row"><span className="my-tag my-tag--alt">罪名认定</span><p>{record.verdict.charge}</p></div>}
                        <div className="my-case-detail__verdict"><span>判决结果</span><p>{record.verdict?.sentence || quoted}</p></div>
                        <div className="my-case-detail__actions">
                          <button type="button" className="my-primary-btn" onClick={() => generateCert(record)}><Award size={14} /> 生成证书</button>
                          <button type="button" className="my-ghost-btn" onClick={() => onCourt(record.input)}><Scale size={14} /> 重新庭审</button>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {/* ---------- Module B: 我发布的 ---------- */}
        {tab === 'posts' && (
          <div className="my-panel">
            <div className="my-panel__head"><h2>我发布的内容</h2><button type="button" className="my-ghost-btn" onClick={() => void loadPosts()}><Clock3 size={13} /> 刷新</button></div>
            {loadingPosts && <div className="my-empty">正在加载内容…</div>}
            {!loadingPosts && myPosts.length === 0 && (
              <div className="my-empty">
                <PenLine size={28} />
                <h3>还没有发布内容</h3>
                <p>当前用户名「{username}」下没有发布记录，去广场发布第一条吧。</p>
                <button type="button" className="my-primary-btn" onClick={onPlaza}><PenLine size={14} /> 去广场发布</button>
              </div>
            )}
            <div className="my-post-list">
              {myPosts.map((post) => (
                <article className="my-post-card" key={post.id} onClick={onPlaza}>
                  <div className="my-post-card__head">
                    <b>{post.title}</b>
                    <span className="my-tag my-tag--alt">{post.type === 'closed_court' ? '已结案' : '讨论'}</span>
                  </div>
                  <p className="my-post-card__body">{shortText(post.body || '', 80) || '（图片/案件内容）'}</p>
                  <div className="my-post-card__meta">
                    <span><ThumbsUp size={12} /> {post.likes}</span>
                    <span><MessageCircle size={12} /> {post.comments.length}</span>
                    <span><Clock3 size={12} /> {fmtDate(post.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* ---------- Module C: 证书 ---------- */}
        {tab === 'certs' && (
          <div className="my-panel">
            <div className="my-panel__head"><h2>我的证书墙</h2><span className="my-panel__count">{certs.length} 张</span></div>
            {certs.length === 0 && (
              <div className="my-empty">
                <Award size={28} />
                <h3>还没有证书</h3>
                <p>在「我参与的」里完成一次庭审，即可生成趣味纪念证书。</p>
                <button type="button" className="my-primary-btn" onClick={() => setTab('cases')}><Gavel size={14} /> 去看看庭审</button>
              </div>
            )}
            <div className="my-cert-grid">
              {certs.map((cert) => (
                <button type="button" className="my-cert-card" key={cert.id} onClick={() => setPreviewCert(cert)}>
                  <div className="my-cert-card__seal"><Award size={22} /></div>
                  <b>{shortText(cert.caseTitle, 18)}</b>
                  <em>“{shortText(cert.verdict, 26)}”</em>
                  <small>{cert.id} · {fmtDate(cert.date)}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------- Module D: 消息 ---------- */}
        {tab === 'msgs' && (
          <div className="my-panel">
            <div className="my-panel__head"><h2>消息通知</h2>{unread > 0 && <button type="button" className="my-ghost-btn" onClick={markAllRead}>全部已读</button>}</div>
            {msgs.length === 0 && (
              <div className="my-empty"><Bell size={28} /><h3>暂无新消息</h3><p>庭审完成、有人评论、证书生成时会通知你。</p></div>
            )}
            <div className="my-msg-list">
              {msgs.map((m) => {
                const Icon = m.kind === 'court' ? Gavel : m.kind === 'cert' ? Award : m.kind === 'comment' ? MessageSquare : Bell
                return (
                  <button type="button" key={m.id} className={`my-msg-card ${m.read ? '' : 'is-unread'}`} onClick={() => markRead(m.id)}>
                    <span className="my-msg-card__icon"><Icon size={16} /></span>
                    <span className="my-msg-card__text">
                      <b>{m.title}{!m.read && <em className="my-msg-dot" />}</b>
                      <small>{m.summary}</small>
                      <em><Clock3 size={11} /> {fmtDate(m.time)}</em>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ---------- Module E: 设置 ---------- */}
        {tab === 'settings' && (
          <div className="my-panel my-settings">
            <div className="my-panel__head"><h2>设置</h2></div>
            <div className="my-setting-row">
              <div><b>用户名</b><small>用于广场发布与「我发布的」归属</small></div>
              <div className="my-setting__inline">
                <input value={nameDraft} maxLength={12} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUsername() }} />
                <button type="button" className="my-ghost-btn" onClick={saveUsername}>保存</button>
              </div>
            </div>
            <div className="my-setting-row">
              <div><b>音效</b><small>开庭、判决与提示音</small></div>
              <button type="button" className={`my-toggle ${sound ? 'is-on' : ''}`} onClick={toggleSound} aria-pressed={sound}>
                <span className="my-toggle__knob">{sound ? <Volume2 size={13} /> : <VolumeX size={13} />}</span>
                <em>{sound ? '开' : '关'}</em>
              </button>
            </div>
            <div className="my-setting-row">
              <div><b>清除本地数据</b><small>清除本地缓存的案件、消息与证书</small></div>
              <button type="button" className="my-danger-btn" onClick={clearLocal}><Trash2 size={13} /> 清除</button>
            </div>
            <div className="my-about">
              <img src="/brand/balabala-mark-clean.jpg" alt="叽里呱啦" />
              <div><b>叽里呱啦 · BalaBala</b><small>版本 0.4.0 · Social Court</small><p>把生活里的小小争议，变成一场温柔又好玩的趣味庭审。</p></div>
            </div>
          </div>
        )}
      </section>

      {/* certificate preview modal */}
      {previewCert && (
        <div className="my-cert-modal" onClick={() => setPreviewCert(null)}>
          <div className="my-cert-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="my-cert-modal__head">
              <b>证书预览</b>
              <div>
                <button type="button" className="my-ghost-btn" onClick={() => downloadCert(previewCert)}><Download size={14} /> 下载 SVG</button>
                <button type="button" className="my-ghost-btn" onClick={() => setPreviewCert(null)}>关闭</button>
              </div>
            </div>
            <div className="my-cert-modal__paper">
              <div id="cert-preview-svg"><CertificateSvg cert={previewCert} /></div>
            </div>
            <p className="my-cert-modal__tip"><BadgeCheck size={13} /> {previewCert.id} · 由叽里呱啦趣味法庭颁发</p>
          </div>
        </div>
      )}

      {toast && <div className="my-toast"><Sparkles size={14} /> {toast}</div>}
    </main>
  )
}
