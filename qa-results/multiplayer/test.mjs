// Round3 真人多人房间 · 双开真机联调脚本
// 运行：node test.mjs
// 两个隔离的 browser context 代表两个真实用户（独立 localStorage → 不同 userId）。
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/home/user/Doubao/chats/38440437530857986/main-wt/qa-results/multiplayer'
const BASE = 'http://localhost:5173'
const CHROME = '/usr/local/bin/chromium'
const ROOM_NAME = '联调测试房'

fs.mkdirSync(OUT, { recursive: true })

const results = []
function report(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 注入到每个页面 document_start：跳过新手引导 + 劫持 WebSocket / RTCPeerConnection
const PRELOAD = () => {
  // 正确结构：interestSkipped=true → needsInterestSelection()=false，跳过兴趣选择页
  try {
    localStorage.setItem('balabala.onboarding.v1', JSON.stringify({ selectedInterest: null, interestSkipped: true, playedScenes: [], updatedAt: new Date().toISOString() }))
  } catch (e) {}

  window.__wsLog = []
  window.__wsUrl = null
  const OrigWS = window.WebSocket
  function HookedWS(url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url)
    window.__wsUrl = String(url)
    window.__ws = ws
    window.__wsReadyStates = window.__wsReadyStates || []
    const push = (dir, data) => {
      let parsed = null
      try { parsed = typeof data === 'string' ? JSON.parse(data) : data } catch (e) {}
      window.__wsLog.push({ ts: Date.now(), dir, type: parsed && parsed.type, raw: parsed == null ? String(data).slice(0, 300) : parsed })
    }
    ws.addEventListener('message', (ev) => { try { push('in', ev.data) } catch (e) {} })
    ws.addEventListener('close', (ev) => { window.__wsLog.push({ ts: Date.now(), dir: 'sys', type: 'close', raw: { code: ev.code, reason: ev.reason, wasClean: ev.wasClean } }) })
    ws.addEventListener('error', () => { window.__wsLog.push({ ts: Date.now(), dir: 'sys', type: 'error' }) })
    const origClose = ws.close.bind(ws)
    ws.close = (...args) => {
      window.__wsLog.push({ ts: Date.now(), dir: 'sys', type: 'close-called', raw: new Error('close-stack').stack.split('\n').slice(1, 6).join(' | ') })
      return origClose(...args)
    }
    const origSend = ws.send.bind(ws)
    ws.send = (data) => { try { push('out', data) } catch (e) {} return origSend(data) }
    return ws
  }
  HookedWS.prototype = OrigWS.prototype
  window.WebSocket = HookedWS

  window.__pcCount = 0
  window.__rtcLog = []
  const OrigPC = window.RTCPeerConnection
  function HookedPC(cfg, constraints) {
    const pc = constraints ? new OrigPC(cfg, constraints) : new OrigPC(cfg)
    window.__pcCount++
    window.__rtcLog.push({ ts: Date.now(), ev: 'pc-created' })
    pc.addEventListener('iceconnectionstatechange', () => {
      window.__rtcLog.push({ ts: Date.now(), ev: 'ice-' + pc.iceConnectionState })
    })
    pc.addEventListener('track', (e) => {
      window.__rtcLog.push({ ts: Date.now(), ev: 'track-' + (e.track && e.track.kind) })
    })
    return pc
  }
  HookedPC.prototype = OrigPC.prototype
  // 探针：createOffer 调用与结果
  const origCO = OrigPC.prototype.createOffer
  OrigPC.prototype.createOffer = function (...args) {
    window.__rtcLog.push({ ts: Date.now(), ev: 'createOffer-called', state: this.signalingState })
    return origCO.apply(this, args).then(
      (sdp) => { window.__rtcLog.push({ ts: Date.now(), ev: 'createOffer-ok', type: sdp && sdp.type }); return sdp },
      (err) => { window.__rtcLog.push({ ts: Date.now(), ev: 'createOffer-ERR', err: String(err && err.message || err).slice(0, 200) }); throw err }
    )
  }
  window.RTCPeerConnection = HookedPC
}

