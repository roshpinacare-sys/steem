/**
 * charts.tsx — dependency-free inline-SVG charts for the Insights page,
 * following the app's chart rules: status colors carry pass/fail identity and
 * are never the only encoding (legend + printed values always accompany
 * them), grids are recessive, text wears text tokens, marks are thin with a
 * 2px surface gap between stacked segments.
 */
import React from "react";
import { UI, FONT, Dot } from "./ui.js";

export interface DayBucket {
  label: string;   // e.g. "Jul 3"
  success: number;
  failure: number;
}

/** Stacked columns: runs per day, success vs failure. */
export function RunColumns({ buckets, height = 130 }: { buckets: DayBucket[]; height?: number }): React.ReactElement {
  const max = Math.max(1, ...buckets.map((b) => b.success + b.failure));
  const n = buckets.length;
  const colW = 100 / n;
  const barFrac = 0.55;
  const chartH = height - 26; // room for x labels

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: UI.textSecondary }}><Dot color={UI.green} size={7} /> Passed</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: UI.textSecondary }}><Dot color={UI.red} size={7} /> Failed</span>
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        {/* Recessive grid: quarter lines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="100" y1={chartH * f} y2={chartH * f} stroke={UI.border} strokeWidth="0.4" />
        ))}
        <line x1="0" x2="100" y1={chartH} y2={chartH} stroke={UI.borderStrong} strokeWidth="0.5" />
        {buckets.map((b, i) => {
          const total = b.success + b.failure;
          const x = i * colW + (colW * (1 - barFrac)) / 2;
          const w = colW * barFrac;
          const hS = (b.success / max) * (chartH - 4);
          const hF = (b.failure / max) * (chartH - 4);
          const gap = hS > 0 && hF > 0 ? 1.5 : 0;
          return (
            <g key={i}>
              <title>{`${b.label}: ${total} run${total === 1 ? "" : "s"} — ${b.success} passed, ${b.failure} failed`}</title>
              {hF > 0 && <rect x={x} y={chartH - hF} width={w} height={hF} rx={hS > 0 ? 0 : 1.2} fill={UI.red} />}
              {hS > 0 && <rect x={x} y={chartH - hF - gap - hS} width={w} height={hS} rx={1.2} fill={UI.green} />}
              {total === 0 && <rect x={x} y={chartH - 1} width={w} height={1} fill={UI.border} />}
            </g>
          );
        })}
        {/* X labels every other tick to avoid collisions on phones */}
        {buckets.map((b, i) =>
          i % 2 === 0 ? (
            <text key={i} x={i * colW + colW / 2} y={height - 8} textAnchor="middle"
              style={{ font: `8px ${FONT}` }} fill={UI.textMuted}>
              {b.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** Single-series sparkline (success-rate trend). No legend — the title names it. */
export function Sparkline({ points, height = 44, color = UI.indigo }: { points: number[]; height?: number; color?: string }): React.ReactElement {
  if (points.length < 2) {
    return <div style={{ height, display: "grid", placeItems: "center", color: UI.textMuted, fontSize: 11.5 }}>Not enough completed runs yet</div>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1e-6, max - min);
  const pad = 4;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = pad + (1 - (p - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const lastY = pad + (1 - (points[points.length - 1] - min) / span) * (height - pad * 2);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx="100" cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}
