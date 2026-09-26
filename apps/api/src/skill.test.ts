// ===== 人物 skill markdown 解析器单测 =====
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BEHAVIOR,
  buildSystemPrompt,
  defaultSkillForCelebrity,
  parseSkillMarkdown,
  serializeSkill,
} from "@balabala/shared";
import { getCelebrity } from "@balabala/shared";

describe("parseSkillMarkdown · 正常解析", () => {
  const md = `---
name: 马斯克人格
description: 第一性原理创业者
version: 1.2.0
---

## 人格

你是埃隆·马斯克，特斯拉与 SpaceX 创始人。

## 知识边界

擅长：电动车、航天、火星、脑机接口。

## 行为规则

用第一性原理作答，敢说能成或不能成。
`;

  it("解析 frontmatter 字段", () => {
    const s = parseSkillMarkdown(md, "elon-musk");
    expect(s.id).toBe("elon-musk");
    expect(s.name).toBe("马斯克人格");
    expect(s.description).toBe("第一性原理创业者");
    expect(s.version).toBe("1.2.0");
  });

  it("解析三个 section 正文", () => {
    const s = parseSkillMarkdown(md, "elon-musk");
    expect(s.persona).toContain("埃隆·马斯克");
    expect(s.knowledge).toContain("火星");
    expect(s.behavior).toContain("第一性原理");
  });

  it("保留原始全文 raw", () => {
    const s = parseSkillMarkdown(md, "elon-musk");
    expect(s.raw).toBe(md);
  });

  it("serialize 后可被 parse 还原", () => {
    const s = parseSkillMarkdown(md, "elon-musk");
    const round = parseSkillMarkdown(serializeSkill(s), s.id);
    expect(round.name).toBe(s.name);
    expect(round.description).toBe(s.description);
    expect(round.version).toBe(s.version);
    expect(round.persona).toBe(s.persona);
    expect(round.knowledge).toBe(s.knowledge);
    expect(round.behavior).toBe(s.behavior);
  });
});

describe("parseSkillMarkdown · 缺字段兜底", () => {
  it("缺 frontmatter 时用 id 作 name、默认 version、默认 behavior", () => {
    const md = `## 人格

你是一个普通角色。
`;
    const s = parseSkillMarkdown(md, "custom-123");
    expect(s.name).toBe("custom-123");
    expect(s.version).toBe("1.0.0");
    expect(s.persona).toContain("普通角色");
    expect(s.knowledge).toBe("");
    expect(s.behavior).toBe(DEFAULT_BEHAVIOR);
  });

  it("缺某个 section 时对应字段为空串，不抛错", () => {
    const md = `---
name: 只有人格
---

## 人格

只写人格。
`;
    const s = parseSkillMarkdown(md, "x");
    expect(s.persona).toBe("只写人格。");
    expect(s.knowledge).toBe("");
    // behavior 缺省走默认
    expect(s.behavior).toBe(DEFAULT_BEHAVIOR);
  });

  it("空字符串输入不崩溃", () => {
    const s = parseSkillMarkdown("", "empty");
    expect(s.name).toBe("empty");
    expect(s.persona).toBe("");
    expect(s.behavior).toBe(DEFAULT_BEHAVIOR);
  });
});

describe("parseSkillMarkdown · 非法 frontmatter 不崩溃", () => {
  it("有开头 --- 但无闭合 --- 时，整段按 body 处理", () => {
    const md = `---
name: 没有闭合
## 人格

你好世界。
`;
    const s = parseSkillMarkdown(md, "bad");
    // 不应崩溃；persona 可能解析不到（因为那一行被当成正文），但绝不能抛异常
    expect(typeof s.persona).toBe("string");
    expect(s.version).toBe("1.0.0");
  });

  it("完全没有 frontmatter 时整体按 body 解析", () => {
    const md = `## 人格

直接写人格，没有 frontmatter。

## 行为规则

保持角色。
`;
    const s = parseSkillMarkdown(md, "nofm");
    expect(s.name).toBe("nofm");
    expect(s.persona).toContain("没有 frontmatter");
    expect(s.behavior).toContain("保持角色");
  });

  it("frontmatter 行不是 key:value 时被忽略", () => {
    const md = `---
this is not a valid frontmatter line
name: 合法名字
---

## 人格

正文。
`;
    const s = parseSkillMarkdown(md, "weird");
    expect(s.name).toBe("合法名字");
    expect(s.persona).toBe("正文。");
  });
});

describe("defaultSkillForCelebrity", () => {
  it("从名人 persona 生成默认 skill", () => {
    const musk = getCelebrity("elon-musk")!;
    const s = defaultSkillForCelebrity(musk);
    expect(s.id).toBe("elon-musk");
    expect(s.persona).toBe(musk.persona);
    expect(s.knowledge).toContain(musk.intro);
    expect(s.knowledge).toContain("第一性原理");
    expect(s.behavior).toBe(DEFAULT_BEHAVIOR);
    expect(s.raw).toContain("## 人格");
  });
});

describe("buildSystemPrompt", () => {
  it("把 persona / 知识边界 / 行为规则拼成 system prompt", () => {
    const s = parseSkillMarkdown(
      `---
name: 测试
---

## 人格

P 人格。

## 知识边界

K 边界。

## 行为规则

B 规则。
`,
      "t",
    );
    const sys = buildSystemPrompt(s);
    expect(sys).toContain("P 人格。");
    expect(sys).toContain("【知识边界】K 边界。");
    expect(sys).toContain("【行为规则】B 规则。");
    expect(sys.endsWith("始终保持角色，用第一人称作答。")).toBe(true);
  });

  it("persona 为空时跳过但不报错", () => {
    const sys = buildSystemPrompt({
      id: "x", name: "x", description: "", version: "1.0.0",
      persona: "", knowledge: "K", behavior: "B", raw: "",
    });
    expect(sys).toContain("【知识边界】K");
    expect(sys).toContain("【行为规则】B");
  });
});
