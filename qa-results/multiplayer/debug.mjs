import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/chromium', headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--disable-dev-shm-usage','--mute-audio'],
})
const ctx = await browser.createBrowserContext()
const page = await ctx.newPage()
page.on('console', m => console.log('[console]', m.type(), m.text()))
page.on('pageerror', e => console.log('[pageerror]', String(e)))
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('balabala.onboarding.v1', JSON.stringify({interests:['court'],updatedAt:new Date().toISOString()})) } catch(e){} })
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
await new Promise(r=>setTimeout(r, 5000))
await page.screenshot({ path: 'debug-1-after-load.png' })
console.log('--- body text (first 500) ---')
console.log(await page.evaluate(() => document.body.innerText.slice(0,500)))
const nick = await page.$('input[placeholder*="给自己起个名字"]')
console.log('nick input found:', !!nick)
if (nick) {
  await page.type('input[placeholder*="给自己起个名字"]', '玩家A', { delay: 40 })
  await new Promise(r=>setTimeout(r,300))
  const btn = await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('进入广场')))
  console.log('submit btn found:', !!btn)
  await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('进入广场')); b && b.click() })
  await new Promise(r=>setTimeout(r, 6000))
  await page.screenshot({ path: 'debug-2-after-submit.png' })
  console.log('--- after submit body text ---')
  console.log(await page.evaluate(() => document.body.innerText.slice(0,600)))
  console.log('create cards:', await page.evaluate(() => document.querySelectorAll('.main-home__create-card').length))
}
await browser.close()
