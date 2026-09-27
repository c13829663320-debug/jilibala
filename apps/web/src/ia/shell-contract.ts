/**
 * R5-IA 统一场景壳契约（纯逻辑校验，无 DOM，可单测）。
 *
 * 约定（Shell = 容器与导航，View = 场景内 3D 内容与交互）：
 * - 每个场景 Shell 对外必须满足 SceneShellProps（来自 @balabala/shared）；
 * - validateSceneShellProps 对传入对象做结构校验，返回错误文案数组（空 = 通过）；
 * - 各域在接线时应让自己的 Shell 产出符合本契约的 props，便于架构测试兜底。
 */
import { SCENE_META, type SceneShellProps, type SceneId } from '@balabala/shared'

const SCENE_ID_SET = new Set(SCENE_META.map((s) => s.id))

/** 运行时校验 SceneShellProps；返回所有违规项（空数组 = 合法）。 */
export function validateSceneShellProps(input: unknown): string[] {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return ['SceneShellProps 必须是非空对象']
  }
  const p = input as Record<string, unknown>

  if (typeof p.sceneId !== 'string' || !SCENE_ID_SET.has(p.sceneId as SceneId)) {
    errors.push(`sceneId 非法：${String(p.sceneId)}（必须是六大场景之一）`)
  }
  if (typeof p.title !== 'string' || p.title.trim() === '') {
    errors.push('title 必须是非空字符串')
  }
  if (p.mode !== 'fullscreen' && p.mode !== 'cards') {
    errors.push(`mode 必须是 'fullscreen' | 'cards'，实际：${String(p.mode)}`)
  }
  if (!Array.isArray(p.breadcrumb) || p.breadcrumb.length === 0) {
    errors.push('breadcrumb 必须是非空数组')
  } else {
    p.breadcrumb.forEach((item, i) => {
      if (typeof item !== 'object' || item === null || typeof (item as { label?: unknown }).label !== 'string') {
        errors.push(`breadcrumb[${i}] 缺少字符串 label`)
      }
    })
  }
  if (typeof p.onBack !== 'function') {
    errors.push('onBack 必须是函数')
  }
  if (p.error !== undefined && typeof p.error !== 'string') {
    errors.push('error 若提供必须是字符串')
  }
  if (p.loading !== undefined && typeof p.loading !== 'boolean') {
    errors.push('loading 若提供必须是布尔值')
  }
  return errors
}

/** 类型断言辅助：合法即返回 SceneShellProps，否则抛错（供开发期断言用，勿用于运行时渲染）。 */
export function assertSceneShellProps(input: unknown): SceneShellProps {
  const errors = validateSceneShellProps(input)
  if (errors.length) throw new Error(`SceneShellProps 校验失败：\n- ${errors.join('\n- ')}`)
  return input as SceneShellProps
}
