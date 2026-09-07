/**
 * pages/_shared.tsx — small presentational atoms reused across shell pages
 * (event rows, progress bars, run-status pills, mini bar charts). All derive
 * from telemetry data already in the store — no fetching here.
 */
import React from "react";
import type { TelemetryEvent } from "../../types/telemetry.js";
import { phaseLabel, phaseCategory } from "../../utils/phase-meta.js";
import type { RunStatus } from "../../mobile/derive.js";
import { UI, Pill, Dot, CATEGORY_COLOR, timeAgo, MONO, Panel } from "../ui.js";

// ── Progress bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ value, color = UI.indigo, height = 6 }: { value: number; color?: string; height?: number }): React.ReactElement {
  return (
    <div style={{ height, borderRadius: 999, background: "rgba(148,163,184,0.14)", overflow: "hidden", width: "100%" }}>
      <div
        style={{
          height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
          background: color, borderRadius: 999, transition: "width 0.4s ease",
        }}
      />
    </div>
  );
}

// ── Run status → colour + label ──────────────────────────────────────────────
export const RUN_STATUS: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "Running", color: UI.amber },
  done: { label: "Merged", color: UI.green },
  failed: { label: "Failed", color: UI.red },
  idle: { label: "Idle", color: UI.textMuted },
};

export function RunStatusPill({ status }: { status: RunStatus }): React.ReactElement {
  const s = RUN_STATUS[status];
  return (
    <Pill color={s.color}>
      <Dot color={s.color} glow={status === "running"} size={7} />
      {s.label}
    </Pill>
  );
}

// ── Decision-stream row (Activity / Safety / Overview) ───────────────────────
export function EventRow({ e, expandable = true }: { e: TelemetryEvent; expandable?: boolean }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const cat = phaseCategory(e.phase);
  const color = CATEGORY_COLOR[cat] ?? UI.textMuted;
  const meta = extractMeta(e);
  const hasMeta = expandable && meta.length > 0;
  return (
    <div
      onClick={() => hasMeta && setOpen((v) => !v)}
      style={{
        display: "flex", gap: 12, padding: "10px 12px", borderRadius: 10,
        borderBottom: `1px solid ${UI.border}`, cursor: hasMeta ? "pointer" : "default",
        alignItems: "flex-start",
      }}
    >
      <div style={{ paddingTop: 4 }}><Dot color={color} size={7} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: UI.textPrimary }}>{phaseLabel(e.phase)}</span>
          {e.decision && (
            <span style={{ fontSize: 12.5, color: UI.textSecondary }}>{e.decision.replace(/[-_]/g, " ")}</span>
          )}
        </div>
        {open && meta.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3, fontFamily: MONO, fontSize: 11.5, color: UI.textMuted }}>
            {meta.map(([k, v, full]) =>
              looksLikeDiff(full) ? (
                <div key={k} style={{ margin: "4px 0" }}>
                  <div style={{ color: UI.textSecondary, marginBottom: 4 }}>{k}</div>
                  <DiffBlock diff={full} maxHeight={260} />
                </div>
              ) : (
                <div key={k} style={{ display: "flex", gap: 6 }}>
                  <span style={{ color: UI.textSecondary }}>{k}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: UI.textMuted, flexShrink: 0, whiteSpace: "nowrap" }}>{timeAgo(e.timestamp)}</span>
      {hasMeta && <span style={{ color: UI.textMuted, fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>}
    </div>
  );
}

const HIDDEN_KEYS = new Set(["runId", "timestamp", "phase", "decision"]);
function extractMeta(e: TelemetryEvent): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
    if (HIDDEN_KEYS.has(k) || v == null) continue;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    out.push([k, s.length > 120 ? s.slice(0, 120) + "…" : s, s]);
    if (out.length >= 8) break;
  }
  return out;
}

// ── Unified-diff block (surfaced from the mobile DiffView, shell tokens) ─────
export function looksLikeDiff(s: string): boolean {
  if (s.length < 20 || !s.includes("\n")) return false;
  return s.includes("@@ ") || /^(\+\+\+|---) /m.test(s) || /^\+[^+]/m.test(s) && /^-[^-]/m.test(s);
}

type DiffLineKind = "add" | "del" | "hunk" | "file" | "ctx";
function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

const DIFF_TONE: Record<DiffLineKind, { bg: string; color: string }> = {
  add:  { bg: "rgba(52,211,153,0.10)", color: "#6EE7B7" },
  del:  { bg: "rgba(248,113,113,0.10)", color: "#FCA5A5" },
  hunk: { bg: "rgba(99,102,241,0.12)", color: UI.indigoLight },
  file: { bg: "transparent", color: UI.textMuted },
  ctx:  { bg: "transparent", color: UI.textSecondary },
};

