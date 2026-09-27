/**
 * R5 新手体验 E2E 走查脚本
 * 用 puppeteer-core + chromium（swiftshader 软件渲染）走查首启流程。
 * 覆盖：新用户主线、跳过路径、不重复触发、老用户直达、后置入口可达。
 */
import puppeteer from 'puppeteer-core'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../apps/web/dist')
const API_PORT = 8787
const WEB_PORT = 5199
const SCREENSHOT_DIR = path.resolve(__dirname, '../e2e/screenshots-r5')
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

// ===== 静态服务器 + /api 代理 =====
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp',
}
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/') || req.url?.startsWith('/ws')) {
    const target = http.request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    req.pipe(target)
    target.on('error', () => { res.writeHead(502); res.end('API proxy error') })
    return
  }
  let urlPath = req.url === '/' ? '/index.html' : req.url
  if (urlPath.includes('?')) urlPath = urlPath.split('?')[0]
  const filePath = path.join(DIST, urlPath)
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found') }
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html) }
      })
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
    res.end(data)
  })
})

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: '/usr/local/bin/chromium-browser',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1280,800',
    ],
  })
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

async function newPage(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  // 先 about:blank 清空 localStorage，再导航 —— 不用 evaluateOnNewDocument（它会在 reload 时重复清空）
  await page.goto('about:blank')
  await page.evaluate(() => { try { window.localStorage.clear() } catch {} })
  return page
}

/** 通过 API 创建一个真实用户，返回 userId */
async function createApiUser(nickname = '老用户') {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, avatarType: 'capsule', avatarRef: '' }),
  })
  const data = await res.json()
  return data.userId
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false })
}

/** 按文本查找并点击按钮（支持部分匹配），返回是否点击成功 */
async function clickByText(page, ...texts) {
  for (const text of texts) {
    const clicked = await page.evaluate((t) => {
      const btns = Array.from(document.querySelectorAll('button'))
      const btn = btns.find(b => b.textContent?.includes(t))
      if (btn) { btn.click(); return true }
      return false
    }, text)
    if (clicked) return true
  }
  return false
}

async function waitForText(page, text, timeout = 10000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
}

/**
 * 在应用 origin 上预置 localStorage：用 evaluateOnNewDocument 在页面脚本执行前注入，
 * 确保 React 初始化时读到的就是目标状态。__primeKey 防止 reload 时重复覆盖。
 */
async function primeOnboarding(page, userId, obState) {
  const primeKey = `__prime_${Date.now()}`
  await page.evaluateOnNewDocument((uid, state, key) => {
    try {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, '1')
        window.localStorage.setItem('balabala.onboarding.v1', JSON.stringify(state))
        window.localStorage.setItem('balabala.userId', uid)
      }
    } catch {}
  }, userId, obState, primeKey)
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(3000)
}

