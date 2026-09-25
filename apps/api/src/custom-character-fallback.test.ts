// ===== 功能闭环：自定义人物「占位模特」降级判定 =====
// Tripo 云端不可达时，finalize 必须能在不访问 Tripo 的情况下保存人物。
import { describe, expect, it } from "vitest";
import { shouldUsePlaceholderFinalize } from "./custom-character-routes.js";

describe("shouldUsePlaceholderFinalize", () => {
  it("显式 usePlaceholder → 占位降级", () => {
    expect(shouldUsePlaceholderFinalize({ usePlaceholder: true, tripoTaskId: "abc" })).toBe(true);
  });

  it("前端本地降级任务号 local-fallback-* → 占位降级", () => {
    expect(shouldUsePlaceholderFinalize({ tripoTaskId: "local-fallback-1700000000000" })).toBe(true);
  });

  it("真实 Tripo 任务号且未要求占位 → 不降级（走 Tripo 下载）", () => {
    expect(shouldUsePlaceholderFinalize({ tripoTaskId: "66a1b2c3d4e5" })).toBe(false);
  });

  it("空任务号 / 未要求占位 → 不降级", () => {
    expect(shouldUsePlaceholderFinalize({})).toBe(false);
    expect(shouldUsePlaceholderFinalize({ tripoTaskId: "" })).toBe(false);
  });
});
