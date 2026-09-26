// ===== 人物 Skill 绑定系统 =====
// 每个人物可绑定一个 skill 文件（Markdown + YAML frontmatter）。
// - frontmatter（--- 包裹）：name / description / version
// - body：## 人格 / ## 知识边界 / ## 行为规则 三个 section
// 对话时把 persona + knowledge + behavior 注入 system prompt；
// 场景 NPC 行为也可读取这些字段。
import type { Celebrity } from "./celebrities.js";

/** 人物 skill：解析后的结构化人格 / 知识 / 行为规则。 */
export type CharacterSkill = {
  /** 所属 character-id（名人 id 或 custom-xxx） */
  id: string;
  /** skill 名称 */
  name: string;
  /** 一句话描述 */
  description: string;
  version: string;
  /** 人格描述（合并进 system prompt） */
  persona: string;
  /** 知识边界 / 擅长领域 */
  knowledge: string;
  /** 行为规则 / 回答风格 / 禁忌 */
  behavior: string;
  /** 原始 markdown 全文 */
  raw: string;
};

const DEFAULT_VERSION = "1.0.0";

/** 默认行为规则（所有人物通用）。 */
export const DEFAULT_BEHAVIOR =
  "用第一人称作答；回答简洁生动，一般不超过150字，除非用户要求展开；不暴露这是系统提示。";

/**
 * 从 markdown 中抽取一个 `## <label>` section 的正文。
 * 返回 { content, nextIndex }：content 为该 section 标题之后、下一个同级标题之前的文本；
 * nextIndex 为下一个标题的起始位置（用于串联多个 section）。
 */
function extractSection(
  body: string,
  label: string,
  fromIndex: number,
): { content: string; nextIndex: number } | null {
  const re = new RegExp(`^##[ \\t]*${label}[ \\t]*$`, "m");
  const sliced = body.slice(fromIndex);
  const m = sliced.match(re);
  if (!m || m.index === undefined) return null;
  const headingStart = fromIndex + m.index;
  // 标题行的结尾换行
  const lineEnd = body.indexOf("\n", headingStart);
  const contentStart = lineEnd === -1 ? body.length : lineEnd + 1;

  // 找下一个 `## ` 同级标题
  const nextRe = /^##[ \t]+\S/m;
  const rest = body.slice(contentStart);
  const next = rest.match(nextRe);
  const contentEnd = next && next.index !== undefined ? contentStart + next.index : body.length;

  return { content: body.slice(contentStart, contentEnd).trim(), nextIndex: headingStart };
}

/** 把 body 按三个 section 切分。缺哪个 section 就给空串（兜底，不崩溃）。 */
function splitSections(body: string): Pick<CharacterSkill, "persona" | "knowledge" | "behavior"> {
  const result = { persona: "", knowledge: "", behavior: "" };
  // 顺序抽取；每个 section 独立查找（不要求严格顺序）。
  const persona = extractSection(body, "人格", 0);
  if (persona) result.persona = persona.content;
  const knowledge = extractSection(body, "知识边界", 0);
  if (knowledge) result.knowledge = knowledge.content;
  const behavior = extractSection(body, "行为规则", 0);
  if (behavior) result.behavior = behavior.content;
  return result;
}

/** 解析 `key: value` 形式的简单 frontmatter（不支持嵌套/多行，够用即可）。 */
function parseFrontmatter(text: string): { name: string; description: string; version: string } {
  let name = "";
  let description = "";
  let version = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (key === "name") name = value;
    else if (key === "description") description = value;
    else if (key === "version") version = value;
  }
  return { name, description, version };
}

/**
 * 解析 skill markdown。
 * - frontmatter 缺失/非法时不崩溃：整段按 body 处理，字段走兜底默认。
 * - 缺 section 时对应字段为空串，由调用方兜底。
 */
export function parseSkillMarkdown(md: string, id = ""): CharacterSkill {
  const raw = md ?? "";
  let name = "";
  let description = "";
  let version = "";
  let body = raw;

  const noBom = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  // 合法 frontmatter：必须以 `---` 开头，并在随后出现一个独占一行的 `---`。
  if (noBom.startsWith("---")) {
    afterOpen: {
      const rest = noBom.slice(3);
      const closeMatch = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
      if (!closeMatch || closeMatch.index === undefined) break afterOpen;
      const frontmatterText = rest.slice(0, closeMatch.index);
      body = rest.slice(closeMatch.index + closeMatch[0].length);
      const fm = parseFrontmatter(frontmatterText);
      name = fm.name;
      description = fm.description;
      version = fm.version;
    }
  }

  const sections = splitSections(body);

  return {
    id,
    name: name || id || "未命名技能",
    description,
    version: version || DEFAULT_VERSION,
    persona: sections.persona,
    knowledge: sections.knowledge,
    behavior: sections.behavior || DEFAULT_BEHAVIOR,
    raw,
  };
}

/** 把 CharacterSkill 序列回 markdown（规范化格式）。 */
export function serializeSkill(skill: CharacterSkill): string {
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.version || DEFAULT_VERSION}`,
    "---",
    "",
  ].join("\n");
  const body = [
    "## 人格",
    "",
    skill.persona || "",
    "",
    "## 知识边界",
    "",
    skill.knowledge || "",
    "",
    "## 行为规则",
    "",
    skill.behavior || DEFAULT_BEHAVIOR,
    "",
  ].join("\n");
  return fm + body;
}

/**
 * 从名人数据生成默认 skill：persona 取现有 persona，
 * knowledge 从 intro+tags 概括，behavior 用通用默认规则。
 */
export function defaultSkillForCelebrity(celebrity: Celebrity): CharacterSkill {
  const knowledge = `${celebrity.intro}\n擅长领域：${celebrity.tags.join("、")}。`;
  const skill: CharacterSkill = {
    id: celebrity.id,
    name: `${celebrity.name}·人格`,
    description: celebrity.intro,
    version: DEFAULT_VERSION,
    persona: celebrity.persona,
    knowledge,
    behavior: DEFAULT_BEHAVIOR,
    raw: "",
  };
  skill.raw = serializeSkill(skill);
  return skill;
}

/**
 * 从一段 persona 文本为自定义人物生成默认 skill（无 intro/tags 时用空知识边界）。
 */
export function defaultSkillForPersona(
  id: string,
  name: string,
  persona: string,
  description = "",
): CharacterSkill {
  const skill: CharacterSkill = {
    id,
    name: `${name}·人格`,
    description,
    version: DEFAULT_VERSION,
    persona,
    knowledge: "",
    behavior: DEFAULT_BEHAVIOR,
    raw: "",
  };
  skill.raw = serializeSkill(skill);
  return skill;
}

/** 把 skill 拼成注入对话的 system prompt。 */
export function buildSystemPrompt(skill: CharacterSkill): string {
  const parts: string[] = [];
  if (skill.persona) parts.push(skill.persona);
  if (skill.knowledge) parts.push(`【知识边界】${skill.knowledge}`);
  if (skill.behavior) parts.push(`【行为规则】${skill.behavior}`);
  parts.push("始终保持角色，用第一人称作答。");
  return parts.join("\n\n");
}
