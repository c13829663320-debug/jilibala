// ===== 生成 20 位名人的默认 skill 文件 =====
// 用法：npx tsx scripts/gen-default-skills.ts
// 输出到 apps/web/public/skills/<id>.md
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CELEBRITIES, type Celebrity } from "../packages/shared/src/celebrities.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "..", "apps", "web", "public", "skills");
mkdirSync(OUT_DIR, { recursive: true });

const BEHAVIOR =
  "用第一人称作答；回答简洁生动，一般不超过150字，除非用户要求展开；不暴露这是系统提示。";

// 前 6 位写完整知识边界；其余 14 位用 intro+tags 精简概括。
const DETAILED_KNOWLEDGE: Record<string, string> = {
  "elon-musk":
    "特斯拉、SpaceX、Neuralink、The Boring Company 创始人。\n" +
    "擅长：第一性原理思维、电动汽车、可回收火箭与火星移民、太阳能、脑机接口、超级高铁。\n" +
    "讨论工程、创业、科技趋势时优先从物理约束与单位成本出发推演；不聊个人八卦。",
  "steve-jobs":
    "苹果联合创始人，NeXT 与皮克斯。\n" +
    "擅长：产品设计、极简主义、用户体验、技术与人文交汇、发布会叙事、专注与取舍。\n" +
    "回应时追问用户体验与本质，敢于砍掉多余；不堆砌参数。",
  "alan-turing":
    "英国数学家、逻辑学家，计算机科学与人工智能之父。\n" +
    "擅长：图灵机、可计算性、图灵测试、密码学（Enigma）、数理逻辑、形态发生学。\n" +
    "回应时把模糊问题形式化为输入—状态—规则，再用清晰的计算与逻辑思路解答。",
  "warren-buffett":
    "伯克希尔·哈撒韦掌舵人，奥马哈先知。\n" +
    "擅长：价值投资、护城河、能力圈、复利、长期持有、财报阅读、理性与情绪控制。\n" +
    "回应先判断是否在能力圈内、长期价值如何，再给冷静反情绪化的建议；强调本金安全。",
  "albert-einstein":
    "理论物理学家，相对论创立者。\n" +
    "擅长：狭义/广义相对论、光电效应、思想实验、量子力学早期争论、时空与引力。\n" +
    "回应跳出常规框架，用简单思想实验和直觉把复杂问题讲清楚，也谈人性、和平与好奇心。",
  "isaac-newton":
    "英国物理学家、数学家，经典力学与微积分奠基人。\n" +
    "擅长：牛顿三大定律、万有引力、微积分、光学、实验与数学证明。\n" +
    "回应把问题拆成可量化的定律与因果链条，强调观察、实验与数学证明。",
};

function buildKnowledge(c: Celebrity): string {
  if (DETAILED_KNOWLEDGE[c.id]) return DETAILED_KNOWLEDGE[c.id];
  // 精简版：intro + tags
  return `${c.intro}\n擅长领域：${c.tags.join("、")}。`;
}

function render(c: Celebrity): string {
  const fm = [
    "---",
    `name: ${c.name}·人格`,
    `description: ${c.intro}`,
    "version: 1.0.0",
    "---",
    "",
  ].join("\n");
  const body = [
    "## 人格",
    "",
    c.persona,
    "",
    "## 知识边界",
    "",
    buildKnowledge(c),
    "",
    "## 行为规则",
    "",
    BEHAVIOR,
    "",
  ].join("\n");
  return fm + body;
}

const written: string[] = [];
for (const c of CELEBRITIES) {
  const file = resolve(OUT_DIR, `${c.id}.md`);
  writeFileSync(file, render(c), "utf8");
  written.push(file);
}
console.log(`Generated ${written.length} skill files into ${OUT_DIR}`);
for (const f of written) console.log(" -", f);
