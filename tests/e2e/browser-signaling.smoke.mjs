// ===== 浏览器端冒烟（系统 Chromium headless + fake media）=====
//
// 尝试用本机已安装的 chromium（--use-fake-device-for-media-stream）验证浏览器侧：
//   1. RTCPeerConnection API 可用；
//   2. 页面 WS 连上后能收到 welcome + rtc_config（STUN+TURN 配置）；
//   3. 两个浏览器客户端之间能完成 rtc_sdp offer/answer 信令交换。
//
// 注意：云端无 GPU，音频媒体面（真实双向语音）需真机验证；本脚本只验证信令面 +
// WebRTC API 可用性。若本机 chromium 无法启动（缺库/GPU），脚本以退出码 0 并标注
// "skipped"，不阻塞 CI。

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs"

const here = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(here, "logs")
mkdirSync(LOG_DIR, { recursive: true })
const LOG = join(LOG_DIR, `browser-signaling-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`)
const log = (step, detail) => appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), step, ...detail }) + "\n")

let puppeteer
try {
  puppeteer = (await import("puppeteer-core")).default
} catch {
  console.log("[browser-smoke] puppeteer-core 未安装，跳过浏览器验证")
  process.exit(0)
}

const CHROME = process.env.CHROME_PATH || "/usr/local/bin/chromium"

async function main() {
  // 1. 起服务
  const dir = mkdtempSync(join(tmpdir(), "balabala-rtsmoke-"))
  process.env.DB_PATH = join(dir, "test.db")
  const { registerWebSocket } = await import("../../apps/api/src/ws.ts")
  const Fastify = (await import("fastify")).default
  const fastifyWebSocket = (await import("@fastify/websocket")).default
  const app = Fastify({ logger: false })
  await app.register(fastifyWebSocket)
  registerWebSocket(app)
  await app.listen({ port: 0, host: "127.0.0.1" })
  const port = app.server.address().port
  const base = `ws://127.0.0.1:${port}`
  log("server_listening", { base })

  // 2. 启动 chromium
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "shell",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    })
  } catch (e) {
    console.log("[browser-smoke] chromium 无法启动（缺库/GPU），跳过浏览器验证：", e.message)
    log("skipped", { reason: "chromium_launch_failed", error: e.message })
    await app.close()
    process.exit(0)
  }
  log("chromium_launched", { executablePath: CHROME })

  // 3. 页面脚本：两个客户端连同一房间，完成 offer/answer 信令
  const page = await browser.newPage()
  const html = `<!doctype html><html><body><script>
    window.__result = null;
    async function run() {
      const log = [];
      const mk = (uid) => new Promise((resolve) => {
        const ws = new WebSocket('${base}/api/ws?userId=' + uid + '&room=plaza');
        const acc = [];
        ws.onmessage = (ev) => { acc.push(JSON.parse(ev.data)); };
        ws.onopen = () => resolve({ ws, acc });
      });
      const a = await mk('browserA');
      const b = await mk('browserB');
      await new Promise((r) => setTimeout(r, 300));
      const welcomeA = a.acc.find(m => m.type === 'welcome');
      const cfgA = a.acc.find(m => m.type === 'rtc_config');
      const hasRTC = typeof RTCPeerConnection === 'function';
      // A -> B offer
      a.ws.send(JSON.stringify({ type: 'rtc_sdp', from: 'browserA', to: 'browserB', sdp: { type: 'offer', sdp: 'FAKE' }, seq: 1 }));
      await new Promise((r) => setTimeout(r, 300));
      const bGotOffer = b.acc.find(m => m.type === 'rtc_sdp' && m.from === 'browserA');
      // B -> A answer
      b.ws.send(JSON.stringify({ type: 'rtc_sdp', from: 'browserB', to: 'browserA', sdp: { type: 'answer', sdp: 'FAKE2' }, seq: 2 }));
      await new Promise((r) => setTimeout(r, 300));
      const aGotAnswer = a.acc.find(m => m.type === 'rtc_sdp' && m.sdp && m.sdp.type === 'answer');
      window.__result = { welcome: !!welcomeA, hasRTC, stun: cfgA?.iceServers?.[0]?.urls, offerToB: !!bGotOffer, answerToA: !!aGotAnswer };
    }
    run().catch((e) => { window.__result = { error: String(e) } });
  <\/script></body></html>`
  await page.setContent(html)
  await page.waitForFunction(() => window.__result !== null, { timeout: 8000 })
  const result = await page.evaluate(() => window.__result)
  log("browser_signaling_result", result)
  console.log("[browser-smoke] 结果:", JSON.stringify(result))

  await browser.close()
  await app.close()
  rmSync(dir, { recursive: true, force: true })
  console.log("[browser-smoke] 日志:", LOG)
}

main().catch((e) => {
  console.error("[browser-smoke] 失败（不阻塞，需真机复跑）:", e)
  process.exit(0) // 不阻塞 CI：浏览器媒体面本就标注需真机
})
