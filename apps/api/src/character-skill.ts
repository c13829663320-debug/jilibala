// ===== 人物 skill 加载（服务端） =====
// 统一解析某人物当前生效的 skill：
// - 名人：优先读 apps/web/public/skills/<id>.md，缺失则从 celebrities.persona 生成默认。
// - 自定义人物：优先读 DB 里的 skill_md，空则从 persona 生成默认。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as pathResolve } from "node:path";
import {
  buildSystemPrompt,
  defaultSkillForCelebrity,
  defaultSkillForPersona,
  getCelebrity,
  parseSkillMarkdown,
  type CharacterSkill,
} from "@balabala/shared";
import { getCustomCharacter } from "./db.js";

/** R4-10: 名人专属开场白（首次出场 TTS 合成用）。 */
export interface CharacterGreeting {
  /** 开场白文案（1~3 句；外国人物可能含原文名句行）。 */
  lines: string[];
  /** 是否启用（默认 true，运营可关闭）。 */
  enabled: boolean;
}

const greetingsFile = pathResolve(
  dirname(fileURLToPath(import.meta.url)),
  "..", "data", "character-greetings.json",
);

let greetingCache: Record<string, CharacterGreeting> | null = null;

function loadGreetingMap(): Record<string, CharacterGreeting> {
  if (greetingCache) return greetingCache;
  if (!existsSync(greetingsFile)) {
    greetingCache = {};
    return greetingCache;
  }
  try {
    const raw = JSON.parse(readFileSync(greetingsFile, "utf8")) as Record<string, Partial<CharacterGreeting>>;
    const out: Record<string, CharacterGreeting> = {};
    for (const [id, g] of Object.entries(raw)) {
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeId) continue;
      out[safeId] = {
        lines: Array.isArray(g.lines) ? g.lines.filter((l): l is string => typeof l === "string" && l.length > 0) : [],
        enabled: g.enabled !== false,
      };
    }
    greetingCache = out;
    return out;
  } catch {
    greetingCache = {};
    return greetingCache;
  }
}

/**
 * R4-10: 获取某名人首次出场的专属开场白。
 * 优先取 data/character-greetings.json；缺失时回退 celebrities.greeting。
 * 自定义人物 / 未知 id 返回 null。
 */
export function getCharacterGreeting(id: string): CharacterGreeting | null {
  if (!id || id.startsWith("custom-")) return null;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const cfg = loadGreetingMap()[safeId];
  if (cfg && cfg.lines.length > 0) return cfg;
  // 回退到 celebrities.ts 内置 greeting
  const celeb = getCelebrity(safeId);
  if (celeb?.greeting) return { lines: [celeb.greeting], enabled: true };
  return null;
}

/**
 * 解析名人 skill 文件目录。
 * dev: cwd=apps/api → ../web/public/skills；构建后/其它 cwd 也逐一尝试。
 */
function resolveSkillsDir(): string {
  const candidates = [
    pathResolve(process.cwd(), "apps/web/public/skills"),
    pathResolve(process.cwd(), "web/public/skills"),
    pathResolve(pathResolve(process.cwd(), ".."), "web/public/skills"),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* ignore */ }
  }
  return candidates[candidates.length - 1];
}

/**
 * 加载某人物当前生效的 skill。找不到人物返回 undefined。
 * 解析后若 persona 为空，回退到该人物原始 persona，避免 system prompt 丢人格。
 */
export function loadCharacterSkill(id: string): CharacterSkill | undefined {
  if (!id) return undefined;

  if (id.startsWith("custom-")) {
    const rec = getCustomCharacter(id);
    if (!rec) return undefined;
    if (rec.skillMd && rec.skillMd.trim()) {
      try {
        const s = parseSkillMarkdown(rec.skillMd, id);
        if (!s.persona.trim()) s.persona = rec.persona;
        return s;
      } catch {
        // 非法 markdown 不崩溃，落到默认
      }
    }
    return defaultSkillForPersona(id, rec.name, rec.persona, rec.intro);
  }

  const celeb = getCelebrity(id);
  if (!celeb) return undefined;

  const file = join(resolveSkillsDir(), `${id}.md`);
  if (existsSync(file)) {
    try {
      const md = readFileSync(file, "utf8");
      const s = parseSkillMarkdown(md, id);
      if (!s.persona.trim()) s.persona = celeb.persona;
      return s;
    } catch {
      // 读取/解析失败，落到默认
    }
  }
  return defaultSkillForCelebrity(celeb);
}

/** 把 skill 拼成对话 system prompt。 */
export { buildSystemPrompt };
