// 酒吧辩论 · 角度克制三角共享类型（与后端 bar-orchestrator 对齐）
export type ArgumentAngle = 'data' | 'emotion' | 'logic';
export type StanceTendency = 'rational' | 'emotional' | 'mixed';
export type AngleEffectiveness = 'counter' | 'neutral' | 'same';

export interface ArgumentScore {
  content_quality: number;
  relevance: number;
}

/** 克制分值表（与后端 resolveAngleCounter 保持一致，纯查询用）。 */
export const ANGLE_META: Record<ArgumentAngle, { emoji: string; title: string; sub: string }> = {
  data: { emoji: '📊', title: '摆事实', sub: '数据 / 案例' },
  emotion: { emoji: '❤️', title: '打情感', sub: '故事 / 共情' },
  logic: { emoji: '🔍', title: '戳漏洞', sub: '逻辑 / 矛盾' },
};

export const TENDENCY_META: Record<StanceTendency, { emoji: string; label: string; hint: string }> = {
  rational: { emoji: '📐', label: '理性派', hint: '讲证据、论逻辑' },
  emotional: { emoji: '🎭', label: '感性派', hint: '讲故事、打共情' },
  mixed: { emoji: '🔀', label: '混合派', hint: '真假难辨，用逻辑戳' },
};

export const EFFECTIVENESS_META: Record<AngleEffectiveness, { label: string; delta: number; color: string }> = {
  counter: { label: '克制!', delta: 8, color: '#FFD600' },
  neutral: { label: '中性', delta: 5, color: '#4fb3a5' },
  same: { label: '同属性·减半', delta: 2, color: '#9a9aa8' },
};
