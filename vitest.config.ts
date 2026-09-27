// R4-10: scripts/ 目录下纯逻辑脚本（tripo-batch / glb-validate）的单测配置。
// 用法：在仓库根目录执行 `npx vitest run --config vitest.config.ts`
// apps/api 自身的测试仍由 apps/api/vitest.config.ts 负责（`cd apps/api && npx vitest run`）。
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { target: "es2022" },
  resolve: {
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    env: {},
    clearMocks: true,
    testTimeout: 20000,
  },
});
