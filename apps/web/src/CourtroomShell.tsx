import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ChevronRight, Eye, Bot, Sparkles, Play, Scale, Upload, FileText, Gavel, WandSparkles, Users, Clock3, Check, Download } from 'lucide-react'
import {
  CELEBRITIES, getCelebrity,
  type BenchEvent, type BenchMember, type BenchSpeech, type BenchStage,
  type Celebrity, type Perspective, type Verdict,
} from '@balabala/shared'
import BenchSelection from './BenchSelection'
import LiveTranscript from './LiveTranscript'
import TrialInteraction, { type TrialInteractPayload } from './TrialInteraction'
import VerdictCard from './VerdictCard'

const CourtroomView = lazy(() => import('./CourtroomView'))

type HearingMode = 'quick' | 'evidence'
export type EvidenceMeta = { name: string; size: number; type: string }
type BenchPhase = 'config' | 'streaming' | 'verdict'

const STAGE_ORDER: BenchStage[] = ['forming', 'opening', 'debate', 'summary', 'verdict']
const STAGE_LABEL: Record<BenchStage, string> = {
  forming: '组建合议庭', opening: '开庭陈述', debate: '自由辩论', summary: '总结陈词', verdict: '宣判',
}

export type CourtroomShellProps = {
  caseText: string
  onCaseTextChange: (v: string) => void
  hearingMode: HearingMode
  onHearingModeChange: (m: HearingMode) => void
  perspective: Perspective
  onPerspectiveChange: (p: Perspective) => void
  evidenceFiles: EvidenceMeta[]
  onEvidenceFilesChange: (f: EvidenceMeta[]) => void
  onOpenAvatarStudio: () => void
  onPublishToPlaza: () => void
}

