// 领域选择：进馆后选 [科学][文学][哲学][历史][艺术]
import type { QuizDomain } from "@balabala/shared";
import { QUIZ_DOMAINS } from "@balabala/shared";

export const BRAND = {
  bg: "#000000",
  panel: "#0d0d0d",
  yellow: "#FFD600",
  teal: "#4fb3a5",
  text: "#EDEDF0",
  danger: "#FF6B6B",
  dim: "rgba(237,237,240,0.5)",
};

export default function DomainSelector({
  onSelect,
  busy,
}: {
  onSelect: (d: QuizDomain) => void;
  busy?: boolean;
}) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: BRAND.teal, letterSpacing: 4, marginBottom: 10 }}>KNOWLEDGE ARENA</div>
      <h1 style={{ fontSize: 40, fontWeight: 800, color: BRAND.text, margin: "0 0 8px" }}>
        90 秒<span style={{ color: BRAND.yellow }}>知识擂台</span>
      </h1>
      <p style={{ color: BRAND.dim, fontSize: 14, marginBottom: 32, lineHeight: 1.7 }}>
        8 题 × 10 秒 · 4 选项 · 3 条命<br />连对 3 题，下一题分数 ×2；三位 AI 名人会和你抢分。
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        {QUIZ_DOMAINS.map((d) => (
          <button
            key={d.id}
            disabled={busy}
            onClick={() => onSelect(d.id)}
            style={{
              padding: "26px 12px",
              borderRadius: 16,
              border: `1px solid rgba(255,255,255,0.12)`,
              background: BRAND.panel,
              color: BRAND.text,
              fontSize: 22,
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget.style.borderColor = BRAND.yellow); (e.currentTarget.style.transform = "translateY(-3px)"); }}
            onMouseLeave={(e) => { (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"); (e.currentTarget.style.transform = "none"); }}
          >
            <span style={{ color: BRAND.yellow }}>{d.label}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 28, fontSize: 13, color: BRAND.dim }}>{busy ? "正在请出题官准备题目…" : "选择一个领域开战"}</div>
    </div>
  );
}
