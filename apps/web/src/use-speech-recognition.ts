// ===== 语音识别（Web Speech API）封装 =====
// 基于 TrialInteraction.tsx 中已验证的 webkitSpeechRecognition 用法，
// 抽出为可复用 hook：人物馆弹窗的「语音输入」与「模拟电话」两种模式共用。
//
// 用法：
//   const { supported, listening, start, stop } = useSpeechRecognition({
//     onFinal: (text) => { ... },   // 整段转写结束后回调
//     onInterim: (text) => { ... }, // 识别过程中的临时结果（可选）
//   })
//
// 浏览器不支持时 supported=false，UI 应提示「当前浏览器不支持语音输入」。

import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionResultLike = {
  isFinal?: boolean
  0: { transcript: string }
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type BrowserWithSpeech = {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as BrowserWithSpeech
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

type Options = {
  lang?: string
  /** 识别完成（final）回调，整段文本一次性给出。 */
  onFinal?: (text: string) => void
  /** 识别过程中的临时文本，可用于实时上屏。 */
  onInterim?: (text: string) => void
}

export function useSpeechRecognition({ lang = 'zh-CN', onFinal, onInterim }: Options = {}) {
  const [supported] = useState(speechRecognitionSupported)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // 用 ref 保存最新回调，避免 start/stop 依赖回调变化而重建实例
  const onFinalRef = useRef(onFinal)
  const onInterimRef = useRef(onInterim)
  onFinalRef.current = onFinal
  onInterimRef.current = onInterim

  const stop = useCallback(() => {
    try { recognitionRef.current?.stop() } catch { /* noop */ }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    const w = window as unknown as BrowserWithSpeech
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Recognition) return
    // 重复 start 会抛 InvalidStateError，先停掉旧实例
    try { recognitionRef.current?.abort() } catch { /* noop */ }

    const recognition = new Recognition()
    recognition.lang = lang
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      const results = event.results
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (!r) continue
        const transcript = r[0]?.transcript ?? ''
        if (r.isFinal) finalText += transcript
        else interimText += transcript
      }
      if (interimText && onInterimRef.current) onInterimRef.current(interimText)
      if (finalText && onFinalRef.current) onFinalRef.current(finalText)
    }
    recognition.onerror = (e) => {
      setError(e?.error === 'not-allowed' || e?.error === 'service-not-allowed'
        ? '麦克风权限被拒绝，请在浏览器设置中允许'
        : '语音识别出错，请重试')
      setListening(false)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition

    try {
      recognition.start()
      setError('')
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [lang, supported])

  // 卸载时务必释放麦克风
  useEffect(() => () => {
    try { recognitionRef.current?.abort() } catch { /* noop */ }
  }, [])

  return { supported, listening, error, start, stop }
}
