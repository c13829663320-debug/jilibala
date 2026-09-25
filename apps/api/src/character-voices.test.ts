// ===== M13 第五轮：角色音色解析与白名单测试 =====
import { describe, expect, it } from "vitest";
import {
  COURT_ROLE_VOICES,
  DEFAULT_VOICE,
  VOICE_OPTIONS,
  VOICE_WHITELIST,
  isValidVoice,
  resolveCharacterVoice,
} from "@balabala/shared";

describe("VOICE_WHITELIST", () => {
  it("包含默认音色与全部已使用的音色", () => {
    expect(isValidVoice(DEFAULT_VOICE)).toBe(true);
    // 名人映射用到的全部音色
    for (const v of [
      "boyinnansheng", "ruyananshi", "cixingnansheng",
      "wenrougongzi", "zhixingjiejie", "yuanqinansheng", "wenrounansheng",
      "zhengpaiqingnian", "shenchennanyin",
      "qingniandaxuesheng",
    ]) {
      expect(isValidVoice(v)).toBe(true);
    }
  });

  it("拒绝非法/缺失音色", () => {
    expect(isValidVoice(undefined)).toBe(false);
    expect(isValidVoice(null)).toBe(false);
    expect(isValidVoice("")).toBe(false);
    expect(isValidVoice("not-a-real-voice")).toBe(false);
    expect(isValidVoice("JINGDIANNVSHENG")).toBe(false); // 大小写敏感
    expect(isValidVoice("jingdiannvsheng ")).toBe(false); // 不 trim
  });

  it("白名单规模与展示选项一致（实测可用 13 个）", () => {
    expect(VOICE_OPTIONS.length).toBe(13);
    expect(VOICE_WHITELIST.size).toBe(VOICE_OPTIONS.length);
  });
});

describe("resolveCharacterVoice", () => {
  it("预置名人 → 其专属音色", () => {
    expect(resolveCharacterVoice("elon-musk")).toBe("yuanqinansheng");
    expect(resolveCharacterVoice("steve-jobs")).toBe("boyinnansheng");
    expect(resolveCharacterVoice("li-bai")).toBe("yuanqinansheng");
    expect(resolveCharacterVoice("marie-curie")).toBe("zhixingjiejie");
    expect(resolveCharacterVoice("nietzsche")).toBe("zhengpaiqingnian");
  });

  it("法庭固定角色 → 映射音色", () => {
    expect(resolveCharacterVoice("judge")).toBe(COURT_ROLE_VOICES.judge);
    expect(resolveCharacterVoice("plaintiff")).toBe("boyinnansheng");
    expect(resolveCharacterVoice("defendant")).toBe("shenchennanyin");
    expect(resolveCharacterVoice("defender")).toBe("ruyananshi");
    expect(resolveCharacterVoice("witness")).toBe("qingniandaxuesheng");
    expect(resolveCharacterVoice("juror")).toBe("wenrounansheng");
  });

  it("custom-xxx：传入合法 card.voice 则用之，否则回退默认", () => {
    expect(resolveCharacterVoice("custom-abc", "wenrounansheng")).toBe("wenrounansheng");
    expect(resolveCharacterVoice("custom-abc")).toBe(DEFAULT_VOICE);
    // 非法的显式音色被忽略，回退默认
    expect(resolveCharacterVoice("custom-abc", "bogus-voice")).toBe(DEFAULT_VOICE);
  });

  it("显式合法音色优先于一切", () => {
    expect(resolveCharacterVoice("judge", "tianmeinvsheng")).toBe("tianmeinvsheng");
    expect(resolveCharacterVoice("elon-musk", "tianmeinvsheng")).toBe("tianmeinvsheng");
  });

  it("未知/空引用 → 兜底默认", () => {
    expect(resolveCharacterVoice("")).toBe(DEFAULT_VOICE);
    expect(resolveCharacterVoice("no-such-person")).toBe(DEFAULT_VOICE);
  });
});

describe("法庭角色映射", () => {
  it("旁听者不配音（不在映射里，落到默认）", () => {
    expect(COURT_ROLE_VOICES["audience-08"]).toBeUndefined();
    expect(resolveCharacterVoice("audience-08")).toBe(DEFAULT_VOICE);
  });
});
