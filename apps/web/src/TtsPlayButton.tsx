import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { playTts, subscribeTts } from './tts'

export function TtsPlayButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeTts(setPlaying), [])

  const onClick = async () => {
    setError('')
    setLoading(true)
    try {
      await playTts(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : '语音播放失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className={`tts-play-button ${playing ? 'is-playing' : ''} ${loading ? 'is-loading' : ''} ${className ?? ''}`}
      onClick={onClick}
      title={error || '播放语音'}
    >
      {playing ? <VolumeX size={14} /> : <Volume2 size={14} />}
      <span>{loading ? '合成中…' : playing ? '停止' : (label ?? '播放')}</span>
    </button>
  )
}
