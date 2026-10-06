"use client";

// ─────────────────────────────────────────────────────────────────────
// מנוע ההכנסה — לוח המשימה (R127)
// הוראת המפעיל: "המשימה של הסוכנים האוטונומיה והריבונות הוא לייצר
// 1000$ תקני שאפשר להמיר, כל יום. ואם לא — מה חסר לה ועד לתוצאה."
// כרטיס זה הוא לוח התוצאות: הכנסה אמיתית נמדדת מול היעד, בכנות מלאה —
// כולל הפער, גם כשהוא פי מאות-אלפים.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Banknote,
  Coins,
  Flag,
  Landmark,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "../api";

interface IncomeSourceLite {
  id: string;
  nameHe: string;
  usdToday: number | null;
  usd7d: number | null;
  usd30d: number | null;
  events30d: number;
  evidenceHe: string;
}

interface IncomeReportLite {
  at: string;
  ok: boolean;
  generatedAt?: string;
  sources: IncomeSourceLite[];
  capitalInflow?: {
    steemPowerdown30d: number;
    externalInUsd30d: number | null;
    noteHe: string;
  };
  totals: { usdToday: number | null; usd7d: number | null; usd30d: number | null };
  gap: {
    targetUsdPerDay: number;
    actualUsdPerDay30d: number | null;
    ratio: number | null;
    capitalNeeded: Array<{ edgePctPerDay: number; capitalUsd: number }>;
    workingCapitalUsd: number | null;
    missingHe: string[];
  };
}

const TARGET = 1000;

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "לא נמדד";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtRatio(r: number | null): string {
  if (r == null) return "—";
  if (r >= 1000) return `×${Math.round(r).toLocaleString("en-US")}`;
  return `×${r.toFixed(1)}`;
}

export function IncomeMissionCard() {
  const reduced = useReducedMotion();
  const [report, setReport] = useState<IncomeReportLite | null>(null);
  const [recordedAt, setRecordedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // בטעינה: הרשומה היומית האחרונה מהקנון (קלה — קובץ)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await apiFetch<{ exists: boolean; report?: IncomeReportLite }>("/api/income/last");
        if (!alive) return;
        if (j.exists && j.report) {
          setReport(j.report);
          setRecordedAt(j.report.generatedAt ?? j.report.at ?? null);
        }
      } catch {
        /* אין רשומה עדיין — המדידה החיה תיצור */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const measureLive = useCallback(async () => {
    setMeasuring(true);
    setError(null);
    try {
      const j = await apiFetch<IncomeReportLite>("/api/income?record=1");
      setReport(j);
      setRecordedAt(j.at);
    } catch (e) {
      setError(String((e as Error).message ?? e).slice(0, 140));
    } finally {
      setMeasuring(false);
    }
  }, []);

  const today = report?.totals.usdToday ?? null;
  const perDay30 = report?.gap.actualUsdPerDay30d ?? null;
  const ratio = report?.gap.ratio ?? null;
  const progress = perDay30 != null ? Math.min(100, (perDay30 / TARGET) * 100) : 0;
  const sources = report?.sources ?? [];

  return (
    <Card className="overflow-hidden border-2 border-emerald-600/30 shadow-lg shadow-emerald-950/10">
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Banknote className="size-5 text-emerald-600" aria-hidden="true" />
              <h3 className="text-xl font-bold tracking-tight sm:text-2xl">מנוע ההכנסה</h3>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                המשימה
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              הוראת המפעיל: לייצר <strong className="text-foreground">{`$${TARGET.toLocaleString("en-US")} ליום`}</strong> תקני שאפשר להמיר — כל יום, לבד.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={measureLive}
            disabled={measuring}
            aria-label="מדידה חיה של ההכנסה מהשרשרות"
          >
            <RefreshCw className={`size-4 ${measuring ? "animate-spin" : ""}`} aria-hidden="true" />
            {measuring ? "מודד מהשרשרת…" : "מדידה חיה"}
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3" aria-label="טוען רשומת הכנסה">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-4"
          >
            {/* המספרים הראשיים */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">הכנסה · היום</div>
                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight">{fmtUsd(today)}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">קצב יומי · 30 יום</div>
                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight">
                  {perDay30 != null ? `${fmtUsd(perDay30)}/יום` : "לא נמדד"}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">הפער מהיעד</div>
                <div className="mt-1 text-2xl font-black tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
                  {fmtRatio(ratio)}
                </div>
              </div>
            </div>

            {/* התקדמות מול היעד */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>התקדמות מול {`$${TARGET.toLocaleString("en-US")}/יום`}</span>
                <span className="tabular-nums">{perDay30 != null ? (progress < 0.01 ? "‹0.01%" : `${progress.toFixed(2)}%`) : "לא נמדד"}</span>
              </div>
              <Progress value={progress} aria-label="אחוז התקדמות מול יעד ההכנסה" className="h-2" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                הפער מדווח בכנות מלאה — גם כשהוא גדול. מקורות הסרק (כוח-הצבעה, צד הקנייה של הגריד) הופעלו בסבב R127.
              </p>
            </div>

            {/* מקורות */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{s.nameHe}</span>
                    <span className="truncate text-[11px] text-muted-foreground" title={s.evidenceHe}>
                      {s.events30d > 0 ? `${s.events30d} אירועים ב-30 יום` : "אין אירועים ב-30 יום"}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{fmtUsd(s.usd30d)}</span>
                </div>
              ))}
            </div>

            {/* מה חסר — כנות מלאה */}
            {report?.gap?.missingHe?.length ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  <Flag className="size-4 text-amber-600" aria-hidden="true" />
                  מה חסר עד התוצאה (נמדד, לא מומצא):
                </div>
                <ul className="flex flex-col gap-1">
                  {report.gap.missingHe.map((m, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted-foreground">• {m}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* שורת הבהרת הון */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Landmark className="size-3.5" aria-hidden="true" />
                הון-עבודה: {report?.gap?.workingCapitalUsd != null ? `$${report.gap.workingCapitalUsd.toLocaleString("en-US")}` : "לא נמדד"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Coins className="size-3.5" aria-hidden="true" />
                הון שנכנס (30 יום): {report?.capitalInflow ? `${report.capitalInflow.steemPowerdown30d} STEEM מ-powerdown · המרה, לא הכנסה` : "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                בקצב 2%/יום נדרשים ~$50,000 הון
              </span>
            </div>

            {recordedAt ? (
              <p className="text-[11px] text-muted-foreground">
                רשומה יומית בקנון · נמדד {new Date(recordedAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} · הדופק מודד ומתעד מדי יום
              </p>
            ) : null}
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
