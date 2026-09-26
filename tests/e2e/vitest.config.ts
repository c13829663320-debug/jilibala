// E2E 专用 vitest 配置：node 环境，真实起 fastify+ws，裸 node 客户端验证服务端聚合行为。
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { target: "es2022" },
  resolve: {
    // ws.ts 内部以 NodeNext 风格写 "./db.js"，实际是 .ts。
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
