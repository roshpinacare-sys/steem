"use client";

// ─────────────────────────────────────────────────────────────────────
// MONEY-MOVER VIEW · מוביל הכסף (R81 · THE MONEY-MOVER).
//
// הוראת המפעיל שיצרה את התצוגה: "שנכנס אתמול כסף מה קרה איתו אני רואה
// שסתם הוא יושב מחכה.. גרוע מאוד. המערכת צריכה להיות דינמית ומבינה
// בשוק חי ולא לחכות אלא לפעול ותמיד לחפש הזדמנויות טובות יותר."
//
// התצוגה הזו היא הלוח של המוביל — הכול מנתונים חיים:
//   · פאנל התשובה — מה נכנס, היכן ישב, מה המוביל עשה (קבלות + txids)
//   · הסולם החי — הפקודות שלנו מול קו הפאריטה (מרחק bps בזמן אמת)
//   · שוק חי — ספר הפקודות הפנימי (ביד/אסק) מול הסולם שלנו
//   · הדיבון — נקודת-דופק, החלטה אחרונה, תקציב, קירור
//   · ציד הזדמנויות — מלכודת הפאריטה, חימוש SBD, נחיתת דלק, שער TRON
//   · מילויים — מה שהשוק שילם (מההיסטוריה החיה של השרשרת)
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Coins,
  Crosshair,
  Fuel,
  Gauge,
  Landmark,
  Loader2,
  Radar,
  RefreshCw,
  Repeat,
  Scale,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ErrorBox, FadeIn, MotionCard, Section, StatusBadge } from "@/components/weave/shared";

// ── טיפוסים (מראה של ה-API) ─────────────────────────────────────────

interface OpenAsk {
  orderid: number;
  /** r190 · מקור הפקודה לפי טווח-ה-orderid: "grid" = טווח-שמור למנוע-הגריד (המוביל לא נוגע) */
  origin?: "grid" | "mover";
  amount: number;
  receive: number;
  price: number;
  created: string;
  expiration: string;
  vsParityBps: number | null;
  sbdIfFilled: number;
  usdIfFilled: number | null;
}
interface FillReceipt {
  at: string;
  side: "sold-steem" | "bought-steem";
  paid: string;
  received: string;
  price: number | null;
}
interface MoverReceipt {
  at: string;
  kind: string;
  reason: string;
  parity: number | null;
  cancelled: Array<{ orderid: number; txid: string | null }>;
  placed: Array<{ orderid: number; sell: number; receive: number; price: number; txid: string | null }>;
  verify?: { ordersNow: number; deployedNow: number } | null;
  error?: string;
}
interface Opportunity {
  id: string;
  title: string;
  state: "HUNTING" | "ARMED" | "BLOCKED" | "FLOWING";
  detail: string;
  number: string | null;
}
interface MoneySense {
  ok: boolean;
  at: string;
  account: string;
  marks: { steemUsd: number | null; sbdUsd: number | null; trxUsd: number | null; parity: number | null; sources: Record<string, string> };
  balances: { steem: number | null; sbd: number | null };
  book: {
    bids: Array<{ price: number; sbd: number; steem: number }>;
    asks: Array<{ price: number; sbd: number; steem: number }>;
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spreadBps: number | null;
  };
  orders: OpenAsk[];
  // R127 — סולם הקנייה שלנו (הוצב לראשונה חי ב-27/09, חוק אין-רעבת-צד): הבידים הפתוחים שלנו מתחת לקו
  ourBids: Array<{ orderid: number; origin?: "grid" | "mover"; sbd: number; steem: number; price: number; created: string; expiration: string; vsParityBps: number | null; usdIfFilled: number | null }>;
  deployedSteem: number;
  idleSteem: number;
  // r139-c · רצפת-הערך הנמדדת (מ-/api/money): מחליף טענת-HOLD סטטית במדידה חיה
  valueFloor?: {
    parity: number | null;
    asksBelowParity: number;
    steemBelowParity: number;
    worstBps: number;
    maxDriftLossSbd: number | null;
    maxDriftLossUsd: number | null;
    state: "HELD" | "DRIFT" | "UNMEASURED";
    noteHe: string;
  };
  ladder: Array<{ level: number; premiumBps: number; price: number | null }>;
  powerdown: { active: boolean | null; weeklySteem: number | null; nextPayment: string | null; paymentsLeft: number | null; totalRemainingSteem: number | null };
  fills: FillReceipt[];
  sbdArming: { balance: number; needed: number; commitable: number; state: "ARMED" | "WAIT" };
  redemption: { outboxTrx: number | null; custodyTrx: number | null; sendThresholdTrx: number; verdict: "WAIT" | "GO" | "UNKNOWN"; detail: string };
  diagnosis: { enteredSteem: number; whereItSits: { inOrders: number; liquid: number; sbd: number }; staleHours: number | null; note: string };
  opportunities: Opportunity[];
  daemon: {
    alive: boolean;
    bootedAt: string | null;
    beats: number | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    lastActionAt: string | null;
    actionsToday: number | null;
    nextEligibleAt: string | null;
    history: MoverReceipt[];
    fetchedVia: string;
  };
  doctrine: string[];
  down: string[];
  cacheAgeSec: number;
}

