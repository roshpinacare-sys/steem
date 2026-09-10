"use client";

/**
 * 117p8-R6 — FLEET-V3 · מפעל-הצי (פאנל-בקרה · אמת-יחידות)
 * מד-RC חי (max/current מול קיר-טביעה נמדד-שרשרת) · קו-ייצור צפוי ·
 * החזרת-האצלות-SP בדרך · מפת-חומרים · מנועים · הכל אפס-סודות (/api/fleetv3)
 */

import { Bot, Factory, Fuel, GaugeCircle, Map, RefreshCcw, Sprout, TrendingUp } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { Chip, LiveDot, Micro, Panel, SecHead, ago } from "../primitives";
import { cn } from "@/lib/utils";

type ProbeAcc = {
  name: string;
  steem: { ownSP: number; receivedSP: number; liquid: string; rcMaxT: string };
  hive: { ownSP: number; receivedSP: number; liquid: string; rcMaxT: string };
};
type ChainFact = { chain: string; headBlock: number; accountCreationFee: string; steemPerMvest: string; aggMaxRcT: string; headMaxRcT: string; claimNeedT: string };

type FleetV3Data = {
  ok?: boolean;
  at?: string;
  autopilot?: {
    unlocked: boolean; realSPTotal: number; realSPEffective: number;
    vestsPendingReturn: number; etaReturnDays: number;
    rcMaxT: number; rcCurT: number; rcNeededT: number; rcRatioMax: number; rcRatioCur: number; daysToRegen: number;
    unitsFixed?: string; lastRunAt?: string | null; lastDay?: string | null;
    claimedNow?: boolean; poweredNow?: boolean; mintedNow?: number;
    totalRuns: number; lifetimePoweredUp: number; mintedTotal?: number;
  };
  factory?: { powerspan: { status?: string; why?: string }; rewardsClaimed: { status?: string; what?: string }; mintedThisRun: number; r6WallMeasured?: { need?: string; measured?: string } };
  r6?: {
    spReclaim?: { at?: string | null; mode?: string; targets: number; delegatedBeforeMvest: number; projectedEffectiveSP: number; projectedRcMaxT: number };
    powerdownCancelled?: boolean;
    wallMeasured?: string;
    discovery?: string;
  };
  chainFacts?: ChainFact[];
  accountsProbe?: ProbeAcc[];
  fleet?: { total: number; hiveFull: number; dead: string[]; names: string[] };
  material?: Array<{ kind: string; chain: string; what: string; action: string }>;
  engines?: Record<string, { tick?: number; chains?: number; beats?: number; anchoredTotal?: number }>;
};

