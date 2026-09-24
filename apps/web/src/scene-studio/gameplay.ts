// ===== 玩法状态机 纯函数模块 =====
// 不可变更新：每个函数返回新的 GameplayState，不修改入参。
// 可在 node 环境单测。

import type { GameplayTemplate, SceneBlueprint } from '@balabala/shared'

export type GameplayState = {
  template: GameplayTemplate
  /** collect 模板：已收集的物品 id */
  collected: Set<string>
  /** collect 模板：全部目标 id（从 blueprint.gameplay.config.collectTargets 复制） */
  collectTargets: string[]
  /** reach 模板：是否已到达目标 */
  reached: boolean
  /** quest 模板：当前步骤下标（从 0 开始） */
  questStep: number
  /** quest 模板：总步数 */
  questTotal: number
  /** 是否完成 */
  completed: boolean
}

/** 根据 blueprint.gameplay.template 初始化状态。 */
export function createGameplayState(blueprint: SceneBlueprint): GameplayState {
  const template = blueprint.gameplay.template
  const cfg = blueprint.gameplay.config
  return {
    template,
    collected: new Set<string>(),
    collectTargets: cfg.collectTargets ? [...cfg.collectTargets] : [],
    reached: false,
    questStep: 0,
    questTotal: cfg.questSteps?.length ?? 0,
    completed: false,
  }
}

/** collect：收集一个物品。若 itemId 不在目标列表或已收集，原样返回。全部收集完置 completed。 */
export function collectItem(state: GameplayState, itemId: string): GameplayState {
  if (!state.collectTargets.includes(itemId)) return state
  if (state.collected.has(itemId)) return state
  const collected = new Set(state.collected)
  collected.add(itemId)
  const completed = collected.size >= state.collectTargets.length
  return { ...state, collected, completed }
}

/** reach：玩家水平距离 goal < 2 米时，reached=true 且 completed=true。 */
export function checkReach(
  state: GameplayState,
  position: [number, number, number],
  goal: [number, number, number],
): GameplayState {
  if (state.completed) return state
  const dx = position[0] - goal[0]
  const dz = position[2] - goal[2]
  const dist = Math.sqrt(dx * dx + dz * dz)
  if (dist < 2) {
    return { ...state, reached: true, completed: true }
  }
  return state
}

/** quest：推进到下一步。超过最后一步时 completed=true。 */
export function advanceQuest(state: GameplayState): GameplayState {
  const questStep = state.questStep + 1
  const completed = questStep >= state.questTotal
  return { ...state, questStep, completed }
}

/** 查询是否已完成。 */
export function isCompleted(state: GameplayState): boolean {
  return state.completed
}
