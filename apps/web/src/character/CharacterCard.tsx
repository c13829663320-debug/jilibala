// ===== 分片6: 统一人物卡片 =====
// 名人 / 自定义人物通用展示：头像、名称、头衔、简介、标签、来源角标、关注按钮。
import { useState } from 'react'
import type { CharacterProfile } from '@balabala/shared'
import { toggleFollow } from './useUnifiedCharacters'

export interface CharacterCardProps {
  character: CharacterProfile
  /** 当前登录用户 id（用于关注）；为空则不显示关注按钮。 */
  userId?: string
  /** 初始是否已关注。 */
  initialFollowed?: boolean
  onClick?: (character: CharacterProfile) => void
  onFollowChange?: (characterId: string, followed: boolean) => void
}

export function CharacterCard({ character, userId, initialFollowed = false, onClick, onFollowChange }: CharacterCardProps) {
  const [followed, setFollowed] = useState(initialFollowed)
  const [followers, setFollowers] = useState(character.followers)
  const [busy, setBusy] = useState(false)

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId || busy) return
    setBusy(true)
    try {
      const next = !followed
      const count = await toggleFollow(character.id, userId, next)
      setFollowed(next)
      setFollowers(count)
      onFollowChange?.(character.id, next)
    } catch {
      // 失败保持原状
    } finally {
      setBusy(false)
    }
  }

  const isCustom = character.source === 'custom'

  return (
    <div
      onClick={() => onClick?.(character)}
      style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 14,
        padding: 14, cursor: onClick ? 'pointer' : 'default', position: 'relative',
        transition: 'border-color .15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#4fb3a5')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2a2a')}
    >
      {/* 来源角标 */}
      <span
        style={{
          position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '2px 8px',
          borderRadius: 999, background: isCustom ? 'rgba(167,139,250,0.18)' : 'rgba(79,179,165,0.15)',
          color: isCustom ? '#c4b5fd' : '#4fb3a5',
        }}
      >
        {isCustom ? '自定义' : '名人'}
      </span>

      {/* 头像 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {character.portrait ? (
          <img
            src={character.portrait}
            alt={character.name}
            style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', background: '#0d0d0d' }}
          />
        ) : (
          <div style={{
            width: 56, height: 56, borderRadius: 12, display: 'grid', placeItems: 'center',
            background: '#2d2440', color: '#4fb3a5', fontSize: 22, fontWeight: 700,
          }}>
            {character.name[0]}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f4f2ec', paddingRight: 48 }}>
            {character.name}
          </div>
          <div style={{ fontSize: 12, color: '#9a9c92', marginTop: 2 }}>{character.title}</div>
          <div style={{ fontSize: 12, color: '#c9cbc2', marginTop: 6, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {character.intro}
          </div>
        </div>
      </div>

      {/* 标签 */}
      {character.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {character.tags.slice(0, 4).map((t) => (
            <span key={t} style={{ fontSize: 11, color: '#9a9c92', background: '#0d0d0d', padding: '2px 8px', borderRadius: 6 }}>
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 底部：粉丝数 + 关注按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <span style={{ fontSize: 11, color: '#6a6d64' }}>
          {followers} 人关注
        </span>
        {userId && (
          <button
            onClick={(e) => void handleFollow(e)}
            disabled={busy}
            style={{
              padding: '5px 14px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: followed ? 'transparent' : '#4fb3a5',
              color: followed ? '#4fb3a5' : '#1a1a1a',
              border: followed ? '1px solid #4fb3a5' : 'none',
            }}
          >
            {followed ? '已关注' : '+ 关注'}
          </button>
        )}
      </div>
    </div>
  )
}
