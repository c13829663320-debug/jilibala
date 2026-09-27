/**
 * R5 分片B：首次哇时刻奖励文案（纯数据/函数，可单测）
 *
 * 组件层：onboardingBus 收到 reward 事件 → 调 claimFirstWow()；
 * 仅当本次领取成功（返回 true）时才弹窗，保证只领一次。
 */

export interface FirstWowContent {
  emoji: string
  title: string
  body: string
  badge: string
}

/** 首个哇时刻（完成第一场庭审）奖励内容。 */
export const FIRST_WOW_CONTENT: FirstWowContent = {
  emoji: '🎉',
  title: '首次庭审完成！',
  body: '你的第一份判决书已归档，审判长说：这案子办得漂亮。',
  badge: '初出茅庐',
}

/**
 * 根据 claimFirstWow() 的返回值决定是否弹窗。
 * 已领取过（返回 false）→ 不弹窗，避免重复打扰。
 */
export function shouldShowFirstWowDialog(claimResult: boolean): boolean {
  return claimResult === true
}
