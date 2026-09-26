// ============================================================================
// 真人 / AI 槽位分配（纯函数）
// 规则：真人永远占第一个关键槽位（slot index 0），AI 填充其余空位。
// ============================================================================

import type { PlayerSlot } from './types.js';

export interface CreateSlotsConfig {
  /** 场景内每个槽位的角色名，长度 = 本局总人数。 */
  roles: string[];
  /** 期望由真人占据的槽位数（通常为 1）。 */
  humanCount: number;
  /** 可用于填充 AI 空位的名人 / persona 池。 */
  aiPersonas: string[];
}

/** 深拷贝一份槽位数组，避免调用方共享引用。 */
function clone(slots: PlayerSlot[]): PlayerSlot[] {
  return slots.map((s) => ({ ...s }));
}

/**
 * 创建一局的初始槽位排布。
 * 前 `humanCount` 个槽位标记为真人占位（isHuman=true 但 userId 未填），
 * 其余槽位立即按顺序用 aiPersonas 填充 AI。
 */
export function createSlots(config: CreateSlotsConfig): PlayerSlot[] {
  const { roles, humanCount, aiPersonas } = config;
  const slots: PlayerSlot[] = [];
  let aiCursor = 0;

  roles.forEach((role, i) => {
    const isHumanSlot = i < humanCount;
    slots.push({
      slotId: `slot-${i}`,
      role,
      isHuman: isHumanSlot,
      nickname: '',
      score: 0,
      active: true,
      ...(isHumanSlot
        ? {}
        : { aiPersona: aiPersonas[aiCursor++ % Math.max(aiPersonas.length, 1)] }),
    });
  });

  return slots;
}

/** 把一个真人绑定到指定槽位（覆盖占位）。返回新数组。 */
export function assignHumanToSlot(
  slots: PlayerSlot[],
  slotId: string,
  userId: string,
  nickname: string,
): PlayerSlot[] {
  const next = clone(slots);
  const slot = next.find((s) => s.slotId === slotId);
  if (!slot) return next;
  slot.isHuman = true;
  slot.userId = userId;
  slot.nickname = nickname;
  delete slot.aiPersona;
  return next;
}

/**
 * 把所有仍空着的真人占位槽位（isHuman=true 但无 userId）填成 AI。
 * 已绑定真人的槽位不动。返回新数组。
 */
export function fillWithAI(
  slots: PlayerSlot[],
  aiPersonas: string[],
): PlayerSlot[] {
  const next = clone(slots);
  let cursor = 0;
  const pool = aiPersonas.length > 0 ? aiPersonas : ['default-ai'];
  for (const slot of next) {
    const isEmptyHuman = slot.isHuman && !slot.userId;
    const isEmptyAI = !slot.isHuman && !slot.aiPersona;
    if (isEmptyHuman || isEmptyAI) {
      const persona = pool[cursor++ % pool.length];
      slot.isHuman = false;
      slot.aiPersona = persona;
      if (!slot.nickname) slot.nickname = persona;
    }
  }
  return next;
}

/** 第一个真人槽位（关键一方）；没有真人时返回 undefined。 */
export function getKeySlot(
  slots: PlayerSlot[],
): PlayerSlot | undefined {
  return slots.find((s) => s.isHuman && !!s.userId);
}

/** 所有真人槽位。 */
export function getHumanSlots(slots: PlayerSlot[]): PlayerSlot[] {
  return slots.filter((s) => s.isHuman && !!s.userId);
}

/** 所有 AI 槽位。 */
export function getAISlots(slots: PlayerSlot[]): PlayerSlot[] {
  return slots.filter((s) => !s.isHuman);
}
