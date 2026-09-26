// WebGL 截图：脱口秀开放麦 + 酒吧辩论（SwiftShader）
import puppeteer from '/home/user/Doubao/chats/38440437530857986/gl-probe/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = 'http://localhost:5173';
const OUT = '/home/user/Doubao/chats/38440437530857986/jilibala/artifacts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/opt/browser/chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--disable-gpu-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 120)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

async function clickButton(text) {
  const ok = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes(t));
    if (b) { b.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error(`未找到 button: ${text}`);
}

async function enterHome() {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000); // 等 vite 编译 + React 挂载
  await page.evaluate(() => document.querySelector('section.splash')?.click());
  await sleep(3000);
  const nick = await page.$('input[placeholder*="名字"]');
  if (nick) {
    await nick.type('截图测试');
    await sleep(300);
    try { await clickButton('进入广场'); } catch (e) { console.log('无进入广场按钮'); }
    await sleep(6000);
  }
}

console.log('=== 脱口秀 ===');
await enterHome();
await page.screenshot({ path: OUT + '/_debug-home.png' });
await clickButton('脱口秀剧场');
await sleep(6000);
try { await clickButton('我准备好了'); } catch (e) { console.log('跳过上台:', e.message); }
await sleep(3000);
const ta = await page.$('textarea');
if (ta) {
  await ta.type('我去面试，HR 问我最大的缺点，我说太诚实。');
  await sleep(500);
  try { await clickButton('讲出去'); } catch (e) { console.log('跳过讲出去:', e.message); }
  await sleep(4500);
}
await page.screenshot({ path: OUT + '/talkshow-performance.png' });
console.log('✓ talkshow-performance.png');

console.log('=== 酒吧 ===');
await enterHome();
await clickButton('酒吧辩论赛');
await sleep(5000);
await page.screenshot({ path: OUT + '/bar-prepare.png' });
console.log('✓ bar-prepare.png');

await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('外卖迟到'));
  if (t) t.click();
});
await sleep(800);
try { await clickButton('开战'); } catch (e) { console.log('跳过开战:', e.message); }
await sleep(7000);
await page.screenshot({ path: OUT + '/bar-debating.png' });
console.log('✓ bar-debating.png');

await browser.close();
console.log('=== done ===');
