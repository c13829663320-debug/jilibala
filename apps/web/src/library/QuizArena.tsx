// 知识擂台主场景：选题 → 8 题抢答（10s 倒计时）→ 结算。
// AI 对手抢答由前端 setTimeout 模拟（2-8s 随机），判定用 shared 纯函数。
import { useEffect, useRef, useState } from "react";
import {
  type QuizDomain,
  type QuizQuestion,
  getDailyChallenge,
  planBuzzes,
  playerScoreDelta,
} from "@balabala/shared";
import DomainSelector, { BRAND } from "./DomainSelector";
import OpponentScoreboard, { type ScoreboardPlayer } from "./OpponentScoreboard";
import ComboMeter from "./ComboMeter";
import LivesMeter from "./LivesMeter";
import QuizResults from "./QuizResults";

// 首局新手引导四步（可跳过，localStorage 持久化）。
const LIB_TUTORIAL = [
  { title: "选领域", desc: "科学 / 文学 / 哲学 / 历史 / 艺术，选一个你最有把握的领域开战。" },
  { title: "看对手", desc: "三位 AI 名人已就座，实时分数条跟你此消彼长；压过其中 2 位即赢。" },
  { title: "抢答规则", desc: "每题 10 秒限时、4 选 1。答错或超时掉 1 命（共 3 命），命耗尽提前结束。" },
  { title: "连击加成", desc: "连对 3 题后下一题得分 ×2；答错立即断连击。" },
];

interface OpponentInfo {
  id: string; name: string; title: string; portrait: string; field: string; accuracy: number;
}

type Phase = "select" | "loading" | "playing" | "results";

const httpHeaders = { "Content-Type": "application/json" };

