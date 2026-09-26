// 酒吧辩论截图（domcontentloaded 避免 WebSocket 长连接导致 networkidle 超时）
import puppeteer from '/home/user/Doubao/chats/38440437530857986/gl-probe/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const USER_ID = '66c99637-19f7-4a64-9570-ad597cf188ee';
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
await page.evaluateOnNewDocument((uid) => window.localStorage.setItem('balabala.userId', uid), USER_ID);

async function clickButton(text) {
  const ok = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes(t));
    if (b) { b.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error(`未找到 button: ${text}`);
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(4000);
// 跳过闪屏
await page.evaluate(() => document.body.click());
await sleep(2500);
// 填身份设置弹窗
const nick = await page.$('input[placeholder*="名字"]');
if (nick) { await nick.type('截图测试'); await sleep(300); }
try { await clickButton('进入广场'); } catch (e) { console.log('跳过进入广场:', e.message); }
await sleep(4000);
await page.screenshot({ path: OUT + '/_debug-after-splash.png' });
await clickButton('酒吧辩论赛');
await sleep(5000); // prepare + topics
await page.screenshot({ path: OUT + '/bar-prepare.png' });
console.log('✓ bar-prepare.png');

// 选第一个辩题
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('外卖迟到'));
  if (t) t.click();
});
await sleep(800);
await clickButton('开战');
await sleep(7000); // debate start
await page.screenshot({ path: OUT + '/bar-debating.png' });
console.log('✓ bar-debating.png');

await browser.close();
console.log('=== done ===');
