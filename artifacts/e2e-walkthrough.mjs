// 真机走查：新引擎法庭 + 脱口秀全链路（Chromium SwiftShader）
import puppeteer from '/home/user/Doubao/chats/38440437530857986/gl-probe/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
import fs from 'node:fs'

const BASE = 'http://localhost:5176'
const OUT = '/home/user/.doubao/agent_mode/workspace/.sessions/38444242403607554/agents/o_000cxZwI1Io/wt-web-ct/artifacts'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/opt/browser/chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--disable-gpu-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 160)) })

async function clickByTestId(testid) {
  const ok = await page.evaluate((t) => {
    const el = document.querySelector(`[data-testid="${t}"]`)
    if (el) { el.scrollIntoView(); el.click(); return true }
    return false
  }, testid)
  if (!ok) throw new Error(`未找到 testid: ${testid}`)
}
async function clickButtonText(text) {
  const ok = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes(t))
    if (b) { b.click(); return true }
    return false
  }, text)
  if (!ok) throw new Error(`未找到按钮: ${text}`)
}
async function waitForTestId(testid, timeout = 15000) {
  await page.waitForFunction(
    (t) => Boolean(document.querySelector(`[data-testid="${t}"]`)),
    { timeout }, testid,
  )
}

// ===== 1. 开身份：注入 localStorage，跳过开屏/兴趣选择 =====
await page.goto(BASE + '/?__e2e=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(4000)
await page.evaluate(async () => {
  const res = await fetch('/api/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'E2E律师', avatarType: 'capsule', avatarRef: '' }),
  })
  const u = await res.json()
  localStorage.setItem('balabala.userId', u.userId)
  localStorage.setItem('balabala.onboarding.v1', JSON.stringify({
    selectedInterest: null, interestSkipped: true, playedScenes: [], updatedAt: new Date().toISOString(),
  }))
})
await page.goto(BASE + '/?__e2e=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(6000)
console.log('✓ 身份就绪，当前 URL:', page.url())
await page.screenshot({ path: OUT + '/_debug-entry.png' })

// ===== 2. 法庭 =====
console.log('=== 法庭新引擎 ===')
// 从入口页点「法庭」
await clickButtonText('法庭')
await waitForTestId('new-court-game', 20000)
await sleep(3500)
// 关闭 App 级 FirstTimeGuide（趣味法庭·30秒上手）
try { await clickButtonText('跳过'); await sleep(800) } catch { console.log('无法庭 App 级引导') }
// 跳过新引擎自己的新手引导
try { await clickByTestId('court-tutorial-skip'); await sleep(500) } catch { console.log('无法庭新引擎引导（已看过）') }
await page.screenshot({ path: OUT + '/court-evidence/v2-01-start.png' })
console.log('✓ v2-01-start.png')

// 出证据牌 → 选证据 → 提交
await clickByTestId('court-card-evidence')
await sleep(500)
await clickByTestId('court-evidence-ev-1')
await sleep(300)
await clickByTestId('court-submit-card')
await sleep(2000)
await page.screenshot({ path: OUT + '/court-evidence/v2-02-card-played.png' })
console.log('✓ v2-02-card-played.png')

// 打满 3 轮：每轮出一张牌 + 结束本轮
for (let round = 2; round <= 3; round++) {
  await sleep(1500)
  try {
    await clickByTestId('court-card-attack')
    await sleep(400)
    await page.type('[data-testid="court-card-input"]', '凌晨扰民的事实必须被采纳')
    await sleep(200)
    await clickByTestId('court-submit-card')
    await sleep(2000)
  } catch (e) { console.log(`第${round}轮出牌跳过:`, e.message) }
  try { await clickByTestId('court-end-turn'); await sleep(2500) } catch (e) { console.log(`第${round}轮结束跳过:`, e.message) }
}
await sleep(2000)
await page.screenshot({ path: OUT + '/court-evidence/v2-03-results.png' })
console.log('✓ v2-03-results.png')

// ===== 3. 脱口秀 =====
console.log('=== 脱口秀新引擎 ===')
await clickByTestId('talkshow-exit').catch(async () => {
  // 结算页没有 exit？回退到浏览器后退
  await page.goto(BASE + '/?__e2e=1', { waitUntil: 'domcontentloaded' })
  await sleep(5000)
})
await sleep(2000)
// 回到入口后点脱口秀
await clickButtonText('脱口秀')
await waitForTestId('new-talkshow-game', 20000)
await sleep(3500)
// 先关掉 App 级 FirstTimeGuide（如有）
try { await clickButtonText('跳过'); await sleep(800) } catch { console.log('无 App 级引导') }
// 再关掉新引擎自己的新手引导
try { await clickByTestId('talkshow-tutorial-skip'); await sleep(500) } catch { console.log('无脱口秀新引擎引导') }
// 选话题前截图
await page.screenshot({ path: OUT + '/talkshow-evidence/v2-01-topic.png' })
console.log('✓ v2-01-topic.png')

// 选话题
await clickButtonText('职场吐槽')
await waitForTestId('talkshow-joke-input', 10000)
await sleep(800)

// 讲 3 段
for (let i = 1; i <= 3; i++) {
  await page.type('[data-testid="talkshow-joke-input"]', `第${i}段：老板画的饼比食堂的饼还大，我啃了三年都没啃到！`)
  await sleep(300)
  await clickByTestId('talkshow-submit-joke')
  await sleep(3000)
  if (i === 1) {
    await page.screenshot({ path: OUT + '/talkshow-evidence/v2-02-joke-scored.png' })
    console.log('✓ v2-02-joke-scored.png')
  }
  // 下一段：不回扣，顺着讲
  try { await clickByTestId('talkshow-callback-none'); await sleep(600) } catch { console.log(`第${i}段后无下一招`) }
}
await sleep(2500)
await page.screenshot({ path: OUT + '/talkshow-evidence/v2-03-results.png' })
console.log('✓ v2-03-results.png')

await browser.close()
console.log('=== done ===')
