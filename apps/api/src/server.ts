import Fastify from "fastify";
import cors from "@fastify/cors";
import { TRIAL_STAGES, type TrialEvent, type Verdict, type CourtRole, type PlazaContent, type ContentSort, type SceneId, CELEBRITIES, getCelebrity, type BenchStartRequest, type BenchInteraction, type BenchInteractionKind, type Perspective, type User, type CertRecord, type MsgRecord } from "@balabala/shared";
import { runBenchTrial } from "./bench-orchestrator.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createImageTask, createTextTask, findAssetUrl, getTask, TripoError, uploadImageBuffer, uploadImageUrl } from './tripo.js';
import { loadCases as loadStoredCases, saveCases as saveStoredCases, type StoredCase } from './storage.js';
import { loadContents, saveContents, makeSeedContents } from './content-storage.js';
import * as db from './db.js';
import type { StoredContent } from './db.js';
import { registerWebSocket, broadcastToRoom, updateCourtState, getCourtState, sendToUserInRoom } from './ws.js';
import { registerBarRoutes } from './bar-routes.js';
import { registerTalkshowRoutes } from './talkshow-routes.js';
import { registerLibraryRoutes } from './library-routes.js';
import { registerWerewolfRoutes } from './werewolf-routes.js';
import { registerGymRoutes } from './gym-routes.js';
import { registerCustomCharacterRoutes } from './custom-character-routes.js';
import { registerCourtRoutes } from './court-routes.js';
import { setBroadcastCallbacks, setChatProvider } from './werewolf-orchestrator.js';

// Load local development secrets without adding a runtime dependency. Production should use process env.
for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env"), resolve(process.cwd(), "../../.env")]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match=line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]]=match[2].trim();
  }
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(import('@fastify/websocket'));
registerWebSocket(app);

type CaseRecord = StoredCase & { createdAt: string; shareToken?: string; userId?: string };
const cases = new Map<string, CaseRecord>();
for (const item of await loadStoredCases()) {
  cases.set(item.id, { ...item, createdAt: item.createdAt ?? new Date(0).toISOString() });
}
let contents: StoredContent[] = await loadContents();
if (contents.length === 0) {
  contents = makeSeedContents();
  await saveContents(contents);
}
// Queue snapshots so concurrent case creation/verdict completion cannot make
// a later write get overwritten by an earlier one.
let persistQueue = Promise.resolve();
const persistCases = async (): Promise<void> => {
  const snapshot = [...cases.values()];
  persistQueue = persistQueue.then(() => saveStoredCases(snapshot)).catch((error) => {
    app.log.error({ error }, 'Unable to persist case archive');
  });
  await persistQueue;
};
const tripoKey = process.env.TRIPO_API_KEY;
const stepfunBase = process.env.STEPFUN_API_BASE_URL ?? "https://api.stepfun.com/v1";
const stepfunKey = process.env.STEPFUN_API_KEY;
const stepfunModel = process.env.STEPFUN_MODEL ?? "step-3.5-flash";
const evomapBase = process.env.EVOMAP_API_BASE_URL ?? "https://api.evomap.ai/v1";
const evomapKey = process.env.EVOMAP_API_KEY;
const evomapModel = process.env.EVOMAP_MODEL ?? "evomap-deepseek-v4-flash";

const moderationTerms = [
  /自杀|自残|轻生|suicide|self[- ]?harm/i,
  /家暴|虐待|强奸|性侵|child\s*abuse/i,
  /杀人|杀了我|我要杀|谋杀|炸弹|爆炸/i,
];
const moderateInput = (value: string): { ok: true; value: string } | { ok: false; message: string } => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return { ok: false, message: '请先描述一件生活小事。' };
  if (normalized.length > 500) return { ok: false, message: '案件描述请控制在 500 字以内。' };
  if (moderationTerms.some((term) => term.test(normalized))) {
    return { ok: false, message: '本案不在趣味法庭管辖范围，请换一个轻松的话题。' };
  }
  return { ok: true, value: normalized };
};

const fallback = (input:string): Verdict => ({
  caseNo: `(2026) 巴拉民初字第 ${String(Math.floor(Math.random()*9000)+1000)} 号`,
  title: `${(input.split(/[，。！？,!?\n]/)[0].trim() || input).slice(0, 16)}案`, charge: "生活小事过度认真罪", sentence: "判处今日完成一件对自己有益的小事，并在 23:00 前放下手机。",
  facts: `经审理查明，被告确实经历了“${input}”，且在做出决定前进行了充分的脑内辩论。`,
  plaintiffClaim: "原告请求法庭承认这件事确实值得被认真对待。",
  defense: "被告辩称：我只是当时有一点点身不由己。",
  judgeNote: "日子已经很忙了，允许自己偶尔被生活逗笑。",
  quote: "你不是案件本身，你只是今天来这里复盘一下。"
});


