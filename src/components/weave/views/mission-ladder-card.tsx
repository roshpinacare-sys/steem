"use client";

// ─────────────────────────────────────────────────────────────────────
// סולם המשימה — $1,000/יום (Task 9-2 / Z-9)
// לוח חי של מנוע-המשימה: הכנסה נמדדת מול מדרגות הסולם, הון חי,
// חיות-צי (9/9), ורצף-הירוק של L0 מקבצי KPI-history שהמפקיד (kpi-scribe)
// מפקיד יומית. כל מספר מגיע מ-/api/mission — מדידה, לא הצהרה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bot, Landmark, RefreshCw, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "../api";

interface LadderRung {
  rungUsdPerDay: number;
  requiredCapitalUsd: Array<{ tier: string; apr: number; capitalUsd: number }>;
  stateHe: string;
}

interface MissionLadder {
  ok: boolean;
  at: string;
  measured: {
    usdPerDay7dAvg: number;
    usdPerDay30dAvg: number;
    daysRecorded: number;
  };
  capital: {
    steemBalance: number | null;
    steemInOrders?: number | null;
    steemTotal?: number | null;
    steemUsd: number | null;
    capitalUsd: number | null;
  };
  fleet: { up: number; total: number };
  l0: {
    consecutiveGreenDays: number;
    requiredDays: number;
    todayGreen: boolean | null;
    historyDays: number;
  };
  ladder: LadderRung[];
  gap: { dailyNowUsd: number; ratio: number | null; requiredCapitalUsdAtModerateApr: number; capitalGapUsd: number | null };
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "לא נמדד";
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtCapital(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function MissionLadderCard() {
  const reduced = useReducedMotion();
  const [m, setM] = useState<MissionLadder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const j = await apiFetch<MissionLadder>("/api/mission");
      setM(j);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 140));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rungs = m?.ladder ?? [];
  const streak = m?.l0.consecutiveGreenDays ?? 0;
  const requiredDays = m?.l0.requiredDays ?? 7;
  const todayGreen = m?.l0.todayGreen;
  const fleetUp = m?.fleet.up ?? null;
  const fleetTotal = m?.fleet.total ?? null;
  const dailyNow = m?.gap.dailyNowUsd ?? null;
  const daysRecorded = m?.measured.daysRecorded ?? null;
  const moderateCapital = (rung: number) =>
    rungs.find((r) => r.rungUsdPerDay === rung)?.requiredCapitalUsd.find((t) => t.tier === "moderate")?.capitalUsd ?? null;

  return (
    <Card className="overflow-hidden border-emerald-600/25">
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Target className="size-5 text-emerald-600" aria-hidden="true" />
              <h3 className="text-xl font-bold tracking-tight sm:text-2xl">סולם המשימה · 1,000$ ליום</h3>
              {m ? (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  נמדד חי
                </Badge>
              ) : (
                <Badge variant="outline" className="border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400">
                  {loading ? "…" : "לא נמדד"}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              הדרך היחידה: מדידה ← מכונות ← הון. מדרגה מוכרזת רק ממדידה חיה רציפה — אין קסם, יש סולם.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={load}
            disabled={refreshing}
            aria-label="רענון מדידת מנוע-המשימה"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "מודד…" : "רענון"}
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3" aria-label="טוען מנוע-משימה">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-4"
          >
            {/* המספרים החיים */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">קצב נמדד · ממוצע יום-רישום</div>
                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight">
                  {dailyNow != null ? `${fmtUsd(dailyNow)}/יום` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {daysRecorded != null ? `מתוך ${daysRecorded} ימי-רישום בחלון` : "…"}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">הון חי</div>
                <div className="mt-1 flex items-center gap-1.5 text-2xl font-black tabular-nums tracking-tight">
                  <Landmark className="size-4 text-muted-foreground" aria-hidden="true" />
                  {fmtUsd(m?.capital.capitalUsd)}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">חיות-צי</div>
                <div className="mt-1 flex items-center gap-1.5 text-2xl font-black tabular-nums tracking-tight">
                  <Bot className={`size-4 ${(fleetUp ?? 0) === (fleetTotal ?? -1) ? "text-emerald-600" : "text-amber-600"}`} aria-hidden="true" />
                  {fleetUp != null && fleetTotal != null ? `${fleetUp}/${fleetTotal}` : "—"}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">רצף-ירוק L0</div>
                <div
                  className={`mt-1 text-2xl font-black tabular-nums tracking-tight ${
                    todayGreen === true ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {streak}/{requiredDays}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {todayGreen === true ? "היום ירוק" : todayGreen === false ? "היום לא ירוק" : "היום טרם נמדד"}
                </div>
              </div>
            </div>

            {/* מדרגות הסולם — הפער מול כל מדרגה, בכנות */}
            <div className="flex flex-col gap-2">
              {rungs.map((r) => {
                const cap = r.requiredCapitalUsd.find((t) => t.tier === "moderate")?.capitalUsd ?? null;
                const reached = dailyNow != null && dailyNow >= r.rungUsdPerDay;
                return (
                  <div key={r.rungUsdPerDay} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          reached
                            ? "bg-emerald-600 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {r.rungUsdPerDay >= 1000 ? "1k" : r.rungUsdPerDay}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold">{fmtCapital(r.rungUsdPerDay)} ליום</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          הון נדרש (APR 20%): {cap != null ? fmtCapital(cap) : "—"}
                          {r.rungUsdPerDay === 1 ? " · M0→M1" : r.rungUsdPerDay === 10 ? " · L1" : r.rungUsdPerDay === 100 ? " · L2-L3" : " · L4"}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        reached ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                      }`}
                    >
                      {reached ? "עומד במדידה" : `פער ${dailyNow != null && dailyNow > 0 ? `×${Math.round(r.rungUsdPerDay / dailyNow).toLocaleString("en-US")}` : "—"}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* הכנות על הפער */}
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <TrendingUp className="size-4 text-emerald-600" aria-hidden="true" />
                הפער הוא הון + זמן-הוכחה, לא קסם
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                ב-{fmtCapital(m?.gap.requiredCapitalUsdAtModerateApr ?? 0)} ו-APR 20% מגיעים ל-1,000$/יום.
                ההון החי כרגע: {fmtUsd(m?.capital.capitalUsd)}
                {m?.capital.steemInOrders != null && m.capital.steemInOrders > 0
                  ? ` (מתוכם הון-עובד בפקודות פתוחות: ${m.capital.steemInOrders.toLocaleString("en-US", { maximumFractionDigits: 0 })} STEEM + נוזלי ${m?.capital.steemBalance ?? 0})`
                  : ""}
                {" "}
                · פער-הון: {m?.gap.capitalGapUsd != null ? fmtCapital(m.gap.capitalGapUsd) : "לא נמדד"}.
                טירי-ה-APR הם סדרי-גודל לתכנון, לא הבטחת-רווח. שערי-המפעיל (רוטציית-מפתח X-1 · הון L2 X-2) פתוחים להחלטת המפעיל בלבד.
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground">
              מקור: /api/mission · נמדד{" "}
              {m?.at
                ? new Date(m.at).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
                : "—"}{" "}
              · רצף-הירוק נספר מקבצי KPI-history שהמפקיד היומי (kpi-scribe · Z-9) מפקיד — יום חסר שובר את הרצף בכנות.
            </p>
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
