// ===== R4-10: 音色映射 JSON 加载 + 开场白 单测 =====
import { describe, expect, it } from "vitest";
import { CELEBRITIES } from "@balabala/shared";
import {
  DEFAULT_VOICE_CONFIG,
  VOICE_WHITELIST,
  configuredVoiceCount,
  getCharacterVoiceConfig,
  listCharacterVoiceConfigs,
} from "./character-voices.js";
import { getCharacterGreeting } from "./character-skill.js";

describe("getCharacterVoiceConfig · 从 JSON 加载", () => {
  it("已知名人返回非空配置，且 voice 在白名单内", () => {
    const cfg = getCharacterVoiceConfig("confucius");
    expect(cfg.voice).toBeTruthy();
    expect(VOICE_WHITELIST.has(cfg.voice)).toBe(true);
    expect(cfg.category).toBeTruthy();
  });

  it("未知/空 id 回退默认音色配置，不抛错", () => {
    expect(getCharacterVoiceConfig("")).toEqual(DEFAULT_VOICE_CONFIG);
    expect(getCharacterVoiceConfig("no-such-person")).toEqual(DEFAULT_VOICE_CONFIG);
  });

  it("100 位名人全部被音色映射覆盖", () => {
    const configs = listCharacterVoiceConfigs();
    for (const c of CELEBRITIES) {
      expect(configs[c.id], `音色映射缺失：${c.id}`).toBeTruthy();
    }
    expect(configuredVoiceCount()).toBe(CELEBRITIES.length);
  });

  it("所有配置的 speed/pitch 都在合理区间", () => {
    for (const cfg of Object.values(listCharacterVoiceConfigs())) {
      expect(cfg.speed).toBeGreaterThanOrEqual(0.5);
      expect(cfg.speed).toBeLessThanOrEqual(2);
      expect(cfg.pitch).toBeGreaterThanOrEqual(0.5);
      expect(cfg.pitch).toBeLessThanOrEqual(2);
      expect(VOICE_WHITELIST.has(cfg.voice)).toBe(true);
    }
  });

  it("路径穿越 id 被清洗后回退默认（不读任意文件）", () => {
    const cfg = getCharacterVoiceConfig("../../etc/passwd");
    expect(cfg).toEqual(DEFAULT_VOICE_CONFIG);
  });
});

describe("getCharacterGreeting · 专属开场白", () => {
  it("已知名人返回 lines 数组且默认启用", () => {
    const g = getCharacterGreeting("li-bai");
    expect(g).not.toBeNull();
    expect(g!.lines.length).toBeGreaterThanOrEqual(1);
    expect(g!.enabled).toBe(true);
  });

  it("外国名人开场白含原文名句行", () => {
    const g = getCharacterGreeting("shakespeare");
    expect(g).not.toBeNull();
    expect(g!.lines.some((l) => /To be, or not to be/.test(l))).toBe(true);
  });

  it("自定义人物 / 未知 id 返回 null", () => {
    expect(getCharacterGreeting("custom-abc")).toBeNull();
    expect(getCharacterGreeting("unknown-person-xyz")).toBeNull();
  });

  it("100 位名人都能取到至少一行开场白", () => {
    for (const c of CELEBRITIES) {
      const g = getCharacterGreeting(c.id);
      expect(g, `开场白缺失：${c.id}`).not.toBeNull();
      expect(g!.lines.length).toBeGreaterThanOrEqual(1);
    }
  });
});