export function DiffBlock({ diff, maxHeight = 340 }: { diff: string; maxHeight?: number }): React.ReactElement {
  return (
    <div style={{ borderRadius: 10, background: UI.bgElevated, border: `1px solid ${UI.border}`, maxHeight, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
      <pre style={{ margin: 0, padding: "8px 0", minWidth: "max-content" }}>
        {diff.split("\n").map((line, i) => {
          const kind = classifyDiffLine(line);
          const t = DIFF_TONE[kind];
          return (
            <div key={i} style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.6, padding: "0 12px", whiteSpace: "pre", background: t.bg, color: t.color, fontWeight: kind === "hunk" || kind === "file" ? 600 : 400 }}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

// ── 5-gate checklist (states derive from real gate telemetry) ────────────────
export const CANONICAL_GATES = [
  { id: "lockfile", label: "Lockfile integrity" },
  { id: "blast-radius", label: "Blast radius" },
  { id: "dom-xray", label: "DOM X-ray" },
  { id: "shadow-traffic", label: "Shadow traffic" },
  { id: "chaos-monkey", label: "Chaos monkey" },
] as const;

type GateState = "passed" | "failed" | "error" | "pending";

interface GateRow {
  id: string;
  label: string;
  state: GateState;
  at: string | null;
  detail?: string;
}

export function deriveGates(events: TelemetryEvent[], runId: string): GateRow[] {
  const run = events.filter((e) => e.runId === runId && e.phase === "gate");
  const rows: GateRow[] = CANONICAL_GATES.map((g) => {
    const results = run
      .filter((e) => e.decision === `${g.id}-result` || e.decision === `${g.id}-error`)
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
    const latest = results[0];
    if (!latest) return { id: g.id, label: g.label, state: "pending", at: null };
    if (latest.decision === `${g.id}-error`) {
      return { id: g.id, label: g.label, state: "error", at: latest.timestamp, detail: String((latest as { error?: unknown }).error ?? "") };
    }
    const allowed = (latest as { allowed?: unknown }).allowed;
    return { id: g.id, label: g.label, state: allowed === false ? "failed" : "passed", at: latest.timestamp };
  });

  // Guard agents appear beneath the canonical five when they've reported.
  for (const guard of [
    { phase: "secret-guard", label: "Secret guard" },
    { phase: "warden", label: "Warden (code guard)" },
  ]) {
    const latest = events
      .filter((e) => e.runId === runId && e.phase === guard.phase)
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0];
    if (latest) {
      const bad = /violation|blocked|found|failed/i.test(String(latest.decision ?? "")) && !/no[- ]violations|clean/i.test(String(latest.decision ?? ""));
      rows.push({
        id: guard.phase,
        label: guard.label,
        state: bad ? "failed" : "passed",
        at: latest.timestamp,
        detail: String(latest.decision ?? "").replace(/-/g, " "),
      });
    }
  }
  return rows;
}

const GATE_STATE_META: Record<string, { color: string; mark: string; label: string }> = {
  passed: { color: UI.green, mark: "✓", label: "Passed" },
  failed: { color: UI.red, mark: "✕", label: "Failed" },
  error: { color: UI.amber, mark: "!", label: "Error" },
  pending: { color: UI.textMuted, mark: "○", label: "Pending" },
};

export function GateChecklistPanel({ events, runId }: { events: TelemetryEvent[]; runId: string }): React.ReactElement {
  const rows = React.useMemo(() => deriveGates(events, runId), [events, runId]);
  return (
    <Panel pad={6}>
      {rows.map((r) => {
        const m = GATE_STATE_META[r.state] ?? GATE_STATE_META.pending;
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: `1px solid ${UI.border}` }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", border: `2px solid ${m.color}`, color: m.color, fontSize: 11, fontWeight: 700 }}>{m.mark}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: r.state === "pending" ? UI.textMuted : UI.textPrimary }}>{r.label}</div>
              {r.detail && <div style={{ fontSize: 11.5, color: UI.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.detail}</div>}
            </div>
            <Pill color={m.color}>{m.label}</Pill>
            <span style={{ fontSize: 11, color: UI.textMuted, flexShrink: 0 }}>{r.at ? timeAgo(r.at) : "—"}</span>
          </div>
        );
      })}
    </Panel>
  );
}

// ── Horizontal mini bar (Cost byModel) ───────────────────────────────────────
export function MiniBar({ label, value, max, sub, color = UI.indigo }: { label: string; value: number; max: number; sub?: string; color?: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
        <span style={{ color: UI.textSecondary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{label}</span>
        <span style={{ color: UI.textMuted, fontVariantNumeric: "tabular-nums" }}>{sub}</span>
      </div>
      <ProgressBar value={max > 0 ? value / max : 0} color={color} height={7} />
    </div>
  );
}
