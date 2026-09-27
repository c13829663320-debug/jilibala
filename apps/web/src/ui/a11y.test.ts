/**
 * R5 视觉品牌域 · a11y
 * grep 式断言：统一组件库的关键交互/信息元素带 aria-label / role，
 * 焦点环与 reduced-motion 在 a11y.css 落地。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ui = (f: string) => readFileSync(join(__dirname, f), 'utf-8')

describe('a11y：统一组件库无障碍', () => {
  it('Spinner 带 role=status 与 aria-label', () => {
    const src = ui('Spinner.tsx')
    expect(src).toContain('role="status"')
    expect(src).toContain('aria-label')
  })

  it('EmptyState 行动按钮带 aria-label', () => {
    const src = ui('EmptyState.tsx')
    expect(src).toContain('aria-label={actionLabel}')
    expect(src).toContain('role="status"')
  })

  it('Avatar 带 role=img / aria-label，在线点带状态 aria-label', () => {
    const src = ui('Avatar.tsx')
    expect(src).toContain('role="img"')
    expect(src).toContain('aria-label={name}')
    expect(src).toMatch(/aria-label=\{online \? '在线' : '离线'\}/)
  })

  it('Logo 容器带 aria-label', () => {
    expect(ui('Logo.tsx')).toContain('aria-label="叽里呱啦 BalaBala"')
  })

  it('Button 透传 aria-*（不吞掉宿主传入的无障碍属性）', () => {
    // Button 用 {...rest} 透传 HTMLButtonAttributes，aria-label 可从外部注入
    expect(ui('Button.tsx')).toContain('{...rest}')
  })

  it('a11y.css 提供 :focus-visible 品牌黄焦点环 / sr-only / reduced-motion', () => {
    const css = ui('a11y.css')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('var(--brand-primary)')
    expect(css).toContain('.ui-sr-only')
    expect(css).toContain('prefers-reduced-motion')
  })
})