async function waitFor(page, fn, arg, { timeout = 15000, interval = 300, label = '' } = {}) {
  const t0 = Date.now()
  let lastErr = ''
  while (Date.now() - t0 < timeout) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch (e) { lastErr = String(e && e.message || e) }
    await sleep(interval)
  }
  throw new Error(`超时(${timeout}ms): ${label} ${lastErr}`)
}

// 通用：在页面里找包含某文字的按钮并点击
async function clickText(page, selector, text) {
  const ok = await page.evaluate((sel, txt) => {
    const els = [...document.querySelectorAll(sel)]
    const el = els.find((e) => (e.textContent || '').includes(txt))
    if (el) { el.click(); return true }
    return false
  }, selector, text)
  if (!ok) throw new Error(`未找到按钮: ${selector} 含「${text}」`)
}

async function dismissOnboarding(page) {
  for (const sel of ['.skip', '.ob-skip', '.ob-ghost']) {
    try {
      await page.evaluate((s) => {
        const el = document.querySelector(s)
        if (el && el.offsetParent !== null) el.click()
      }, sel)
    } catch (e) {}
  }
}
async function dismissSplash(page) {
  try { await page.evaluate(() => { const s = document.querySelector('.splash:not(.is-gone)'); if (s) s.click() }) } catch {}
  await sleep(1500)
}

async function setupIdentity(page, nickname) {
  await sleep(2500)
  // 程序化关闭开屏 Splash（之前的物理点击会被身份模态框拦截），等其退出动画结束
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.click() })
  await sleep(1800)
  // 等待「创建你的身份」昵称输入框
  await waitFor(page, () => {
    const i = document.querySelector('input[placeholder*="给自己起个名字"]')
    return !!i
  }, null, { timeout: 20000, label: '身份创建模态框' })
  await page.type('input[placeholder*="给自己起个名字"]', nickname, { delay: 40 })
  await clickText(page, 'button', '进入广场')
  await sleep(800)
  // 兜底：若仍弹出兴趣选择页，点跳过
  await page.evaluate(() => { const el = document.querySelector('.ob-skip'); if (el) el.click() })
  // 等待首页出现「多人房间」卡片
  await waitFor(page, () => [...document.querySelectorAll('.main-home__create-card')].some((e) => e.textContent.includes('多人房间')), null, { timeout: 20000, label: '首页 RoomEntry' })
}

async function enterLobby(page) {
  await clickText(page, '.main-home__create-card', '多人房间')
  await waitFor(page, () => !!document.querySelector('.mp-lobby-root'), null, { timeout: 15000, label: '多人房间大厅' })
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage',
    '--mute-audio',
    '--window-size=1280,800',
  ],
})

const logs = { a: [], b: [] }
async function newPlayer(side, nickname) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('console', (m) => { logs[side].push(`[${m.type()}] ${m.text()}`) })
  page.on('pageerror', (e) => logs[side].push(`[pageerror] ${String(e)}`))
  await page.evaluateOnNewDocument(PRELOAD)
  return { ctx, page }
}

