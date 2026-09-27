// Vitest 配置（web 端）：默认 node 环境跑纯逻辑单测；
// 组件测试（.test.tsx）用 docblock `@vitest-environment jsdom` 自行声明环境。
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/setupTests.ts'],
  },
})
