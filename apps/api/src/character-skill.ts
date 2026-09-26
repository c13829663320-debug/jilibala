// ===== 人物 skill 加载（服务端） =====
// 统一解析某人物当前生效的 skill：
// - 名人：优先读 apps/web/public/skills/<id>.md，缺失则从 celebrities.persona 生成默认。
// - 自定义人物：优先读 DB 里的 skill_md，空则从 persona 生成默认。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import {
  buildSystemPrompt,
  defaultSkillForCelebrity,
  defaultSkillForPersona,
  getCelebrity,
  parseSkillMarkdown,
  type CharacterSkill,
} from "@balabala/shared";
import { getCustomCharacter } from "./db.js";

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