type GeneratedHearing = { lines:Array<[CourtRole,string,string]>; verdict:Verdict };
const localLines = (input:string):Array<[CourtRole,string,string]> => [
  ['judge','法槌一响，本庭现在审理这件生活小事。','敲槌'],
  ['plaintiff',`原告陈述：关于“${input}”，我方认为这不是小事，这是今天的头等大事。`,'控诉'],
  ['defendant','被告答辩：我承认事情发生过，但其中一定存在一些不可抗力。','摊手'],
  ['witness','证人作证：我当时在现场，只能说，被告的脑内戏比现场还热闹。','点头'],
  ['judge','本庭认为：成年人可以为小事烦恼，也可以把烦恼讲成一个笑话。','思考']
];
const extractJson = (text:string):unknown => { const clean=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim(); const start=clean.indexOf('{'); const end=clean.lastIndexOf('}'); if(start<0||end<=start) throw new Error('模型没有返回 JSON'); return JSON.parse(clean.slice(start,end+1)); };
const buildHearingPrompt = (input:string) => `案件：${input}`;
const hearingSystem = `你是叽里呱啦 BalaBala 趣味法庭的总编剧。把用户的一件生活小事写成轻松、友善、不涉及真实法律效力的六步庭审。不要辱骂、不要诊断、不要处理自残、家暴或他人隐私。只返回合法 JSON，不要 Markdown。JSON 格式：{"lines":[{"role":"judge|plaintiff|defendant|witness","text":"台词","action":"动作","emotion":"neutral|angry|surprised|warm"}],"verdict":{"caseNo":"案号","title":"案件标题","charge":"趣味罪名","sentence":"可执行且有建设性的量刑","facts":"事实认定","plaintiffClaim":"原告诉求","defense":"被告答辩","judgeNote":"法官寄语","quote":"可分享金句"}}。lines 必须恰好 5 条，角色顺序 judge、plaintiff、defendant、witness、judge。`;

type ProviderConfig = { name:string; base:string; key?:string; model:string };
const requestStructuredHearing = async (provider:ProviderConfig, input:string):Promise<GeneratedHearing> => {
  if (!provider.key) throw new Error(`${provider.name} API key missing`);
  const response=await fetch(`${provider.base.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${provider.key}`, 'Content-Type':'application/json'},body:JSON.stringify({model:provider.model,messages:[{role:'system',content:hearingSystem},{role:'user',content:buildHearingPrompt(input)}],temperature:.65,max_tokens:3000,thinking:{type:'disabled'},response_format:{type:'json_object'}}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`${provider.name} ${response.status}`);
  const body=await response.json() as {choices?:Array<{message?:{content?:string}}>};
  const content=body.choices?.[0]?.message?.content; if(!content) throw new Error(`${provider.name} returned empty content`);
  const parsed=extractJson(content) as {lines?:Array<{role?:CourtRole,text?:string,action?:string,emotion?:string}>;verdict?:Partial<Verdict>};
  if(!parsed.lines || parsed.lines.length<5 || !parsed.verdict) throw new Error(`${provider.name} JSON fields incomplete`);
  const expected: CourtRole[]=['judge','plaintiff','defendant','witness','judge'];
  const lines=expected.map((role,i)=>{const line=parsed.lines![i];return [role,String(line?.text??''),String(line?.action??'')] as [CourtRole,string,string]}).filter(x=>x[1]);
  if(lines.length<5) throw new Error(`${provider.name} dialogue incomplete`);
  const v=parsed.verdict; const local=fallback(input); const verdict:Verdict={caseNo:String(v.caseNo??local.caseNo),title:String(v.title??local.title),charge:String(v.charge??local.charge),sentence:String(v.sentence??local.sentence),facts:String(v.facts??local.facts),plaintiffClaim:String(v.plaintiffClaim??local.plaintiffClaim),defense:String(v.defense??local.defense),judgeNote:String(v.judgeNote??local.judgeNote),quote:String(v.quote??local.quote)};
  return {lines,verdict};
};

const generateHearing = async (input:string):Promise<GeneratedHearing> => {
  const fallbackResult={ lines:localLines(input), verdict:fallback(input) };
  const providers:ProviderConfig[]=[
    {name:'StepFun',base:stepfunBase,key:stepfunKey,model:stepfunModel},
    {name:'EvoMap',base:evomapBase,key:evomapKey,model:evomapModel},
  ];
  for (const provider of providers) {
    if (!provider.key) continue;
    try { return await requestStructuredHearing(provider,input); }
    catch (error) { app.log.warn({provider:provider.name,error}, 'LLM generation failed; trying next provider'); }
  }
  return fallbackResult;
};

