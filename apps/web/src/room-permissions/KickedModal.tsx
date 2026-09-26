// R4-02: 被房主踢出房间时的提示弹窗
import { ShieldX, X } from 'lucide-react'

export default function KickedModal({ reason, onClose }: {
  reason: string
  onClose: () => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #ff4444', borderRadius: 12,
        padding: '28px 32px', maxWidth: 380, width: '90%',
        color: '#fff', textAlign: 'center',
      }}>
        <div style={{ marginBottom: 12 }}>
          <ShieldX size={40} color="#ff4444" />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
          你已被移出房间
        </h2>
        <p style={{ margin: '0 0 20px', color: '#aaa', fontSize: 14, lineHeight: 1.5 }}>
          {reason || '被房主移出房间'}
        </p>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: 12 }}>
          60 秒内无法重新加入该房间
        </p>
        <button
          onClick={onClose}
          style={{
            background: '#ff4444', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 24px', fontSize: 14,
            cursor: 'pointer', fontWeight: 600,
          }}
        >
          <X size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          返回大厅
        </button>
      </div>
    </div>
  )
}