let roomCode = ''
let liveA = null, liveB = null
try {
  // ========== 玩家 A ==========
  console.log('--- 启动玩家A ---')
  const A = await newPlayer('a', '玩家A')
  liveA = A
  await A.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await setupIdentity(A.page, '玩家A')
  await enterLobby(A.page)
  await A.page.screenshot({ path: path.join(OUT, '01-lobby.png') })
  report('A 进入多人房间大厅', true, '01-lobby.png')

  // 创建房间
  await clickText(A.page, '[role="tab"]', '创建房间')
  await waitFor(A.page, () => !!document.querySelector('form input.mp-input'), null, { label: '创建房间表单' })
  await A.page.type('form input.mp-input', ROOM_NAME, { delay: 40 })
  await sleep(200)
  await clickText(A.page, 'button', '创建并进入房间') // 文案唯一，不会误匹配 Tab

  // 等待进入广场 + 房间信息条
  await waitFor(A.page, () => !!document.querySelector('.mp-roominfo-bar'), null, { timeout: 25000, label: 'A 进入广场房间信息条' })
  await dismissSplash(A.page)
  await dismissOnboarding(A.page)

  // 读取房间码（信息条）
  try {
    await waitFor(A.page, () => {
      const t = document.querySelector('.mp-roominfo-code')?.textContent || ''
      return /房间码\s*([A-Z0-9]{6})/.test(t) ? t : ''
    }, null, { timeout: 15000, label: '房间码信息条' })
  } catch (e) {
    // 兜底：从 API 拉房间列表
    roomCode = await A.page.evaluate(async (name) => {
      const r = await fetch('/api/rooms'); const d = await r.json()
      const rm = (d.rooms || []).find((x) => x.name === name)
      return rm ? rm.code : ''
    }, ROOM_NAME)
  }
  if (!roomCode) {
    roomCode = await A.page.evaluate(() => {
      const t = document.querySelector('.mp-roominfo-code')?.textContent || ''
      const m = t.match(/房间码\s*([A-Z0-9]{6})/)
      return m ? m[1] : ''
    })
  }
  const aBarText = await A.page.evaluate(() => document.querySelector('.mp-roominfo-bar')?.textContent?.replace(/\s+/g, ' ').trim() || '')
  const aWsUrl = await A.page.evaluate(() => decodeURIComponent(window.__wsUrl || ''))
  console.log('A 房间码:', roomCode, '| 信息条:', aBarText, '| WS:', aWsUrl)
  report('1.1 A 创建房间进入广场', !!roomCode && aWsUrl.includes(`social:${roomCode}`), `房间码=${roomCode} WS=${aWsUrl}`)
  await A.page.screenshot({ path: path.join(OUT, '02-room-created.png') })

  // ========== 玩家 B ==========
  console.log('--- 启动玩家B ---')
  const B = await newPlayer('b', '玩家B')
  liveB = B
  await B.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await setupIdentity(B.page, '玩家B')
  await enterLobby(B.page)

  await clickText(B.page, '[role="tab"]', '加入房间码')
  await waitFor(B.page, () => !!document.querySelector('.mp-code-input'), null, { label: '加入房间码表单' })
  await B.page.type('.mp-code-input', roomCode, { delay: 50 })
  await sleep(300)
  await B.page.evaluate(() => { const b = document.querySelector('.mp-form button[type="submit"]'); b && b.click() })
  await sleep(500)
  const joinErr = await B.page.evaluate(() => document.querySelector('.mp-error')?.textContent || '')
  if (joinErr) console.log('B 加入错误提示:', joinErr)

  await waitFor(B.page, () => !!document.querySelector('.mp-roominfo-bar'), null, { timeout: 25000, label: 'B 进入广场' })
  await dismissSplash(B.page)
  await dismissOnboarding(B.page)

  // ========== 同房验证：在线人数 = 2 ==========
  await waitFor(B.page, () => /2\s*人在线/.test(document.querySelector('.mp-roominfo-count')?.textContent || ''), null, { timeout: 15000, label: 'B 侧在线人数=2' })
  await waitFor(A.page, () => /2\s*人在线/.test(document.querySelector('.mp-roominfo-count')?.textContent || ''), null, { timeout: 15000, label: 'A 侧在线人数=2' })
  const bBarText = await B.page.evaluate(() => document.querySelector('.mp-roominfo-bar')?.textContent?.replace(/\s+/g, ' ').trim() || '')
  const bWsUrl = await B.page.evaluate(() => decodeURIComponent(window.__wsUrl || ''))
  console.log('B 信息条:', bBarText, '| WS:', bWsUrl)
  const sameRoom = (aWsUrl || '').includes(roomCode) && (bWsUrl || '').includes(roomCode)
  report('1.2 B 用房间码加入同一房间', sameRoom && /2\s*人在线/.test(bBarText), `B信息条="${bBarText}"`)

  await sleep(3000) // 等待远端化身渲染
  await A.page.screenshot({ path: path.join(OUT, '03-both-in-room-A-view.png') })
  await B.page.screenshot({ path: path.join(OUT, '04-both-in-room-B-view.png') })

  // ========== 化身可见性：B 的 WS 收到 user_joined/welcome 含 A ==========
  const aId = await B.page.evaluate(() => {
    for (const e of window.__wsLog) {
      if (e.type === 'welcome' && Array.isArray(e.raw?.users)) {
        const u = e.raw.users.find((x) => x.nickname === '玩家A')
        if (u) return u.userId
      }
      if (e.type === 'user_joined' && e.raw?.user?.nickname === '玩家A') return e.raw.user.userId
    }
    return ''
  })
  report('2. 双化身同房间可见(WS 感知对端)', !!aId, `A 的 userId=${aId || '未感知到'}（在线人数=2 + 截图佐证）`)

  // ========== 位置同步 ==========
  // B 侧记录 A 的 presence 位置基线
  const baseline = await B.page.evaluate((uid) => {
    let last = null
    for (const e of window.__wsLog) {
      if (e.type === 'presence' && Array.isArray(e.raw?.users)) {
        const u = e.raw.users.find((x) => x.userId === uid)
        if (u) last = { x: u.x, z: u.z }
      }
    }
    return last
  }, aId)

  // A 按住 W 两秒（先点画布聚焦页面，并探针确认 keydown 送达 window）
  await A.page.evaluate(() => {
    window.__keyLog = []
    window.addEventListener('keydown', (e) => window.__keyLog.push(e.code))
  })
  await A.page.mouse.click(640, 500)
  await sleep(300)
  // 等待 WS 进入 OPEN 状态后立即按住 W
  await waitFor(A.page, () => window.__ws && window.__ws.readyState === 1, null, { timeout: 15000, label: 'A WS OPEN' })
  console.log('  [探针] A WS OPEN, 立即按住 W')
  await A.page.keyboard.down('w')
  await sleep(1500)
  await A.page.keyboard.up('w')
  const keyLog = await A.page.evaluate(() => window.__keyLog)
  const rsAfter = await A.page.evaluate(() => ({ readyState: window.__ws ? window.__ws.readyState : null }))
  console.log('  [探针] A window 收到 keydown:', JSON.stringify(keyLog), '; ws.readyState=', rsAfter.readyState)

  // 直接派发合成 keydown 事件，验证 PlayerController 是否响应
  await A.page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
  })
  await sleep(1500)
  await A.page.evaluate(() => {
    const ev = new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
  })
  const aMoveOut2 = await A.page.evaluate(() => window.__wsLog.filter((e) => e.type === 'move').slice(-5))
  console.log('  [探针] 合成事件后 move 条数:', aMoveOut2.length)

  // A 自己确实发出 move
  const aMoveOut = await A.page.evaluate(() => window.__wsLog.filter((e) => e.type === 'move').slice(-5))
  await sleep(2500) // 等 presence 广播到 B

  const after = await B.page.evaluate((uid) => {
    let last = null
    for (const e of window.__wsLog) {
      if (e.type === 'presence' && Array.isArray(e.raw?.users)) {
        const u = e.raw.users.find((x) => x.userId === uid)
        if (u) last = { x: u.x, z: u.z }
      }
    }
    return last
  }, aId)

  const dx = after && baseline ? after.x - baseline.x : 0
  const dz = after && baseline ? after.z - baseline.z : 0
  const moved = Math.hypot(dx, dz) > 0.3
  report('3.1 WASD 位置同步', moved && aMoveOut.length > 0, `A发出move ${aMoveOut.length} 条; B侧 A位置 (${baseline?.x?.toFixed(2)},${baseline?.z?.toFixed(2)}) → (${after?.x?.toFixed(2)},${after?.z?.toFixed(2)}) Δ=${Math.hypot(dx,dz).toFixed(2)}`)

  // ========== 手势同步 ==========
  await A.page.evaluate(() => { if (document.activeElement) document.activeElement.blur() })
  await A.page.keyboard.press('1')
  const emoteOk = await waitFor(B.page, (uid) => window.__wsLog.some((e) => e.type === 'emote' && e.emote === undefined && e.raw?.emote === 'wave' && e.raw?.userId === uid), aId, { timeout: 6000, label: 'B 收到 wave 手势' }).catch(() => false)
  report('3.2 数字键1 wave 手势同步', !!emoteOk, 'B 侧 WS 收到 {type:emote, emote:wave}')

  // ========== WebRTC 语音链路 ==========
  // 双方点麦克风
  await A.page.evaluate(() => document.querySelector('.voice-mic-btn')?.click())
  await B.page.evaluate(() => document.querySelector('.voice-mic-btn')?.click())
  await sleep(8000) // 等 getUserMedia + 信令 + ICE

  const rtcStats = await Promise.all([
    A.page.evaluate(() => ({ sdp: window.__wsLog.filter((e) => e.type === 'rtc_sdp').length, ice: window.__wsLog.filter((e) => e.type === 'rtc_ice').length, pcs: window.__pcCount, offers: window.__rtcLog.filter(r => r.ev === 'createOffer-called').length, offerErrs: window.__rtcLog.filter(r => r.ev === 'createOffer-ERR').map(r => r.err), rtcLog: window.__rtcLog.slice(-10) })),
    B.page.evaluate(() => ({ sdp: window.__wsLog.filter((e) => e.type === 'rtc_sdp').length, ice: window.__wsLog.filter((e) => e.type === 'rtc_ice').length, pcs: window.__pcCount, offers: window.__rtcLog.filter(r => r.ev === 'createOffer-called').length, offerErrs: window.__rtcLog.filter(r => r.ev === 'createOffer-ERR').map(r => r.err), rtcLog: window.__rtcLog.slice(-10) })),
  ])
  const [aRtc, bRtc] = rtcStats
  const sdpExchanged = (aRtc.sdp + bRtc.sdp) > 0
  report('4. WebRTC 信令交换(offer/answer)', sdpExchanged, `A: sdp=${aRtc.sdp} offers=${aRtc.offers} err=${JSON.stringify(aRtc.offerErrs)} PC=${aRtc.pcs}; B: sdp=${bRtc.sdp} offers=${bRtc.offers} err=${JSON.stringify(bRtc.offerErrs)} PC=${bRtc.pcs}`)

  await B.page.screenshot({ path: path.join(OUT, '05-after-movement.png') })

  // ========== 落盘日志 ==========
  fs.writeFileSync(path.join(OUT, 'console-a.log'), logs.a.join('\n'))
  fs.writeFileSync(path.join(OUT, 'console-b.log'), logs.b.join('\n'))
  fs.writeFileSync(path.join(OUT, 'ws-a.json'), JSON.stringify(await A.page.evaluate(() => window.__wsLog), null, 2))
  fs.writeFileSync(path.join(OUT, 'ws-b.json'), JSON.stringify(await B.page.evaluate(() => window.__wsLog), null, 2))
} catch (e) {
  report('脚本流程异常', false, String(e && e.stack || e))
  try { await liveA?.page?.screenshot({ path: path.join(OUT, 'fail-A.png') }) } catch {}
  try { await liveB?.page?.screenshot({ path: path.join(OUT, 'fail-B.png') }) } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, roomCode, ts: new Date().toISOString() }, null, 2))
  console.log('\n===== 汇总 =====')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`)
  await browser.close()
}
