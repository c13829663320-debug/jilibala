// Shared TTS playback helper: calls /api/tts and plays the returned audio.
// Singleton audio element so only one voice plays at a time; calling play()
// with the same text that is currently playing stops it.

let currentAudio: HTMLAudioElement | null = null
let currentKey = ''
let listeners: Set<(playing: boolean) => void> = new Set()

export function subscribeTts(listener: (playing: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(playing: boolean) {
  listeners.forEach((fn) => fn(playing))
}

export function stopTts() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
  }
  currentAudio = null
  currentKey = ''
  emit(false)
}

export function isTtsPlaying(text?: string): boolean {
  if (!text) return currentAudio !== null
  return currentKey === text && currentAudio !== null
}

/**
 * Synthesize and play the given text. Returns a promise that resolves when
 * playback ends (or rejects on error). Re-calling with the same text stops.
 */
export async function playTts(text: string, voice?: string): Promise<void> {
  const clean = text.trim().replace(/[“”"]/g, '')
  if (!clean) return
  if (currentKey === clean && currentAudio) {
    stopTts()
    return
  }
  stopTts()
  emit(true)
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, ...(voice ? { voice } : {}) }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(data.message ?? '语音合成失败')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    currentKey = clean
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) { currentAudio = null; currentKey = '' }
      emit(false)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) { currentAudio = null; currentKey = '' }
      emit(false)
    }
    await audio.play()
  } catch (error) {
    emit(false)
    throw error
  }
}
