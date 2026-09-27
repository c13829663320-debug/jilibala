// ============================================================================
// UGC 加载失败降级策略（纯函数，可单测）
// 依据错误码给出：提示文案 + 推荐模板 + 下一步动作。
// ============================================================================

export type FallbackKind = 'retry' | 'browse-templates' | 'back-to-plaza' | 'edit-and-repost'

export interface FallbackAction {
  kind: FallbackKind
  /** 面向用户的错误说明 */
  message: string
  /** 推荐模板 id（点击即用），可空 */
  recommendedTemplateId?: string
  /** 兜底跳转路由 */
  route: string
}

/** 常见可重试错误码（网络/5xx/超时）。 */
const RETRYABLE_CODES = new Set(['network', 'timeout', 'server', 'server-fail', 'load-failed'])

/** 找不到场景 → 引导逛模板。 */
const NOT_FOUND: FallbackAction = {
  kind: 'browse-templates',
  message: '这个场景不存在或已被作者删除，去模板市场挑一个吧。',
  recommendedTemplateId: 'fairy-plaza',
  route: '/studio?view=templates',
}

/** 无权限 → 回广场。 */
const FORBIDDEN: FallbackAction = {
  kind: 'back-to-plaza',
  message: '这是作者私有的场景，无权进入。先回广场逛逛。',
  route: '/?plaza=1',
}

/**
 * 根据错误对象决定降级动作。
 * err 形如 { code, message }；无 code 时按网络错误处理。
 */
export function decideFallback(err: { code?: string; message?: string } | null | undefined): FallbackAction {
  const code = (err?.code ?? '').toLowerCase()

  if (code === 'not_found' || code === '404') return NOT_FOUND
  if (code === 'forbidden' || code === '403') return FORBIDDEN

  if (RETRYABLE_CODES.has(code)) {
    return {
      kind: 'retry',
      message: err?.message || '场景加载开小差了，点一下重试。',
      recommendedTemplateId: 'starlight-court',
      route: windowFriendlyRoute(),
    }
  }

  if (code === 'invalid_draft' || code === 'bad_prompt') {
    return {
      kind: 'edit-and-repost',
      message: '草稿有问题没发布成功，回去改改描述再发一次。',
      route: '/studio?view=new',
    }
  }

  // 未知错误：默认重试 + 推荐模板
  return {
    kind: 'retry',
    message: err?.message || '场景加载失败了，稍后再试或看看模板。',
    recommendedTemplateId: 'cyber-bar',
    route: windowFriendlyRoute(),
  }
}

/** 重试动作保持当前页（路由不变）。 */
function windowFriendlyRoute(): string {
  return locationSafeHref()
}

/** 不直接依赖 window（node 单测下），返回占位。 */
function locationSafeHref(): string {
  try {
    return typeof window !== 'undefined' ? window.location.search : '/'
  } catch {
    return '/'
  }
}