// ===== 人物馆 · 名人对话 =====
type ChatMessage = { role: 'system'|'user'|'assistant'; content: string };
const requestChatCompletion = async (provider: ProviderConfig, messages: ChatMessage[], maxTokens = 800): Promise<string> => {
  const response = await fetch(`${provider.base.replace(/\/$/,'')}/chat/completions`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${provider.key}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model: provider.model, messages, temperature:.8, max_tokens:maxTokens, thinking:{type:'disabled'} }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${provider.name} ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name} empty (finish=${data.choices?.[0]?.finish_reason})`);
  return content;
};
const chatWithProviders = async (messages: ChatMessage[], maxTokens = 800): Promise<string> => {
  const providers: ProviderConfig[] = [
    { name:'StepFun', base:stepfunBase, key:stepfunKey, model:stepfunModel },
    { name:'EvoMap', base:evomapBase, key:evomapKey, model:evomapModel },
  ];
  let lastError: unknown;
  for (const provider of providers) {
    if (!provider.key) continue;
    try { return await requestChatCompletion(provider, messages, maxTokens); }
    catch (error) { lastError = error; app.log.warn({ provider:provider.name, error }, 'celebrity chat failed; trying next provider'); }
  }
  throw lastError ?? new Error('no chat provider available');
};

app.get('/health', async () => ({ ok:true, service:'balabala-api', time:new Date().toISOString(), tripoConfigured:Boolean(tripoKey), stepfunConfigured:Boolean(stepfunKey), stepfunModel, evomapConfigured:Boolean(evomapKey), evomapModel }));

// ===== M7: 用户身份端点 =====
app.post('/api/users', async (req, reply) => {
  const body = (req.body ?? {}) as { userId?: string; nickname?: string; avatarType?: User['avatarType']; avatarRef?: string };
  if (body.userId) {
    // 更新已有用户
    const existing = db.getUser(body.userId);
    if (!existing) return reply.code(404).send({ message: '用户不存在' });
    const updated: User = {
      ...existing,
      nickname: body.nickname?.trim() || existing.nickname,
      avatarType: body.avatarType ?? existing.avatarType,
      avatarRef: body.avatarRef ?? existing.avatarRef,
    };
    db.upsertUser(updated);
    return updated;
  }
  // 创建新用户
  const newUser: User = {
    userId: randomUUID(),
    nickname: body.nickname?.trim() || '我',
    avatarType: body.avatarType ?? 'capsule',
    avatarRef: body.avatarRef ?? '',
    createdAt: new Date().toISOString(),
  };
  db.upsertUser(newUser);
  return reply.code(201).send(newUser);
});

app.get('/api/users/:userId', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  const user = db.getUser(userId);
  if (!user) return reply.code(404).send({ message: '用户不存在' });
  return user;
});

// ===== M7: 我的页面数据端点 =====
app.get('/api/users/:userId/cases', async (req) => {
  const { userId } = req.params as { userId: string };
  return db.getCasesByUser(userId);
});

app.get('/api/users/:userId/contents', async (req) => {
  const { userId } = req.params as { userId: string };
  return db.getContentsByUser(userId);
});

app.get('/api/users/:userId/certificates', async (req) => {
  const { userId } = req.params as { userId: string };
  return db.getCertificates(userId);
});

app.post('/api/users/:userId/certificates', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  const body = (req.body ?? {}) as { caseId?: string; caseTitle?: string; verdict?: string; charge?: string };
  if (!body.caseId || !body.caseTitle || !body.verdict) {
    return reply.code(400).send({ message: 'caseId, caseTitle, verdict 为必填' });
  }
  const cert: CertRecord = {
    id: randomUUID(),
    userId,
    caseId: body.caseId,
    caseTitle: body.caseTitle,
    verdict: body.verdict,
    charge: body.charge,
    createdAt: new Date().toISOString(),
  };
  db.addCertificate(cert);
  return reply.code(201).send(cert);
});

app.get('/api/users/:userId/messages', async (req) => {
  const { userId } = req.params as { userId: string };
  return db.getMessages(userId);
});

app.put('/api/users/:userId/messages/:msgId/read', async (req, reply) => {
  const { userId, msgId } = req.params as { userId: string; msgId: string };
  db.markMessageRead(userId, msgId);
  return { ok: true };
});

app.put('/api/users/:userId/messages/read-all', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  db.markAllMessagesRead(userId);
  return { ok: true };
});

app.post('/api/users/:userId/messages', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  const body = (req.body ?? {}) as { kind?: MsgRecord['kind']; title?: string; summary?: string };
  if (!body.kind || !body.title || !body.summary) {
    return reply.code(400).send({ message: 'kind, title, summary 为必填' });
  }
  const msg: MsgRecord = {
    id: randomUUID(),
    userId,
    kind: body.kind,
    title: body.title,
    summary: body.summary,
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.addMessage(msg);
  return reply.code(201).send(msg);
});

// ===== 案件端点（M1-M6 原有 + M7 userId 扩展） =====
app.post('/api/cases', async (req, reply) => {
  const body = (req.body ?? {}) as { input?: string; userId?: string };
  const checked = moderateInput(body.input ?? '');
  if (!checked.ok) return reply.code(400).send({ message: checked.message });
  const id = randomUUID();
  cases.set(id, { id, input: checked.value, createdAt: new Date().toISOString(), userId: body.userId });
  await persistCases();
  return { id };
});
app.get('/api/cases/:id', async (req, reply) => { const c=cases.get((req.params as {id:string}).id); return c ?? reply.code(404).send({message:'案件不存在'}); });
app.get('/api/archives', async () => [...cases.values()].filter((item) => item.verdict).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
app.post('/api/cases/:id/share', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const item = cases.get(id);
  if (!item) return reply.code(404).send({ message: '案件不存在' });
  if (!item.verdict) return reply.code(409).send({ message: '判决尚未生成，暂时不能分享' });
  item.shareToken ??= randomUUID().replaceAll('-', '');
  await persistCases();
  return {
    shareId: item.shareToken,
    shareUrl: `/share/${item.shareToken}`,
    title: item.verdict.title,
    quote: item.verdict.quote,
    disclaimer: '本内容由 AI 生成，仅供娱乐，不具有法律效力。',
  };
});
app.get('/api/shares/:shareId', async (req, reply) => {
  const token = (req.params as { shareId: string }).shareId;
  const item = [...cases.values()].find((candidate) => candidate.shareToken === token && candidate.verdict);
  if (!item || !item.verdict) return reply.code(404).send({ message: '分享内容不存在或已失效' });
  return {
    title: item.verdict.title,
    quote: item.verdict.quote,
    charge: item.verdict.charge,
    sentence: item.verdict.sentence,
    disclaimer: '本内容由 AI 生成，仅供娱乐，不具有法律效力。',
  };
});
app.delete('/api/cases/:id', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!cases.delete(id)) return reply.code(404).send({ message: '案件不存在' });
  await persistCases();
  return { ok: true, id };
});
app.delete('/api/archives', async () => { cases.clear(); await persistCases(); return { ok: true }; });
// ===== legacy：旧的一次性 generateHearing SSE 端点，保留以确保 M1-M5 不回归 =====
app.get('/api/cases/:id/trial/stream', async (req, reply) => {
  const id=(req.params as {id:string}).id, c=cases.get(id); if(!c) return reply.code(404).send({message:'案件不存在'});
  reply.hijack(); const res=reply.raw; res.writeHead(200,{ 'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*' });
  const send=(event:TrialEvent)=>res.write(`data: ${JSON.stringify(event)}\n\n`); const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  send({type:'stage',stage:'立案'}); await wait(120);
  const generated=await generateHearing(c.input);
  const emitLine=async(line?:[CourtRole,string,string])=>{ if(!line)return; send({type:'dialogue',role:line[0],text:line[1],emotion:line[0]==='plaintiff'?'angry':'neutral',action:line[2]}); await wait(420); };
  for(const stage of TRIAL_STAGES.slice(1)){ send({type:'stage',stage}); await wait(180); if(stage==='开庭') await emitLine(generated.lines[0]); if(stage==='举证'){ await emitLine(generated.lines[1]); await emitLine(generated.lines[3]); } if(stage==='辩论') await emitLine(generated.lines[2]); if(stage==='判决') await emitLine(generated.lines[4]); }
  const verdict=generated.verdict; c.verdict=verdict; c.updatedAt=new Date().toISOString(); await persistCases(); send({type:'verdict',verdict}); await wait(80); res.end();
});


// ===== 合议庭 Bench (M6)：多名人实时编排 + M7 WebSocket 广播 =====
const benchSessions = new Map<string, { interactions: BenchInteraction[] }>();

// POST + SSE：前端用 fetch + ReadableStream 读取（EventSource 仅支持 GET）。
app.post('/api/cases/:id/bench/stream', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const c = cases.get(id);
  if (!c) return reply.code(404).send({ message: '案件不存在' });

  const body = (req.body ?? {}) as Partial<BenchStartRequest>;
  const perspective: Perspective = body.perspective === 'plaintiff' || body.perspective === 'defendant' || body.perspective === 'audience'
    ? body.perspective
    : 'audience';
  const celebrityIds = Array.isArray(body.celebrityIds) ? body.celebrityIds.filter((x): x is string => typeof x === 'string') : [];
  const benchSize = typeof body.benchSize === 'number' ? body.benchSize : 3;

  // 初始化法庭房间状态
  updateCourtState(id, { phase: 'streaming', votes: { plaintiff: 0, defendant: 0 } });

  // 若已有进行中的会话，先清理（避免旧连接泄漏）。
  benchSessions.delete(id);
  benchSessions.set(id, { interactions: [] });

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (event: unknown): void => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

  // M7: onEvent 同时广播给 WebSocket 法庭房间
  const broadcastEvent = (event: unknown): void => {
    broadcastToRoom('court:' + id, { type: 'bench_event', event });
    // 根据事件类型更新法庭房间状态
    if (event && typeof event === 'object' && 'type' in event) {
      const ev = event as { type: string; stage?: string; members?: unknown[]; speech?: unknown; plaintiff?: number; defendant?: number; verdict?: unknown; transcript?: unknown[] };
      switch (ev.type) {
        case 'bench_members':
          updateCourtState(id, { members: ev.members as any[] });
          break;
        case 'speech': {
          const cur = getCourtState(id);
          const speeches = [...(cur?.speeches ?? []), ev.speech as any];
          updateCourtState(id, { speeches });
          break;
        }
        case 'vote_update':
          updateCourtState(id, { votes: { plaintiff: ev.plaintiff ?? 0, defendant: ev.defendant ?? 0 } });
          break;
        case 'verdict':
          updateCourtState(id, { phase: 'verdict', verdict: ev.verdict as Verdict });
          break;
        case 'stage':
          updateCourtState(id, { currentStage: ev.stage as any });
          break;
      }
    }
  };

  let benchResult: Awaited<ReturnType<typeof runBenchTrial>> | undefined;
  try {
    benchResult = await runBenchTrial({
      caseId: id,
      input: c.input,
      celebrityIds,
      perspective,
      benchSize,
      chat: chatWithProviders,
      fallbackVerdict: fallback,
      onEvent: (event) => { send(event); broadcastEvent(event); },
      getPendingInteractions: () => benchSessions.get(id)?.interactions ?? [],
      markInteractionHandled: (interactionId) => {
        const session = benchSessions.get(id);
        if (session) session.interactions = session.interactions.filter((it) => it.id !== interactionId);
      },
    });
  } catch (error) {
    req.log.error(error, 'bench trial failed');
    send({ type: 'error', message: '合议庭审理中断，请稍后重试。' });
  }

  // 持久化合议庭结果。
  const record = cases.get(id);
  if (record) {
    if (benchResult) {
      record.verdict = benchResult.verdict;
      record.benchMembers = benchResult.members;
      record.benchTranscript = benchResult.transcript;
      record.benchVotes = benchResult.votes;
    }
    record.perspective = perspective;
    record.updatedAt = new Date().toISOString();
  }
  await persistCases();
  // 标记法庭房间为判决阶段
  updateCourtState(id, { phase: 'verdict' });
  benchSessions.delete(id);
  res.end();
});

// 非阻塞：用户互动入队，立即返回。
app.post('/api/cases/:id/bench/interact', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const c = cases.get(id);
  if (!c) return reply.code(404).send({ message: '案件不存在' });
  const session = benchSessions.get(id);
  if (!session) return reply.code(409).send({ message: '没有进行中的合议庭会话。' });

  const body = (req.body ?? {}) as { kind?: BenchInteractionKind; text?: string; targetCelebrityId?: string; evidenceName?: string; vote?: 'plaintiff' | 'defendant' };
  const kind = body.kind;
  if (!kind) return reply.code(400).send({ message: '缺少互动类型 kind。' });
  if (kind === 'call' && !body.targetCelebrityId) return reply.code(400).send({ message: 'call 需要 targetCelebrityId。' });

  const interaction: BenchInteraction = {
    id: randomUUID(),
    kind,
    text: body.text,
    targetCelebrityId: body.targetCelebrityId,
    evidenceName: body.evidenceName,
    vote: body.vote,
    perspective: c.perspective ?? 'audience',
    createdAt: new Date().toISOString(),
  };
  session.interactions.push(interaction);
  return { interactionId: interaction.id, ok: true };
});
app.post('/api/tripo/tasks', async (req, reply) => {
  try {
    const body = (req.body ?? {}) as { type?: 'text_to_model'|'image_to_model'; prompt?: string; imageUrl?: string; modelVersion?: string; faceLimit?: number };
    const type = body.type ?? (body.prompt ? 'text_to_model' : 'image_to_model');
    if (type === 'text_to_model') {
      if (!body.prompt?.trim()) return reply.code(400).send({ message: 'prompt 不能为空。' });
      const task = await createTextTask(body.prompt.trim(), { modelVersion: body.modelVersion, faceLimit: body.faceLimit });
      return reply.code(202).send({ provider: 'tripo', type, task });
    }
    if (!body.imageUrl?.trim()) return reply.code(400).send({ message: 'image_to_model 需要 imageUrl。' });
    const imageToken = await uploadImageUrl(body.imageUrl.trim());
    const task = await createImageTask(imageToken, { modelVersion: body.modelVersion, faceLimit: body.faceLimit });
    return reply.code(202).send({ provider: 'tripo', type, task });
  } catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '创建 3D 任务失败。' });
  }
});
app.get('/api/tripo/tasks/:taskId', async (req, reply) => {
  try {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(taskId);
    return { provider: 'tripo', task, assetUrl: findAssetUrl(task) ?? null };
  } catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '查询 3D 任务失败。' });
  }
});
app.get('/api/tripo/tasks/:taskId/download.glb', async (req, reply) => {
  try {
    const { taskId } = req.params as { taskId: string };
    const { asset } = req.query as { asset?: string };
    const task = await getTask(taskId);
    const assetUrl = findAssetUrl(task, asset);
    if (!assetUrl) return reply.code(409).send({ message: '任务尚未生成可下载文件。', task });
    // Proxy the short-lived Tripo CDN URL through our API origin so browser
    // GLB previews do not depend on the CDN's CORS policy.
    const assetResponse = await fetch(assetUrl);
    if (!assetResponse.ok) return reply.code(502).send({ message: `模型文件下载失败（${assetResponse.status}）。` });
    const contentType = assetResponse.headers.get('content-type') ?? 'model/gltf-binary';
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    return reply.header('content-type', contentType).header('cache-control', 'private, max-age=300').send(bytes);
  } catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '获取 3D 下载地址失败。' });
  }
});
// Keep the original endpoint available for links copied by earlier builds.
app.get('/api/tripo/tasks/:taskId/download', async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const query = req.query as { asset?: string };
  return reply.redirect(`/api/tripo/tasks/${encodeURIComponent(taskId)}/download.glb${query.asset ? `?asset=${encodeURIComponent(query.asset)}` : ''}`);
});

// Backward-compatible aliases used by the first avatar UI prototype.
app.post('/api/avatars/generate', async (req, reply) => {
  const body = (req.body ?? {}) as { type?: 'text_to_model'|'image_to_model'; prompt?: string; imageToken?: string; imageUrl?: string; modelVersion?: string };
  try {
    const type = body.type ?? (body.prompt ? 'text_to_model' : 'image_to_model');
    if (type === 'text_to_model' && !body.prompt?.trim()) return reply.code(400).send({ message: 'prompt 不能为空。' });
    if (type === 'image_to_model' && !body.imageToken && !body.imageUrl) return reply.code(400).send({ message: 'image_to_model 需要 imageToken 或 imageUrl。' });
    const task = type === 'text_to_model'
      ? await createTextTask(body.prompt!.trim(), { modelVersion: body.modelVersion })
      : await createImageTask(body.imageToken ?? await uploadImageUrl(body.imageUrl!), { modelVersion: body.modelVersion });
    if (!task.task_id) return reply.code(502).send({ message: 'Tripo 未返回 task_id。' });
    return reply.code(202).send({ taskId: task.task_id, type });
  } catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '创建 3D 任务失败。' });
  }
});
app.get('/api/avatars/tasks/:taskId', async (req, reply) => {
  try { return await getTask((req.params as { taskId: string }).taskId); }
  catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '查询 3D 任务失败。' });
  }
});

// ===== 广场 Plaza =====
const hotScore = (c: PlazaContent) => c.likes + c.dislikes + c.comments.length * 3;
const recScore = (c: PlazaContent) => c.likes * 1.5 + c.comments.length * 2 + c.views * 0.05;
const sortContents = (list: PlazaContent[], sort: ContentSort): PlazaContent[] => {
  const byTime = (a: PlazaContent, b: PlazaContent) => b.createdAt.localeCompare(a.createdAt);
  const copy = [...list];
  if (sort === 'latest') copy.sort(byTime);
  else if (sort === 'hot') copy.sort((a, b) => hotScore(b) - hotScore(a) || byTime(a, b));
  else copy.sort((a, b) => recScore(b) - recScore(a) || byTime(a, b));
  return copy;
};

app.get('/api/contents', async (req) => {
  const query = req.query as { sort?: string; scene?: string; topic?: string };
  const sort = (query.sort === 'hot' || query.sort === 'latest' ? query.sort : 'recommended') as ContentSort;
  let list = contents;
  if (query.scene && query.scene !== 'all') list = list.filter((c) => c.scene === query.scene);
  const topic = query.topic;
  if (topic) list = list.filter((c) => c.topics.includes(topic));
  const result = sortContents(list, sort);
  return { contents: result, total: result.length };
});

app.get('/api/topics', async () => {
  const counts = new Map<string, number>();
  for (const c of contents) for (const t of c.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  const topics = [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { topics };
});

app.get('/api/contents/:id', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const content = contents.find((c) => c.id === id);
  if (!content) return reply.code(404).send({ message: '内容不存在' });
  content.views += 1;
  await saveContents(contents);
  return { content };
});

app.post('/api/contents', async (req, reply) => {
  const body = (req.body ?? {}) as { title?: string; body?: string; topics?: string[]; scene?: string; author?: string; userId?: string };
  const title = body.title?.trim();
  const text = body.body?.trim();
  if (!title || !text) return reply.code(400).send({ message: '标题和正文不能为空' });
  // M7: 若传了 userId，从用户资料取昵称作为 author
  let author = body.author?.trim() || '我';
  if (body.userId) {
    const user = db.getUser(body.userId);
    if (user) author = user.nickname;
  }
  const content: StoredContent = {
    id: randomUUID(),
    type: 'text',
    scene: (body.scene as SceneId | "all") ?? "all",
    author,
    createdAt: new Date().toISOString(),
    topics: (body.topics ?? []).map((t) => t.trim()).filter(Boolean),
    title,
    body: text,
    likes: 0,
    dislikes: 0,
    views: 0,
    comments: [],
    userId: body.userId ?? "",
  };
  contents.unshift(content);
  await saveContents(contents);
  return reply.code(201).send({ content });
});

app.post('/api/cases/:id/publish', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const body = (req.body ?? {}) as { topics?: string[]; author?: string; participants?: number; userId?: string };
  const record = cases.get(id);
  if (!record) return reply.code(404).send({ message: '案件不存在' });
  if (!record.verdict) return reply.code(409).send({ message: '判决尚未生成，暂时不能发布' });
  const existing = contents.find((c) => c.type === 'closed_court' && c.caseId === id);
  if (existing) return { content: existing };
  // M7: 若传了 userId，从用户资料取昵称作为 author
  let author = body.author?.trim() || '我';
  if (body.userId) {
    const user = db.getUser(body.userId);
    if (user) author = user.nickname;
  }
  const v = record.verdict;
  const closedAt = record.updatedAt ?? record.createdAt ?? new Date().toISOString();
  const content: StoredContent = {
    id: randomUUID(),
    type: 'closed_court',
    scene: 'court',
    author,
    createdAt: closedAt,
    topics: body.topics ?? [],
    title: v.title,
    caseId: id,
    likes: 0,
    dislikes: 0,
    views: 0,
    comments: [],
    userId: body.userId ?? "",
    court: {
      caseNo: v.caseNo,
      title: v.title,
      plaintiffClaim: v.plaintiffClaim,
      defendantClaim: v.defense,
      evidence: v.facts,
      verdict: v.sentence,
      judgeNote: v.judgeNote,
      participants: body.participants ?? 4,
      closedAt,
    },
  };
  contents.unshift(content);
  await saveContents(contents);
  return reply.code(201).send({ content });
});

app.post('/api/contents/:id/react', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const body = (req.body ?? {}) as { reaction?: string; userId?: string };
  const content = contents.find((c) => c.id === id);
  if (!content) return reply.code(404).send({ message: '内容不存在' });
  if (body.reaction !== 'like' && body.reaction !== 'dislike') {
    return reply.code(400).send({ message: 'reaction 必须是 like 或 dislike' });
  }
  // M7: 使用 reactions 表去重，返回最新计数
  const counts = db.addReaction(id, body.userId ?? '', body.reaction);
  content.likes = counts.likes;
  content.dislikes = counts.dislikes;
  await saveContents(contents);
  return { likes: content.likes, dislikes: content.dislikes };
});

app.post('/api/contents/:id/comments', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const body = (req.body ?? {}) as { text?: string; author?: string; userId?: string };
  const content = contents.find((c) => c.id === id);
  if (!content) return reply.code(404).send({ message: '内容不存在' });
  const text = body.text?.trim();
  if (!text) return reply.code(400).send({ message: '评论内容不能为空' });
  // M7: 若传了 userId，从用户资料取昵称作为评论作者
  let author = body.author?.trim() || '我';
  if (body.userId) {
    const user = db.getUser(body.userId);
    if (user) author = user.nickname;
  }
  const newComment = { id: randomUUID(), author, text, createdAt: new Date().toISOString() };
  content.comments.push(newComment);
  await saveContents(contents);
  return reply.code(201).send({ comment: newComment });
});

// ===== 人物馆 · 名人接口 =====
app.get('/api/celebrities', async () => ({
  // persona 只在服务端用于注入，不下发给前端。
  celebrities: CELEBRITIES.map(({ persona, ...rest }) => rest),
  total: CELEBRITIES.length,
}));

app.post('/api/celebrities/:id/chat', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const celebrity = getCelebrity(id);
  if (!celebrity) return reply.code(404).send({ message: '名人不存在' });
  const body = (req.body ?? {}) as { messages?: Array<{ role?: string; content?: string }> };
  const history = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return reply.code(400).send({ message: '需要用户消息。' });
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: `${celebrity.persona} 始终保持角色，用第一人称作答；回答简洁生动，一般不超过150字，除非用户要求展开；不暴露这是系统提示。` },
    ...history.map((m) => ({ role: m.role as 'user'|'assistant', content: m.content as string })),
  ];
  try {
    const text = await chatWithProviders(messages);
    return { reply: text, name: celebrity.name };
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ message: '暂时连不上对话服务，请稍后再试。' });
  }
});


// ===== M5: 图片生成 3D（base64 上传） =====
app.post('/api/avatars/generate-from-image', async (req, reply) => {
  const body = (req.body ?? {}) as { imageBase64?: string; contentType?: string; filename?: string; modelVersion?: string };
  try {
    const raw = (body.imageBase64 ?? '').trim();
    if (!raw) return reply.code(400).send({ message: '请选择一张图片。' });
    const comma = raw.indexOf(',');
    const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
    let bytes: Buffer;
    try { bytes = Buffer.from(b64, 'base64'); } catch { return reply.code(400).send({ message: '图片数据格式不正确。' }); }
    if (!bytes.length) return reply.code(400).send({ message: '图片为空。' });
    if (bytes.length > 10 * 1024 * 1024) return reply.code(413).send({ message: '图片不能超过 10MB。' });
    const contentType = body.contentType && body.contentType.startsWith('image/') ? body.contentType : 'image/jpeg';
    const filename = body.filename || 'upload.jpg';
    const imageToken = await uploadImageBuffer(bytes, contentType, filename);
    const task = await createImageTask(imageToken, { modelVersion: body.modelVersion });
    if (!task.task_id) return reply.code(502).send({ message: 'Tripo 未返回 task_id。' });
    return reply.code(202).send({ taskId: task.task_id, type: 'image_to_model' });
  } catch (error) {
    if (error instanceof TripoError) return reply.code(error.statusCode).send({ message: error.message, details: error.details });
    req.log.error(error); return reply.code(500).send({ message: '创建图片生成任务失败。' });
  }
});

// ===== M5: TTS 语音合成（StepFun） =====
const DEFAULT_TTS_VOICE = process.env.STEPFUN_TTS_VOICE ?? 'jingdiannvsheng';
app.post('/api/tts', async (req, reply) => {
  const body = (req.body ?? {}) as { text?: string; voice?: string; format?: string };
  const text = (body.text ?? '').trim();
  if (!text) return reply.code(400).send({ message: 'text 不能为空。' });
  if (text.length > 1000) return reply.code(400).send({ message: '单次合成不超过 1000 字。' });
  if (!stepfunKey) return reply.code(503).send({ message: '语音服务未配置。' });
  const voice = body.voice?.trim() || DEFAULT_TTS_VOICE;
  const format = (body.format ?? 'mp3').toLowerCase();
  try {
    const response = await fetch(`${stepfunBase.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stepfunKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.STEPFUN_TTS_MODEL ?? 'step-tts-mini', input: text, voice, response_format: format }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      req.log.warn({ status: response.status, errText }, 'StepFun TTS failed');
      return reply.code(502).send({ message: `语音合成失败（${response.status}）` });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    return reply
      .header('content-type', response.headers.get('content-type') ?? 'audio/mpeg')
      .header('cache-control', 'private, max-age=86400')
      .send(audio);
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ message: '语音服务暂时不可用。' });
  }
});

