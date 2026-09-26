// ============================================================================
// 新手引导引擎。可跳过，不阻断复玩：skip 后标记完成，不再触发。
// ============================================================================

import type { TutorialStep } from './types.js';

export class TutorialEngine {
  readonly steps: TutorialStep[];
  currentStepIndex = 0;
  isActive = false;
  isSkipped = false;
  /** 本引导是否已完整完成或被跳过（持久层据此决定下次是否触发）。 */
  isCompleted = false;

  constructor(steps: TutorialStep[] = []) {
    this.steps = steps;
  }

  /** 开始引导（若无步骤则直接标记完成）。 */
  start(): void {
    if (this.isCompleted) return;
    if (this.steps.length === 0) {
      this.isCompleted = true;
      return;
    }
    this.currentStepIndex = 0;
    this.isActive = true;
    this.isSkipped = false;
  }

  /** 前进到下一步；走到末尾则结束。 */
  next(): void {
    if (!this.isActive) return;
    if (this.currentStepIndex + 1 >= this.steps.length) {
      this.finish();
      return;
    }
    this.currentStepIndex += 1;
  }

  /** 跳过引导：标记完成，不再触发。 */
  skip(): void {
    this.isActive = false;
    this.isSkipped = true;
    this.isCompleted = true;
  }

  /** 重置（仅调试 / 强教学模式用；普通复玩不应调用）。 */
  reset(): void {
    this.currentStepIndex = 0;
    this.isActive = false;
    this.isSkipped = false;
    this.isCompleted = false;
  }

  private finish(): void {
    this.isActive = false;
    this.isCompleted = true;
  }

  getCurrentStep(): TutorialStep | null {
    if (!this.isActive) return null;
    return this.steps[this.currentStepIndex] ?? null;
  }
}
