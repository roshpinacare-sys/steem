/**
 * Shared design tokens and style helpers for Mission Control.
 * All glass-morphism panels, badges, and color constants live here
 * so they are changed in exactly one place.
 */
import React from "react";

// ── Color palette ─────────────────────────────────────────────────────────
export const COLOR = {
  bgBase: "#020617",
  bgPanel: "rgba(15, 23, 42, 0.55)",
  bgPanelDark: "rgba(11, 17, 33, 0.8)",
  bgOverlay: "rgba(2, 6, 23, 0.82)",
  bgInput: "rgba(2, 6, 23, 0.6)",

  borderSubtle: "rgba(148, 163, 184, 0.15)",
  borderInput: "rgba(148, 163, 184, 0.25)",
  borderIndigo: "rgba(99, 102, 241, 0.35)",
  borderGreen: "rgba(52, 211, 153, 0.4)",
  borderRed: "rgba(248, 113, 113, 0.4)",
  borderAmber: "rgba(251, 191, 36, 0.35)",

  textPrimary: "#e2e8f0",
  textSecondary: "#cbd5e1",
  textMuted: "#94a3b8",
  textWhite: "#f8fafc",
  // Alias kept for components that reference COLOR.text
  text: "#e2e8f0",

  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  indigo: "#6366f1",
  indigoLight: "#e0e7ff",
  // Additional tokens used by RunHistory and StatusBadge
  cyan: "#22d3ee",
  purple: "#a78bfa",

  blur: "blur(14px)",
} as const;

// ── Shared style factories ────────────────────────────────────────────────

/** Glass-morphism panel — used by every floating card. */
export function glassPanel(): React.CSSProperties {
  return {
    background: COLOR.bgPanel,
    backdropFilter: COLOR.blur,
    border: `1px solid ${COLOR.borderSubtle}`,
    borderRadius: 16,
    boxShadow: "0 20px 50px rgba(2, 6, 23, 0.55)",
  };
}

/** Section label (uppercase, muted, tracked). */
export function sectionLabel(): React.CSSProperties {
  return {
    fontSize: 11,
    color: COLOR.textMuted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 600,
  };
}

/** Pill badge with a semi-transparent tint. */
export function Badge({ text, color }: { text: string; color: string }): React.ReactElement {
  return React.createElement(
    "span",
    {
      style: {
        padding: "4px 10px",
        borderRadius: 999,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        fontSize: 11,
        color,
        fontWeight: 600,
      },
    },
    text,
  );
}

/** File pill — indigo tint, used in ApprovalGate and FailureRecoveryPanel. */
export function FilePill({ path }: { path: string }): React.ReactElement {
  return React.createElement(
    "span",
    {
      style: {
        padding: "4px 10px",
        borderRadius: 999,
        background: "rgba(99,102,241,0.12)",
        color: COLOR.indigoLight,
        fontSize: 12,
        border: "1px solid rgba(99,102,241,0.25)",
      },
    },
    path,
  );
}

// ── Shared utilities ──────────────────────────────────────────────────────

/** Format an ISO timestamp → HH:MM:SS. */
export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Return the latest event from a (possibly empty) array. */
export function latestEvent<T extends { timestamp: string }>(events: T[]): T | null {
  if (!events.length) return null;
  return events.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  );
}

/** Map a file extension → Prism language id for syntax highlighting. */
export function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    sh: "bash",
    py: "python",
    css: "css",
    html: "html",
    graphql: "graphql",
    sql: "sql",
  };
  return map[ext] ?? "text";
}