// ===== M5: AI 帮写（润色/扩写） =====
const POLISH_SYSTEM = {
  post: '你是叽里呱啦广场的爆款写手。把用户给的一句话或一段草稿润色成一条有趣、有话题性、适合社交广场发布的文字观点：1）语气活泼但不油腻；2）适当加入 2-4 个贴合语境的 emoji；3）保留用户原意，不要虚构事实；4）可以加一个吸引人的短句开头或结尾；5）只输出润色后的正文，不要解释、不要前缀、不要 Markdown。',
  case: '你是叽里呱啦趣味法庭的编剧。把用户给的生活小事润色成一段客观、清晰、有一点戏剧性的案件描述：1）保留事实，不辱骂、不涉及自残/家暴等敏感内容；2）100 字以内；3）只输出润色后的案件描述，不要解释、不要前缀、不要 Markdown。',
  character: '你是叽里呱啦人物馆的角色设定师。根据用户给的角色名字和简短描述，帮他生成一份完整的角色人设：1）身份/背景（1-2句）；2）性格特点（3-5个关键词）；3）说话风格（语气、用词习惯）；4）口头禅（1句）；5）一段可直接用作 system prompt 的 persona 描述（100-200字，用第二人称"你是..."开头）。只输出 JSON：{"title":"...","intro":"...","tags":["..."],"greeting":"...","persona":"..."}，不要解释、不要 Markdown、不要代码块包裹。',
} as const;
app.post('/api/ai/polish', async (req, reply) => {
  const body = (req.body ?? {}) as { text?: string; context?: 'post' | 'case' | 'character' };
  const text = (body.text ?? '').trim();
  if (!text) return reply.code(400).send({ message: '请先输入要润色的内容。' });
  const context = body.context === 'case' || body.context === 'character' ? body.context : 'post';
  try {
    const result = await chatWithProviders([
      { role: 'system', content: POLISH_SYSTEM[context] },
      { role: 'user', content: text },
    ], 800);
    return { result: result.trim(), context };
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ message: '润色服务暂时不可用，请稍后再试。' });
  }
});

