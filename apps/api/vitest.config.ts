// Vitest 配置：node 环境，ESM + TS，兼容 NodeNext 的 .js 扩展 import。
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "es2022",
  },
  resolve: {
    // NodeNext 风格的源码里写的是 "./db.js"，实际文件是 "./db.ts"。
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 测试绝不读取真实 .env / 真实密钥。
    env: {},
    clearMocks: true,
    restoreMocks: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
