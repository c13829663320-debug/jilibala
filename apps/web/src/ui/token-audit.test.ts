/**
 * R5 视觉品牌域 · token-audit
 * grep 式断言：业务 CSS 不再硬编码品牌色 hex，必须走 var(--color-brand-*)。
 * 运行环境 node（vitest node env），直接读源文件。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')

/** 收集 src 下所有 .css 文件（递归），排除 design-tokens.css（token 定义处）与 ui/ui.css（组件库，同样走 var）。 */
function collectCss(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectCss(full, acc)
    else if (entry.endsWith('.css')) acc.push(full)
  }
  return acc
}

const BRAND_HEXES = ['#ffd600', '#ffd60a', '#4fb3a5', '#20a486']

describe('token-audit：业务 CSS 不硬编码品牌色', () => {
  const files = collectCss(SRC).filter((f) => {
    const base = f.split('/').pop()!
    // design-tokens.css 是 token 定义处，允许出现品牌 hex
    return base !== 'design-tokens.css'
  })

  it(`扫描到 ${files.length} 个业务 CSS 文件`, () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const file of files) {
    it(`${relative(SRC, file)} 不含品牌色 hex（应走 var()）`, () => {
      const text = readFileSync(file, 'utf-8').toLowerCase()
      for (const hex of BRAND_HEXES) {
        // 词边界匹配，避免误伤注释里的相邻字符
        const re = new RegExp(`(?<![0-9a-f])${hex}(?![0-9a-f])`)
        expect(text, `${relative(SRC, file)} 出现硬编码 ${hex}`).not.toMatch(re)
      }
    })
  }

  it('design-tokens.css 定义了全部品牌 token', () => {
    const tokens = readFileSync(join(SRC, 'design-tokens.css'), 'utf-8')
    expect(tokens).toMatch(/--color-brand-yellow:\s*#FFD600/i)
    expect(tokens).toMatch(/--color-brand-yellow-alt:\s*#FFD60A/i)
    expect(tokens).toMatch(/--color-brand-teal:\s*#4fb3a5/i)
    expect(tokens).toMatch(/--color-brand-teal-dark:\s*#20A486/i)
    expect(tokens).toMatch(/--color-bg-pure:\s*#000000/i)
    expect(tokens).toMatch(/--color-avatar-bg:\s*#ffffff/i)
  })
})
