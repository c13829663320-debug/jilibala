// ============================================================================
// 场景创作工作室 · API 客户端封装
// 所有调用走同源 /api（vite 代理到后端），与 CharacterHall / CustomCharacterStudio 一致。
// ============================================================================
import type {
  CreateSceneRequest,
  GameplayTemplate,
  SceneAssetRecord,
  SceneBlueprint,
  SceneGenerateEvent,
  ScenePlayPayload,
  SceneRecord,
  TerrainTheme,
  UpdateSceneRequest,
} from '@balabala/shared'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { message?: string }
      if (data?.message) message = data.message
    } catch { /* ignore */ }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

/** 判断 characterId 是否为自定义人物（名人 id 如 elon-musk，自定义人物以 custom- 开头）。 */
export function isCustomCharacterId(characterId: string): boolean {
  return /^custom[-_]/i.test(characterId)
}

// ---------------------------------------------------------------------------
// SSE 解析（纯函数，便于单测）
// ---------------------------------------------------------------------------

/**
 * 把一行 SSE data: 载荷解析为 SceneGenerateEvent。
 * 解析失败返回 null。导出为纯函数，方便单测覆盖。
 */
export function parseSceneSseData(raw: string): SceneGenerateEvent | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const obj = JSON.parse(text) as SceneGenerateEvent
    if (obj && typeof obj === 'object' && 'type' in obj) return obj
    return null
  } catch {
    return null
  }
}

/**
 * 消费 fetch 返回的 ReadableStream（text/event-stream），逐行解析 data: 载荷并回调。
 * 读完返回。abort 时直接 resolve。
 */
async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SceneGenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 以空行分隔事件；逐行处理 data: 前缀。
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        const event = parseSceneSseData(payload)
        if (event) onEvent(event)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ---------------------------------------------------------------------------
// 1. 生成场景（SSE 流式）
// ---------------------------------------------------------------------------

export interface GenerateSceneOptions {
  theme?: TerrainTheme
  gameplay?: GameplayTemplate
  ownerId?: string
  /** 每收到一个 SSE 事件回调一次（用于进度 / 蓝图逐步更新）。 */
  onEvent?: (event: SceneGenerateEvent) => void
  signal?: AbortSignal
}

/**
 * POST /api/scenes/generate —— 读 SSE 流。
 * 返回一个 Promise：流结束时 resolve，携带最终收到的蓝图（若有）与场景 id。
 * 进度通过 opts.onEvent 增量回调。
 */
export async function generateScene(
  description: string,
  opts: GenerateSceneOptions = {},
): Promise<{ sceneId?: string; blueprint?: SceneBlueprint }> {
  const body: CreateSceneRequest = {
    description,
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.gameplay ? { gameplay: opts.gameplay } : {}),
    ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
  }
  const res = await fetch('/api/scenes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    await readJson<unknown>(res).catch(() => undefined)
    throw new Error('场景生成请求失败')
  }
  let finalBlueprint: SceneBlueprint | undefined
  let sceneId: string | undefined
  const captureId = (event: SceneGenerateEvent) => {
    // done 事件或任意事件里可能回传 sceneId（不同后端实现不同，尽量都接住）
    const maybe = event as { sceneId?: string; id?: string; scene?: { id?: string } }
    if (typeof maybe.sceneId === 'string' && maybe.sceneId) sceneId = maybe.sceneId
    else if (typeof maybe.id === 'string' && maybe.id && event.type !== 'asset') sceneId = maybe.id
    else if (maybe.scene && typeof maybe.scene.id === 'string') sceneId = maybe.scene.id
  }
  await consumeSseStream(res.body, (event) => {
    if (event.type === 'blueprint') finalBlueprint = event.blueprint
    captureId(event)
    opts.onEvent?.(event)
  }, opts.signal)
  return { sceneId, blueprint: finalBlueprint }
}

// ---------------------------------------------------------------------------
// 2. 场景 CRUD
// ---------------------------------------------------------------------------

