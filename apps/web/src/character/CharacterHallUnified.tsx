// ===== 分片6: 统一人物馆（名人 + 公开自定义人物混合）=====
// 独立页面：顶部搜索框 + 来源 Tab + 标签筛选 + 人物卡片网格。
// 与原 CharacterHall（3D 人物馆）并存，低风险接入。
import { useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useIdentity } from '../identity'
import { useUnifiedCharacters } from './useUnifiedCharacters'
import { CharacterCard } from './CharacterCard'
import type { CharacterProfile } from '@balabala/shared'

export interface CharacterHallUnifiedProps {
  onBack: () => void
  onOpenCharacter?: (character: CharacterProfile) => void
}

const SOURCE_TABS = [
  { id: 'all', label: '全部' },
  { id: 'celebrity', label: '名人' },
  { id: 'custom', label: '自定义' },
] as const

export default function CharacterHallUnified({ onBack, onOpenCharacter }: CharacterHallUnifiedProps) {
  const { user } = useIdentity()
  const [q, setQ] = useState('')
  const [input, setInput] = useState('')
  const [source, setSource] = useState<string>('all')
  const [tag, setTag] = useState<string>('')

  const { items, total, tags, loading } = useUnifiedCharacters({ q, source, tag, page: 1, limit: 60 })

  const tagOptions = useMemo(() => tags.slice(0, 12), [tags])

  const submitSearch = () => setQ(input.trim())

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f4f2ec', padding: 16 }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#9a9c92', cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>人物馆 · 全部</h2>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6a6d64' }}>{total} 位人物</span>
      </div>

      {/* 搜索框 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#6a6d64' }} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
            placeholder="搜索人物名 / 头衔 / 简介 / 标签…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 36px',
              borderRadius: 10, border: '1px solid #333', background: '#141414',
              color: '#f4f2ec', fontSize: 14, outline: 'none',
            }}
          />
        </div>
        <button
          onClick={submitSearch}
          style={{
            padding: '0 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#4fb3a5', color: '#1a1a1a', fontWeight: 700,
          }}
        >
          搜索
        </button>
      </div>

      {/* 来源 Tab */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {SOURCE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSource(t.id)}
            style={{
              padding: '6px 16px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
              border: '1px solid',
              borderColor: source === t.id ? '#4fb3a5' : '#333',
              background: source === t.id ? 'rgba(79,179,165,0.1)' : 'transparent',
              color: source === t.id ? '#4fb3a5' : '#9a9c92',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 标签筛选 */}
      {tagOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            onClick={() => setTag('')}
            style={{
              padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: '1px solid', borderColor: tag === '' ? '#4fb3a5' : '#333',
              background: tag === '' ? 'rgba(79,179,165,0.1)' : 'transparent',
              color: tag === '' ? '#4fb3a5' : '#9a9c92',
            }}
          >
            全部标签
          </button>
          {tagOptions.map((t) => (
            <button
              key={t.tag}
              onClick={() => setTag(tag === t.tag ? '' : t.tag)}
              style={{
                padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                border: '1px solid', borderColor: tag === t.tag ? '#4fb3a5' : '#333',
                background: tag === t.tag ? 'rgba(79,179,165,0.1)' : 'transparent',
                color: tag === t.tag ? '#4fb3a5' : '#9a9c92',
              }}
            >
              #{t.tag} · {t.count}
            </button>
          ))}
        </div>
      )}

      {/* 卡片网格 */}
      {loading ? (
        <div style={{ color: '#6a6d64', textAlign: 'center', padding: 40 }}>加载中…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#6a6d64', textAlign: 'center', padding: 40 }}>没有匹配的人物</div>
      ) : (
        <div
          style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {items.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              userId={user?.userId}
              onClick={onOpenCharacter ? () => onOpenCharacter(c) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
