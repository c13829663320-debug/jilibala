import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Film, ImagePlus, Loader2, Play, Sparkles, Trash2 } from 'lucide-react'
import './video-studio.css'

type HistoryItem = {
  id: string
  kind: 'text' | 'image'
  prompt: string
  duration: number
  ratio: string
  videoUrl: string
  thumbnail?: string
  createdAt: string
}

const LS_KEY = 'balabala.video-history'
const DURATIONS = [5, 10, 15]
const RATIOS = ['16:9', '9:16', '1:1'] as const

function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch { return [] }
}
function saveHistory(items: HistoryItem[]) {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 24))) } catch { /* ignore */ }
}

export default function VideoStudio({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<'text' | 'image'>('text')
  const [prompt, setPrompt] = useState('一只穿法官袍的橘猫在法庭里敲击法槌，暖黄色灯光，卡通电影质感')
  const [duration, setDuration] = useState(5)
  const [ratio, setRatio] = useState<string>('16:9')
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [activeVideo, setActiveVideo] = useState<HistoryItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { saveHistory(history) }, [history])

  const pickImage = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('请选择图片文件。'); return }
    const reader = new FileReader()
    reader.onload = () => setImage({ dataUrl: String(reader.result ?? ''), name: file.name })
    reader.readAsDataURL(file)
  }

  const generate = async () => {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setMessage('已提交视频任务，正在排队生成…')
    try {
      const res = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt: p, duration, ratio, ...(kind === 'image' && image ? { imageUrl: image.dataUrl } : {}) }),
      })
      const data = await res.json() as { taskId?: string; message?: string }
      if (!res.ok || !data.taskId) throw new Error(data.message ?? '提交失败')
      // Poll the task. The running environment injects the final video URL
      // through the local bridge endpoint once generation finishes.
      // Seedance 暂未接入真实生成：轮询超过阈值即优雅降级为「功能开发中」，
      // 避免 busy 永久转圈。
      const taskId = data.taskId
      const startedAt = Date.now()
      const POLL_TIMEOUT_MS = 90_000
      const poll = async () => {
        try {
          const r = await fetch(`/api/video/tasks/${encodeURIComponent(taskId)}`)
          const t = await r.json() as { status?: string; videoUrl?: string; error?: string }
          if (t.status === 'done' && t.videoUrl) {
            const item: HistoryItem = {
              id: taskId, kind, prompt: p, duration, ratio,
              videoUrl: t.videoUrl, createdAt: new Date().toISOString(),
            }
            setHistory((prev) => [item, ...prev])
            setActiveVideo(item)
            setMessage('视频生成完成，开始播放。')
            setBusy(false)
            return
          }
          if (t.status === 'failed') {
            setMessage(t.error || '视频生成失败，请换个描述再试。')
            setBusy(false)
            return
          }
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setMessage('视频生成服务暂未开放（功能开发中）。你的描述已保留，接入 Seedance 后即可出片。')
            setBusy(false)
            return
          }
          window.setTimeout(poll, 2500)
        } catch {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setMessage('视频生成服务暂时不可用，请稍后再试。')
            setBusy(false)
            return
          }
          window.setTimeout(poll, 3000)
        }
      }
      window.setTimeout(poll, 1500)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '提交失败')
      setBusy(false)
    }
  }

  return (
    <main className="video-studio">
      <header className="video-studio__topbar">
        <button className="video-studio__back" type="button" onClick={onBack}><ArrowLeft size={16} /> 返回</button>
        <div className="video-studio__brand"><span className="video-studio__mark">叽</span><span>AI 视频工坊 <em>· Seedance</em></span></div>
      </header>

      <section className="video-studio__hero">
        <span className="video-studio__kicker"><Film size={14} /> TEXT / IMAGE TO VIDEO</span>
        <h1>一句话，<em>动起来。</em></h1>
        <p>输入一段画面描述，或上传一张参考图，AI 会把它变成一段短视频。</p>
      </section>

      <section className="video-studio__layout">
        <div className="video-studio__panel">
          <div className="video-studio__tabs" role="tablist">
            <button type="button" className={kind === 'text' ? 'is-active' : ''} onClick={() => setKind('text')}><Play size={14} /> 文生视频</button>
            <button type="button" className={kind === 'image' ? 'is-active' : ''} onClick={() => setKind('image')}><ImagePlus size={14} /> 图生视频</button>
          </div>

          {kind === 'image' && (
            <>
              <input ref={fileRef} id="video-ref" type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
              <button type="button" className="video-studio__ref" onClick={() => fileRef.current?.click()} disabled={busy}>
                {image ? <img src={image.dataUrl} alt="参考图" /> : <span><ImagePlus size={20} /> 点击上传参考图</span>}
              </button>
            </>
          )}

          <label className="video-studio__field">
            <span>画面描述</span>
            <textarea value={prompt} maxLength={400} rows={5} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：夕阳下的城市天际线，镜头缓缓推进，电影感" />
          </label>

          <div className="video-studio__row">
            <label>时长
              <div className="video-studio__chips">
                {DURATIONS.map((d) => <button type="button" key={d} className={duration === d ? 'is-active' : ''} onClick={() => setDuration(d)}>{d}s</button>)}
              </div>
            </label>
            <label>比例
              <div className="video-studio__chips">
                {RATIOS.map((r) => <button type="button" key={r} className={ratio === r ? 'is-active' : ''} onClick={() => setRatio(r)}>{r}</button>)}
              </div>
            </label>
          </div>

          <button className="video-studio__generate" type="button" onClick={generate} disabled={!prompt.trim() || busy || (kind === 'image' && !image)}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? '生成中…' : '生成视频'}
          </button>
          {message && <div className={`video-studio__message ${busy ? '' : 'is-done'}`} role="status">{message}</div>}
        </div>

        <div className="video-studio__panel video-studio__result">
          <div className="video-studio__card-label">PREVIEW</div>
          {activeVideo ? (
            <video key={activeVideo.id} src={activeVideo.videoUrl} controls autoPlay loop playsInline />
          ) : (
            <div className="video-studio__empty"><Film size={28} /><span>生成的视频会在这里播放</span></div>
          )}
        </div>
      </section>

      {history.length > 0 && (
        <section className="video-studio__history">
          <div className="video-studio__card-label">HISTORY <button type="button" className="video-studio__clear" onClick={() => { setHistory([]); setActiveVideo(null) }}><Trash2 size={12} /> 清空</button></div>
          <div className="video-studio__history-grid">
            {history.map((item) => (
              <button type="button" key={item.id} className={`video-studio__history-item ${activeVideo?.id === item.id ? 'is-active' : ''}`} onClick={() => setActiveVideo(item)}>
                <video src={item.videoUrl} muted playsInline preload="metadata" />
                <span>{item.prompt.slice(0, 18)}… · {item.duration}s · {item.ratio}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
