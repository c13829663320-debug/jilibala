// 结算：排名 + 段位 + 败者名人金句 + 再来一局
import { useEffect, useRef } from "react";
import { rankPlayers, tierForRank, type QuizPlayer } from "@balabala/shared";
import { BRAND } from "./DomainSelector";
import { submitGameResult } from "../profile";
import type { ScoreboardPlayer } from "./OpponentScoreboard";

/** 败者（输给你的名人）的 canned 金句——整局不再调 LLM，预置数条轮换。 */
const LOSER_QUIPS = [
  "年轻人不错，下次读几本再来挑战我。",
  "哼，这次算你记性好，下次可没这么容易。",
  "抢答快不算本事，学问要坐得住冷板凳。",
  "我刚才手滑了……我们再来一局，敢不敢？",
];

export default function QuizResults({
  players,
  correctCount,
  totalQuestions,
  maxCombo,
  domainLabel,
  onReplay,
  onDeepChat,
}: {
  players: ScoreboardPlayer[];
  correctCount: number;
  totalQuestions: number;
  maxCombo: number;
  domainLabel: string;
  onReplay: () => void;
  onDeepChat: () => void;
}) {
  const ranked = rankPlayers(players as QuizPlayer[]);
  const me = ranked.find((p) => p.id === "you")!;
  const tier = tierForRank(me.rank);
  const loser = ranked.find((p) => !p.isCeleb && p.rank > me.rank);
  const quip = LOSER_QUIPS[Math.floor(Math.random() * LOSER_QUIPS.length)];
  const won = me.rank === 1;
  const tierColor = tier === "宗师" ? BRAND.yellow : tier === "学霸" ? BRAND.teal : BRAND.dim;

  // 全局档案上报一次：第 1 名视为获胜，答对题数用于「图书馆宗师」成就。
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    submitGameResult("library", {
      won,
      score: me.score,
      detail: { correctCount, totalQuestions },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: BRAND.dim, letterSpacing: 3 }}>{domainLabel} · 擂台结算</div>
      <div style={{ fontSize: 56, fontWeight: 900, color: tierColor, margin: "6px 0" }}>{tier}</div>
      <div style={{ fontSize: 15, color: BRAND.text, marginBottom: 4 }}>
        {won ? "你赢了！" : "差一口气，下次再来。"} 总分 <b style={{ color: BRAND.yellow }}>{me.score}</b>
      </div>
      <div style={{ fontSize: 13, color: BRAND.dim, marginBottom: 24 }}>
        答对 {correctCount}/{totalQuestions} · 最高连击 ×{maxCombo}
      </div>

      <div style={{ textAlign: "left", background: BRAND.panel, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, marginBottom: 20 }}>
        {ranked.map((p) => (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "6px 4px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            color: p.id === "you" ? BRAND.yellow : BRAND.text, fontWeight: p.id === "you" ? 700 : 400,
          }}>
            <span style={{ width: 22, color: BRAND.dim }}>#{p.rank}</span>
            <span style={{ flex: 1 }}>{p.id === "you" ? "你" : p.name}</span>
            <span style={{ fontWeight: 700 }}>{p.score}</span>
          </div>
        ))}
      </div>

      {loser && (
        <div style={{ fontStyle: "italic", color: BRAND.teal, fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          “{quip}” —— {loser.name}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button onClick={onReplay} style={{ ...btn, background: BRAND.yellow, color: "#000", border: "none" }}>再来一局</button>
        <button onClick={onDeepChat} style={{ ...btn, background: "transparent", color: BRAND.teal, border: `1px solid ${BRAND.teal}` }}>想深聊？去找名人</button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "11px 22px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
};
