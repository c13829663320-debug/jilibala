// Vitest 配置：仓库根级裸 node e2e（WebRTC 信令面）。
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "es2022",
  },
  resolve: {
    // ws.ts 内部用 NodeNext 风格的 "./db.js"，实际文件是 "./db.ts"
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
