/**
 * 通用懒加载 fallback：居中 spinner + 文案。
 * R5 分片B：文案轮换成「情境化趣味台词」，而不是干巴巴的「正在加载」。
 * 传入 label 时：label 作为静态上下文显示，下方仍轮播趣味台词。
 */
import { useEffect, useState } from 'react'

const FUN_LINES = [
  'AI 陪审团正在入席…',
  '名人正在化妆…',
  '证人正在深呼吸…',
  '天平正在校准…',
  '麦克风正在试音…',
  '狼人正在闭眼…',
  '地形正在生成…',
  'NPC 正在背台词…',
]

const ROTATE_MS = 1500

export default function LoadingFallback({ label }: { label?: string }) {
  const [lineIndex, setLineIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLineIndex((i) => (i + 1) % FUN_LINES.length)
    }, ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, background: '#000', color: '#f5f5f5',
    }}>
      <span style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '3px solid rgba(79,179,165,0.18)', borderTopColor: '#4fb3a5',
        animation: 'bb-spin 0.9s linear infinite',
      }} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label && <span style={{ color: '#666', fontSize: 12, letterSpacing: '.04em' }}>{label}</span>}
        <span style={{ color: '#9a9c92', fontSize: 13, letterSpacing: '.04em' }} data-testid="loading-fun-line">
          {FUN_LINES[lineIndex]}
        </span>
      </div>
      <style>{`@keyframes bb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
