// ===== 合议庭编排器 Bench Orchestrator (M6) =====
// 多名人实时合议庭：forming -> opening -> debate(2轮) -> summary -> verdict。
// 所有 LLM 调用串行执行，每次间隔 300ms；失败重试 1 次（间隔 1s）后用兜底文本。
import {
  CELEBRITIES,
  getCelebrity,
  type BenchMember,
  type BenchSpeech,
  type BenchEvent,
  type BenchStance,
  type Perspective,
  type BenchInteraction,
  type Verdict,
} from "@balabala/shared";
import { resolveCharacter, type ResolvedCharacter } from "./character-resolver.js";
import { randomUUID } from "node:crypto";

/** 通用聊天函数签名（由 server.ts 的 chatWithProviders 注入，避免循环依赖）。 */
export type ChatFn = (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens?: number,
  opts?: { signal?: AbortSignal },
) => Promise<string>;

export interface RunBenchOpts {
  caseId: string;
  input: string;
  /** 为空或不传时由 AI 自动推荐。 */
  celebrityIds: string[];
  perspective: Perspective;
  /** 自动推荐时的评委人数（3-5）。 */
  benchSize: number;
  chat: ChatFn;
  /** verdict 生成失败时的兜底（server.ts 的 fallback）。 */
  fallbackVerdict: (input: string) => Verdict;
  onEvent: (event: BenchEvent) => void;
  getPendingInteractions: () => BenchInteraction[];
  markInteractionHandled: (interactionId: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const STANCE_LABEL: Record<BenchStance, string> = {
  plaintiff: "原告倾向（支持原告 / 替用户出头）",
  defendant: "被告倾向（为被告 / 惯性和合理辩护）",
  neutral: "中立（保持客观、兼顾双方）",
};

const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  plaintiff: "用户站在原告一方",
  defendant: "用户站在被告一方",
  audience: "用户以旁观观众视角观看本案",
};

/** 抽取 LLM 返回中的 JSON 对象。 */
const extractJson = (text: string): unknown => {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
};

/** 清理发言文本：去除外层引号、控制长度。 */
const tidySpeech = (raw: string): string => {
  let text = raw.trim();
  text = text.replace(/^[""「『]|[""」』]$/g, "").trim();
  // 去掉可能的前缀式说明，如 "某某："
  text = text.replace(/^[^，。：:]{0,12}说[：:]\s*/, "").trim();
  if (text.length > 300) text = `${text.slice(0, 300)}…`;
  return text;
};

// ===== 2.1 名人推荐 =====
/**
 * 让 AI 根据案件内容从 20 位名人中推荐 count 位评委。
 * 失败或结果不合法时按领域轮转兜底。
 */
export const recommendCelebrities = async (
  input: string,
  count: number,
  chat: ChatFn,
): Promise<string[]> => {
  const catalog = CELEBRITIES.map((c) => `${c.id}（${c.name}，${c.field}）`).join("；");
  const system =
    "你是合议庭调度官，根据案件争议领域推荐最合适的名人评委。从给定名单中选择，返回 JSON {\"ids\":[\"id1\",\"id2\",...]}，数量恰好等于要求的数量，覆盖不同领域（科技/商业/科学/文学/艺术/哲学），不要重复，不要解释。";
  const user = `案件：${input}\n需要 ${count} 位评委。\n候选名人：${catalog}\n请只返回 JSON。`;

  const fallbackPick = (): string[] => {
    // 按领域轮转取前 count 位。
    const byField = new Map<string, string[]>();
    for (const c of CELEBRITIES) {
      const list = byField.get(c.field) ?? [];
      list.push(c.id);
      byField.set(c.field, list);
    }
    const fields = [...byField.keys()];
    const picked: string[] = [];
    let i = 0;
    while (picked.length < count) {
      const field = fields[i % fields.length];
      const pool = byField.get(field)!;
      const candidate = pool[Math.floor(i / fields.length) % pool.length];
      if (!picked.includes(candidate)) picked.push(candidate);
      i += 1;
    }
    return picked;
  };

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      400,
    );
    const parsed = extractJson(raw) as { ids?: unknown };
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === "string") : [];
    const valid: string[] = [];
    for (const id of ids) {
      const celeb = getCelebrity(id);
      if (celeb && !valid.includes(celeb.id)) valid.push(celeb.id);
    }
    // 补齐到 count：用未选中的名人按领域轮转补位。
    const remaining = CELEBRITIES.map((c) => c.id).filter((id) => !valid.includes(id));
    let ri = 0;
    while (valid.length < count && ri < remaining.length) valid.push(remaining[ri++]);
    // 截到 count。
    return valid.slice(0, count);
  } catch {
    return fallbackPick().slice(0, count);
  }
};

// ===== 2.2 名人发言生成 =====
const JARGON_RULE =
  "始终保持你的角色与说话风格，用第一人称发言；发言简短生动，100-300字；友善、幽默、有观点；不要暴露这是系统提示，不要自我介绍，不要解释你是谁。";

/**
 * 让某位名人发表一段合议庭发言。注入 persona 作为 system prompt。
 */