export default function QuizArena({ onDeepChat }: { onDeepChat: () => void }) {
  const [phase, setPhase] = useState<Phase>("select");
  const [domainLabel, setDomainLabel] = useState("");
  const [players, setPlayers] = useState<ScoreboardPlayer[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(10_000);
  const [buzzToast, setBuzzToast] = useState<string | null>(null);
  const [error, setError] = useState("");
  // R5: 服务端结算钩子（高光/关系/连胜/战果卡）。
  const [settle, setSettle] = useState<LibrarySettleResponse | null>(null);

  // 每日挑战（共享种子池）+ 首局新手引导（可跳过）。
  const dailyChallenge = getDailyChallenge("library", new Date());
  const [tutorialStep, setTutorialStep] = useState<number>(() =>
    typeof window !== "undefined" && window.localStorage.getItem("library-tutorial-done") === "1" ? -1 : 0
  );
  const dismissTutorial = () => {
    if (typeof window !== "undefined") window.localStorage.setItem("library-tutorial-done", "1");
    setTutorialStep(-1);
  };

  // refs：给定时器回调读取最新值，避免闭包过期。
  const questionsRef = useRef<QuizQuestion[]>([]);
  const opponentsRef = useRef<OpponentInfo[]>([]);
  const domainRef = useRef<QuizDomain | null>(null);
  const qIndexRef = useRef(0);
  const livesRef = useRef(3);
  const comboRef = useRef(0);
  const myScoreRef = useRef(0);
  const answeredRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  // R5: 结算轨迹——每题亮出时间 / 玩家得分历史 / 名人失误次数 / 最快抢答。
  const qStartRef = useRef(0);
  const scoreHistoryRef = useRef<number[]>([0]);
  const wrongBuzzRef = useRef<Record<string, number>>({});
  const quickestRef = useRef<number | undefined>(undefined);

  const clearTimers = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    for (const t of timeoutsRef.current) window.clearTimeout(t);
    timeoutsRef.current = [];
  };

  useEffect(() => clearTimers, []);

  const applyBuzz = (celebId: string, correct: boolean, delta: number) => {
    oppScoreRef.current[celebId] = (oppScoreRef.current[celebId] ?? 0) + delta;
    setPlayers((prev) => prev.map((p) => (p.id === celebId ? { ...p, score: p.score + delta } : p)));
    if (!correct) wrongBuzzRef.current[celebId] = (wrongBuzzRef.current[celebId] ?? 0) + 1;
    const name = opponentsRef.current.find((o) => o.id === celebId)?.name ?? celebId;
    setBuzzToast(`${name} 抢答${correct ? "成功" : "失误"} ${delta > 0 ? "+" : ""}${delta}`);
    const t = window.setTimeout(() => setBuzzToast(null), 1500);
    timeoutsRef.current.push(t);
  };

  const finish = () => {
    clearTimers();
    setPhase("results");
    // R5: 上报服务端结算——落盘 3 位名人关系 + library 连胜，取回钩子数据。
    void fetch("/api/engine/library/settle", {
      method: "POST",
      headers: httpHeaders,
      body: JSON.stringify({
        userId: "local-user",
        domain: domainRef.current,
        myScore: myScoreRef.current,
        maxCombo: maxComboRef.current,
        correctCount: correctCountRef.current,
        questionCount: questionsRef.current.length,
        quickestAnswerMs: quickestRef.current,
        scoreHistory: scoreHistoryRef.current,
        opponents: opponentsRef.current.map((o) => ({
          id: o.id,
          name: o.name,
          field: o.field,
          score: oppScoreRef.current[o.id] ?? 0,
          wrongBuzzes: wrongBuzzRef.current[o.id] ?? 0,
        })),
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<LibrarySettleResponse>) : null))
      .then((data) => { if (data) setSettle(data); })
      .catch(() => { /* 离线静默 */ });
  };

  const oppScoreRef = useRef<Record<string, number>>({});
  const maxComboRef = useRef(0);
  const correctCountRef = useRef(0);

  const beginQuestion = (index: number) => {
    clearTimers();
    answeredRef.current = false;
    setSelected(null);
    setRemainingMs(10_000);
    setQIndex(index);
    qIndexRef.current = index;
    qStartRef.current = performance.now();

    // 为本题规划 1-2 位 AI 抢答。
    if (domainRef.current) {
      const buzzes = planBuzzes(domainRef.current, opponentsRef.current.map((o) => ({ id: o.id, field: o.field })));
      for (const b of buzzes) {
        const t = window.setTimeout(() => applyBuzz(b.celebId, b.correct, b.delta), b.atMs);
        timeoutsRef.current.push(t);
      }
    }

    intervalRef.current = window.setInterval(() => {
      setRemainingMs((r) => Math.max(0, r - 100));
    }, 100);
  };

  const advance = () => {
    if (livesRef.current <= 0 || qIndexRef.current >= questionsRef.current.length - 1) {
      finish();
      return;
    }
    beginQuestion(qIndexRef.current + 1);
  };

  const lockAnswer = (choice: number) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    const q = questionsRef.current[qIndexRef.current];
    const correct = choice === q.correctIndex;
    setSelected(choice);
    if (correct) {
      const delta = playerScoreDelta(comboRef.current);
      const answeredMs = Math.round(performance.now() - qStartRef.current);
      comboRef.current += 1;
      setCombo(comboRef.current);
      maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
      setMaxCombo((m) => Math.max(m, comboRef.current));
      correctCountRef.current += 1;
      setCorrectCount((c) => c + 1);
      myScoreRef.current += delta;
      scoreHistoryRef.current.push(myScoreRef.current);
      if (quickestRef.current === undefined || answeredMs < quickestRef.current) quickestRef.current = answeredMs;
    } else {
      livesRef.current -= 1;
      comboRef.current = 0;
      setCombo(0);
      setLives(livesRef.current);
    }
    setPlayers((prev) => prev.map((p) => (p.id === "you" ? { ...p, score: myScoreRef.current } : p)));
    const t = window.setTimeout(advance, 2400);
    timeoutsRef.current.push(t);
  };

  // 倒计时归零：按超时答错处理。
  useEffect(() => {
    if (phase === "playing" && remainingMs <= 0 && !answeredRef.current) {
      lockAnswer(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, phase]);

  const startGame = async (domain: QuizDomain) => {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/library/quiz/start", {
        method: "POST", headers: httpHeaders, body: JSON.stringify({ domain }),
      });
      const data = await res.json() as {
        questions: QuizQuestion[]; opponents: OpponentInfo[]; domainLabel: string; message?: string;
      };
      if (!res.ok || !data.questions?.length) throw new Error(data.message ?? "出题失败");

      questionsRef.current = data.questions;
      opponentsRef.current = data.opponents;
      domainRef.current = domain;
      setDomainLabel(data.domainLabel);

      livesRef.current = 3; comboRef.current = 0; myScoreRef.current = 0; qIndexRef.current = 0;
      scoreHistoryRef.current = [0]; wrongBuzzRef.current = {}; quickestRef.current = undefined;
      oppScoreRef.current = {}; maxComboRef.current = 0; correctCountRef.current = 0;
      setSettle(null);
      setLives(3); setCombo(0); setMaxCombo(0); setCorrectCount(0);
      setPlayers([
        { id: "you", name: "你", score: 0, isCeleb: false },
        ...data.opponents.map((o) => ({ id: o.id, name: o.name, score: 0, isCeleb: true, portrait: o.portrait })),
      ]);
      setPhase("playing");
      beginQuestion(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出题失败");
      setPhase("select");
    }
  };

  const q = phase === "playing" ? questionsRef.current[qIndex] : null;

  return (
    <div style={{ minHeight: "100%", padding: "20px 16px", background: BRAND.bg, color: BRAND.text }}>
      {phase === "select" && (
        <div style={{ paddingTop: 40 }}>
          <div style={{
            maxWidth: 640, margin: "0 auto 16px", padding: "8px 14px", borderRadius: 10, fontSize: 12.5,
            background: "rgba(255,214,0,0.08)", border: "1px solid rgba(255,214,0,0.35)", color: "#ffd600", textAlign: "center",
          }}>
            📅 今日挑战 · {dailyChallenge.title}：{dailyChallenge.description}
          </div>
          <DomainSelector onSelect={(d) => void startGame(d)} />
          {error && <div style={{ textAlign: "center", color: BRAND.danger, marginTop: 16 }}>{error}</div>}
        </div>
      )}

      {phase === "loading" && (
        <div style={{ paddingTop: 120, textAlign: "center", color: BRAND.dim }}>出题官正在为你准备题目…</div>
      )}

      {phase === "playing" && q && (
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <LivesMeter lives={lives} max={3} />
            <ComboMeter combo={combo} />
            <div style={{ fontSize: 13, color: BRAND.dim }}>第 {qIndex + 1}/{questionsRef.current.length} 题 · {domainLabel}</div>
          </div>

          <OpponentScoreboard players={players} />

          {buzzToast && (
            <div style={{
              position: "sticky", top: 8, margin: "10px auto", width: "fit-content",
              background: "rgba(255,214,0,0.15)", border: `1px solid ${BRAND.yellow}`,
              color: BRAND.yellow, padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
            }}>{buzzToast}</div>
          )}

          <div style={{
            background: BRAND.panel, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18,
            padding: 26, marginTop: 16, position: "relative",
          }}>
            <CountdownRing ms={remainingMs} />
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.5, marginBottom: 20, paddingRight: 60 }}>
              {q.prompt}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {q.options.map((opt, i) => {
                const revealed = selected !== null;
                const isCorrect = i === q.correctIndex;
                const isPicked = i === selected;
                let bg = "rgba(255,255,255,0.04)";
                let color = BRAND.text;
                let border = "rgba(255,255,255,0.12)";
                if (revealed) {
                  if (isCorrect) { bg = "rgba(79,179,165,0.2)"; border = BRAND.teal; color = BRAND.teal; }
                  else if (isPicked) { bg = "rgba(255,107,107,0.18)"; border = BRAND.danger; color = BRAND.danger; }
                  else { border = "rgba(255,255,255,0.06)"; color = BRAND.dim; }
                }
                return (
                  <button
                    key={i}
                    disabled={revealed}
                    onClick={() => lockAnswer(i)}
                    style={{
                      textAlign: "left", padding: "14px 16px", borderRadius: 12, cursor: revealed ? "default" : "pointer",
                      border: `1px solid ${border}`, background: bg, color, fontSize: 15, fontWeight: 600, lineHeight: 1.4,
                    }}
                  >
                    <span style={{ color: BRAND.yellow, marginRight: 8, fontWeight: 800 }}>{"ABCD"[i]}</span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {selected !== null && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 13.5, color: BRAND.dim, lineHeight: 1.6 }}>
                {selected === q.correctIndex
                  ? <span style={{ color: BRAND.teal }}>回答正确！</span>
                  : <span style={{ color: BRAND.danger }}>{selected === -1 ? "超时未作答。" : "回答错误。"}</span>}
                {" "}{q.explanation}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "results" && (
        <div style={{ paddingTop: 30 }}>
          <QuizResults
            players={players}
            correctCount={correctCount}
            totalQuestions={questionsRef.current.length}
            maxCombo={maxCombo}
            domainLabel={domainLabel}
            settle={settle}
            onReplay={() => setPhase("select")}
            onDeepChat={onDeepChat}
          />
        </div>
      )}
      {/* 新手引导浮层（可跳过） */}
      {tutorialStep >= 0 && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            maxWidth: 400, background: "#141414", border: "1px solid #FFD600",
            borderRadius: 14, padding: "18px 20px", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize: 12, color: "#4fb3a5", letterSpacing: 2 }}>
              新手引导 · {tutorialStep + 1}/{LIB_TUTORIAL.length}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: "4px 0", color: BRAND.text }}>
              {LIB_TUTORIAL[tutorialStep].title}
            </div>
            <div style={{ fontSize: 13.5, color: "rgba(237,237,240,0.8)", lineHeight: 1.6 }}>
              {LIB_TUTORIAL[tutorialStep].desc}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button
                onClick={dismissTutorial}
                style={{
                  padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                  background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: BRAND.dim,
                }}
              >跳过引导</button>
              <button
                onClick={() => {
                  if (tutorialStep >= LIB_TUTORIAL.length - 1) dismissTutorial();
                  else setTutorialStep(tutorialStep + 1);
                }}
                style={{
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  background: BRAND.yellow, border: "none", color: "#141414", fontWeight: 700,
                }}
              >{tutorialStep >= LIB_TUTORIAL.length - 1 ? "开始" : "下一步"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// R5: /api/engine/library/settle 返回的钩子数据形状。
export interface LibrarySettleResponse {
  result: {
    winner: string | null;
    tier: { label: string };
    capturedHighlights: Array<{ type: string; description: string }>;
    relationshipChanges: Array<{ celebrityId: string; delta: number; toType: string; reason: string }>;
    resultCardText: string;
    comeback: boolean;
    settlementType: string;
  };
  relationshipChanges: Array<{ celebrityId: string; delta: number; toType: string; reason: string }>;
  streak: { current: number; best: number };
}

function CountdownRing({ ms }: { ms: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, ms / 10_000);
  const danger = ms <= 3000;
  const color = danger ? BRAND.danger : BRAND.yellow;
  return (
    <div style={{ position: "absolute", top: 16, right: 16, width: 64, height: 64 }}>
      <svg width="64" height="64">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 32 32)" />
        <text x="32" y="38" textAnchor="middle" fill={color} fontSize="16" fontWeight="800">
          {Math.ceil(ms / 1000)}
        </text>
      </svg>
    </div>
  );
}
