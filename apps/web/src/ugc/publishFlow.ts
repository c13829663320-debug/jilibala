// ============================================================================
// 发布流程状态机 + 草稿校验（纯函数，可单测）
// draft → previewing → published | failed
// ============================================================================
import type { SceneDraft, ScenePublishStatus, UGCError } from '@balabala/shared'

/** 触发状态迁移的事件。 */
export type PublishEvent =
  | 'submit'        // 用户点“发布”，开始校验
  | 'validate-ok'   // 本地校验通过，请求服务端
  | 'validate-fail' // 本地校验失败
  | 'server-ok'     // 服务端落库成功
  | 'server-fail'   // 服务端/网络失败
  | 'reset'         // 回到草稿重编

/**
 * 发布状态机迁移。非法迁移原样返回当前态（防御式）。
 * draft --submit--> previewing
 * previewing --validate-ok--> (等待 server)；--server-ok--> published；--server-fail--> failed
 * previewing --validate-fail--> failed
 * failed/published --reset--> draft
 */
export function nextPublishStatus(current: ScenePublishStatus, event: PublishEvent): ScenePublishStatus {
  switch (event) {
    case 'submit':
      return current === 'draft' ? 'previewing' : current
    case 'validate-ok':
      // 校验通过后仍在 previewing，等待服务端结果
      return current === 'previewing' ? 'previewing' : current
    case 'validate-fail':
      return current === 'previewing' ? 'failed' : current
    case 'server-ok':
      return current === 'previewing' ? 'published' : current
    case 'server-fail':
      return current === 'previewing' ? 'failed' : current
    case 'reset':
      return 'draft'
    default:
      return current
  }
}

/** 本地草稿校验：返回错误列表（空 = 可发布）。 */
export function validateDraftLocally(draft: Partial<SceneDraft> | null | undefined): UGCError[] {
  const errors: UGCError[] = []
  if (!draft) {
    errors.push({ code: 'bad_prompt', message: '请先描述你想要的场景', retryable: false })
    return errors
  }
  if (!draft.rawPrompt || !draft.rawPrompt.trim()) {
    errors.push({ code: 'bad_prompt', message: '描述不能为空，说一句话你想要的场景吧', retryable: false })
  }
  if (!draft.theme) {
    errors.push({ code: 'bad_prompt', message: '没能识别出场景主题，换个说法试试', retryable: false })
  }
  if (!draft.gameType) {
    errors.push({ code: 'bad_prompt', message: '缺少玩法类型', retryable: false })
  }
  if (draft.celebrityIds !== undefined && !Array.isArray(draft.celebrityIds)) {
    errors.push({ code: 'bad_prompt', message: '参与名人数据异常', retryable: false })
  }
  return errors
}

/** 给定状态机当前态 + 事件序列，跑到终点（纯函数，便于测试）。 */
export function runStateMachine(events: PublishEvent[]): ScenePublishStatus {
  let s: ScenePublishStatus = 'draft'
  for (const e of events) s = nextPublishStatus(s, e)
  return s
}
