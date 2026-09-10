"use client";

/**
 * 117p8-R5 — FLEET-V3 · מפעל-הצי-השלישי (פאנל-בקרה)
 * מפת-חומרים · טייס-צמיחת-SP (RC-מד) · ממצאי-המפעל בכנות · צמיחת-הצי החיה
 * מקור: /api/fleetv3 (אפס-סודות — רק-מדינה-וקידומות-ציבוריות)
 */

import { Bot, Factory, Fuel, GaugeCircle, Map, Sprout, TrendingUp } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { Chip, LiveDot, Micro, Panel, SecHead, ago } from "../primitives";
import { cn } from "@/lib/utils";

type FleetV3Data = {
  ok?: boolean;
  at?: string;
  autopilot?: {
    unlocked: boolean; spNow: number; spAtUnlock: number; gapSP: number;
    rcNowT: number; rcNeededT: number; rcRatio: number;
    lastRunAt?: string | null; lastDay?: string | null;
    claimedNow?: boolean; poweredNow?: boolean;
    totalRuns: number; lifetimePoweredUp: number;
  };
  factory?: {
    rcBlock: { status?: string; need?: string; have?: string; unlock?: string };
    powerspan: { status?: string; why?: string };
    rewardsClaimed: { status?: string; what?: string };
    mintedThisRun: number;
  };
  fleet?: { total: number; hiveFull: number; dead: string[]; names: string[] };
  material?: Array<{ kind: string; chain: string; what: string; action: string }>;
  folders?: Array<{ dir: string; files: number; kb: number }>;
  engines?: Record<string, { tick?: number; chains?: number; beats?: number; anchoredTotal?: number }>;
};

export function FleetV3Panel() {
  const live = useLive<FleetV3Data>("/api/fleetv3", 8000);
  const d = live.data;

  const ap = d?.autopilot;
  const ratio = ap ? Math.min(1, Math.max(0, ap.rcRatio || 0)) : 0;
  const pct = (ratio * 100).toFixed(1);

  return (
    <Panel className="p-4 md:p-5">
      <SecHead
        icon={<Factory className="h-4 w-4" />}
        title="FLEET-V3 · מפעל-הצי-השלישי"
        sub="מפת-חומרים · טייס-צמיחת-SP · הדרך-היחידה-לטביעת-חיילים-חדשים"
        extra={<Chip tone={ap?.unlocked ? "emerald" : "violet"}>{ap?.unlocked ? "מפעל-פתוח" : "בצמיחה"}</Chip>}
      />

      {!d ? (
        <div className="py-6 text-center text-xs text-zinc-600">טוען-מדינת-מפעל…</div>
      ) : (
        <div className="space-y-4">
          {/* מד-RC: הפער-אל-פתיחת-מפעל */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <GaugeCircle className="h-3.5 w-3.5" aria-hidden />
                מד-RC · סף-טביעת-חשבונות (claim_account)
              </span>
              <span dir="ltr" className="font-mono tabular-nums">
                {ap?.rcNowT.toFixed(2)}T / {ap?.rcNeededT.toFixed(2)}T
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-800/80" role="progressbar" aria-valuenow={Number(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="התקדמות-RC-אל-פתיחת-מפעל-הצי">
              <div className={cn("h-full rounded-full transition-all", ratio >= 1 ? "bg-emerald-400" : "bg-violet-400/80")} style={{ width: pct + "%" }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
              <span dir="ltr" className="font-mono">{pct}% מהסף · חסר {ap?.gapSP.toFixed(2)} SP על-headcorner</span>
              <span dir="ltr" className="font-mono">SP {ap?.spNow.toFixed(2)} → {ap?.spAtUnlock.toFixed(1)}</span>
            </div>
          </div>

          {/* טייס-הצמיחה */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatBox icon={<Sprout className="h-3.5 w-3.5" />} label="טייס-יומי" value={ap?.lastDay || "—"} sub={ap?.claimedNow ? "היום: נתבעו-תגמולים" : "ממתין-לריצת-היום"} tone={ap?.claimedNow ? "emerald" : "default"} />
            <StatBox icon={<TrendingUp className="h-3.5 w-3.5" />} label="SP-הראש" value={(ap?.spNow ?? 0).toFixed(3)} sub="power-up-אוטומטי-מצטבר" tone="violet" />
            <StatBox icon={<Fuel className="h-3.5 w-3.5" />} label="הועלה-לכוח" value={"+" + (ap?.lifetimePoweredUp ?? 0).toFixed(3) + " ST"} sub={"ריצות: " + (ap?.totalRuns ?? 0)} tone="emerald" />
            <StatBox icon={<Bot className="h-3.5 w-3.5" />} label="הצי-החי" value={(d?.fleet?.total ?? 0) + " חשבונות"} sub={d?.fleet?.hiveFull + " שליטה-מלאה-ב-Hive"} />
          </div>

          {/* ממצאי-המפעל בכנות */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
            <Micro className="mb-2">ממצאי-המפעל · כנות-מלאה</Micro>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400">
              <Finding ok text={"תגמולי-הראש נתבעו-והועלו-לכוח: " + (d?.factory?.rewardsClaimed?.what || "0.156 STEEM + VESTS ✓")} />
              <Finding ok={false} text={"טביעת-חשבונות-חדשים חסומה-RC: דרוש 5.83T · יש 3.46T — נפתח-אוטומטית כשהטייס-יצליח-את-הסף"} />
              <Finding ok={false} text="powerspan: השרשרת דוחה חתימת-עוגן-בעלות (tx_missing_owner_auth) · המפתח-המקורי-אבד-באיפוס — ממשיך-כסוללת-הצי" />
              <Finding ok={false} text="tov: נדרש מפתח-בעלים-אחד-מהמפעיל (הכלי-ערוך-וממתין-הדבקה)" />
            </ul>
          </div>

          {/* מפת-חומרים */}
          <div>
            <Micro className="mb-2 flex items-center gap-1.5"><Map className="h-3.5 w-3.5" aria-hidden /> מפת-החומרים ({d?.material?.length ?? 0})</Micro>
            <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1 [scrollbar-color:rgb(63_63_70)_transparent] [scrollbar-width:thin]">
              {(d?.material || []).map((m, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-1.5 text-[11px]">
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-200">{m.kind}</span>
                    {m.chain ? <span className="text-zinc-600"> · {m.chain}</span> : null}
                    <div dir="ltr" className="truncate font-mono text-[10px] text-zinc-500">{m.what}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-emerald-300/80">{m.action}</span>
                </div>
              ))}
            </div>
          </div>

          {/* מנועים חיים */}
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-2.5 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1"><LiveDot ok /> deposits tick {d?.engines?.deposits?.tick ?? "—"} · {d?.engines?.deposits?.chains ?? 0}/10</span>
            <span>· microdex beats {d?.engines?.microdex?.beats ?? "—"}</span>
            <span>· bridge anchors {d?.engines?.bridge?.anchoredTotal ?? "—"}</span>
            <span>· עודכן {ago(d?.at)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function StatBox({ icon, label, value, sub, tone = "default" }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "default" | "emerald" | "violet" }) {
  const map = { default: "text-zinc-100", emerald: "text-emerald-300", violet: "text-violet-300" } as const;
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <span className="truncate text-[10px]">{label}</span>
      </div>
      <div dir="ltr" className={cn("mt-1 truncate font-mono text-sm font-bold tabular-nums", map[tone])}>{value}</div>
      {sub ? <div className="truncate text-[9px] text-zinc-600">{sub}</div> : null}
    </div>
  );
}

function Finding({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-1.5">
      <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
      <span>{text}</span>
    </li>
  );
}
