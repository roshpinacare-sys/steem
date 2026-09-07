/**
 * shell/ui.tsx — the desktop platform shell's design primitives.
 *
 * A small, cohesive set of premium dark-UI building blocks (Panel, StatTile,
 * Pill, Dot, SectionTitle, EmptyState, …) so every capability page reads as
 * one system. Inline-styled to match the rest of Mission Control; the palette
 * extends utils/styles.ts COLOR with a few shell-only surfaces.
 */
import React from "react";
import { COLOR } from "../utils/styles.js";

// ── Shell palette (extends COLOR without changing the cockpit tokens) ───────
export const UI = {
  ...COLOR,
  bg: "#070B16",
  bgElevated: "rgba(17, 23, 38, 0.72)",
  bgPanel: "rgba(19, 26, 43, 0.55)",
  bgHover: "rgba(99, 102, 241, 0.10)",
  bgActive: "rgba(99, 102, 241, 0.16)",
  rail: "rgba(9, 13, 24, 0.86)",
  topbar: "rgba(9, 13, 24, 0.72)",
  border: "rgba(148, 163, 184, 0.12)",
  borderStrong: "rgba(148, 163, 184, 0.22)",
} as const;

export const FONT =
  "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO =
  "'SFMono-Regular', ui-monospace, 'JetBrains Mono', 'Menlo', monospace";

// ── Category → accent colour (used across Ministry / Activity / Pipeline) ───
export const CATEGORY_COLOR: Record<string, string> = {
  core: UI.indigo,
  safety: UI.amber,
  autonomous: UI.cyan,
  infra: UI.purple,
  meta: UI.green,
  other: UI.textMuted,
};

// ── Panel ───────────────────────────────────────────────────────────────────
export function Panel({
  children,
  style,
  pad = 18,
  interactive = false,
  onClick,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: number;
  interactive?: boolean;
  onClick?: () => void;
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: UI.bgPanel,
        border: `1px solid ${hover ? UI.borderStrong : UI.border}`,
        borderRadius: 14,
        padding: pad,
        transition: "border-color 0.15s ease, transform 0.15s ease",
        cursor: interactive || onClick ? "pointer" : "default",
        transform: hover && interactive ? "translateY(-1px)" : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Section title ────────────────────────────────────────────────────────────
export function SectionTitle({
  children,
  right,
  style,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          fontWeight: 700,
          color: UI.textMuted,
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

// ── Status dot (with optional glow when "live") ──────────────────────────────
export function Dot({
  color,
  glow = false,
  size = 8,
}: {
  color: string;
  glow?: boolean;
  size?: number;
}): React.ReactElement {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: glow ? `0 0 8px ${color}` : "none",
        display: "inline-block",
      }}
    />
  );
}

// ── Pill / chip ──────────────────────────────────────────────────────────────
export function Pill({
  children,
  color = UI.textMuted,
  solid = false,
}: {
  children: React.ReactNode;
  color?: string;
  solid?: boolean;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        color: solid ? "#0a0e1a" : color,
        background: solid ? color : `${color}1e`,
        border: `1px solid ${color}${solid ? "" : "3a"}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────
export function StatTile({
  label,
  value,
  sub,
  accent = UI.textPrimary,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600, color: UI.textMuted }}>
          {label}
        </span>
        {icon}
      </div>
      <span style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      {sub != null && (
        <span style={{ fontSize: 12, color: UI.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub}
        </span>
      )}
    </Panel>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({
  title,
  hint,
  icon = "◦",
}: {
  title: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "48px 24px",
        textAlign: "center",
        color: UI.textMuted,
      }}
    >
      <div style={{ fontSize: 30, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: UI.textSecondary }}>{title}</div>
      {hint && <div style={{ fontSize: 12, maxWidth: 380, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

// ── Primary / ghost buttons ──────────────────────────────────────────────────
export function Button({
  children,
  onClick,
  variant = "ghost",
  color = UI.indigo,
  disabled = false,
  style,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  color?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  const primary = variant === "primary";
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 14px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: FONT,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        color: primary ? "#0a0e1a" : color,
        background: primary
          ? color
          : hover
            ? `${color}1e`
            : "transparent",
        border: `1px solid ${primary ? color : `${color}44`}`,
        transition: "all 0.15s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── Scroll area (page content) ───────────────────────────────────────────────
export function ScrollArea({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        overflowY: "auto",
        overflowX: "hidden",
        height: "100%",
        padding: "24px 28px 40px",
        ...style,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>{children}</div>
    </div>
  );
}

/** A responsive auto-fit grid of cards. */
export function CardGrid({
  children,
  min = 220,
  gap = 14,
  style,
}: {
  children: React.ReactNode;
  min?: number;
  gap?: number;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Suspense fallback for lazily-loaded pages. */
export function PageLoading(): React.ReactElement {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", color: UI.textMuted, fontSize: 12.5, fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Dot color={UI.indigo} glow size={7} />
        Loading…
      </div>
    </div>
  );
}

/** Relative-time formatter shared by pages. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