// ===== M5: AI 视频工作台（异步任务桥接） =====
type VideoTask = { id: string; kind: 'text' | 'image'; prompt: string; duration: number; ratio: string; imageUrl?: string; status: 'queued'|'processing'|'done'|'failed'; videoUrl?: string; error?: string; createdAt: string };
const videoTasks = new Map<string, VideoTask>();
app.post('/api/video/generate', async (req, reply) => {
  const body = (req.body ?? {}) as { kind?: 'text'|'image'; prompt?: string; duration?: number; ratio?: string; imageUrl?: string };
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return reply.code(400).send({ message: '请输入视频描述。' });
  const id = randomUUID();
  const task: VideoTask = {
    id, kind: body.kind === 'image' ? 'image' : 'text', prompt,
    duration: Math.min(30, Math.max(5, Math.round(Number(body.duration) || 5))),
    ratio: body.ratio || '16:9', imageUrl: body.imageUrl,
    status: 'queued', createdAt: new Date().toISOString(),
  };
  videoTasks.set(id, task);
  return reply.code(202).send({ taskId: id, status: task.status });
});
app.get('/api/video/tasks/:taskId', async (req, reply) => {
  const task = videoTasks.get((req.params as { taskId: string }).taskId);
  if (!task) return reply.code(404).send({ message: '任务不存在。' });
  return task;
});
// 本地验证桥接：由运行环境把生成好的视频 URL 注入任务结果。
app.post('/api/video/tasks/:taskId/result', async (req, reply) => {
  const task = videoTasks.get((req.params as { taskId: string }).taskId);
  if (!task) return reply.code(404).send({ message: '任务不存在。' });
  const body = (req.body ?? {}) as { videoUrl?: string; error?: string };
  if (body.videoUrl) { task.status = 'done'; task.videoUrl = body.videoUrl; }
  else { task.status = 'failed'; task.error = body.error || '生成失败'; }
  return task;
});

