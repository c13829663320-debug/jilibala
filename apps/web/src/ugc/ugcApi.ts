// ============================================================================
// R5-UGC 前端 API 客户端：发布/读取/模板市场/我的作品
// 同源 /api（vite 代理到后端）。
// ============================================================================
import type {
  SceneDraft,
  SceneTemplate,
  UgcPublishRequest,
  UgcSceneMeta,
  UgcSceneRecord,
} from '@balabala/shared'

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    let code = res.status === 404 ? 'not_found' : res.status === 403 ? 'forbidden' : 'network'
    try {
      const data = (await res.json()) as { error?: string; message?: string; code?: string }
      if (data?.error) message = data.error
      else if (data?.message) message = data.message
      if (data?.code) code = data.code
    } catch { /* ignore */ }
    throw Object.assign(new Error(message), { code })
  }
  return res.json() as Promise<T>
}

/** POST /api/ugc/scenes —— 发布一句话场景。 */
export async function publishUgcScene(
  body: UgcPublishRequest,
): Promise<{ sceneId: string; shareLink: string; status: string; isPublic: boolean }> {
  const res = await fetch('/api/ugc/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

/** GET /api/ugc/scenes/:id —— 进入一个已发布场景。 */
export async function fetchUgcScene(sceneId: string, viewerUserId?: string): Promise<UgcSceneRecord> {
  const qs = viewerUserId ? `?viewer=${encodeURIComponent(viewerUserId)}` : ''
  const res = await fetch(`/api/ugc/scenes/${encodeURIComponent(sceneId)}${qs}`)
  return readJson<UgcSceneRecord>(res)
}

/** GET /api/ugc/templates —— 官方模板 + 热门用户作品。 */
export async function fetchUgcTemplates(): Promise<{ official: SceneTemplate[]; hot: UgcSceneMeta[] }> {
  const res = await fetch('/api/ugc/templates')
  return readJson(res)
}

/** GET /api/ugc/mine?userId= —— 我的作品。 */
export async function fetchMyWorks(userId: string): Promise<UgcSceneMeta[]> {
  const res = await fetch(`/api/ugc/mine?userId=${encodeURIComponent(userId)}`)
  const data = await readJson<{ scenes?: UgcSceneMeta[] } | UgcSceneMeta[]>(res)
  return Array.isArray(data) ? data : (data.scenes ?? [])
}

/** PATCH /api/ugc/scenes/:id —— 编辑/重新发布/改可见性。 */
export async function updateUgcScene(
  sceneId: string,
  userId: string,
  patch: { name?: string; draft?: SceneDraft; isPublic?: boolean; status?: string },
): Promise<{ sceneId: string; status: string; shareLink: string }> {
  const res = await fetch(`/api/ugc/scenes/${encodeURIComponent(sceneId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...patch }),
  })
  return readJson(res)
}

/** DELETE /api/ugc/scenes/:id?userId= —— 删除我的作品。 */
export async function deleteUgcScene(sceneId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/ugc/scenes/${encodeURIComponent(sceneId)}?userId=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
  if (res.status !== 204) await readJson<unknown>(res).catch(() => undefined)
}
