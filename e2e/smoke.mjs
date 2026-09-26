// ===== E2E 冒烟测试（不依赖浏览器）=====
// 运行方式：e2e/run-smoke.sh 会先拉起 API，再执行本脚本。
// 本脚本使用 Node 内置 fetch + ws（@fastify/websocket 的传递依赖），覆盖：
//   a. GET /healthz 存活
//   b. GET /readyz 就绪（含 sqlite 可写探测）
//   c. API 关键路由（/api/celebrities、/api/contents）返回正常
//   d. WebSocket 建立连接 -> 收到 welcome -> 发送 chat -> 收到广播
//   e. 前端构建产物 dist/index.html 存在
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8787";
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function checkHttp(path, expectStatus = 200, label = path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    const ok = res.status === expectStatus;
    let bodyPreview = "";
    try { bodyPreview = (await res.text()).slice(0, 120); } catch { /* ignore */ }
    record(`GET ${label} -> ${expectStatus}`, ok, `got ${res.status} ${bodyPreview}`);
    return ok;
  } catch (error) {
    record(`GET ${label}`, false, String(error));
    return false;
  }
}

async function checkWebSocket() {
  return new Promise((resolve) => {
    const wsUrl = BASE.replace(/^http/, "ws") + "/api/ws?userId=smoke-tester&room=plaza";
    const ws = new WebSocket(wsUrl);
    const messages = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        record("WebSocket 连接+收发", false, `timeout, messages=${JSON.stringify(messages.map(m=>m.type))}`);
        try { ws.close(); } catch {}
        resolve(false);
      }
    }, 8000);

    ws.on("open", () => {
      // 连接建立后发送一条 chat，期待被广播回来（self 也在房间广播列表里）。
      setTimeout(() => {
        try { ws.send(JSON.stringify({ type: "chat", text: "smoke-hello" })); } catch {}
      }, 300);
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      messages.push(msg);
      const hasWelcome = messages.some((m) => m.type === "welcome");
      const hasChatEcho = messages.some((m) => m.type === "chat" && m.text === "smoke-hello");
      if (hasWelcome && hasChatEcho) {
        settled = true;
        clearTimeout(timer);
        record("WebSocket 连接+收发", true, `welcome ok, chat echo ok (${messages.length} msgs)`);
        try { ws.close(); } catch {}
        resolve(true);
      }
    });

    ws.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        record("WebSocket 连接+收发", false, String(error));
        resolve(false);
      }
    });
  });
}

async function checkFrontendDist() {
  const candidates = [
    resolve(repoRoot, "apps/web/dist/index.html"),
    resolve(repoRoot, "apps/web/dist/assets"),
  ];
  const ok = existsSync(candidates[0]);
  record("前端构建产物 apps/web/dist/index.html 存在", ok, ok ? candidates[0] : "未找到，请先 npm run build");
  return ok;
}

async function main() {
  console.log(`== E2E smoke against ${BASE} ==`);

  const up = await waitForServer();
  record("服务就绪（轮询 /healthz）", up, up ? "up" : "timeout");
  if (!up) process.exit(1);

  await checkHttp("/healthz", 200, "/healthz 存活");
  await checkHttp("/readyz", 200, "/readyz 就绪(db 可写)");
  await checkHttp("/health", 200, "旧版 /health 兼容");
  await checkHttp("/api/celebrities", 200, "API 关键路由 /api/celebrities");
  await checkHttp("/api/contents", 200, "API 关键路由 /api/contents");
  await checkHttp("/metrics", 200, "/metrics Prometheus 文本");
  await checkWebSocket();
  await checkFrontendDist();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== 结果: ${results.length - failed.length}/${results.length} 通过 ==`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("smoke crashed:", error);
  process.exit(1);
});
