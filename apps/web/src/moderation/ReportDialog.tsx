// ===== 分片5: 举报对话框 =====
// 原因选择（单选）+ 详情输入 + 提交。由 AvatarContextMenu 或其他入口唤起。
import { useState } from 'react'
import { X, Flag } from 'lucide-react'

export const REPORT_REASONS = [
  '辱骂 / 人身攻击',
  '垃圾广告 / 刷屏',
  '不友善 / 骚扰',
  '色情 / 低俗',
  '违法 / 危险内容',
  '其他',
] as const

export interface ReportDialogProps {
  open: boolean
  targetName: string
  onClose: () => void
  onSubmit: (input: { reason: string; detail: string }) => Promise<void> | void
}

export function ReportDialog({ open, targetName, onClose, onSubmit }: ReportDialogProps) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0])
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onSubmit({ reason, detail: detail.trim() })
      setDone(true)
      // 短暂展示成功态后关闭
      setTimeout(() => {
        setDone(false)
        setDetail('')
        onClose()
      }, 900)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(10,10,10,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24,
          width: '100%', maxWidth: 420, color: '#f4f2ec',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
            <Flag size={16} color="#FF6B6B" /> 举报 {targetName}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9a9c92', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#4fb3a5' }}>
            举报已提交，感谢反馈。
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#9a9c92', marginBottom: 8 }}>举报原因</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 8, cursor: 'pointer', fontSize: 14,
                    background: reason === r ? 'rgba(79,179,165,0.1)' : 'transparent',
                    border: '1px solid ' + (reason === r ? '#4fb3a5' : '#333'),
                  }}
                >
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} style={{ accentColor: '#4fb3a5' }} />
                  {r}
                </label>
              ))}
            </div>

            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="补充说明（可选）…"
              maxLength={200}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8,
                border: '1px solid #444', background: '#0d0d0d', color: '#f4f2ec',
                fontSize: 14, outline: 'none', resize: 'vertical',
              }}
            />

            <button
              onClick={() => void handleSubmit()}
              disabled={submitting}
              style={{
                width: '100%', marginTop: 16, padding: '11px 0', borderRadius: 8, border: 'none',
                cursor: 'pointer', background: submitting ? '#555' : '#FF6B6B', color: '#fff',
                fontSize: 15, fontWeight: 700,
              }}
            >
              {submitting ? '提交中…' : '提交举报'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