// ── עזרי תצוגה ──────────────────────────────────────────────────────

import { RailsStrip } from "@/components/weave/views/rails-strip";
import { MarketMakerView } from "@/components/weave/views/market-maker-view";

const f4 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(4));
const f3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));
const usd = (x: number | null | undefined) => (x == null ? "—" : `$${x.toFixed(2)}`);

function bpsBadge(bps: number | null): { label: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (bps == null) return { label: "—", tone: "muted" };
  if (bps >= 0) return { label: `+${bps}bps מעל הקו`, tone: "good" };
  if (bps >= -50) return { label: `${bps}bps (עיגול)`, tone: "warn" };
  return { label: `${bps}bps מתחת לקו — מיושן`, tone: "bad" };
}

function oppBadge(state: Opportunity["state"]): { label: string; className: string } {
  switch (state) {
    case "FLOWING":
      return { label: "זורם", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" };
    case "ARMED":
      return { label: "חמוש", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" };
    case "HUNTING":
      return { label: "צד", className: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/30" };
    default:
      return { label: "חסום בכנות", className: "bg-muted text-muted-foreground border-border" };
  }
}

function fmtTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 48) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

// ── התצוגה ──────────────────────────────────────────────────────────

export function MoneyMoverView({ section }: { section?: string }) {
  const [data, setData] = useState<MoneySense | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/money", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as MoneySense;
      if (alive.current) {
        setData(j);
        setErr(null);
      }
    } catch (e) {
      if (alive.current) setErr(String((e as Error).message ?? e));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const poll = setInterval(() => void load(), 90_000);
    const tick = setInterval(() => forceTick((x) => x + 1), 1_000);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const d = data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      {/* r188 · פס-המסילות — BLURT + TRON חיות למפעיל (חיבור-היתום /api/money/blurt) */}
      <RailsStrip />
      {/* Task 2-b · לוח-מנוע-הגריד — הסוחר השני (SBD:STEEM דו-צדדי, פורט 3049) */}
      <MarketMakerView />
      {/* פתיח */}
      <Section
        wash
        icon={<Landmark />}
        title="מוביל הכסף — R81"
        description="הדלק לעולם לא יושב: הסולם על קו הפאריטה החי, הדיבון צד הזדמנויות כל דקה, וכל פעולה נמדדת מהשרשרת"
        action={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="hidden sm:inline">רענן</span>
          </Button>
        }
      >
        {/* צ'יפים חיים */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              icon: Scale,
              label: "פאריטה חיה (SBD/STEEM)",
              value: f4(d?.marks.parity),
              sub: d ? `${d.marks.steemUsd?.toFixed(5) ?? "—"} / ${d.marks.sbdUsd?.toFixed(4) ?? "—"}` : "…",
            },
            {
              icon: Crosshair,
              label: "שוק: ביד / אסק",
              value: d ? `${f4(d.book.bestBid)} / ${f4(d.book.bestAsk)}` : "…",
              sub: d?.book.spreadBps != null ? `ספרד ${d.book.spreadBps}bps` : "…",
            },
            {
              icon: Coins,
              label: "דלק בסולם",
              value: d ? `${d.deployedSteem.toFixed(3)} STEEM` : "…",
              sub: d ? `נזיל: ${d.idleSteem.toFixed(3)}` : "…",
            },
            {
              icon: Banknote,
              label: "הכנסה אם יתמלא הסולם",
              value: d ? `${(d.orders.reduce((s, o) => s + o.receive, 0)).toFixed(3)} SBD` : "…",
              sub: d ? usd(d.orders.reduce((s, o) => s + (o.usdIfFilled ?? 0), 0)) : "…",
            },
            {
              icon: Activity,
              label: "הדיבון",
              value: d ? (d.daemon.alive ? "חי" : d.daemon.fetchedVia === "file" ? "קובץ" : "מושבת") : "…",
              sub: d?.daemon.beats != null ? `${d.daemon.beats} פעימות` : "…",
            },
          ].map((chip) => (
            <MotionCard key={chip.label}>
              <CardContent className="flex items-start gap-3 p-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground [&_svg]:size-4">
                  <chip.icon />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">{chip.label}</p>
                  <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums">{chip.value}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{chip.sub}</p>
                </div>
              </CardContent>
            </MotionCard>
          ))}
        </div>

        {d?.down?.length ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            מקורות שנפלו בכנות: {d.down.join(" · ")} — שאר המדידות חיות.
          </div>
        ) : null}
      </Section>

      {err ? (
        <div className="mt-0">
          <ErrorBox message={`ה-API לא ענה: ${err} — התצוגה מציגה את מה שיש; נסה רענון.`} />
        </div>
      ) : null}

      {loading && !d ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {d ? (
        <>
          {/* פאנל התשובה — מה קרה לכסף שנכנס */}
          <Section
            icon={<Radar />}
            title="התשובה — הכסף שנכנס ומה קרה איתו"
            description="אבחנה חיה מהשרשרת: מה נכנס, היכן ישב, ומה המוביל עשה בפועל"
          >
            <MotionCard>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-[11px] text-muted-foreground">דלק ביד עכשיו</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">{d.diagnosis.enteredSteem.toFixed(3)} <span className="text-xs font-normal">STEEM</span></p>
                    <p className="text-[11px] text-muted-foreground">מקור: פאוורדאון + יתרה</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-[11px] text-muted-foreground">פרוס בסולם</p>
                    <p className="font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{d.diagnosis.whereItSits.inOrders.toFixed(3)} <span className="text-xs font-normal">STEEM</span></p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.orders.length} פקודות על הקו
                      {d.orders.filter((o) => o.origin === "grid").length > 0
                        ? ` · ${d.orders.filter((o) => o.origin === "grid").length} של מנוע-הגריד (טווח-שמור — לא נוגעים)`
                        : ""}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-[11px] text-muted-foreground">נזיל</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">{d.diagnosis.whereItSits.liquid.toFixed(3)} <span className="text-xs font-normal">STEEM</span></p>
                    <p className="text-[11px] text-muted-foreground">{d.idleSteem > 1 ? "ממתין לפריסה במחזור הבא" : "אפס כמעט — הכול פרוס"}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-[11px] text-muted-foreground">SBD בקופה</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">{d.diagnosis.whereItSits.sbd.toFixed(3)}</p>
                    <p className="text-[11px] text-muted-foreground">חימוש צד-קנייה: {d.sbdArming.commitable.toFixed(3)}/{d.sbdArming.needed}{(d.ourBids ?? []).length > 0 ? " · סולם קנייה חי" : ""}</p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {d.diagnosis.note}
                  {d.diagnosis.staleHours != null && d.orders.length > 0 ? ` · הפקודה הוותיקה בת ${d.diagnosis.staleHours} שעות — אך המוביל בודק אותה כל דקה מול הפאריטה החיה: זזה מעבר ל-50bps — הסולם נגרר אליה מיד.` : ""}
                </p>

                {/* קבלות המוביל */}
                {(d.daemon.history ?? []).length > 0 ? (
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="p-2 text-right font-medium">פעולה</th>
                          <th className="p-2 text-right font-medium">סיבה</th>
                          <th className="p-2 text-right font-medium">בוטלו / הוצבו</th>
                          <th className="p-2 text-right font-medium">אימות שרשרת</th>
                          <th className="p-2 text-right font-medium">מתי</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.daemon.history.slice(0, 5).map((r) => (
                          <tr key={r.at} className="border-t">
                            <td className="p-2 font-medium">{r.kind === "FUEL-IN" ? "פריסת דלק" : "גרירת סולם"}</td>
                            <td className="max-w-56 truncate p-2 text-muted-foreground" title={r.reason}>{r.reason}</td>
                            <td className="p-2 font-mono tabular-nums">{r.cancelled.length} / {r.placed.length}</td>
                            <td className="p-2">
                              {r.verify ? (
                                <span className="text-emerald-600 dark:text-emerald-400">{r.verify.ordersNow} פקודות · {r.verify.deployedNow} STEEM</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap p-2 text-muted-foreground">{fmtTimeAgo(r.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    המוביל טרם פעל בסשן הזה —{" "}
                    {d.valueFloor?.state === "HELD"
                      ? "הרצפה מוחזקת (נמדד)."
                      : d.valueFloor?.state === "DRIFT"
                        ? "דריפה נמדדת."
                        : "טרם נמדד."}{" "}
                    קבלות יופיעו כאן בכל פעולה עתידית.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  הערת-אמת: קבלות מוקדמות (לפני תיקון האימות) עשויות להראות ״הוצבו 0״ גם כשהשרשרת קיבלה את הפקודות —
                  אישורי-השידור התעכבו מעבר לתקרה והמונה לא נספר. השופט הוא השרשרת: טבלת הסולם למעלה נקראת
                  ממנה חסר-מפתחות בכל מחזור. מעתה כל קבלה נושאת שדה אימות חי. מ-R87 ואילך: פקודה שאישור-השידור
                  שלה התעכב מאומתת בסקר-שרשרת לפי מזהה-הפקודה עצמו — ״הוצבו״ משקף את מה שפתוח שם באמת
                  (‎confirmedBy: chain-read‎).
                </p>
              </CardContent>
            </MotionCard>
          </Section>

          <>
              {/* הסולם החי */}
              <Section
                icon={<TrendingUp />}
                title="הסולם החי — הפקודות שלנו מול הקו"
                description="שלוש רמות על קו הפאריטה: השוק משלם ערך-חוץ או שהכסף נשאר שלנו — אין מכירה מתחת לקו, נקודה"
              >
                <MotionCard>
                  <CardContent className="p-0 sm:p-0">
                    <div className="max-h-96 overflow-y-auto [scrollbar-width:thin]">
                      <table className="w-full text-xs sm:text-sm">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                          <tr>
                            <th className="p-2 text-right font-medium">רמה</th>
                            <th className="p-2 text-right font-medium">מקור</th>
                            <th className="p-2 text-right font-medium">מוכר (STEEM)</th>
                            <th className="p-2 text-right font-medium">מקבל (SBD)</th>
                            <th className="p-2 text-right font-medium">מחיר</th>
                            <th className="p-2 text-right font-medium">מול הקו</th>
                            <th className="hidden p-2 text-right font-medium sm:table-cell">אם ימלא</th>
                            <th className="hidden p-2 text-right font-medium md:table-cell">פותחה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...d.orders]
                            .sort((a, b) => a.price - b.price)
                            .map((o, i) => {
                              const b = bpsBadge(o.vsParityBps);
                              return (
                                <tr key={o.orderid} className="border-t">
                                  <td className="p-2 font-mono">#{i + 1}</td>
                                  <td className="p-2">
                                    {o.origin === "grid" ? (
                                      <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" title="פקודת מנוע-הגריד — orderid בטווח השמור; המוביל לא נוגע בה (חוק r190)">
                                        גריד
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">מוביל</span>
                                    )}
                                  </td>
                                  <td className="p-2 font-mono tabular-nums">{o.amount.toFixed(3)}</td>
                                  <td className="p-2 font-mono tabular-nums">{o.receive.toFixed(3)}</td>
                                  <td className="p-2 font-mono tabular-nums">{o.price.toFixed(6)}</td>
                                  <td className="p-2">
                                    <Badge variant="outline" className={cn(
                                      b.tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                      b.tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                                      b.tone === "bad" && "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
                                    )}>
                                      {b.label}
                                    </Badge>
                                  </td>
                                  <td className="hidden p-2 font-mono tabular-nums text-muted-foreground sm:table-cell">
                                    {o.sbdIfFilled.toFixed(3)} SBD {o.usdIfFilled != null ? `(${usd(o.usdIfFilled)})` : ""}
                                  </td>
                                  <td className="hidden whitespace-nowrap p-2 text-muted-foreground md:table-cell">{fmtTimeAgo(o.created + "Z")}</td>
                                </tr>
                              );
                            })}
                          {d.orders.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="p-6 text-center text-muted-foreground">
                                אין פקודות פתוחות — המוביל יפרוס את הדלק במחזור הקרוב (טריגר T4)
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </MotionCard>

                {/* סולם הקנייה שלנו — R127 */}
                <Section
                  icon={<TrendingUp />}
                  title="סולם הקנייה שלנו — לוקחים את הפער מתחת לקו"
                  description="שלוש רמות מתחת לפאריטה: כל קנייה מתחת לקו היא עודף נמדד — הגריד דו-צדדי (חוק R127: אין רעבת-צד)"
                >
                  <MotionCard>
                    <CardContent className="p-0 sm:p-0">
                      <div className="max-h-96 overflow-y-auto [scrollbar-width:thin]">
                        <table className="w-full text-xs sm:text-sm">
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                            <tr>
                              <th className="p-2 text-right font-medium">רמה</th>
                              <th className="p-2 text-right font-medium">מקור</th>
                              <th className="p-2 text-right font-medium">מוכר (SBD)</th>
                              <th className="p-2 text-right font-medium">מקבל (STEEM)</th>
                              <th className="p-2 text-right font-medium">מחיר</th>
                              <th className="p-2 text-right font-medium">מול הקו</th>
                              <th className="hidden p-2 text-right font-medium sm:table-cell">אם ימלא</th>
                              <th className="hidden p-2 text-right font-medium md:table-cell">פותחה</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...(d.ourBids ?? [])]
                              .sort((a, b) => b.price - a.price)
                              .map((o, i) => {
                                const bps = o.vsParityBps;
                                return (
                                  <tr key={o.orderid} className="border-t">
                                    <td className="p-2 font-mono">#{i + 1}</td>
                                    <td className="p-2">
                                      {o.origin === "grid" ? (
                                        <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" title="פקודת מנוע-הגריד — orderid בטווח השמור; המוביל לא נוגע בה (חוק r190)">
                                          גריד
                                        </Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">מוביל</span>
                                      )}
                                    </td>
                                    <td className="p-2 font-mono tabular-nums">{o.sbd.toFixed(3)}</td>
                                    <td className="p-2 font-mono tabular-nums">{o.steem.toFixed(3)}</td>
                                    <td className="p-2 font-mono tabular-nums">{o.price.toFixed(6)}</td>
                                    <td className="p-2">
                                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                        {bps != null ? `${bps > 0 ? "+" : ""}${bps}bps מתחת לקו` : "—"}
                                      </Badge>
                                    </td>
                                    <td className="hidden p-2 font-mono tabular-nums text-muted-foreground sm:table-cell">
                                      {o.steem.toFixed(3)} STEEM {o.usdIfFilled != null ? `(${usd(o.usdIfFilled)})` : ""}
                                    </td>
                                    <td className="hidden whitespace-nowrap p-2 text-muted-foreground md:table-cell">{fmtTimeAgo(o.created + "Z")}</td>
                                  </tr>
                                );
                              })}
                            {(d.ourBids ?? []).length === 0 ? (
                              <tr>
                                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                                  אין בידים פתוחים — יוצבו כשה-SBD יגיע לקו החימוש (0.15) במילוי המכירה הבא
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </MotionCard>
                </Section>

                {/* שוק חי + סולם רצוי */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <MotionCard>
                    <CardContent className="space-y-3 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4" /> ספר הפקודות הפנימי (חי)</p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="mb-1 text-muted-foreground">בידים (קונים STEEM)</p>
                          <div className="space-y-1">
                            {d.book.bids.slice(0, 5).map((b, i) => {
                              const gap = d.marks.parity != null ? Math.round((b.price / d.marks.parity - 1) * 10_000) : null;
                              return (
                                <div key={i} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 font-mono tabular-nums">
                                  <span>{b.price.toFixed(6)}</span>
                                  <span className="text-muted-foreground">{b.steem.toFixed(1)} STEEM</span>
                                  {gap != null ? (
                                    <span className={cn("text-[10px]", gap >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                      {gap >= 0 ? `+${gap}` : gap}bps
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground">אסקים (מוכרים STEEM)</p>
                          <div className="space-y-1">
                            {d.book.asks.slice(0, 5).map((a, i) => {
                              const gap = d.marks.parity != null ? Math.round((a.price / d.marks.parity - 1) * 10_000) : null;
                              return (
                                <div key={i} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 font-mono tabular-nums">
                                  <span>{a.price.toFixed(6)}</span>
                                  <span className="text-muted-foreground">{a.steem.toFixed(1)} STEEM</span>
                                  {gap != null ? (
                                    <span className={cn("text-[10px]", gap >= 0 ? "text-muted-foreground" : "text-rose-600 dark:text-rose-400")}>
                                      {gap >= 0 ? `+${gap}` : gap}bps
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        הבידים בירוק = מעל קו הפאריטה — כאלה ממלאים את הסולם מיד. הביד החי רחוק
                        {d.marks.parity != null && d.book.bestBid != null
                          ? ` ${Math.round((d.marks.parity / d.book.bestBid - 1) * 10_000)}bps`
                          : " —"}{" "}
                        מהקו: השוק חייב לשלם ערך-חוץ כדי לגעת בכסף.
                      </p>
                    </CardContent>
                  </MotionCard>

                  <MotionCard>
                    <CardContent className="space-y-3 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold"><Crosshair className="size-4" /> הסולם הרצוי (עכשיו)</p>
                      <div className="space-y-2">
                        {d.ladder.map((l) => (
                          <div key={l.level} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                            <span className="text-sm font-medium">רמה {l.level}</span>
                            <Badge variant="outline" className="font-mono">
                              {l.premiumBps === 0 ? "על הקו" : `+${l.premiumBps / 100}%`}
                            </Badge>
                            <span className="font-mono text-sm tabular-nums">{f4(l.price)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
                        <p className="flex items-center gap-1.5 font-medium text-foreground"><Fuel className="size-3.5" /> נחיתת דלק הבאה</p>
                        <p className="mt-1">
                          {d.powerdown.active
                            ? `${d.powerdown.weeklySteem?.toFixed(1) ?? "?"} STEEM ב־${d.powerdown.nextPayment?.slice(0, 16).replace("T", " ")}Z · נותרו ${d.powerdown.paymentsLeft} תשלומים (${d.powerdown.totalRemainingSteem?.toFixed(0)} STEEM)`
                            : "אין פאוורדאון פעיל"}
                          {" — "}
                          המוביל פורש אותה בסולם בתוך מחזור אחד מהנחיתה (חוק 4).
                        </p>
                      </div>
                    </CardContent>
                  </MotionCard>
                </div>
              </Section>
            </>

          {/* ציד הזדמנויות */}
          <Section
            icon={<Radar />}
            title="ציד הזדמנויות — מה המערכת מחפשת עכשיו"
            description="לא המתנה סבילה: כל הזדמנות נמדדת בכל מחזור, וכשהיא נפתחת — הפעולה מיידית"
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {d.opportunities.map((o) => {
                  const b = oppBadge(o.state);
                  return (
                    <MotionCard key={o.id}>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold leading-tight">{o.title}</p>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", b.className)}>{b.label}</span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">{o.detail}</p>
                        {o.number ? <p className="font-mono text-sm font-semibold tabular-nums">{o.number}</p> : null}
                      </CardContent>
                    </MotionCard>
                  );
                })}
              </div>
            </Section>

          {/* הדיבון — מי מחליט מתי */}
          <Section
            icon={<Activity />}
            title="הדיבון — מי מחליט מתי"
            description="המוביל (פורט 3034) מחליט מתי; העורק (/api/money) מחליט איך; המפתח לא נמצא באף אחד מהם"
            >
              <div className="grid gap-4 lg:grid-cols-3">
                <MotionCard className="lg:col-span-2">
                  <CardContent className="space-y-3 p-4 sm:p-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="relative flex size-3">
                        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", d.daemon.alive ? "animate-ping bg-emerald-500" : "bg-muted-foreground/40")} />
                        <span className={cn("relative inline-flex size-3 rounded-full", d.daemon.alive ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                      </span>
                      <p className="text-sm font-semibold">{d.daemon.alive ? "הדיבון חי ופועל" : d.daemon.fetchedVia === "file" ? "הדיבון לא עונה ב-HTTP — מצב מהקובץ" : "הדיבון מושבת בסשן זה"}</p>
                      {d.daemon.beats != null ? <Badge variant="outline" className="font-mono">{d.daemon.beats} פעימות</Badge> : null}
                      {d.daemon.actionsToday != null ? <Badge variant="outline" className="font-mono">פעולות היום: {d.daemon.actionsToday}/12</Badge> : null}
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="text-[11px] text-muted-foreground">ההחלטה האחרונה</p>
                      <p className="mt-1 font-mono text-sm">
                        <span className="font-semibold">{d.daemon.lastDecision?.kind ?? "—"}</span>
                        <span className="text-muted-foreground"> · {fmtTimeAgo(d.daemon.lastDecision?.at)}</span>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{d.daemon.lastDecision?.detail ?? "—"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div className="rounded border p-2">
                        <p className="text-muted-foreground">פעולה אחרונה</p>
                        <p className="font-mono">{fmtTimeAgo(d.daemon.lastActionAt)}</p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-muted-foreground">זכאות באה</p>
                        <p className="font-mono">{fmtTimeAgo(d.daemon.nextEligibleAt)}</p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-muted-foreground">טריגרים</p>
                        <p className="font-mono">{"פאריטה >50bps · רצפה · דלק >1"}</p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-muted-foreground">קירור</p>
                        <p className="font-mono">30 דקות בין פעולות</p>
                      </div>
                    </div>
                  </CardContent>
                </MotionCard>

                <MotionCard>
                  <CardContent className="space-y-3 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold"><Repeat className="size-4" /> שער הפדיון (TRON)</p>
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                      <p className="font-mono">תיבת-פדיון: {d.redemption.outboxTrx != null ? `${d.redemption.outboxTrx.toFixed(6)} TRX` : "—"}</p>
                      <p className="font-mono">משמרת: {d.redemption.custodyTrx != null ? `${d.redemption.custodyTrx.toFixed(6)} TRX` : "—"}</p>
                      <p className="font-mono">סף שידור: {d.redemption.sendThresholdTrx} TRX</p>
                      <p className="mt-2 text-muted-foreground">{d.redemption.detail}</p>
                    </div>
                    <StatusBadge
                      status={d.redemption.verdict === "GO" ? "ok" : "warn"}
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      כשהשער ייפתח — הכול זורם: המשמרת מגבהת, התיבה משדרת, והמוביל ממשיך לצוד. ההזדמנויות האלה נפתחות ממילויים אמיתיים, לא ממכירות מתחת לערך.
                    </p>
                  </CardContent>
                </MotionCard>
              </div>
            </Section>

          {/* מילויים — מה שהשוק שילם */}
          <Section
            icon={<ArrowUpRight />}
            title="מילויים — מה שהשוק שילם"
            description="מההיסטוריה החיה של החשבון (fill_order) — כל מילוי עם מחיר נמדד"
            >
              <MotionCard>
                <CardContent className="p-0 sm:p-0">
                  <div className="max-h-72 overflow-y-auto [scrollbar-width:thin]">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                        <tr>
                          <th className="p-2 text-right font-medium">כיוון</th>
                          <th className="p-2 text-right font-medium">שולם</th>
                          <th className="p-2 text-right font-medium">התקבל</th>
                          <th className="p-2 text-right font-medium">מחיר</th>
                          <th className="p-2 text-right font-medium">מתי</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.fills.map((f, i) => (
                          <tr key={`${f.at}-${i}`} className="border-t">
                            <td className="p-2">
                              {f.side === "sold-steem" ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><ArrowUpRight className="size-3.5" /> מכר STEEM</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><ArrowDownLeft className="size-3.5" /> קנה STEEM</span>
                              )}
                            </td>
                            <td className="p-2 font-mono tabular-nums">{f.paid}</td>
                            <td className="p-2 font-mono tabular-nums">{f.received}</td>
                            <td className="p-2 font-mono tabular-nums">{f.price != null ? f.price.toFixed(6) : "—"}</td>
                            <td className="whitespace-nowrap p-2 text-muted-foreground">{fmtTimeAgo(f.at)}</td>
                          </tr>
                        ))}
                        {d.fills.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-muted-foreground">אין מילויים אחרונים — הסולם ממתין בקו עד שהשוק ישלם ערך-חוץ</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </MotionCard>
            </Section>

          {/* דוקטרינה */}
          <Section
            icon={<ShieldCheck />}
            title="חוקי המוביל"
            description="hard-coded — לא המלצות"
          >
            <div className="grid gap-3 md:grid-cols-2">
              {d.doctrine.map((t, i) => (
                <FadeIn key={i} delay={i * 0.04}>
                  <div className="flex h-full items-start gap-3 rounded-lg border bg-muted/30 p-3">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-xs leading-relaxed">{t}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              מקורות חיים: {Object.entries(d.marks.sources).map(([k, v]) => `${k}=${v}`).join(" · ") || "—"} · מטמון {d.cacheAgeSec}s
            </p>
          </Section>
        </>
      ) : null}
    </div>
  );
}