/** GET /api/scenes/list —— 场景列表。ownerId 不传则由后端取当前用户。 */
export async function listScenes(ownerId?: string): Promise<SceneRecord[]> {
  const qs = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''
  const res = await fetch(`/api/scenes/list${qs}`)
  const data = await readJson<{ scenes?: SceneRecord[] } | SceneRecord[]>(res)
  return Array.isArray(data) ? data : (data.scenes ?? [])
}

/** GET /api/scenes/:id —— 单个场景详情（含 blueprint_json）。 */
export async function getScene(id: string): Promise<SceneRecord> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`)
  return readJson<SceneRecord>(res)
}

/** PUT /api/scenes/:id —— 更新蓝图 / 名称 / NPC / 结构。 */
export async function updateScene(id: string, patch: UpdateSceneRequest): Promise<SceneRecord> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return readJson<SceneRecord>(res)
}

/** POST /api/scenes/:id/npc —— 给场景添加一个 NPC。 */
export async function addNpc(
  sceneId: string,
  npc: Omit<import('@balabala/shared').SceneNpc, 'id'>,
): Promise<SceneRecord> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/npc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(npc),
  })
  return readJson<SceneRecord>(res)
}

/** POST /api/scenes/:id/publish —— 发布场景（status → published）。 */
export async function publishScene(id: string): Promise<SceneRecord> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}/publish`, { method: 'POST' })
  return readJson<SceneRecord>(res)
}

/** DELETE /api/scenes/:id。 */
export async function deleteScene(id: string): Promise<void> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) await readJson<unknown>(res).catch(() => undefined)
}

/** GET /api/scenes/:id/play —— 运行时播放载荷。 */
export async function getPlayPayload(id: string): Promise<ScenePlayPayload> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}/play`)
  return readJson<ScenePlayPayload>(res)
}

/** GET /api/scenes/:id/assets —— 结构资产记录（用于布置面板展示资产状态）。 */
export async function listSceneAssets(sceneId: string): Promise<SceneAssetRecord[]> {
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/assets`)
    const data = await readJson<{ assets?: SceneAssetRecord[] } | SceneAssetRecord[]>(res)
    return Array.isArray(data) ? data : (data.assets ?? [])
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 3. NPC 对话 / TTS / 名人列表
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * POST /api/celebrities/:id/chat 或 /api/custom-characters/:id/chat。
 * 根据 characterId 自动选端点；自定义人物额外带 userId。
 */
export async function chatWithNpc(
  characterId: string,
  messages: ChatMessage[],
  userId?: string,
): Promise<string> {
  const custom = isCustomCharacterId(characterId)
  const url = custom
    ? `/api/custom-characters/${encodeURIComponent(characterId)}/chat`
    : `/api/celebrities/${encodeURIComponent(characterId)}/chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      ...(custom && userId ? { userId } : {}),
    }),
  })
  const data = await readJson<{ reply?: string; message?: string }>(res)
  if (!data.reply) throw new Error(data.message || '对话失败')
  return data.reply
}

/** POST /api/tts —— 合成语音，返回可播放的 object URL（调用方负责 revoke）。 */
export async function synthesizeSpeech(text: string, voice?: string): Promise<string> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
  })
  if (!res.ok) throw new Error('语音合成失败')
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** GET /api/celebrities —— 名人列表（人物选择器用）。 */
export async function fetchCelebrities(): Promise<import('@balabala/shared').Celebrity[]> {
  try {
    const res = await fetch('/api/celebrities')
    const data = await readJson<{ celebrities?: import('@balabala/shared').Celebrity[] } | import('@balabala/shared').Celebrity[]>(res)
    return Array.isArray(data) ? data : (data.celebrities ?? [])
  } catch {
    // 后端列表不可用时降级到本地静态表（与人物馆一致）
    const { CELEBRITIES } = await import('@balabala/shared')
    return CELEBRITIES
  }
}

/** POST /api/ai/polish?context=post —— AI 智能优化场景描述。 */
export async function polishSceneDescription(description: string): Promise<string> {
  const res = await fetch('/api/ai/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: description, context: 'post' }),
  })
  const data = await readJson<{ result?: string; message?: string }>(res)
  if (!data.result) throw new Error(data.message || 'AI 优化失败')
  return data.result
}
