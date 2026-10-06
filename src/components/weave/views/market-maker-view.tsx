"use client";

// ─────────────────────────────────────────────────────────────────────
// MARKET-MAKER VIEW (Task 2-b) — לוח-מנוע-הגריד: SBD:STEEM דו-צדדי.
//
// אח של RailsStrip (r188): קומפוננטה-פס עצמאית שמחוברת בתוך לוח-המוביל.
// הנתונים מהדיבון החי (פורט 3049) דרך /api/market-maker — אפס-סודות,
// רק מצב, מחירים ופסקי-דין. כנות: דיבון-לא-חי מוצג כנה כ"לא-חי".
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Ban, Grid3x3, RefreshCw, Skull } from "lucide-react";

interface MMOrder {
  orderid: number;
  side: "buy" | "sell";
  level: number;
  price: number;
  amount: number;
  total: number;
  placedAt: string;
  expiration: string;
  centerAtPlace: number;
  txid: string | null;
  dry: boolean;
}

interface MMStatus {
  ok?: boolean;
  service?: string;
  port?: number;
  status?: "offline";
  reason?: string;
  state?: {
    mode: "dry" | "live";
    lastTick: string | null;
    ticks: number;
    centerPrice: number | null;
    spreadBps: number | null;
    openOrders: MMOrder[];
    fills24h: number;
    volume24hSteem: number;
    volume24hSbd: number;
    realizedPnlSbd: number;
    dailyPnlSbd: number;
    fillsSeen: number;
    internalFills: number;
    halted: boolean;
    haltedAt: string | null;
    killSwitch: boolean;
    lastError: string | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    coordination: { moverActing: boolean; ourOrders: number; moverOrders: number };
    balances: { steemFree: number; sbdFree: number; measuredAt: string | null };
    fleetChurn: { effective: boolean; verified: boolean; reason: string; soldiersChecked: number };
  };
  config?: {
    rails?: {
      steem?: { pair?: string; gridLevels?: number; spreadBps?: number; levelSpacingBps?: number; orderCap?: number; minOrder?: number; budgetPct?: number; refreshHours?: number };
      hive?: { enabled?: boolean; reason?: string };
    };
    dailyLossCapSbd?: number;
    tickSec?: number;
  };
  now?: string;
}

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 1 ? "עכשיו" : min < 60 ? `לפני ${min} דק׳` : `לפני ${Math.round(min / 60)} שע׳`;
}