export default function CourtroomShell({
  caseText, onCaseTextChange, hearingMode, onHearingModeChange, perspective, onPerspectiveChange,
  evidenceFiles, onEvidenceFilesChange, onOpenAvatarStudio, onPublishToPlaza,
}: CourtroomShellProps) {
  const [benchPhase, setBenchPhase] = useState<BenchPhase>('config')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [members, setMembers] = useState<BenchMember[]>([])
  const [speeches, setSpeeches] = useState<BenchSpeech[]>([])
  const [currentStage, setCurrentStage] = useState<BenchStage>('forming')
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [votes, setVotes] = useState({ plaintiff: 0, defendant: 0 })
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [caseId, setCaseId] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [polishingCase, setPolishingCase] = useState(false)
  const [polishError, setPolishError] = useState('')
  const [showToast, setShowToast] = useState(false)
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealNote, setAppealNote] = useState('')
  const [certOpen, setCertOpen] = useState(false)

  const [avatarPrompt, setAvatarPrompt] = useState('卡通风格、穿红色法官袍的猫咪')
  const [avatarStatus, setAvatarStatus] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  const generatedTitle = useMemo(() => {
    const clean = caseText.trim()
    if (!clean) return '等待一个新案件'
    const firstSentence = clean.split(/[。！？!?\n]/)[0].trim()
    return (firstSentence.slice(0, 18) || '生活小事案')
  }, [caseText])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  // ===== AI 帮写 =====
  const polishCase = async () => {
    const input = caseText.trim()
    if (!input || polishingCase) return
    setPolishingCase(true); setPolishError('')
    try {
      const res = await fetch('/api/ai/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input, context: 'case' }) })
      const data = await res.json() as { result?: string; message?: string }
      if (!res.ok || !data.result) throw new Error(data.message ?? '润色失败')
      onCaseTextChange(data.result.slice(0, 120))
    } catch (e) { setPolishError(e instanceof Error ? e.message : '润色失败') }
    finally { setPolishingCase(false) }
  }

  // ===== 3D 分身生成（保留原 Tripo 接线） =====
  const generateAvatar = async () => {
    if (!avatarPrompt.trim()) return
    setAvatarStatus('提交中…'); setAvatarUrl('')
    try {
      const response = await fetch('/api/avatars/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text_to_model', prompt: avatarPrompt.trim() }) })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建任务失败')
      const taskId = data.taskId
      setAvatarStatus('已提交，正在生成…')
      const poll = async () => {
        const statusResponse = await fetch(`/api/avatars/tasks/${taskId}`)
        const task = (await statusResponse.json()) as { data?: { status?: string; output?: Record<string, string> }; status?: string; output?: Record<string, string> }
        const t = task.data ?? task
        if (t.status === 'success') { const output = t.output ?? {}; setAvatarUrl(output.pbr_model ?? output.model ?? output.mesh ?? ''); setAvatarStatus('生成完成'); return }
        if (t.status === 'failed') { setAvatarStatus('生成失败'); return }
        setAvatarStatus(`生成中… ${t.status ?? 'queued'}`)
        window.setTimeout(poll, 2500)
      }
      window.setTimeout(poll, 1200)
    } catch (error) { setAvatarStatus(error instanceof Error ? error.message : '生成失败') }
  }

  // ===== 启动庭审：建案 + POST SSE =====
  const startHearing = async (overrideInput?: string) => {
    const input = (overrideInput ?? caseText).trim()
    if (!input) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // 重置合议庭状态
    setMembers([]); setSpeeches([]); setVerdict(null); setCurrentStage('forming')
    setActiveSpeakerId(null); setVotes({ plaintiff: 0, defendant: 0 }); setErrorMessage('')
    setBenchPhase('streaming'); setIsStreaming(true); setShowToast(true)
    window.setTimeout(() => setShowToast(false), 2200)
    try {
      const created = await fetch('/api/cases', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, mode: hearingMode, perspective, evidence: evidenceFiles }),
      })
      if (!created.ok) { const e = await created.json().catch(() => ({})) as { message?: string }; throw new Error(e.message ?? '案件创建失败') }
      const { id } = await created.json() as { id: string }
      setCaseId(id)

      const response = await fetch(`/api/cases/${id}/bench/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celebrityIds: selectedIds, perspective, benchSize: selectedIds.length || 3 }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('庭审流连接失败')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          let event: BenchEvent
          try { event = JSON.parse(raw) as BenchEvent } catch { continue }
          handleBenchEvent(event)
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setIsStreaming(false)
        setErrorMessage(error instanceof Error ? error.message : '庭审服务暂时不可用')
      }
    }
  }

  const handleBenchEvent = (event: BenchEvent) => {
    switch (event.type) {
      case 'stage':
        setCurrentStage(event.stage); break
      case 'bench_members':
        setMembers(event.members); break
      case 'speech_start':
        setActiveSpeakerId(event.speakerId); break
      case 'speech':
        setSpeeches((prev) => [...prev, event.speech]); setActiveSpeakerId(event.speech.speakerId); break
      case 'vote_update':
        setVotes({ plaintiff: event.plaintiff, defendant: event.defendant }); break
      case 'verdict':
        setVerdict(event.verdict); setSpeeches(event.transcript); setIsStreaming(false); setBenchPhase('verdict'); break
      case 'error':
        setErrorMessage(event.message); setIsStreaming(false); break
      case 'user_ack':
        break
    }
  }

  // ===== 用户互动（fire-and-forget） =====
  const sendInteraction = (payload: TrialInteractPayload) => {
    if (!caseId) return
    if (payload.kind === 'vote' && payload.vote) {
      setVotes((prev) => ({ ...prev, [payload.vote as 'plaintiff' | 'defendant']: prev[payload.vote as 'plaintiff' | 'defendant'] + 1 }))
    }
    void fetch(`/api/cases/${caseId}/bench/interact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: payload.kind, text: payload.text, targetCelebrityId: payload.targetCelebrityId, evidenceName: payload.evidenceName, vote: payload.vote }),
    }).catch(() => { /* fire-and-forget */ })
  }

  // ===== 结束流程 =====
  const shareVerdict = async () => {
    setShareStatus('准备分享…')
    try {
      const response = await fetch(`/api/cases/${caseId}/share`, { method: 'POST' })
      const data = await response.json() as { shareUrl?: string; title?: string; quote?: string; message?: string }
      if (!response.ok || !data.shareUrl) throw new Error(data.message ?? '分享链接生成失败')
      const shareUrl = new URL(data.shareUrl, window.location.origin).toString()
      if (navigator.share) await navigator.share({ title: data.title ?? '叽里呱啦趣味法庭判决', text: data.quote ?? '', url: shareUrl })
      else { await navigator.clipboard.writeText(`${data.title ?? ''}\n${data.quote ?? ''}\n${shareUrl}`); setShareStatus('分享链接已复制') }
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '分享失败') }
    window.setTimeout(() => setShareStatus(''), 2800)
  }

  const publishCourt = async () => {
    setShareStatus('正在发布到广场…')
    try {
      const response = await fetch(`/api/cases/${caseId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await response.json() as { content?: unknown; message?: string }
      if (!response.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setShareStatus('已发布到广场')
      window.setTimeout(onPublishToPlaza, 900)
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '发布失败') }
    window.setTimeout(() => setShareStatus(''), 1600)
  }

  const beginAppeal = () => {
    const suffix = appealNote.trim() ? ` 上诉补充：${appealNote.trim()}` : ' 我对上一份判决提出复议。'
    const nextInput = `${caseText.replace(/\s+$/u, '')}${suffix}`.slice(0, 120)
    onCaseTextChange(nextInput)
    setAppealOpen(false); setAppealNote('')
    setBenchPhase('config')
    void startHearing(nextInput)
  }

  const toggleCelebrity = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id])
  }
  const autoSelect = (count: number) => {
    const pool = CELEBRITIES.filter((c) => !selectedIds.includes(c.id)).map((c) => c.id)
    setSelectedIds([...selectedIds, ...pool.slice(0, Math.max(0, count - selectedIds.length))])
  }

  const addEvidence = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).map((f) => ({ name: f.name, size: f.size, type: f.type }))
    if (files.length) onEvidenceFilesChange([...evidenceFiles, ...files].slice(0, 8))
    event.currentTarget.value = ''
  }

  const celebrities: Celebrity[] = members
    .map((m) => getCelebrity(m.celebrityId))
    .filter((c): c is Celebrity => Boolean(c))
  const stageIndex = STAGE_ORDER.indexOf(currentStage)

  return (
    <div className="workspace">
      {/* ===== 左侧配置栏 ===== */}
      <aside className="sidebar">
        <div className="eyebrow"><Sparkles size={14} /> 今日趣味法庭</div>
        <h1>把小事说清楚，<br /><span>让快乐继续发生。</span></h1>
        <p className="intro">输入一件生活小事，挑几位名人当合议庭，让他们替你辩个明白。</p>

        <label className="field-label" htmlFor="case">案件描述 · 客观叙述</label>
        <div className="textarea-wrap">
          <textarea id="case" value={caseText} onChange={(e) => onCaseTextChange(e.target.value)} placeholder="例如：谁把最后一块小蛋糕吃掉了？" maxLength={120} />
          <span>{caseText.length}/120</span>
        </div>
        <div className="polish-row">
          <button type="button" className="polish-button" onClick={() => void polishCase()} disabled={!caseText.trim() || polishingCase}>
            <Sparkles size={13} /> {polishingCase ? 'AI 润色中…' : '✨ AI 帮写'}
          </button>
          {polishError && <span className="polish-error">{polishError}</span>}
        </div>

        <div className="hearing-prep">
          <div className="prep-heading"><span>开庭方式</span><small>{hearingMode === 'evidence' ? '已带证据' : '轻装上庭'}</small></div>
          <div className="prep-segmented" role="tablist" aria-label="开庭方式">
            <button type="button" role="tab" aria-selected={hearingMode === 'quick'} className={hearingMode === 'quick' ? 'is-active' : ''} onClick={() => onHearingModeChange('quick')}>快速开庭</button>
            <button type="button" role="tab" aria-selected={hearingMode === 'evidence'} className={hearingMode === 'evidence' ? 'is-active' : ''} onClick={() => onHearingModeChange('evidence')}>带着证据开庭</button>
          </div>
          <div className="prep-heading prep-role-heading"><span>我的视角</span><small>AI 自动生成对手</small></div>
          <div className="perspective-grid" role="radiogroup" aria-label="我的视角">
            <button type="button" role="radio" aria-checked={perspective === 'plaintiff'} className={perspective === 'plaintiff' ? 'is-active' : ''} onClick={() => onPerspectiveChange('plaintiff')}><Scale size={14} /><span>原告</span><small>提出主张</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'defendant'} className={perspective === 'defendant' ? 'is-active' : ''} onClick={() => onPerspectiveChange('defendant')}><Bot size={14} /><span>被告</span><small>回应质疑</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'audience'} className={perspective === 'audience' ? 'is-active' : ''} onClick={() => onPerspectiveChange('audience')}><Eye size={14} /><span>观众</span><small>旁观站队</small></button>
          </div>
          <label className="evidence-dropzone" htmlFor="evidence-upload">
            <Upload size={15} /><span>{evidenceFiles.length ? `已选择 ${evidenceFiles.length} 份证据` : '添加聊天记录、图片或文件'}</span>
            <input id="evidence-upload" type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.zip" onChange={addEvidence} />
          </label>
          {evidenceFiles.length > 0 && (
            <div className="evidence-list">{evidenceFiles.map((file, i) => (
              <div className="evidence-chip" key={`${file.name}-${i}`}><FileText size={12} /><span title={file.name}>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => onEvidenceFilesChange(evidenceFiles.filter((_, idx) => idx !== i))}>×</button></div>
            ))}</div>
          )}
        </div>

        {benchPhase === 'config' && (
          <button className="primary-button" onClick={() => void startHearing()} disabled={!caseText.trim() || selectedIds.length < 3}>
            <Play size={17} fill="currentColor" /> 开始合议庭 <ChevronRight size={17} />
          </button>
        )}
        {errorMessage && <div className="error-message">{errorMessage}</div>}
        <div className="hint-row"><WandSparkles size={14} /> AI 会把你的故事变成一场有趣的名人辩论</div>

        <div className="avatar-builder">
          <div className="section-title"><span>创建 3D 分身</span><span className="phase-count">Tripo3D</span></div>
          <input value={avatarPrompt} onChange={(e) => setAvatarPrompt(e.target.value)} placeholder="例如：穿西装的赛博朋克律师" maxLength={120} />
          <button className="secondary-button" onClick={() => void generateAvatar()} disabled={!avatarPrompt.trim() || avatarStatus.startsWith('生成中') || avatarStatus === '提交中…'}><Sparkles size={14} /> 生成模型</button>
          <button className="secondary-button" onClick={onOpenAvatarStudio}>打开 3D 分身工坊</button>
          {avatarStatus && <div className="avatar-status">{avatarStatus}</div>}
          {avatarUrl && <a className="model-link" href={avatarUrl} target="_blank" rel="noreferrer">打开 GLB 模型文件</a>}
        </div>

        <div className="divider" />
        <div className="section-title"><span>庭审进度</span><span className="phase-count">{benchPhase === 'config' ? '待开庭' : `${stageIndex + 1} / ${STAGE_ORDER.length}`}</span></div>
        <div className="phase-list">{STAGE_ORDER.map((stage, i) => (
          <button key={stage} className={`phase-item ${currentStage === stage && benchPhase !== 'config' ? 'active' : ''} ${benchPhase !== 'config' && i < stageIndex ? 'done' : ''}`}>
            <span className={`phase-icon teal`}>{benchPhase !== 'config' && i < stageIndex ? <Check size={13} /> : i + 1}</span>
            <span>{STAGE_LABEL[stage]}</span>
            {currentStage === stage && benchPhase !== 'config' && <span className="live-pill">LIVE</span>}
          </button>
        ))}</div>
        <div className="sidebar-footer">
          <div><Users size={15} /> {members.length || selectedIds.length || '—'} 位名人</div>
          <div><Clock3 size={15} /> 约 {8 + members.length * 2} 分钟</div>
        </div>
      </aside>

      {/* ===== 右侧主舞台 ===== */}
      <section className="main-stage">
        <div className="stage-header">
          <div>
            <div className="stage-kicker"><span className="tiny-dot" /> {benchPhase === 'streaming' ? `正在进行 · ${STAGE_LABEL[currentStage]}` : benchPhase === 'verdict' ? '宣判完成' : '开庭准备'}</div>
            <h2>{generatedTitle}</h2>
            <div className="case-meta">
              <span>{hearingMode === 'evidence' ? '带证据开庭' : '快速开庭'}</span><span>·</span>
              <span>{perspective === 'audience' ? '观众视角' : perspective === 'plaintiff' ? '原告视角' : '被告视角'}</span>
              {evidenceFiles.length > 0 && <><span>·</span><span>{evidenceFiles.length} 份证据</span></>}
            </div>
          </div>
          <div className="stage-tools">
            <span className="scene-tag">3D 场景 · 趣味法庭</span>
          </div>
        </div>

        {/* config：选合议庭 */}
        {benchPhase === 'config' && (
          <BenchSelection selectedIds={selectedIds} onToggle={toggleCelebrity} onAutoSelect={autoSelect} onConfirm={() => void startHearing()} minCount={3} maxCount={5} />
        )}

        {/* streaming：3D 法庭 + 实时记录 + 互动 */}
        {benchPhase === 'streaming' && (
          <>
            <div className="scene-card">
              <Suspense fallback={null}>
                <CourtroomView celebrities={celebrities} activeSpeakerId={activeSpeakerId} />
              </Suspense>
              <div className="scene-overlay">
                <div className="camera-hint">拖动旋转 · 滚轮缩放</div>
                <div className="scene-corner"><Gavel size={13} /> 合议庭直播中</div>
              </div>
            </div>
            <div className="bench-live-grid">
              <LiveTranscript speeches={speeches} members={members} currentStage={currentStage} activeSpeakerId={activeSpeakerId} />
              <TrialInteraction perspective={perspective} members={members} disabled={isStreaming === false} votes={votes} onInteract={sendInteraction} />
            </div>
          </>
        )}

        {/* verdict：判决 + 结束操作 */}
        {benchPhase === 'verdict' && (
          <>
            <div className="scene-card">
              <Suspense fallback={null}>
                <CourtroomView celebrities={celebrities} activeSpeakerId={null} />
              </Suspense>
              <div className="scene-overlay">
                <div className="camera-hint">庭审结束</div>
                <div className="scene-corner"><Gavel size={13} /> 已归档</div>
              </div>
            </div>
            <div className="bench-verdict-grid">
              <VerdictCard verdict={verdict} transcript={speeches} onShare={() => void shareVerdict()} onPublish={() => void publishCourt()} onAppeal={() => setAppealOpen(true)} shareStatus={shareStatus} />
              <div className="cert-card">
                <h3>留下一份纪念</h3>
                <p>生成一张趣味法庭参与证书，截图保存或分享给朋友。</p>
                <button type="button" className="secondary-button" onClick={() => setCertOpen(true)}><Download size={14} /> 生成证书</button>
              </div>
            </div>
          </>
        )}
      </section>

      {showToast && <div className="toast"><Sparkles size={15} /> 合议庭已就位，欢迎开庭！</div>}

      {/* 上诉模态框 */}
      {appealOpen && (
        <div className="appeal-backdrop" onClick={() => setAppealOpen(false)}>
          <section className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="appeal-modal-head"><div><span className="micro-label">APPEAL HEARING</span><h2>发起二次上诉</h2></div><button type="button" className="icon-button" onClick={() => setAppealOpen(false)}>×</button></div>
            <p>保留原案卷事实，在下一轮庭审中加入一条新的理由或证据。</p>
            <textarea value={appealNote} onChange={(e) => setAppealNote(e.target.value)} placeholder="例如：补充医院诊断书，说明泡面导致肚子不舒服。" maxLength={100} />
            <div className="appeal-modal-actions">
              <button type="button" className="listen-button" onClick={() => setAppealOpen(false)}>稍后再说</button>
              <button type="button" className="send-button" onClick={beginAppeal}>确认上诉 <ChevronRight size={14} /></button>
            </div>
          </section>
        </div>
      )}

      {/* 证书模态框 */}
      {certOpen && (
        <div className="cert-backdrop" onClick={() => setCertOpen(false)}>
          <section className="certificate" onClick={(e) => e.stopPropagation()}>
            <div className="certificate__seal">⚖</div>
            <span className="micro-label">BALABALA SOCIAL COURT · CERTIFICATE</span>
            <h2>趣味法庭参与证书</h2>
            <p className="certificate__case">案件：{verdict?.title ?? generatedTitle}</p>
            <div className="certificate__members">
              <b>合议庭</b>
              <span>{members.map((m) => m.name).join(' · ') || '名人合议庭'}</span>
            </div>
            <blockquote>“{verdict?.quote ?? '把小事说清楚，让快乐继续发生。'}”</blockquote>
            <div className="certificate__foot">
              <span>原告/被告：{perspective === 'audience' ? '观众' : perspective === 'plaintiff' ? '原告' : '被告'}</span>
              <span>{new Date().toLocaleDateString('zh-CN')}</span>
            </div>
            <p className="certificate__hint">按 Ctrl/⌘ + P 或直接截图，把这份证书保存下来。</p>
            <button type="button" className="secondary-button" onClick={() => setCertOpen(false)}>关闭</button>
          </section>
        </div>
      )}
    </div>
  )
}
