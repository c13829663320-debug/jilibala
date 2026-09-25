// 实时分数榜：你 + 3 位 AI 名人头像与分数条
import { BRAND } from "./DomainSelector";

export interface ScoreboardPlayer {
  id: string;
  name: string;
  score: number;
  isCeleb: boolean;
  portrait?: string;
}

export default function OpponentScoreboard({ players }: { players: ScoreboardPlayer[] }) {
  const maxScore = Math.max(100, ...players.map((p) => p.score));
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
      {players.map((p) => (
        <div key={p.id} style={{
          width: 130, padding: 10, borderRadius: 12,
          background: BRAND.panel, border: `1px solid ${p.id === "you" ? BRAND.yellow : "rgba(255,255,255,0.08)"}`,
          textAlign: "center",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", margin: "0 auto 6px",
            background: p.isCeleb ? BRAND.teal : BRAND.yellow,
            color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 16, overflow: "hidden",
          }}>
            {p.portrait
              ? <img src={p.portrait} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : p.name.slice(0, 1)}
          </div>
          <div style={{ fontSize: 12, color: BRAND.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.id === "you" ? "你" : p.name}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: p.id === "you" ? BRAND.yellow : BRAND.text }}>{p.score}</div>
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", marginTop: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${Math.max(4, (p.score / maxScore) * 100)}%`,
              background: p.id === "you" ? BRAND.yellow : BRAND.teal, transition: "width .3s",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
