// ===== Round4 R4-04: 麦克风权限引导弹窗 =====
//
// getUserMedia 被拒绝 / 未授权时弹出：
//   - 解释为什么需要麦克风（广场里和朋友语音聊天）
//   - 如何在浏览器地址栏/设置里重新开启权限（分 Chrome/Safari 简述）
//   - 提供「使用文字喊话」备选按钮（无需麦克风，头顶气泡沟通）
//
// 配色遵循品牌：纯黑底 + 明黄 #FFD600 + 青绿 #4fb3a5。

import { MicOff, MessageSquareText, X } from 'lucide-react'

export type MicPermissionReason = 'denied' | 'no_device' | 'webrtc_failed'

export default function MicPermissionGuide({
  reason = 'denied',
  onUseText,
  onClose,
  onRetry,
}: {
  /** 触发原因：denied=权限被拒；no_device=无硬件；webrtc_failed=P2P 打不通 */
  reason?: MicPermissionReason
  /** 用户选择「用文字喊话」 */
  onUseText: () => void
  /** 关闭弹窗（不再打扰） */
  onClose: () => void
  /** 用户点「重试语音」（重新走 getUserMedia） */
  onRetry: () => void
}) {
  const title =
    reason === 'denied' ? '需要麦克风权限才能语音聊天'
    : reason === 'no_device' ? '没检测到麦克风设备'
    : '语音连接没打通'

  const body =
    reason === 'denied'
      ? '在广场里和朋友语音聊天需要使用麦克风。你可以点击浏览器地址栏左侧的 🔒 图标，把麦克风权限改成「允许」，然后回来点「重试语音」。'
      : reason === 'no_device'
        ? '这台设备上没有可用的麦克风。你仍然可以用「文字喊话」和大家沟通——输入文字后会出现在你头顶的气泡里。'
        : '语音连接没能建立起来（可能是网络或防火墙限制）。你可以稍后重试，或先用「文字喊话」和大家沟通。'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#000',
          border: '1px solid #2a2a2a',
          borderRadius: 16,
          padding: '24px 22px',
          color: '#f5f5f5',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#FFD600',
              color: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MicOff size={22} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{ background: 'transparent', border: 0, color: '#888', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <h2 style={{ margin: '14px 0 8px', fontSize: 17, color: '#FFD600', fontWeight: 800 }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#bbb' }}>{body}</p>

        {reason === 'denied' && (
          <ol style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: '#888', lineHeight: 1.8 }}>
            <li>点浏览器地址栏左侧的 🔒 / 调章图标</li>
            <li>把「麦克风」设为「允许」</li>
            <li>回来点「重试语音」</li>
          </ol>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          {reason !== 'no_device' && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                minHeight: 44,
                border: 0,
                borderRadius: 10,
                background: '#FFD600',
                color: '#111',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              重试语音
            </button>
          )}
          <button
            type="button"
            onClick={onUseText}
            style={{
              minHeight: 44,
              border: '1px solid #4fb3a5',
              borderRadius: 10,
              background: 'transparent',
              color: '#4fb3a5',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <MessageSquareText size={16} /> 使用文字喊话
          </button>
        </div>
      </div>
    </div>
  )
}
