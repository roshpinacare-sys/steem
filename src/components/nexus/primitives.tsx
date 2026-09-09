"use client";

/**
 * 117m — NEXUS primitives · שפת-המכשירים של מרכז-הבקרה
 * פאנלים-שער-זווית · מספרים-מונו · נקודות-חי · שבבי-מצב · פסי-עומק
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── עזרי-פורמט ── */
export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
export function fmtµ(µ: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(µ / 1_000_000);
}
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
export function mask(addr: string, head = 8, tail = 6): string {
  if (!addr || addr.length <= head + tail + 3) return addr;
  return addr.slice(0, head) + "…" + addr.slice(-tail);
}
export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

/* ── נקודת-חי (פעימה) ── */
export function LiveDot({ ok, className }: { ok: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} role="status" aria-label={ok ? "חי" : "מושבת"}>
      {ok && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", ok ? "bg-emerald-400" : "bg-rose-400")} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-rose-500")} />
    </span>
  );
}

/* ── שבב-מצב ── */
export function Chip({ ok, children, tone }: { ok?: boolean; children: ReactNode; tone?: "emerald" | "amber" | "rose" | "violet" | "zinc" }) {
  const t =
    tone ||
    (ok === true ? "emerald" : ok === false ? "rose" : "zinc");
  const map = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    zinc: "border-zinc-700/60 bg-zinc-800/40 text-zinc-400",
  } as const;
  return (
    <span dir="ltr" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none tracking-wide", map[t])}>
      {children}
    </span>
  );
}

/* ── תווית-עליונה ── */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500", className)}>{children}</div>;
}

/* ── פאנל-שער-זווית (HUD) · 117q — עומק + זוהר-רך ── */
export function Panel({ children, className, corners = true }: { children: ReactNode; className?: string; corners?: boolean }) {
  return (
    <div className={cn(
      "relative rounded-lg border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm",
      "transition-all duration-300 hover:border-emerald-500/25 hover:shadow-[0_0_24px_-6px_rgba(16,185,129,0.18)]",
      className
    )}>
      {/* הדגשת-קצה-עליון — עומק-בלי-רעש */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-white/[0.07] to-transparent" />
      {corners && (
        <>
          <span aria-hidden className="absolute -top-px -left-px h-2.5 w-2.5 border-t border-l border-emerald-500/50 rounded-tl-lg" />
          <span aria-hidden className="absolute -top-px -right-px h-2.5 w-2.5 border-t border-r border-emerald-500/50 rounded-tr-lg" />
          <span aria-hidden className="absolute -bottom-px -left-px h-2.5 w-2.5 border-b border-l border-emerald-500/30 rounded-bl-lg" />
          <span aria-hidden className="absolute -bottom-px -right-px h-2.5 w-2.5 border-b border-r border-emerald-500/30 rounded-br-lg" />
        </>
      )}
      {children}
    </div>
  );
}

/* ── סטטיסטיקה-גדולה ── */
export function Stat({ label, value, sub, tone = "default", dir = "ltr" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "emerald" | "amber" | "rose" | "violet"; dir?: "ltr" | "rtl" }) {
  const toneMap = {
    default: "text-zinc-100",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    violet: "text-violet-300",
  } as const;
  return (
    <div className="min-w-0 space-y-1">
      <Micro>{label}</Micro>
      <div dir={dir} className={cn("truncate font-mono text-xl font-semibold tabular-nums md:text-2xl", toneMap[tone])}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

/* ── פס-מידה ── */
export function Bar({ pct, tone = "emerald" }: { pct: number; tone?: "emerald" | "amber" | "rose" | "violet" }) {
  const map = { emerald: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-rose-400", violet: "bg-violet-400" } as const;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={cn("h-full rounded-full transition-all duration-500", map[tone])} style={{ width: p + "%" }} />
    </div>
  );
}

/* ── כותרת-מקטע ── */
export function SecHead({ icon, title, sub, extra }: { icon: ReactNode; title: string; sub: string; extra?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-[0_0_14px_-4px_rgba(16,185,129,0.4)]">{icon}</div>
        <div>
          <h2 className="text-base font-bold leading-tight text-zinc-100 md:text-lg">{title}</h2>
          <p className="text-xs text-zinc-500">{sub}</p>
        </div>
      </div>
      {extra}
    </div>
  );
}
