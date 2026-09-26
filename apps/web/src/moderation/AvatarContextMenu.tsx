// ===== 分片5: 化身右键 / 长按菜单 =====
// 在 3D 场景中，对远端化身右键（桌面）或长按（移动端）唤起的操作菜单：
// 屏蔽 / 静音语音 / 举报。本组件是纯 DOM 浮层，由父组件控制 open 与位置。
import { useEffect, useState } from 'react'
import { Ban, VolumeX, Flag, Volume2, Check } from 'lucide-react'
import { ReportDialog } from './ReportDialog'

export interface MenuTarget {
  userId: string
  nickname: string
}

export interface AvatarContextMenuProps {
  open: boolean
  target: MenuTarget | null
  /** 菜单屏幕坐标（px）。 */
  x: number
  y: number
  /** 是否已被屏蔽（控制菜单项文案/勾选）。 */
  blocked: boolean
  /** 是否已被静音语音。 */
  muted: boolean
  onClose: () => void
  onToggleBlock: () => void | Promise<void>
  onToggleMute: () => void | Promise<void>
  onReportSubmit: (input: { reason: string; detail: string }) => Promise<void> | void
}

export function AvatarContextMenu({
  open, target, x, y, blocked, muted,
  onClose, onToggleBlock, onToggleMute, onReportSubmit,
}: AvatarContextMenuProps) {
  const [showReport, setShowReport] = useState(false)

  // 点击菜单外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !target) return null

  // 防止菜单超出屏幕右/下边界
  const MENU_W = 180
  const MENU_H = 150
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8))

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '10px 12px', background: 'transparent', border: 'none',
    color: '#f4f2ec', fontSize: 14, cursor: 'pointer', textAlign: 'left',
  }

  return (
    <>
      {/* 半透明遮罩点击关闭（不阻挡右键菜单弹出的那一次点击） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 199998 }}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'fixed', left, top, zIndex: 199999, width: MENU_W,
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 12,
          padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '6px 12px', fontSize: 12, color: '#6a6d64', borderBottom: '1px solid #2a2a2a', marginBottom: 4 }}>
          {target.nickname}
        </div>
        <button style={itemStyle} onClick={() => { void onToggleBlock(); onClose() }}>
          {blocked ? <Check size={15} color='#4fb3a5' /> : <Ban size={15} />}
          {blocked ? '已屏蔽 · 点击取消' : '屏蔽该用户'}
        </button>
        <button style={itemStyle} onClick={() => { void onToggleMute(); onClose() }}>
          {muted ? <Check size={15} color='#4fb3a5' /> : (muted ? <VolumeX size={15} /> : <Volume2 size={15} />)}
          {muted ? '已静音语音 · 点击取消' : '静音语音'}
        </button>
        <button style={{ ...itemStyle, color: '#FF6B6B' }} onClick={() => setShowReport(true)}>
          <Flag size={15} /> 举报
        </button>
      </div>

      <ReportDialog
        open={showReport}
        targetName={target.nickname}
        onClose={() => setShowReport(false)}
        onSubmit={async (input) => {
          await onReportSubmit(input)
          setShowReport(false)
        }}
      />
    </>
  )
}