function modeBadge(s: MMStatus): { label: string; cls: string } {
  const st = s.state;
  if (!st) return { label: "לא-חי", cls: "bg-muted text-muted-foreground" };
  if (st.halted) return { label: "עצור-עצמית (HALTED)", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30" };
  if (st.mode === "live") return { label: "LIVE — שידור-חי", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30" };
  return { label: "DRY — חזרה-כנה, אפס-שידור", cls: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30" };
}

export function MarketMakerView() {
  const [data, setData] = useState<MMStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const j = (await fetch("/api/market-maker", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as MMStatus | null;
      if (alive.current) setData(j);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  const st = data?.state;
  const cfg = data?.config;
  const offline = !st || data?.status === "offline";
  const mb = modeBadge(data ?? {});
  const orders = st?.openOrders ?? [];
  const f3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));
  const f6 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(6));

  return (
    <section aria-label="מנוע-הגריד — SBD:STEEM דו-צדדי" className="rounded-xl border bg-card p-4">
      {/* כותרת + תגי-מצב */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Grid3x3 className="size-4 text-muted-foreground" aria-hidden />
          מנוע-הגריד — {cfg?.rails?.steem?.pair ?? "SBD:STEEM"} · {cfg?.rails?.steem?.gridLevels ?? 5}×2 רמות
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mb.cls}`}>{mb.label}</span>
          {st?.killSwitch ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
              <Skull className="size-3" aria-hidden /> מתג-הרג חמוש
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">בלי-מתג-הרג</span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${busy ? "animate-spin" : ""}`} aria-hidden />
            רענון
          </button>
        </div>
      </div>

      {offline ? (
        <p className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          הדיבון אינו חי עכשיו — כנות-מלאה: {data?.reason ?? "אין-תשובה"} · הפעלה: mini-services/market-maker (פורט 3049)
        </p>
      ) : (
        <>
          {/* מדדי-לב */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <div>
              <p className="text-[11px] text-muted-foreground">מרכז-הגריד</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{f6(st?.centerPrice)}</p>
              <p className="text-[10px] text-muted-foreground">SBD ל-STEEM</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">מרווח-ראש-הספר</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{st?.spreadBps != null ? `${st.spreadBps}bps` : "—"}</p>
              <p className="text-[10px] text-muted-foreground">פריסה {cfg?.rails?.steem?.levelSpacingBps ?? "—"}bps ברמה</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">פקודות-פתוחות</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{orders.length}</p>
              <p className="text-[10px] text-muted-foreground">השכן: {st?.coordination.moverOrders ?? 0} פקודות-מוביל</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">נפח-24ש׳</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{f3(st?.volume24hSbd)} SBD</p>
              <p className="text-[10px] text-muted-foreground">{f3(st?.volume24hSteem)} STEEM · {st?.fills24h ?? 0} מילויים</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">רווח-ממומש</p>
              <p className={`font-mono text-sm font-semibold tabular-nums ${(st?.realizedPnlSbd ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                {(st?.realizedPnlSbd ?? 0) >= 0 ? "+" : ""}{f3(st?.realizedPnlSbd)} SBD
              </p>
              <p className="text-[10px] text-muted-foreground">תקרת-אובדן-יומי {cfg?.dailyLossCapSbd ?? "—"} SBD</p>
            </div>
          </div>

          {st?.halted ? (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
              המנוע עצר את עצמו ({ago(st.haltedAt)}) — תקרת-האובדן-היומי נחצה. רק איפוס-תצורה (sovereign/market-maker/config.json) מחזיר אותו לעבוד.
            </p>
          ) : null}

          {/* הסולם הפתוח */}
          <p className="mt-4 mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Activity className="size-3.5" aria-hidden /> הסולם הפתוח — {st?.mode === "live" ? "חי על השרשרת" : "רישום-חזרה (dry) — לא על השרשרת"}
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg border [scrollbar-width:thin]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="p-2 text-right font-medium">צד</th>
                  <th className="p-2 text-right font-medium">רמה</th>
                  <th className="p-2 text-right font-medium">מחיר</th>
                  <th className="p-2 text-right font-medium">גודל (STEEM)</th>
                  <th className="p-2 text-right font-medium">שווה (SBD)</th>
                  <th className="p-2 text-right font-medium">bps מהמרכז</th>
                  <th className="p-2 text-right font-medium">הוצב</th>
                  <th className="p-2 text-right font-medium">פקיעה</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const vsCenter = o.centerAtPlace > 0 ? Math.round(((o.price - o.centerAtPlace) / o.centerAtPlace) * 10_000) : 0;
                  return (
                    <tr key={o.orderid} className="border-t">
                      <td className="p-2">
                        {o.side === "sell" ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><ArrowUpRight className="size-3.5" /> מכירה</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><ArrowDownLeft className="size-3.5" /> קנייה</span>
                        )}
                      </td>
                      <td className="p-2">L{o.level}</td>
                      <td className="p-2 font-mono tabular-nums">{o.price.toFixed(6)}</td>
                      <td className="p-2 font-mono tabular-nums">{o.amount.toFixed(3)}</td>
                      <td className="p-2 font-mono tabular-nums">{o.total.toFixed(3)}</td>
                      <td className="p-2 font-mono tabular-nums">{vsCenter > 0 ? "+" : ""}{vsCenter}</td>
                      <td className="whitespace-nowrap p-2 text-muted-foreground">{ago(o.placedAt)}</td>
                      <td className="whitespace-nowrap p-2 text-muted-foreground">{ago(o.expiration)}</td>
                    </tr>
                  );
                })}
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">אין פקודות פתוחות — הפעימה הבאה תפרוס סולם סביב המרכז החי</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* מילויים — רק מהספר של המנוע (ledger.jsonl נקרא כאן דרך המצב: אין-מילויים-חיים ב-dry) */}
          <p className="mt-4 mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Ban className="size-3.5" aria-hidden /> מילויים שנספרו מהשרשרת — {st?.fillsSeen ?? 0} סה״כ ({st?.internalFills ?? 0} פנימיים) · האחרונים רואים בפעימה
          </p>
          <p className="rounded-lg border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {st?.lastDecision ? (
              <>פסק-דין אחרון: <span className="font-semibold">{st.lastDecision.kind}</span> — {st.lastDecision.detail} ({ago(st.lastDecision.at)})</>
            ) : (
              "אין פסק-דין — המנוע טרם פעם"
            )}
            {st?.lastError ? <> · שגיאה-אחרונה (כנה): <span className="text-red-700 dark:text-red-400">{st.lastError}</span></> : null}
            {st?.fleetChurn ? <> · חיול-צי: {st.fleetChurn.effective ? "פעיל" : "כבוי"} ({st.fleetChurn.reason})</> : null}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            תקציב: {f3(st?.balances.sbdFree)} SBD חופשיים × {cfg?.rails?.steem?.budgetPct ?? "—"} (היתרה-החופשית כבר מנוכה פקודות-נעולות שלנו ושל המוביל — שני-הסוחרים לא נלחמים על אותם כספים) · פעימה {st?.ticks ?? 0} · {ago(st?.lastTick)} · רגל-HIVE: {cfg?.rails?.hive?.enabled ? "פעילה" : `כבויה (${cfg?.rails?.hive?.reason ?? "—"})`}
          </p>
        </>
      )}
    </section>
  );
}
