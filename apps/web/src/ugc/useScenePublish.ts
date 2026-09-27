// ============================================================================
// useScenePublish —— 发布流程 hook：校验→生成 sceneId→写服务端→拿分享链接
// ============================================================================
import { useCallback, useState } from 'react'
import type { SceneDraft, ScenePublishStatus, SceneShareLink, UGCError } from '@balabala/shared'
import { validateDraftLocally, nextPublishStatus } from './publishFlow'
import { publishUgcScene } from './ugcApi'

export interface UseScenePublishResult {
  status: ScenePublishStatus
  shareLink: SceneShareLink | null
  error: UGCError | null
  publishing: boolean
  /** 提交发布：本地校验 → POST。 */
  publish: (args: { userId: string; name: string; draft: SceneDraft }) => Promise<SceneShareLink | null>
  reset: () => void
}

export function useScenePublish(): UseScenePublishResult {
  const [status, setStatus] = useState<ScenePublishStatus>('draft')
  const [shareLink, setShareLink] = useState<SceneShareLink | null>(null)
  const [error, setError] = useState<UGCError | null>(null)
  const [publishing, setPublishing] = useState(false)

  const reset = useCallback(() => {
    setStatus('draft')
    setShareLink(null)
    setError(null)
    setPublishing(false)
  }, [])

  const publish = useCallback(
    async ({ userId, name, draft }: { userId: string; name: string; draft: SceneDraft }) => {
      setError(null)
      // 1) 本地校验
      setStatus((s) => nextPublishStatus(s, 'submit'))
      const localErrs = validateDraftLocally(draft)
      if (localErrs.length > 0) {
        setStatus((s) => nextPublishStatus(s, 'validate-fail'))
        setError(localErrs[0])
        return null
      }
      setStatus((s) => nextPublishStatus(s, 'validate-ok'))
      // 2) 写服务端
      setPublishing(true)
      try {
        const res = await publishUgcScene({ userId, name, draft, isPublic: true })
        const link: SceneShareLink = {
          sceneId: res.sceneId,
          url: res.shareLink,
          status: 'published',
          createdAt: new Date().toISOString(),
        }
        setShareLink(link)
        setStatus((s) => nextPublishStatus(s, 'server-ok'))
        return link
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'server'
        setError({
          code,
          message: e instanceof Error ? e.message : '发布失败',
          retryable: code === 'network' || code === 'server',
        })
        setStatus((s) => nextPublishStatus(s, 'server-fail'))
        return null
      } finally {
        setPublishing(false)
      }
    },
    [],
  )

  return { status, shareLink, error, publishing, publish, reset }
}