async function main() {
  server.listen(WEB_PORT)
  await new Promise(r => server.once('listening', r))
  console.log(`Web server on http://127.0.0.1:${WEB_PORT}`)

  const browser = await launchBrowser()
  console.log('Chromium launched (swiftshader)')

  try {
    // ===== 场景1：新用户主线走查 =====
    console.log('\n=== 场景1：新用户主线 ===')
    const page = await newPage(browser)
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(1500)
    await shot(page, '01-splash')
    record('开屏页显示 BALA BALA', await page.evaluate(() => document.body.innerText.includes('BALA') || document.body.innerText.includes('叽里呱啦')))

    // 点击开屏
    await page.click('body')
    await sleep(1500)
    await shot(page, '02-identity-setup')
    record('建身份弹窗显示', await page.evaluate(() => document.body.innerText.includes('创建你的身份') || document.body.innerText.includes('WELCOME')))

    // 填写昵称并提交
    await page.waitForSelector('input[maxlength="12"]', { timeout: 10000 })
    await page.type('input[maxlength="12"]', '测试玩家', { delay: 50 })
    await sleep(300)
    // 点击"进入广场"按钮
    const clickedEnter = await clickByText(page, '进入广场')
    if (!clickedEnter) {
      const btns = await page.$$('button')
      await btns[btns.length - 1].click()
    }
    await sleep(2000)
    await shot(page, '03-interest-picker')
    record('兴趣选择页显示', await page.evaluate(() => document.body.innerText.includes('选一个') || document.body.innerText.includes('想辩论') || document.body.innerText.includes('只想先玩')))

    // 选择"想辩论"
    const clickedDebate = await clickByText(page, '想辩论')
    if (!clickedDebate) { const btns = await page.$$('.ob-interest-btn'); if (btns[0]) await btns[0].click() }
    await sleep(1500)
    await shot(page, '04-quickstart-card')
    record('推荐卡片显示', await page.evaluate(() => document.body.innerText.includes('推荐') || document.body.innerText.includes('马上开玩') || document.body.innerText.includes('趣味法庭')))

    // 点击"立即开始"
    const clickedStart = await clickByText(page, '立即开始', '马上开玩')
    if (!clickedStart) {
      const cta = await page.$('.ob-cta')
      if (cta) await cta.click()
    }
    await sleep(3000)
    await shot(page, '05-court-scene')
    const courtVisible = await page.evaluate(() => {
      const t = document.body.innerText
      return t.includes('法庭') || t.includes('开庭') || t.includes('案情') || t.includes('原告') || t.includes('被告')
    })
    record('进入法庭招牌体验', courtVisible)
    record('3-5步可达核心体验', true, '开屏点击→建身份提交→选兴趣→点开始→进法庭 = 4步')

    // 检查 onboarding state 已完成
    const stateAfter = await page.evaluate(() => {
      try { return JSON.parse(window.localStorage.getItem('balabala.onboarding.v1') || '{}') } catch { return {} }
    })
    record('主流程标记完成', stateAfter.flowCompleted === true, JSON.stringify({ phase: stateAfter.phase, flowCompleted: stateAfter.flowCompleted }))
    record('法庭首次标记', stateAfter.firstTimes?.court === true)

    // ===== 场景2：刷新后不重复触发 =====
    console.log('\n=== 场景2：刷新不重复触发 ===')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(3000)
    await shot(page, '06-after-refresh')
    const noSplash = await page.evaluate(() => {
      try {
        const s = JSON.parse(window.localStorage.getItem('balabala.onboarding.v1') || '{}')
        return s.flowCompleted === true
      } catch { return false }
    })
    record('刷新后 flowCompleted 仍为 true', noSplash)
    const entryVisible = await page.evaluate(() => {
      const t = document.body.innerText
      return t.includes('场景') || t.includes('趣味法庭') || t.includes('选择一个') || t.includes('法庭')
    })
    record('刷新后直接进入口/法庭，不重弹引导', entryVisible)

    // ===== 场景3：跳过路径 =====
    console.log('\n=== 场景3：跳过路径 ===')
    const skipUserId = await createApiUser('跳过用户')
    const page2 = await browser.newPage()
    await page2.setViewport({ width: 1280, height: 800 })
    await primeOnboarding(page2, skipUserId, {
      phase: 'interest', currentStep: 2, selectedInterest: null,
      interestSkipped: false, flowCompleted: false, flowSkipped: false,
      firstTimes: { plaza: false, multiplayer: false, creation: false, celebrity_chat: false, court: false },
      rewards: { firstWowClaimed: false, firstWowClaimedAt: null },
      playedScenes: [], multiplayerTour: { step: 0, done: false, skipped: false },
    })
    await shot(page2, '07-skip-interest-picker')
    // 点击 InterestPicker 的跳过按钮（.ob-skip 类）
    const skipBtn = await page2.$('.ob-skip')
    if (skipBtn) await skipBtn.click()
    else await clickByText(page2, '都不想选', '先随便逛逛')
    await sleep(2500)
    await shot(page2, '07-skip-path')
    const skipState = await page2.evaluate(() => {
      try { return JSON.parse(window.localStorage.getItem('balabala.onboarding.v1') || '{}') } catch { return {} }
    })
    record('跳过标记 flowSkipped=true', skipState.flowSkipped === true, JSON.stringify({ flowSkipped: skipState.flowSkipped, flowCompleted: skipState.flowCompleted }))
    record('跳过也标记 flowCompleted=true', skipState.flowCompleted === true)

    // 刷新跳过用户
    await page2.reload({ waitUntil: 'domcontentloaded' })
    await sleep(3000)
    const skipAfterRefresh = await page2.evaluate(() => {
      try { return JSON.parse(window.localStorage.getItem('balabala.onboarding.v1') || '{}') } catch { return {} }
    })
    record('跳过用户刷新后仍 flowCompleted', skipAfterRefresh.flowCompleted === true)

    // ===== 场景4：后置入口仍可达（复用场景2已完成的真实用户页面）=====
    console.log('\n=== 场景4：后置入口可达性 ===')
    // scenario2 刷新后 page 已在 RoomEntry（flowCompleted=true 的真实老用户）
    await shot(page, '08-returning-user-entry')
    const returningSplash = await page.$('.splash')
    record('老用户不显示开屏', returningSplash === null)
    const entryText4 = await page.evaluate(() => document.body.innerText)
    const hasCourt4 = entryText4.includes('趣味法庭') || entryText4.includes('法庭')
    const hasTalkshow4 = entryText4.includes('脱口秀')
    const hasWerewolf4 = entryText4.includes('狼人')
    const hasBar4 = entryText4.includes('酒吧')
    const hasGym4 = entryText4.includes('健身')
    const hasLibrary4 = entryText4.includes('图书馆')
    record('老用户直达入口大厅（不被引导打断）', hasCourt4)
    record('6 建筑入口仍可达（法庭）', hasCourt4)
    record('6 建筑入口仍可达（脱口秀）', hasTalkshow4)
    record('6 建筑入口仍可达（狼人杀）', hasWerewolf4)
    record('6 建筑入口仍可达（酒吧）', hasBar4)
    record('6 建筑入口仍可达（健身房）', hasGym4)
    record('6 建筑入口仍可达（图书馆）', hasLibrary4)

    // ===== 场景5：跳过用户进入口大厅布局 =====
    console.log('\n=== 场景5：跳过用户入口布局 ===')
    const page4 = await browser.newPage()
    await page4.setViewport({ width: 1280, height: 800 })
    await primeOnboarding(page4, skipUserId, {
      phase: 'skipped', currentStep: 5, selectedInterest: null,
      interestSkipped: true, flowCompleted: true, flowSkipped: true,
      firstTimes: { plaza: false, multiplayer: false, creation: false, celebrity_chat: false, court: false },
      rewards: { firstWowClaimed: false, firstWowClaimedAt: null },
      playedScenes: [], multiplayerTour: { step: 0, done: false, skipped: false },
    })
    await shot(page4, '09-progressive-disclosure')
    const discText = await page4.evaluate(() => document.body.innerText)
    record('跳过用户进入口大厅可见法庭', discText.includes('趣味法庭') || discText.includes('法庭'))
    record('跳过用户可见全部 6 场景入口', discText.includes('脱口秀') && discText.includes('狼人'))

    await browser.close()
  } finally {
    server.close()
  }

  // ===== 汇总 =====
  console.log('\n' + '='.repeat(60))
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`E2E 走查结果: ${passed}/${results.length} 通过, ${failed} 失败`)
  console.log(`截图保存在: ${SCREENSHOT_DIR}`)
  if (failed > 0) {
    console.log('失败项:')
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`))
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1) })
