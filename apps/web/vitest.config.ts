// Vitest 配置（web 端）：node 环境，仅跑纯逻辑单测（如 courtroom-camera）。
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
