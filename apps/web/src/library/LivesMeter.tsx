// 3 颗命（心）
import { BRAND } from "./DomainSelector";

export default function LivesMeter({ lives, max }: { lives: number; max: number }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, fontSize: 18, lineHeight: 1 }} title={`剩余生命 ${lives}/${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} style={{ color: i < lives ? BRAND.danger : "rgba(255,255,255,0.15)" }}>♥</span>
      ))}
    </div>
  );
}
