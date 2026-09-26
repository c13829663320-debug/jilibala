// ===== M13: 角色音色映射与白名单 =====
// 前后端共用：
// - 后端 /api/tts 用 VOICE_WHITELIST / isValidVoice 做入参校验，非法音色回退默认；
// - 前端用 resolveCharacterVoice(ref, voice) 把发言者映射到具体音色后调用 playTts。
//
// 合规：所有音色均为 StepFun step-tts-mini 官方预置音色，只做「气质贴合」，
// 不调用音色复刻（create_voice）克隆任何在世名人的真实声音。

import { getCelebrity } from "./celebrities.js";

/** 兜底默认音色（经典女声）。 */
export const DEFAULT_VOICE = "jingdiannvsheng";

/**
 * 法庭固定角色 → 音色映射。
 * key 与 CourtTurn.speaker / 合议庭 speakerId 对齐：
 *  judge=法官 / plaintiff=原告 / defendant=被告 / defender=辩护人 / witness=证人。
 * 旁听者（旁听者08-13）不发言，不配音。
 */
export const COURT_ROLE_VOICES: Record<string, string> = {
  judge: "cixingnansheng",        // 磁性男生 · 威严
  plaintiff: "boyinnansheng",     // 播音男生 · 陈述清晰有力
  "plaintiff-counsel": "ruyananshi", // 儒雅男士 · 专业冷静
  defendant: "shenchennanyin",     // 低沉男音
  "defendant-counsel": "ruyananshi",
  defender: "ruyananshi",          // M13 CourtTurn.speaker='defender'
  witness: "qingniandaxuesheng",   // 青年大学生 · 年轻
  juror: "wenrounansheng",          // 温柔男生
};

/** 单个音色的元信息（供自定义人物音色选择器分组展示）。 */
export interface VoiceOption {
  /** StepFun voice 标识，直接传给 /api/tts。 */
  id: string;
  /** 中文展示名。 */
  label: string;
  /** 性别分组。 */
  gender: "female" | "male";
}

/**
 * 官方预置音色白名单（step-tts-mini）。
 * 前后端传入的 voice 必须落在这个集合内，否则回退 DEFAULT_VOICE。
 * 这里至少包含全部已在名人/法庭映射中使用的音色。
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  // —— 女声 ——（本账户实测可用）
  { id: "jingdiannvsheng", label: "经典女声（默认）", gender: "female" },
  { id: "zhixingjiejie", label: "知性姐姐", gender: "female" },
  { id: "wenrounvsheng", label: "温柔女声", gender: "female" },
  { id: "tianmeinvsheng", label: "甜美女声", gender: "female" },
  // —— 男声 ——（本账户实测可用）
  { id: "boyinnansheng", label: "播音男生", gender: "male" },
  { id: "ruyananshi", label: "儒雅男士", gender: "male" },
  { id: "cixingnansheng", label: "磁性男生", gender: "male" },
  { id: "wenrougongzi", label: "温柔公子", gender: "male" },
  { id: "yuanqinansheng", label: "元气男生", gender: "male" },
  { id: "wenrounansheng", label: "温柔男生", gender: "male" },
  { id: "zhengpaiqingnian", label: "正派青年", gender: "male" },
  { id: "shenchennanyin", label: "低沉男音", gender: "male" },
  { id: "qingniandaxuesheng", label: "青年大学生", gender: "male" },
];

/** 白名单：合法音色 id 集合。 */
export const VOICE_WHITELIST: ReadonlySet<string> = new Set(VOICE_OPTIONS.map((v) => v.id));

/** 校验音色是否在官方白名单内。 */
export function isValidVoice(voice: unknown): voice is string {
  return typeof voice === "string" && VOICE_WHITELIST.has(voice);
}

/**
 * 解析某发言者应使用的音色。
 * 解析顺序：
 *   1. 显式传入的 voice（自定义人物 card.voice / 前端已知音色）若合法则直接用；
 *   2. custom-xxx：无显式音色时回退默认（shared 不读 db，由调用方传入 card.voice）；
 *   3. 法庭固定角色（judge/plaintiff/defendant/defender/witness/juror…）；
 *   4. 预置名人 id → celebrity.voice；
 *   5. 兜底 DEFAULT_VOICE。
 */
export function resolveCharacterVoice(ref: string, explicitVoice?: string): string {
  if (isValidVoice(explicitVoice)) return explicitVoice;

  if (ref) {
    // custom- 前缀：调用方应传入 card.voice；未传则走兜底。
    if (ref.startsWith("custom-")) return DEFAULT_VOICE;

    // 法庭固定角色。
    const courtVoice = COURT_ROLE_VOICES[ref];
    if (courtVoice) return courtVoice;

    // 预置名人。
    const celeb = getCelebrity(ref);
    if (celeb?.voice && isValidVoice(celeb.voice)) return celeb.voice;
  }
  return DEFAULT_VOICE;
}