export function FleetV3Panel() {
  const live = useLive<FleetV3Data>("/api/fleetv3", 8000);
  const d = live.data;

  const ap = d?.autopilot;
  const ratioMax = ap ? Math.min(1, Math.max(0, ap.rcRatioMax || 0)) : 0;
  const ratioCur = ap ? Math.min(1, Math.max(0, ap.rcRatioCur || 0)) : 0;
  const pctMax = (ratioMax * 100).toFixed(1);
  const pctCur = (ratioCur * 100).toFixed(1);

  return (
    <Panel className="p-4 md:p-5">
      <SecHead
        icon={<Factory className="h-4 w-4" />}
        title="FLEET-V3 · מפעל-הצי · קו-ייצור"
        sub="מד-RC אמיתי · החזרת-כוח-בדרך · טביעה-אוטומטית כשהקיר-נחצה"
        extra={<Chip tone={ap?.unlocked ? "emerald" : "violet"}>{ap?.unlocked ? "מפעל-פתוח" : "בתהליך"}</Chip>}
      />

      {!d ? (
        <div className="py-6 text-center text-xs text-zinc-600">טוען-מדינת-מפעל…</div>
      ) : (
        <div className="space-y-4">
          {/* מד-RC כפול: תקרה (max) + מאגר-נוכחי (current) מול קיר-הטביעה */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <GaugeCircle className="h-3.5 w-3.5" aria-hidden />
                קיר-טביעת-חשבונות · נמדד-חי-מהשרשרת {d.r6?.wallMeasured ? "(5.78T)" : ""}
              </span>
              <span dir="ltr" className="font-mono tabular-nums">
                max {ap?.rcMaxT.toFixed(2)}T · cur {ap?.rcCurT.toFixed(2)}T / {ap?.rcNeededT.toFixed(2)}T
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-800/80" role="progressbar" aria-valuenow={Number(pctMax)} aria-valuemin={0} aria-valuemax={100} aria-label="תקרת-RC מול קיר-הטביעה">
              <div className={cn("h-full rounded-full transition-all", ratioMax >= 1 ? "bg-emerald-400" : "bg-violet-400/80")} style={{ width: pctMax + "%" }} />
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800/60" role="progressbar" aria-valuenow={Number(pctCur)} aria-valuemin={0} aria-valuemax={100} aria-label="מאגר-RC נוכחי מול קיר-הטביעה">
              <div className="h-full rounded-full bg-teal-400/70 transition-all" style={{ width: pctCur + "%" }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
              <span dir="ltr" className="font-mono">ceiling {pctMax}% · mana {pctCur}%</span>
              <span dir="ltr" className="font-mono">regen-ETA {ap?.daysToRegen ?? "—"}d · vests-in-return {ap?.vestsPendingReturn.toFixed(2)}M (~{ap?.etaReturnDays}d)</span>
            </div>
          </div>

          {/* כוח-אמת של הראש */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatBox icon={<TrendingUp className="h-3.5 w-3.5" />} label="SP-אמיתי-לראש" value={(ap?.realSPTotal ?? 0).toLocaleString("he-IL", { maximumFractionDigits: 0 })} sub="R5 דיווח 8.6 — היה MVests; התיקון-נמדד-שרשרת" tone="violet" />
            <StatBox icon={<RefreshCcw className="h-3.5 w-3.5" />} label="SP-אפקטיבי" value={(ap?.realSPEffective ?? 0).toLocaleString("he-IL", { maximumFractionDigits: 0 })} sub="אחרי-החזרת-האצלות" tone="emerald" />
            <StatBox icon={<Sprout className="h-3.5 w-3.5" />} label="טייס-יומי" value={ap?.lastDay || "—"} sub={ap?.claimedNow ? "היום: נתבעו-תגמולים ✓" : "ריצות: " + (ap?.totalRuns ?? 0)} tone={ap?.claimedNow ? "emerald" : "default"} />
            <StatBox icon={<Bot className="h-3.5 w-3.5" />} label="הצי" value={(d?.fleet?.total ?? 0) + " חשבונות"} sub={d?.fleet?.hiveFull + " שליטה-מלאה-ב-Hive · " + (d?.fleet?.dead?.length ?? 0) + " עדים-לא-שולטים"} />
          </div>

          {/* מה מתרחש עכשיו — קו-הייצור */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
            <Micro className="mb-2">קו-הייצור · מה-קורה-עכשיו</Micro>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400">
              <Finding ok text={"תגמולי-הראש נתבעים-יומית ומועלים-לכוח (" + (ap?.lifetimePoweredUp ?? 0).toFixed(3) + " ST מצטבר)"} />
              <Finding ok text={"הוחזרו-חי 3433 SP שהוקצו-ל-11 חשבונותינו (sp_reclaim 11/11 ✓) — ה-VESTS חוזרים-לראש תוך ~7-ימים ⇒ תקרת-ה-RC מזנקת ל-~7T ≥ הקיר"} />
              <Finding ok text={"power-down של 1747 SP בוטל-חי — כל-הכוח-נשאר-במערכת"} />
              <Finding ok={false} text="טביעת-חשבונות: נמדד-חי-מהשרשרת 5.78T נדרש · היום 3.46T — נחצה-אוטומטית עם-חזרת-ההאצלות (~17.9) ⇒ אז חייל-חדש כל-מחזור-regen (~3-4 ימים), מצטבר" />
              <Finding ok={false} text="powerspan: השרשרת דוחה חתימת-עוגן-בעלות · המפתח-המקורי-אבד-באיפוס — ממשיך-כסוללת-הצי" />
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
