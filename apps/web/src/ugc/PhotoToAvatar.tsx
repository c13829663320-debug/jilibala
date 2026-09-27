// ============================================================================
// PhotoToAvatar —— 上传照片 → 裁剪/白底 → 生成“头像化身”
// 明确标注：照片正面贴图 + 程序化身体，非真实 3D 重建。
// 几何/绘制编排复用纯函数 renderAvatarOnWhite（已单测）。
// ============================================================================
import { useRef, useState } from 'react'
import type { PhotoAvatarConfig } from '@balabala/shared'
import { renderAvatarOnWhite, buildPhotoAvatarConfig, AVATAR_CANVAS_SIZE } from './photoToAvatar'

export interface PhotoToAvatarProps {
  /** 生成化身配置后回调（可带入广场/场景，与 avatarType='photo' 兼容）。 */
  onDone: (config: PhotoAvatarConfig) => void
}

export default function PhotoToAvatar({ onDone }: PhotoToAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [config, setConfig] = useState<PhotoAvatarConfig | null>(null)
  const [error, setError] = useState('')

  const handleFile = (file: File) => {
    setError('')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = AVATAR_CANVAS_SIZE
      canvas.height = AVATAR_CANVAS_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) { setError('当前浏览器不支持 Canvas'); return }
      // 居中方形裁剪 + 白底（纯函数）
      renderAvatarOnWhite(ctx, img, img.naturalWidth, img.naturalHeight, AVATAR_CANVAS_SIZE)
      const dataUrl = canvas.toDataURL('image/png')
      URL.revokeObjectURL(url)
      setPreview(dataUrl)
      const cfg = buildPhotoAvatarConfig(dataUrl, file.name.replace(/\.[^.]+$/, ''))
      setConfig(cfg)
    }
    img.onerror = () => { setError('图片读取失败，换一张试试'); URL.revokeObjectURL(url) }
    img.src = url
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', color: '#eee' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📷 照片变头像化身</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
        上传正面照片，自动居中裁剪 + 白底；这是“头像化身”（正面贴图 + 程序化身体），不做真实 3D 重建。
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        style={{ color: '#ccc', fontSize: 13 }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {preview && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <img
            src={preview}
            alt="头像化身预览"
            style={{ width: 160, height: 160, borderRadius: 12, border: '2px solid #4fb3a5', objectFit: 'cover' }}
          />
          {config && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              身体色：<span style={{ display: 'inline-block', width: 12, height: 12, background: config.bodyColor, borderRadius: 3 }} />
            </div>
          )}
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: '#ff6b6b', fontSize: 13 }}>{error}</div>}
      {config && (
        <button
          onClick={() => onDone(config)}
          style={{
            marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
            background: '#4fb3a5', color: '#0a0a0a', fontWeight: 700, cursor: 'pointer',
          }}
        >
          带这个化身进入广场 →
        </button>
      )}
    </div>
  )
}
