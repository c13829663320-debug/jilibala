// ===== R4-10: 名人音色映射（从 JSON 加载，缺失回退默认）=====
// 数据源：apps/api/data/character-voice-map.json
//   每个名人 → { voice: StepFun 预置音色 id, category: 气质类别, speed, pitch }
// 合规：voice 仅使用 packages/shared 白名单中的 StepFun 官方预置音色，
// 不调用 create_voice 克隆任何在世名人的真实声音。

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { DEFAULT_VOICE, isValidVoice, VOICE_WHITELIST } from "@balabala/shared";/** 音色气质类别（与 character-voice-map.json 对齐）。 */
export type VoiceCategory =
  | "deep_male"
  | "bright_female"
  | "old_male"
  | "old_female"
  | "young_male"
  | "young_female"
  | "neutral";

export interface CharacterVoiceConfig {
  /** StepFun voice id（白名单内）。 */
  voice: string;
  /** 气质类别标签，不模仿真人。 */
  category: VoiceCategory;
  /** 语速倍率，1.0 为正常。 */
  speed: number;
  /** 音调倍率，1.0 为正常。 */
  pitch: number;
}

const CATEGORIES: ReadonlySet<VoiceCategory> = new Set([
  "deep_male", "bright_female", "old_male", "old_female",
  "young_male", "young_female", "neutral",
]);

const dataDir = pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "data");

let cache: Record<string, CharacterVoiceConfig> | null = null;

function loadMap(): Record<string, CharacterVoiceConfig> {
  if (cache) return cache;
  const file = pathResolve(dataDir, "character-voice-map.json");
  if (!existsSync(file)) {
    cache = {};
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, Partial<CharacterVoiceConfig>>;
    const out: Record<string, CharacterVoiceConfig> = {};
    for (const [id, cfg] of Object.entries(raw)) {
      // 防路径穿越
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeId) continue;
      out[safeId] = {
        voice: isValidVoice(cfg.voice) ? (cfg.voice as string) : DEFAULT_VOICE,
        category: CATEGORIES.has(cfg.category as VoiceCategory) ? (cfg.category as VoiceCategory) : "neutral",
        speed: typeof cfg.speed === "number" && cfg.speed > 0.5 && cfg.speed < 2 ? cfg.speed : 1,
        pitch: typeof cfg.pitch === "number" && cfg.pitch > 0.5 && cfg.pitch < 2 ? cfg.pitch : 1,
      };
    }
    cache = out;
    return out;
  } catch {
    cache = {};
    return cache;
  }
}

/** 缺省音色配置（JSON 缺失或该 id 未配置时回退）。 */
export const DEFAULT_VOICE_CONFIG: CharacterVoiceConfig = {
  voice: DEFAULT_VOICE,
  category: "neutral",
  speed: 1,
  pitch: 1,
};

/** 获取某名人的 TTS 音色配置；未配置则返回默认音色。 */
export function getCharacterVoiceConfig(id: string): CharacterVoiceConfig {
  if (!id) return DEFAULT_VOICE_CONFIG;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const cfg = loadMap()[safeId];
  return cfg ?? { ...DEFAULT_VOICE_CONFIG };
}

/** 列出全部已配置的音色映射（用于覆盖率测试 / 管理接口）。 */
export function listCharacterVoiceConfigs(): Record<string, CharacterVoiceConfig> {
  return { ...loadMap() };
}

/** 已配置音色的名人数量。 */
export function configuredVoiceCount(): number {
  return Object.keys(loadMap()).length;
}

/** 仅供测试：清空缓存。 */
export function _resetVoiceCache(): void {
  cache = null;
}

// 保留白名单引用，便于外部从这里复用校验。
export { VOICE_WHITELIST, isValidVoice };