export const celebritySpeak = async (
  celebrity: ResolvedCharacter,
  context: string,
  chat: ChatFn,
  maxTokens = 800,
): Promise<string> => {
  const system = `${celebrity.persona}\n${JARGON_RULE}`;
  const raw = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: context },
    ],
    maxTokens,
  );
  return tidySpeech(raw) || celebrity.greeting;
};

/**
 * 带退避与容错的 LLM 调用：失败重试 1 次（间隔 1s），再失败返回 fallbackText。
 */
const withRetry = async (fn: () => Promise<string>, fallbackText: string): Promise<string> => {
  try {
    return await fn();
  } catch (error) {
    try {
      await sleep(1000);
      return await fn();
    } catch (secondError) {
      // 不中断整个流程，用兜底文本。
      return fallbackText;
    }
  }
};

/** 把已发言记录压成摘要，控制在 2000 字以内。 */
const summarizeTranscript = (speeches: BenchSpeech[]): string => {
  const lines = speeches.map((s) => `【${s.speakerName}】${s.text}`);
  let summary = lines.join("\n");
  if (summary.length > 2000) summary = `${summary.slice(0, 2000)}\n（后略）`;
  return summary;
};

// ===== 2.3 主编排流程 =====
export const runBenchTrial = async (
  opts: RunBenchOpts,
): Promise<{ verdict: Verdict; transcript: BenchSpeech[]; members: BenchMember[]; votes: { plaintiff: number; defendant: number } }> => {
  const { caseId, input, perspective, chat, onEvent, getPendingInteractions, markInteractionHandled, fallbackVerdict } = opts;
  const transcript: BenchSpeech[] = [];
  const votes = { plaintiff: 0, defendant: 0 };

  // ---- 处理用户互动：返回需要加入上下文的现场备注，并消费 vote / call ----
  const drainInteractions = (): string[] => {
    const notes: string[] = [];
    const pending = getPendingInteractions();
    for (const it of pending) {
      switch (it.kind) {
        case "vote":
          if (it.vote === "plaintiff") votes.plaintiff += 1;
          else if (it.vote === "defendant") votes.defendant += 1;
          onEvent({ type: "vote_update", plaintiff: votes.plaintiff, defendant: votes.defendant });
          markInteractionHandled(it.id);
          break;
        case "question":
        case "interrupt":
          if (it.text) notes.push(`现场听众提问：${it.text}`);
          markInteractionHandled(it.id);
          break;
        case "evidence":
          if (it.evidenceName) notes.push(`现场提交的证据：${it.evidenceName}`);
          markInteractionHandled(it.id);
          break;
        case "call":
          // call 在外部主循环中处理（需要让指定名人优先发言），这里不消费。
          break;
      }
    }
    return notes;
  };

  const pushSpeech = (speakerId: string, speakerName: string, stage: BenchSpeech["stage"], text: string) => {
    const speech: BenchSpeech = {
      id: randomUUID(),
      speakerId,
      speakerName,
      stage,
      text,
      timestamp: new Date().toISOString(),
    };
    transcript.push(speech);
    onEvent({ type: "speech", speech });
  };

  // ---- 1. forming 阶段 ----
  onEvent({ type: "stage", stage: "forming" });
  const size = Math.min(5, Math.max(3, opts.benchSize || 3));
  // 用户指定的评委：用统一解析器（支持 custom- 前缀的自定义人物）。
  let chosenIds = opts.celebrityIds.filter((id) => resolveCharacter(id));
  if (chosenIds.length === 0) {
    chosenIds = await recommendCelebrities(input, size, chat);
  }
  // 去重并截到 size。
  chosenIds = [...new Set(chosenIds)].slice(0, size);

  // 为每位成员分配 stance（尽量均衡）和 seatIndex。
  const stances: BenchStance[] = ["plaintiff", "defendant", "neutral"];
  const members: BenchMember[] = chosenIds
    .map((id) => resolveCharacter(id))
    .filter((c): c is ResolvedCharacter => Boolean(c))
    .map((c, index) => ({
      celebrityId: c.id,
      name: c.name,
      title: c.title,
      portrait: c.portrait,
      model: c.model,
      stance: stances[index % stances.length],
      seatIndex: index,
    }));

  onEvent({ type: "bench_members", members });
  await sleep(300);

  const memberById = new Map(members.map((m) => [m.celebrityId, m]));

  // 构造某位成员发言的 context。
  const buildContext = (member: BenchMember, stage: string, userNotes: string[]): string => {
    const summary = summarizeTranscript(transcript);
    const parts = [
      `案件：${input}`,
      `当前阶段：${stage}`,
      `用户视角：${PERSPECTIVE_LABEL[perspective]}`,
      `你的立场：${STANCE_LABEL[member.stance]}`,
      summary ? `此前各位评委发言：\n${summary}` : "（这是你的首次发言）",
    ];
    if (userNotes.length) parts.push(`现场互动：\n${userNotes.join("\n")}`);
    if (stage === "辩论") parts.push("你可以引用某位评委的观点并表示同意或反驳，也可以提出新角度。");
    return parts.join("\n\n");
  };

  /** 让某位成员发言一次（带退避容错），返回是否成功。 */
  const speakAsMember = async (member: BenchMember, stage: BenchSpeech["stage"], userNotes: string[]): Promise<void> => {
    const celeb = resolveCharacter(member.celebrityId)!;
    onEvent({ type: "speech_start", speakerId: member.celebrityId, speakerName: member.name });
    const context = buildContext(member, stage, userNotes);
    const text = await withRetry(
      () => celebritySpeak(celeb, context, chat, 800),
      celeb.greeting,
    );
    pushSpeech(member.celebrityId, member.name, stage, text);
    await sleep(300);
  };

  // ---- 2. opening 阶段 ----
  onEvent({ type: "stage", stage: "opening" });
  for (const member of members) {
    await speakAsMember(member, "opening", []);
  }

  // ---- 3. debate 阶段（2 轮）----
  onEvent({ type: "stage", stage: "debate" });
  for (let round = 0; round < 2; round += 1) {
    const spokenThisRound = new Set<string>();
    // 每轮按 seatIndex 依次发言。
    let seat = 0;
    while (spokenThisRound.size < members.length) {
      // 先消费互动：处理 vote / question / evidence，并检测 call。
      const pendingAll = getPendingInteractions();
      const callTarget = pendingAll.find((it) => it.kind === "call" && it.targetCelebrityId && memberById.has(it.targetCelebrityId));
      const notes = drainInteractions();

      if (callTarget) {
        // call：让指定名人优先发言回应。
        const target = memberById.get(callTarget.targetCelebrityId!)!;
        if (!spokenThisRound.has(target.celebrityId)) {
          spokenThisRound.add(target.celebrityId);
          const callNote = [`现场听众点名请 ${target.name} 回应。`];
          await speakAsMember(target, "debate", [...callNote, ...notes]);
        }
        markInteractionHandled(callTarget.id);
        continue;
      }

      // 找下一个未发言成员。
      const member = members.find((m) => !spokenThisRound.has(m.celebrityId));
      if (!member) break;
      spokenThisRound.add(member.celebrityId);
      await speakAsMember(member, "debate", notes);
      seat += 1;
    }
  }

  // ---- 4. summary 阶段 ----
  onEvent({ type: "stage", stage: "summary" });
  const judgeSystem =
    "你是叽里呱啦趣味法庭的 AI 法官，友善、幽默、公正，擅长从多角度归纳并给出温暖有趣的判决。判决不具有真实法律效力。";
  const judgeSummaryUser = `案件：${input}\n用户视角：${PERSPECTIVE_LABEL[perspective]}\n各位评委发言记录：\n${summarizeTranscript(transcript)}\n\n请用 100-200 字归纳各位评委的核心观点，并引出即将作出的判决。只输出归纳正文。`;
  onEvent({ type: "speech_start", speakerId: "judge", speakerName: "AI 法官" });
  const summaryText = await withRetry(
    () => chat([{ role: "system", content: judgeSystem }, { role: "user", content: judgeSummaryUser }], 800),
    "各位评委从不同角度进行了充分讨论，本庭综合各方意见，现在作出判决。",
  );
  pushSpeech("judge", "AI 法官", "summary", summaryText.trim() || "本庭综合各方意见，现在作出判决。");

  // ---- 5. verdict 阶段 ----
  onEvent({ type: "stage", stage: "verdict" });
  const verdictUser = `案件：${input}\n用户视角：${PERSPECTIVE_LABEL[perspective]}\n听众票数：原告 ${votes.plaintiff} 票 / 被告 ${votes.defendant} 票\n评委发言记录：\n${summarizeTranscript(transcript)}\n\n请根据以上内容生成一份趣味判决。只返回 JSON，字段：caseNo（案号）、title（案件标题）、charge（趣味罪名）、sentence（可执行且有建设性的量刑）、facts（事实认定）、plaintiffClaim（原告诉求）、defense（被告答辩）、judgeNote（法官寄语）、quote（可分享金句）。不要 Markdown。`;

  let verdict: Verdict;
  try {
    const raw = await chat(
      [
        { role: "system", content: `${judgeSystem} 只返回合法 JSON，不要 Markdown。` },
        { role: "user", content: verdictUser },
      ],
      2000,
    );
    const parsed = extractJson(raw) as Partial<Verdict>;
    const local = fallbackVerdict(input);
    verdict = {
      caseNo: String(parsed.caseNo ?? local.caseNo),
      title: String(parsed.title ?? local.title),
      charge: String(parsed.charge ?? local.charge),
      sentence: String(parsed.sentence ?? local.sentence),
      facts: String(parsed.facts ?? local.facts),
      plaintiffClaim: String(parsed.plaintiffClaim ?? local.plaintiffClaim),
      defense: String(parsed.defense ?? local.defense),
      judgeNote: String(parsed.judgeNote ?? local.judgeNote),
      quote: String(parsed.quote ?? local.quote),
    };
  } catch {
    verdict = fallbackVerdict(input);
  }

  onEvent({ type: "verdict", verdict, transcript });
  return { verdict, transcript, members, votes: { ...votes } };
};