// ===== M8: 脱口秀剧场路由（注入 chatWithProviders） =====
registerTalkshowRoutes(app, { chat: chatWithProviders, contents });

// ===== M8: 酒吧辩论路由 =====
registerBarRoutes(app, { chat: chatWithProviders, contents });

// ===== M8: 图书馆路由 =====
registerLibraryRoutes(app, { chat: chatWithProviders, contents });

// ===== M9: 狼人杀馆 =====
// 注入广播/单发回调：公开事件走广播，私密快照走 sendToUserInRoom 单发。
setBroadcastCallbacks(
  (gameId, event) => broadcastToRoom(`werewolf:${gameId}`, { type: "werewolf_event", event }),
  (gameId, userId, msg) => sendToUserInRoom(`werewolf:${gameId}`, userId, msg),
);
// 注入 LLM chat 供 AI 名人玩家决策（串行、带兜底）。
setChatProvider(chatWithProviders);
registerWerewolfRoutes(app, { chat: chatWithProviders, contents });

// ===== M11: 健身房 =====
registerGymRoutes(app, { chat: chatWithProviders, contents });

// ===== M12: 自定义人物 =====
registerCustomCharacterRoutes(app, { chat: chatWithProviders, contents });

// ===== M13: 趣味法庭（全屏 3D + 完整案件状态机）=====
registerCourtRoutes(app, { chat: chatWithProviders, contents, saveContents });

await app.listen({port:Number(process.env.PORT??8787),host:'0.0.0.0'});

