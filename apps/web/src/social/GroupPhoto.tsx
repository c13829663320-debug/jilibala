// ===== R5: 多人合影高光 =====
//
// 对局结束时触发：捕获当前 3D 场景快照（gl.domElement.toDataURL，由外层注入），
// 叠加参与者头像墙 + 战果摘要，渲染成一张可分享的合影（canvas -> dataURL）。
//
// 布局坐标来自纯函数 computeGroupPhotoLayout；3D 截图接线最小化：
// 外层在 onMount 回调里把 renderer 的 canvas dataURL 传进来。
// 云端无 WebGL：真实截图/头像跨域绘制需真机确认。

import { useEffect, useRef, useState } from 'react'
import type { GroupPhotoParticipant } from './groupPhotoLayout'
import { computeGroupPhotoLayout } from './groupPhotoLayout'

export interface GroupPhotoProps {
  open: boolean
  participants: GroupPhotoParticipant[]
  title: string
  resultText: string
  /** 3D 场景快照（gl.domElement.toDataURL()）；为空则用纯色背景。 */
  sceneSnapshotUrl?: string
  onClose: () => void
  /** 生成可分享 dataURL 后回调（外层可下载/分享）。 */
  onShare?: (dataUrl: string) => void
}

export function GroupPhoto({ open, participants, title, resultText, sceneSnapshotUrl, onClose, onShare }: GroupPhotoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string>('')

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const layout = computeGroupPhotoLayout(participants.length)
    canvas.width = layout.width
    canvas.height = layout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 背景：3D 快照 or 渐变
    let pending = 1
    const finish = () => {
      pending -= 1
      if (pending > 0) return
      // 头像墙
      layout.avatars.forEach((slot, i) => {
        const p = participants[i]
        if (!p) return
        ctx.fillStyle = '#1a1a1a'
        ctx.beginPath()
        ctx.arc(slot.x + slot.size / 2, slot.y + slot.size / 2, slot.size / 2, 0, Math.PI * 2)
        ctx.fill()
        // 昵称
        ctx.fillStyle = '#EDEDF0'
        ctx.font = '14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(p.nickname, slot.x + slot.size / 2, slot.y + slot.size + 16)
      })
      // 标题
      ctx.fillStyle = '#FFD600'
      ctx.font = 'bold 44px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(title, layout.title.x, layout.title.y)
      // 战果
      ctx.fillStyle = '#EDEDF0'
      ctx.font = '24px sans-serif'
      ctx.fillText(resultText, layout.resultText.x, layout.resultText.y)
      try {
        const url = canvas.toDataURL('image/png')
        setDataUrl(url)
      } catch {
        /* 跨域污染：忽略，仍展示组件 */
      }
    }

    if (sceneSnapshotUrl) {
      const img = new Image()
      pending = 2
      img.onload = () => {
        ctx.drawImage(img, 0, 0, layout.width, layout.height)
        finish()
      }
      img.onerror = () => {
        ctx.fillStyle = '#0b0b12'
        ctx.fillRect(0, 0, layout.width, layout.height)
        finish()
      }
      img.src = sceneSnapshotUrl
    } else {
      ctx.fillStyle = '#0b0b12'
      ctx.fillRect(0, 0, layout.width, layout.height)
    }
    finish()
  }, [open, participants, title, resultText, sceneSnapshotUrl])

  if (!open) return null

  return (
    <div style={styles.mask}>
      <div style={styles.dialog}>
        <div style={styles.head}>
          <span style={styles.title}>📸 合影留念</span>
          <button style={styles.close} onClick={onClose}>×</button>
        </div>
        <canvas ref={canvasRef} style={styles.canvas} />
        <div style={styles.actions}>
          <button style={styles.shareBtn} onClick={() => dataUrl && onShare?.(dataUrl)}>保存分享</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  mask: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  dialog: { background: '#000', border: '1px solid #FFD600', borderRadius: 12, padding: 12 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#FFD600', fontWeight: 600 },
  close: { background: 'transparent', border: 'none', color: '#EDEDF0', fontSize: 18, cursor: 'pointer' },
  canvas: { display: 'block', width: 600, borderRadius: 8 },
  actions: { marginTop: 8, textAlign: 'right' },
  shareBtn: { background: '#FFD600', border: 'none', color: '#000', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 },
}
