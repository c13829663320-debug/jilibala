// R5: 举报按钮 + 弹窗
// 挂载在聊天消息旁 / 用户头像菜单。提交到公开路由 POST /api/reports。
import { useState } from 'react'
import { Flag } from 'lucide-react'
import { useIdentity } from '../identity'

type ReportCategory = 'abuse' | 'ad' | 'harassment' | 'other'

const CATEGORIES: Array<{ id: ReportCategory; label: string }> = [
  { id: 'abuse', label: '辱骂/人身攻击' },
  { id: 'ad', label: '广告/导流' },
  { id: 'harassment', label: '骚扰' },
  { id: 'other', label: '其他' },
]

export default function ReportButton({
  targetUserId,
  targetNickname,
  evidence,
  size = 14,
}: {
  targetUserId: string
  targetNickname?: string
  evidence?: string
  size?: number
}) {
  const { user } = useIdentity()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<ReportCategory>('other')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!user) { setError('请先登录'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterId: user.userId,
          targetUserId,
          category,
          reason: reason.trim(),
          evidence,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message || '举报失败')
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '举报失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        title="举报"
        onClick={() => { setOpen(true); setDone(false); setError('') }}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#8a8d82', padding: 2, display: 'inline-flex', alignItems: 'center',
        }}
      >
        <Flag size={size} />
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100002, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 14, padding: 22,
              maxWidth: 380, width: '100%', color: '#f4f2ec',
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>
              举报{targetNickname ? `：${targetNickname}` : ''}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8a8d82' }}>
              我们会在核实后对违规账号采取禁言/封禁措施。
            </p>
            {done ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#4fb3a5' }}>
                举报已提交，感谢反馈。
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {CATEGORIES.map((c) => (
                    <label key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer',
                      padding: '6px 8px', borderRadius: 6,
                      background: category === c.id ? 'rgba(79,179,165,0.1)' : 'transparent',
                    }}>
                      <input
                        type="radio"
                        name="report-cat"
                        checked={category === c.id}
                        onChange={() => setCategory(c.id)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  placeholder="补充说明（可选）…"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid #444', background: '#0d0d0d', color: '#f4f2ec', fontSize: 13,
                    outline: 'none', resize: 'vertical',
                  }}
                />
                {error && <div style={{ color: '#FF6B6B', fontSize: 12, marginTop: 8 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #444',
                      background: 'transparent', color: '#9a9c92', cursor: 'pointer',
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
                      background: submitting ? '#555' : '#e06666', color: '#fff',
                      fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {submitting ? '提交中…' : '提交举报'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
