"use client";

/**
 * 117n — NEXUS shell II · מעטפת-מפעיל
 * 7-מסכים × תתי-תפריטים אמת: מסילת-מחשב (עם-תתי-קישורים-פתוחים) · סרגל-תת-תפריט דביק ·
 * ניווט-תחתון-מובייל 4+MORE (גיליון-תחתון) · safe-area · hash-routing דו-שלבי (#section/sub)
 */

import { useState } from "react";
import type { ReactNode } from "react";
import {
  Activity, ArrowDownToLine, BookOpen, ChevronDown, Coins, DoorOpen, Gauge,
  LayoutGrid, Server, ShieldCheck, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveDot, fmtInt } from "./primitives";

/* ── מבנה-הניווט: מסכים × תתי-תפריטים ── */
export const SECTIONS = [
  { id: "control", label: "בקרה", en: "CONTROL", icon: Gauge },
  { id: "book", label: "ספר", en: "THE-BOOK", icon: BookOpen },
  { id: "shield", label: "מגן", en: "SHIELD", icon: ShieldCheck },
  { id: "doors", label: "דלתות", en: "DOORS", icon: DoorOpen },
  { id: "deposits", label: "הפקדות", en: "DEPOSITS", icon: ArrowDownToLine },
  { id: "econ", label: "כלכלה", en: "ECON", icon: Coins },
  { id: "system", label: "מערכת", en: "SYSTEM", icon: Server },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const SUBS: Record<SectionId, Array<{ id: string; label: string }>> = {
  control: [
    { id: "overview", label: "סקירה" },
    { id: "fleet", label: "הצי" },
  ],
  book: [
    { id: "blocks", label: "בלוקים" },
    { id: "search", label: "חיפוש" },
  ],
  shield: [
    { id: "posture", label: "תמונה" },
    { id: "scanner", label: "בודק" },
    { id: "audit", label: "ביקורת" },
  ],
  doors: [
    { id: "vault", label: "כספת" },
    { id: "relay", label: "ריליי" },
    { id: "ops", label: "תפעול" },
  ],
  deposits: [
    { id: "chains", label: "שרשראות" },
    { id: "events", label: "אירועים" },
  ],
  econ: [
    { id: "pools", label: "בריכות" },
    { id: "wrapped", label: "עטופים" },
    { id: "grid", label: "גריד" },
    { id: "harvest", label: "קציר" },
  ],
  system: [
    { id: "logs", label: "לוגים" },
    { id: "inventory", label: "מלוא-האחזקות" },
    { id: "broker", label: "ברוקר" },
  ],
};

export type SubId = string;

/* ── ראש-דביק ── */
export function NexusHeader({
  saosHeight,
  tronHeight,
  fleetOk,
  fleetTotal,
  chainsOk,
  chainsTotal,
  bookHead,
  at,
}: {
  saosHeight: number;
  tronHeight: number;
  fleetOk: number;
  fleetTotal: number;
  chainsOk: number;
  chainsTotal: number;
  bookHead: number;
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
              SAOS-NET <span className="text-emerald-400">COMMAND II</span>
            </div>
            <div className="hidden text-[10px] uppercase tracking-[0.2em] text-zinc-500 sm:block">מרכז-ההפעלה-הריבוני · r117n</div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div dir="ltr" className="hidden items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-[11px] tabular-nums text-zinc-400 lg:flex">
            <span title="SAOS-NET height">SAOS <span className="text-zinc-200">{fmtInt(saosHeight)}</span></span>
            <span title="THE-BOOK head">BOOK <span className="text-violet-300">{fmtInt(bookHead)}</span></span>
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
          <span dir="ltr" className="hidden font-mono text-[10px] tabular-nums text-zinc-600 xl:inline" title={at}>
            {at ? new Date(at).toLocaleTimeString("en-GB") : ""}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ── סרגל-תת-תפריט דביק (מובייל+מחשב) ── */
export function SubNav({ section, sub, onNavigate }: { section: SectionId; sub: SubId; onNavigate: (s: SubId) => void }) {
  const subs = SUBS[section];
  return (
    <div className="sticky top-14 z-30 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto px-3 py-2 nexus-scroll-x md:px-6" role="tablist" aria-label="תת-תפריט">
        {subs.map((s) => {
          const on = s.id === sub;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={on}
              onClick={() => onNavigate(s.id)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all",
                on
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── גיליון-MORE (מובייל) ── */
export function MoreSheet({
  open,
  active,
  onClose,
  onNavigate,
}: {
  open: boolean;
  active: SectionId;
  onClose: () => void;
  onNavigate: (s: SectionId) => void;
}) {
  if (!open) return null;
  const extra = SECTIONS.filter((s) => !["control", "book", "shield", "doors"].includes(s.id));
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="מסכים-נוספים">
      <button aria-label="סגירה" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-800 bg-zinc-950 p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-200">כל-המסכים</span>
          <button onClick={onClose} aria-label="סגור" className="rounded-md border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {extra.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => { onNavigate(s.id); onClose(); }}
                className={cn(
                  "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border p-2 transition-colors",
                  on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="text-xs font-semibold">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── ניווט-תחתון-מובייל: 4-עיקריים + MORE ── */
const PRIMARY: SectionId[] = ["control", "book", "shield", "doors"];

export function BottomNav({ active, onNavigate }: { active: SectionId; onNavigate: (s: SectionId) => void }) {
  const [more, setMore] = useState(false);
  const primary = SECTIONS.filter((s) => PRIMARY.includes(s.id));
  const activeInMore = !PRIMARY.includes(active);
  return (
    <>
      <nav
        aria-label="ניווט-ראשי"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/80 bg-zinc-950/92 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-md grid-cols-5">
          {primary.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => onNavigate(s.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] transition-colors",
                  on ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="font-medium">{s.label}</span>
                {on && <span className="absolute top-0 h-0.5 w-6 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            );
          })}
          <button
            onClick={() => setMore(true)}
            aria-current={activeInMore ? "page" : undefined}
            className={cn(
              "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] transition-colors",
              activeInMore ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <LayoutGrid className="h-5 w-5" aria-hidden />
            <span className="font-medium">עוד</span>
            {activeInMore && <span className="absolute top-0 h-0.5 w-6 rounded-full bg-emerald-400" aria-hidden />}
          </button>
        </div>
      </nav>
      <MoreSheet open={more} active={active} onClose={() => setMore(false)} onNavigate={onNavigate} />
    </>
  );
}

/* ── מסילת-צד-מחשב · תתי-תפריטים-פתוחים-למסך-הפעיל ── */
export function DesktopRail({
  active,
  sub,
  onNavigate,
}: {
  active: SectionId;
  sub: SubId;
  onNavigate: (s: SectionId, sub?: SubId) => void;
}) {
  return (
    <nav aria-label="ניווט-צד" className="sticky top-20 hidden flex-col gap-1 md:flex">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const on = active === s.id;
        return (
          <div key={s.id}>
            <button
              onClick={() => onNavigate(s.id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-right transition-all",
                on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-300"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", on ? "text-emerald-300" : "text-zinc-600 group-hover:text-zinc-400")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight">{s.label}</span>
                <span dir="ltr" className="block text-[9px] uppercase tracking-[0.22em] text-zinc-600">{s.en}</span>
              </span>
              {on && <ChevronDown className="h-3.5 w-3.5 text-emerald-400/70" aria-hidden />}
            </button>
            {on && (
              <div className="mb-1 ml-4 mt-0.5 flex flex-col gap-0.5 border-r border-zinc-800 pr-2" role="tablist" aria-label="תתי-תפריט">
                {SUBS[s.id].map((u) => {
                  const onSub = u.id === sub;
                  return (
                    <button
                      key={u.id}
                      role="tab"
                      aria-selected={onSub}
                      onClick={() => onNavigate(s.id, u.id)}
                      className={cn(
                        "rounded px-2 py-1.5 text-right text-xs transition-colors",
                        onSub ? "bg-emerald-500/10 font-bold text-emerald-300" : "text-zinc-600 hover:bg-zinc-900/60 hover:text-zinc-400"
                      )}
                    >
                      {u.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
          <span className="font-mono" dir="ltr">SAOS-NET · headcorner · r117n-command-ii</span>
        </div>
        <span dir="ltr" className="font-mono tabular-nums">{at ? new Date(at).toISOString().slice(0, 19).replace("T", " ") + "Z" : ""}</span>
      </div>
    </footer>
  );
}

export type { ReactNode };
