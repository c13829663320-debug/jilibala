import { useMemo, useState } from 'react'
import { Archive, ArrowLeft, ChevronRight, Clock3, Gavel, Home, RotateCcw, Trash2 } from 'lucide-react'

export type ArchiveRecord = { id: string; input: string; createdAt?: string; updatedAt?: string; verdict?: { title?: string; quote?: string; charge?: string; sentence?: string } }
type ArchivePageProps = { archives: ArchiveRecord[]; loading?: boolean; error?: string; onBack: () => void; onCourt: () => void; onRefresh: () => void; onOpenCase: (record: ArchiveRecord) => void; onDelete: (record: ArchiveRecord) => void; onClear: () => void }
const formatDate = (value?: string) => { if (!value) return '刚刚归档'; const date = new Date(value); if (Number.isNaN(date.getTime())) return '已归档'; return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) }

export default function ArchivePage({ archives, loading, error, onBack, onCourt, onRefresh, onOpenCase, onDelete, onClear }: ArchivePageProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => { const needle = query.trim().toLowerCase(); if (!needle) return archives; return archives.filter((item) => `${item.input} ${item.verdict?.title ?? ''} ${item.verdict?.quote ?? ''}`.toLowerCase().includes(needle)) }, [archives, query])
  return <main className="platform-shell archive-page">
    <header className="platform-topbar">
      <button className="platform-brand" type="button" onClick={onBack} aria-label="返回空间大厅"><span className="platform-brand-mark">叽</span><span><b>叽里呱啦</b><small>BALABALA · SOCIAL WORLD</small></span></button>
      <nav className="platform-nav" aria-label="平台导航"><button type="button" onClick={onBack}><Home size={14} /> 空间大厅</button><button type="button" onClick={onCourt}><Gavel size={14} /> 趣味法庭</button><button type="button" className="is-active"><Archive size={14} /> 案卷库</button></nav>
      <div className="platform-presence"><i /> 空间在线</div>
    </header>
    <section className="archive-page-content">
      <div className="archive-page-head"><div><span className="archive-page-kicker">PERSONAL ARCHIVE · 03</span><h1>每一次小事，<em>都值得被好好记住。</em></h1><p>在这里回看你的庭审、判决和那些被认真对待的生活瞬间。</p></div><div className="archive-page-actions"><button type="button" className="archive-ghost-button" onClick={onRefresh}><RotateCcw size={14} /> 刷新</button><button type="button" className="archive-primary-button" onClick={onCourt}><Gavel size={14} /> 新建庭审</button></div></div>
      <div className="archive-toolbar"><div className="archive-metrics"><strong>{archives.length}</strong><span>份已归档案卷</span></div><label className="archive-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索案件、判决或金句" /></label>{archives.length > 0 && <button type="button" className="archive-clear-button" onClick={onClear}><Trash2 size={13} /> 清空案卷</button>}</div>
      {error && <div className="archive-page-error" role="alert">{error}</div>}{loading && <div className="archive-loading">正在整理案卷…</div>}
      {!loading && filtered.length === 0 && <div className="archive-empty-state"><div className="archive-empty-icon"><Archive size={24} /></div><h2>{archives.length === 0 ? '案卷库还是空的' : '没有找到匹配案卷'}</h2><p>{archives.length === 0 ? '开一场趣味庭审，第一份判决书就会出现在这里。' : '换个关键词试试，或者回到全部案卷。'}</p>{archives.length === 0 ? <button type="button" className="archive-primary-button" onClick={onCourt}><Gavel size={14} /> 开始第一场庭审</button> : <button type="button" className="archive-ghost-button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
      {!loading && filtered.length > 0 && <div className="archive-page-grid">{filtered.map((record, index) => <article className="archive-case-card" key={record.id}><div className="archive-case-card-top"><span className="archive-case-number">CASE · {String(filtered.length - index).padStart(2, '0')}</span><span className="archive-case-date"><Clock3 size={12} /> {formatDate(record.updatedAt ?? record.createdAt)}</span></div><button type="button" className="archive-case-main" onClick={() => onOpenCase(record)}><div className="archive-case-icon"><Gavel size={17} /></div><h2>{record.verdict?.title || `${record.input.slice(0, 24)}案`}</h2><p>{record.verdict?.quote || record.input}</p><span className="archive-case-open">查看判决 <ChevronRight size={14} /></span></button><div className="archive-case-footer"><span>{record.verdict?.charge || '生活小事过度认真罪'}</span><button type="button" aria-label="删除案卷" onClick={() => onDelete(record)}><Trash2 size={13} /></button></div></article>)}</div>}
      <p className="archive-page-note">案卷已通过 SQLite 持久化保存，重启服务不丢失。登录身份后可跨设备同步。</p>
    </section>
    <footer className="platform-footer"><button type="button" onClick={onBack}><ArrowLeft size={13} /> 返回空间大厅</button><span>© 2025 BALABALA SOCIAL WORLD</span></footer>
  </main>
}
