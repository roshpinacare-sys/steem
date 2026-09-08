"use client";

/**
 * 117m — NEXUS shell · מעטפת מרכז-הבקרה
 * ראש-דביק (פעימה·גבהים-חיים) · ניווט-תחתון-מובייל (safe-area) · מסילת-צד-מחשב · תחתית-דביקה
 */

import type { ReactNode } from "react";
import { Activity, ArrowDownToLine, Coins, DoorOpen, Gauge, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveDot, fmtInt } from "./primitives";

export const SECTIONS = [
  { id: "control", label: "בקרה", en: "CONTROL", icon: Gauge },
  { id: "deposits", label: "הפקדות", en: "DEPOSITS", icon: ArrowDownToLine },
  { id: "doors", label: "דלתות", en: "DOORS", icon: DoorOpen },
  { id: "shield", label: "מגן", en: "SHIELD", icon: ShieldCheck },
  { id: "econ", label: "כלכלה", en: "ECON", icon: Coins },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/* ── ראש-דביק ── */
export function NexusHeader({
  saosHeight,
  tronHeight,
  fleetOk,
  fleetTotal,
  chainsOk,
  chainsTotal,
  at,
}: {
  saosHeight: number;
  tronHeight: number;
  fleetOk: number;
  fleetTotal: number;
  chainsOk: number;
  chainsTotal: number;
  at: string;
}) {
  const allOk = fleetTotal > 0 && fleetOk === fleetTotal && chainsOk === chainsTotal;
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/70 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10">
            <Activity className="h-4 w-4 text-emerald-300" aria-hidden />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-extrabold tracking-wide text-zinc-100">
              SAOS-NET <span className="text-emerald-400">COMMAND</span>
            </div>
            <div className="hidden text-[10px] uppercase tracking-[0.2em] text-zinc-500 sm:block">מרכז-הבקרה הריבוני · רשת-האמת</div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div dir="ltr" className="hidden items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-[11px] tabular-nums text-zinc-400 md:flex">
            <span title="SAOS-NET height">SAOS <span className="text-zinc-200">{fmtInt(saosHeight)}</span></span>
            <span className="text-zinc-700">│</span>
            <span title="TRON live height">TRX <span className="text-zinc-200">{tronHeight ? fmtInt(tronHeight) : "—"}</span></span>
            <span className="text-zinc-700">│</span>
            <span title="שרשראות-חוץ תקינות">
              CHAINS <span className={chainsOk === chainsTotal ? "text-emerald-300" : "text-amber-300"}>{chainsOk}/{chainsTotal}</span>
            </span>
          </div>
          <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1", allOk ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10")}>
            <LiveDot ok={allOk} />
            <span dir="ltr" className={cn("font-mono text-[10px] tabular-nums", allOk ? "text-emerald-300" : "text-amber-300")}>
              {fleetOk}/{fleetTotal}
            </span>
          </div>
          <span dir="ltr" className="hidden font-mono text-[10px] tabular-nums text-zinc-600 lg:inline" title={at}>
            {at ? new Date(at).toLocaleTimeString("en-GB") : ""}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ── מסילת-ניווט-מובייל ── */
export function BottomNav({ active, onNavigate }: { active: SectionId; onNavigate: (s: SectionId) => void }) {
  return (
    <nav
      aria-label="ניווט-ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/80 bg-zinc-950/92 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] transition-colors",
                on ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="font-medium">{s.label}</span>
              {on && <span className="absolute-none h-0.5 w-6 rounded-full bg-emerald-400" aria-hidden />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ── מסילת-צד-מחשב ── */
export function DesktopRail({ active, onNavigate }: { active: SectionId; onNavigate: (s: SectionId) => void }) {
  return (
    <nav aria-label="ניווט-צד" className="sticky top-20 hidden flex-col gap-1 md:flex">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const on = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onNavigate(s.id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-md border px-3 py-2.5 text-right transition-all",
              on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-300"
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", on ? "text-emerald-300" : "text-zinc-600 group-hover:text-zinc-400")} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{s.label}</span>
              <span dir="ltr" className="block text-[9px] uppercase tracking-[0.22em] text-zinc-600">{s.en}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ── תחתית-דביקה ── */
export function NexusFooter({ at }: { at: string }) {
  return (
    <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-zinc-600 md:px-6">
        <div className="flex items-center gap-2">
          <LiveDot ok />
          <span className="font-mono" dir="ltr">SAOS-NET · headcorner · r117m</span>
        </div>
        <span dir="ltr" className="font-mono tabular-nums">{at ? new Date(at).toISOString().slice(0, 19).replace("T", " ") + "Z" : ""}</span>
      </div>
    </footer>
  );
}
