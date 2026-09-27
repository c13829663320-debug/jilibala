// ============================================================================
// R5 · 高光捕捉纯函数
//
// 引擎在 act() 结算后，把「场景事件」喂给 detectHighlight；命中规则就吐出一条
// Highlight，不命中返回 null。本文件不持有任何状态，便于单测与跨引擎复用。
// ============================================================================

import type { Highlight, HighlightType } from './base-orchestrator.js';

/** detectHighlight 入参：一条场景内部事件。 */
export interface HighlightEvent {
  type: string;
  payload: Record<string, unknown>;
}

let highlightSeq = 0;
function nextId(): string {
  highlightSeq += 1;
  return `hl-${Date.now()}-${highlightSeq}`;
}

/** 安全取 payload 嵌套字段。 */
function get(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * 根据场景 + 事件判定是否产生高光。未命中返回 null。
 *
 * 各场景规则：
 *  - court     : court_card_resolved 且 hit===true 且 delta>=8        → key_evidence
 *  - talkshow  : joke_scored 且 scores.punchline>=35                 → golden_quote
 *  - werewolf  : vote_result 且 lynchedWerewolf===true                → prophet_vote
 *  - bar       : turn_resolved 且 effectiveness==='counter' 且 delta>=8 → epic_rebuttal
 *  - gym       : station_completed 且 perfectRate>=0.9                → extreme_performance
 *  - library   : answered 且 combo>=5                                 → high_combo
 *  - 通用      : settlement 事件 且 comeback===true                    → comeback
 */
export function detectHighlight(
  scene: string,
  event: HighlightEvent,
  state: Record<string, unknown> = {},
): Highlight | null {
  const p = event.payload;
  let type: HighlightType | null = null;
  let description = '';
  const data: Record<string, unknown> = { ...p };

  switch (`${scene}:${event.type}`) {
    case 'court:court_card_resolved': {
      const hit = p.hit === true;
      const delta = Number(p.delta) || 0;
      if (hit && delta >= 8) {
        type = 'key_evidence';
        description = `关键证据命中，天平 +${delta}`;
      }
      break;
    }
    case 'talkshow:joke_scored': {
      const punchline = Number(get(p, ['scores', 'punchline'])) || 0;
      if (punchline >= 35) {
        type = 'golden_quote';
        description = `爆梗达成，包袱分 ${punchline}`;
      }
      break;
    }
    case 'werewolf:vote_result': {
      if (p.lynchedWerewolf === true) {
        type = 'prophet_vote';
        description = '公投精准带走一匹狼';
      }
      break;
    }
    case 'bar:turn_resolved': {
      const effectiveness = p.effectiveness;
      const delta = Number(p.delta) || 0;
      if (effectiveness === 'counter' && delta >= 8) {
        type = 'epic_rebuttal';
        description = `漂亮反驳，气势 +${delta}`;
      }
      break;
    }
    case 'gym:station_completed': {
      const perfectRate = Number(p.perfectRate) || 0;
      if (perfectRate >= 0.9) {
        type = 'extreme_performance';
        description = `本站完美率 ${(perfectRate * 100).toFixed(0)}%`;
      }
      break;
    }
    case 'library:answered': {
      const combo = Number(p.combo) || 0;
      if (combo >= 5) {
        type = 'high_combo';
        description = `连对 ${combo} 题`;
      }
      break;
    }
    default: {
      // 通用：结算时翻盘
      if (event.type === 'settlement' && p.comeback === true) {
        type = 'comeback';
        description = '逆风翻盘！';
      }
    }
  }

  if (!type) return null;

  return {
    id: nextId(),
    scene,
    type,
    timestamp: Number(p.timestamp) || Date.now(),
    ...(typeof p.round === 'number' ? { round: p.round } : {}),
    description,
    data,
  };
}

/** 高光类型 → 中文名（战果卡 / 复盘用）。 */
export const HIGHLIGHT_TYPE_LABEL: Record<HighlightType, string> = {
  key_evidence: '关键证据',
  golden_quote: '爆梗金句',
  epic_rebuttal: '神级反驳',
  prophet_vote: '睿智投票',
  extreme_performance: '极致发挥',
  high_combo: '连胜连击',
  comeback: '逆风翻盘',
  perfect_round: '完美回合',
};

/** 把高光格式化成一句可读文案。 */
export function formatHighlightDescription(h: Highlight): string {
  const label = HIGHLIGHT_TYPE_LABEL[h.type] ?? '高光';
  return `【${label}】${h.description}`;
}

/** 按类型过滤高光。 */
export function getHighlightsByType(
  highlights: Highlight[],
  type: HighlightType,
): Highlight[] {
  return highlights.filter((h) => h.type === type);
}
