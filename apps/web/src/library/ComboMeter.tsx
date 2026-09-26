// 连击表：combo 倍数提示
import { BRAND } from "./DomainSelector";

export default function ComboMeter({ combo }: { combo: number }) {
  const doubled = combo >= 3; // 连对 3 题后下一题 ×2
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 24 }}>
      {combo >= 2 && (
        <span style={{
          fontSize: 13, fontWeight: 700, color: BRAND.yellow,
          background: "rgba(255,214,0,0.12)", border: `1px solid ${BRAND.yellow}`,
          borderRadius: 12, padding: "3px 10px",
        }}>
          连击 ×{combo}
        </span>
      )}
      {doubled && (
        <span style={{
          fontSize: 13, fontWeight: 800, color: "#000",
          background: BRAND.yellow, borderRadius: 12, padding: "3px 10px",
        }}>
          下题 ×2
        </span>
      )}
    </div>
  );
}
