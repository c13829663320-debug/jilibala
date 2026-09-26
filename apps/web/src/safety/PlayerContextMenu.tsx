// ===== Round4 R4-03：玩家上下文菜单 =====
// 点击远端玩家后弹出：静音/屏蔽/举报/查看档案。
// 纯 DOM 浮层（fixed 定位），不进 WebGL canvas。举报内嵌一个小表单（分类+原因）。
import { useState, type ReactNode } from 'react'
import { MicOff, Mic, Ban, UserX, Flag, UserCircle, X } from 'lucide-react'
import type { ReportCategory } from '@balabala/shared'

export interface PlayerTarget {
  userId: string
  nickname: string
}

export interface PlayerContextMenuProps {
  target: PlayerTarget
  /** 屏幕坐标（clientX/clientY） */
  x: number
  y: number
  /** 当前是否已静音 / 已屏蔽（决定按钮文案） */
  isMuted: boolean
  isBlocked: boolean
  onToggleMute: () => void
  onToggleBlock: () => void
  /** 提交举报（分类 + 原因） */
  onReport: (category: ReportCategory, reason: string) => void
  onViewProfile: () => void
  onClose: () => void
}

const CATEGORY_OPTIONS: Array<{ value: ReportCategory; label: string }> = [
  { value: 'harassment', label: '骚扰/人身攻击' },
  { value: 'spam', label: '刷屏/广告' },
  { value: 'abuse', label: '辱骂/不当言论' },
  { value: 'cheating', label: '作弊/破坏体验' },
  { value: 'other', label: '其他' },
]

export default function PlayerContextMenu({
  target, x, y, isMuted, isBlocked,
  onToggleMute, onToggleBlock, onReport, onViewProfile, onClose,
}: PlayerContextMenuProps) {
  const [mode, setMode] = useState<'menu' | 'report'>('menu')
  const [category, setCategory] = useState<ReportCategory>('harassment')
  const [reason, setReason] = useState('')

  // 防止菜单溢出屏幕右侧/底部
  const menuWidth = 220
  const left = Math.min(x, window.innerWidth - menuWidth - 12)
  const top = Math.min(y, window.innerHeight - 260)

  return (
    <div
      // 点击遮罩关闭
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      onPointerDown={onClose}
    >
      <div
        style={{
          position: 'absolute', left, top, width: menuWidth,
          background: '#17191f', border: '1px solid #2b2f38', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.5)', overflow: 'hidden',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 头部：玩家昵称 */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #23262e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#e6e9ee', fontWeight: 600 }}>{target.nickname}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8a8f99', cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        </div>

        {mode === 'menu' ? (
          <div style={{ padding: '6px 0' }}>
            <MenuItem
              icon={isMuted ? <Mic size={15} /> : <MicOff size={15} />}
              label={isMuted ? '取消静音' : '静音（禁听语音）'}
              onClick={() => { onToggleMute(); onClose() }}
            />
            <MenuItem
              icon={isBlocked ? <UserX size={15} /> : <Ban size={15} />}
              label={isBlocked ? '取消屏蔽' : '屏蔽（完全不可见）'}
              danger={!isBlocked}
              onClick={() => { onToggleBlock(); onClose() }}
            />
            <MenuItem icon={<Flag size={15} />} label="举报" onClick={() => setMode('report')} />
            <MenuItem icon={<UserCircle size={15} />} label="查看档案" onClick={() => { onViewProfile(); onClose() }} />
          </div>
        ) : (
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 12, color: '#9aa0aa', marginBottom: 6 }}>举报：{target.nickname}</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              style={{ width: '100%', marginBottom: 8, background: '#0e1014', color: '#e6e9ee', border: '1px solid #2b2f38', borderRadius: 8, padding: '6px 8', fontSize: 12 }}
            >
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              placeholder="补充原因（可选）"
              rows={3}
              style={{ width: '100%', background: '#0e1014', color: '#e6e9ee', border: '1px solid #2b2f38', borderRadius: 8, padding: '6px 8', fontSize: 12, resize: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setMode('menu')}
                style={{ padding: '6px 12', borderRadius: 8, background: 'transparent', border: '1px solid #2b2f38', color: '#9aa0aa', fontSize: 12, cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={() => { onReport(category, reason.trim()); onClose() }}
                style={{ padding: '6px 12', borderRadius: 8, background: '#c0392b', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                提交举报
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, color: danger ? '#ff7a6b' : '#d6dae0', textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#1f232b' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
