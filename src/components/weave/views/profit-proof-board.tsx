"use client";

// ─────────────────────────────────────────────────────────────────────
// PROFIT-PROOF BOARD · לוח-הוכחת-רווח (r191-1-d).
//
// התשובה החיה להוראת המפעיל: "עוד לא הרווחנו דולר... בוא תראה איך את
// מוכיח את עצמך" — ולכן הלוח הזה מציג רק מספרים שנגזרו מנתון-אמת:
//   · דוח-ההכנסה של מנוע-הגריד (state.json v1.2.0-r191 + זנב הספר)
//   · מדידת-הקיורציה של 04/10 מהשרשרת עצמה (חסר-מפתחות)
//   · הצהרת-מימון: אין בקשות מימון — המערכת מממנת את עצמה
//
// חוקי-הלוח: null מוצג כ"אין נתונים" (לעולם לא 0) · 0 מדידה הוא 0 ·
// כל מספר עם תווית עברית · סקלטונים בטעינה · שגיאה כנה בכישלון.
// נטען מ-/api/money/pnl — אותו SWR של מדידת-האמת (רענון-דקתי בלקוח).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Coins,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ErrorBox, scrollBoxClass } from "@/components/weave/shared";

// ── מראה ה-API (מקומי בכוונה — חוזה הלקוח, לא השרת) ──────────────────

interface LedgerFillRow {
  at: string | null;
  side: string | null;
  price: number | null;
  amount: number | null;
  total: number | null;
}

interface IncomeStatement {
  at: string;
  marketMaking: {
    present: boolean;
    reason: string | null;
    stateFileMtimeMs: number | null;
    realizedPnlSbd: number | null;
    dailyPnlSbd: number | null;
    unrealizedPnlSbd: number | null;
    basisBlendedSbd: number | null;
    lotsCount: number | null;
    fills24h: number | null;
    volume24hSteem: number | null;
    volume24hSbd: number | null;
    engineVersion: string | null;
    engineMode: string | null;
    lastTick: string | null;
    ledgerFills: LedgerFillRow[];
    ledgerReason: string | null;
  };
  curation: {
    ok: boolean;
    reason: string | null;
    account: string;
    pending: { hive: number | null; hbd: number | null; vests: number | null };
    lifetimeVests: number | null;
    last7d: {
      windowDays: number;
      ops: number | null;
      vests: number | null;
      steem: number | null;
      usd: number | null;
      vestsPerSteem: number | null;
      partial: boolean;
      walkedEntries: number;
      scannedFromIdx: number | null;
      scannedToIdx: number | null;
      lastOpAt: string | null;
      note: string | null;
    };
  };
  declaration: { fundingRequests: string; selfFunded: boolean };
}

interface PnlPayload {
  at?: string;
  ok?: boolean;
  stats?: {
    fillsTotal?: number;
    roundTrips?: number;
    capturedSbd?: number;
    openLongSteem?: number;
  };
  cached?: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
  incomeStatement?: IncomeStatement;
}

// ── עזרי-תצוגה ───────────────────────────────────────────────────────

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק׳`;
  return `לפני ${Math.round(min / 60)} שע׳`;
}

function f3(x: number | null | undefined): string {
  return x == null ? "—" : x.toFixed(3);
}

function f4(x: number | null | undefined): string {
  return x == null ? "—" : x.toFixed(4);
}

function f6(x: number | null | undefined): string {
  return x == null ? "—" : x.toFixed(6);
}

/** מספר עם סימן — מדידה אמיתית כולל 0; null לא מגיע לכאן */
function signed(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
}

/** צבע מדידה: רווח ירוק, הפסד אדום — בלי לשקר על 0 (ניטרלי) */
function pnlTone(x: number | null): string {
  if (x == null) return "";
  if (x > 0) return "text-emerald-700 dark:text-emerald-400";
  if (x < 0) return "text-red-700 dark:text-red-400";
  return "";
}

const NO_DATA = <span className="text-xs text-muted-foreground">אין נתונים</span>;

// ── תא-כותרת (מספר ראשי) ─────────────────────────────────────────────

function HeadCell({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-center">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums sm:text-base">{children}</div>
      {sub ? <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

// ── הלוח ─────────────────────────────────────────────────────────────

export function ProfitProofBoard() {
  const [data, setData] = useState<PnlPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const j = await fetch("/api/money/pnl", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((e) => {
          throw e instanceof Error ? e : new Error(String(e));
        });
      if (alive.current) {
        setData(j as PnlPayload);
        setErr(null);
      }
    } catch (e) {
      if (alive.current) setErr(String((e as Error)?.message ?? e).slice(0, 120));
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

  const inc = data?.incomeStatement;
  const mm = inc?.marketMaking;
  const cur = inc?.curation;
  const stats = data?.stats;

  const mode = mm?.engineMode ?? null;
  const modeBadge =
    mode === "live"
      ? { label: "LIVE — שידור-חי", cls: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }
      : mode === "dry"
        ? { label: "DRY — אפס-שידור", cls: "border border-zinc-500/30 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" }
        : { label: "לא-חי", cls: "bg-muted text-muted-foreground" };

  const pendingAllNull = cur ? cur.pending.hive == null && cur.pending.hbd == null && cur.pending.vests == null : true;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8" data-testid="profit-proof-board">
      <section aria-label="לוח-הוכחת-רווח" className="rounded-xl border bg-card p-4 sm:p-6">
        {/* כותרת + מצב-מנוע + רענון */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            לוח-הוכחת-רווח
            <span className="text-[11px] font-normal text-muted-foreground">— הוכחה במספרים, לא בהבטחות</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", modeBadge.cls)}>{modeBadge.label}</span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              aria-label="רענון לוח-ההוכחה"
            >
              {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
              רענון
            </button>
          </div>
        </div>

        {/* שגיאה כנה */}
        {err ? (
          <div className="mt-3">
            <ErrorBox message={`מדידת-הרווח לא נטענה: ${err}`} onRetry={() => void load()} retrying={busy} />
          </div>
        ) : null}

        {/* סקלטונים בטעינה-ראשונה */}
        {!data && !err ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : null}

        {data && !inc ? (
          <p className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            אין נתונים — דוח-ההכנסה לא חזר מהשרת. לא מומצא תחליף.
          </p>
        ) : null}

        {mm ? (
          <>
            {/* המספרים הראשיים */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <HeadCell
                label="PnL ממומש"
                sub={
                  <>
                    סבבי-FIFO שנסגרו · SBD
                    {mm.dailyPnlSbd != null ? (
                      <span dir="ltr" className={cn("font-mono", pnlTone(mm.dailyPnlSbd))}>
                        {" "}· 24ש׳: {signed(mm.dailyPnlSbd)}
                      </span>
                    ) : null}
                  </>
                }
              >
                {mm.realizedPnlSbd != null ? (
                  <span className={pnlTone(mm.realizedPnlSbd)}>{signed(mm.realizedPnlSbd)}</span>
                ) : (
                  NO_DATA
                )}
              </HeadCell>
              <HeadCell label="PnL צפוי — שלא מומש" sub="עמדה פתוחה, לא רווח · SBD">
                {mm.unrealizedPnlSbd != null ? (
                  <span className={pnlTone(mm.unrealizedPnlSbd)}>{signed(mm.unrealizedPnlSbd)}</span>
                ) : (
                  NO_DATA
                )}
              </HeadCell>
              <HeadCell label="מילויים-24ש׳" sub="המנוע סופר מהשרשרת">
                {mm.fills24h != null ? mm.fills24h : NO_DATA}
              </HeadCell>
              <HeadCell label="ווליום-24ש׳" sub={`${f3(mm.volume24hSteem)} STEEM`}>
                {mm.volume24hSbd != null ? (
                  <>
                    {f3(mm.volume24hSbd)} <span className="text-[10px] font-normal">SBD</span>
                  </>
                ) : (
                  NO_DATA
                )}
              </HeadCell>
              <HeadCell label="בסיס-עלות ממוצע" sub="SBD ל-STEEM · משוקלע">
                {mm.basisBlendedSbd != null ? f6(mm.basisBlendedSbd) : <span className="text-xs text-muted-foreground">—</span>}
              </HeadCell>
              <HeadCell
                label="מצב-מנוע"
                sub={
                  <>
                    {mm.engineVersion ?? "—"} · פעימה {ago(mm.lastTick)}
                  </>
                }
              >
                <span className="inline-flex items-center gap-1 text-[11px]">
                  {mode === "live" ? <TrendingUp className="size-3.5" aria-hidden /> : mode === "dry" ? <Gauge className="size-3.5" aria-hidden /> : null}
                  {modeBadge.label}
                </span>
              </HeadCell>
            </div>

            {/* סיבה כנה כשמצב-המנוע לא נקרא */}
            {!mm.present && mm.reason ? (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                מצב-המנוע לא נקרא ({mm.reason}) — השדות מוצגים כ"אין נתונים" ולא כאפס.
              </p>
            ) : null}

            {/* קיורציה 04/10 — המדידה של היום */}
            <div className="mt-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Coins className="size-3.5 text-muted-foreground" aria-hidden />
                  קיורציה 04/10 — המדידה של היום
                  <span className="text-[11px] font-normal text-muted-foreground">· נמדד מהשרשרת, חסר-מפתחות</span>
                </p>
                {cur?.last7d.partial ? (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                    סריקה חלקית — ממשיכה ברקע
                  </Badge>
                ) : null}
              </div>

              {cur?.ok ? (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">זכאי-לתביעה עכשיו (pending)</p>
                    {pendingAllNull ? (
                      <p className="mt-1 text-xs text-muted-foreground">אין נתונים — השרשרת לא הציגה יתרות-ממתינות</p>
                    ) : (
                      <p className="mt-1 font-mono text-sm font-semibold tabular-nums" dir="ltr">
                        {f3(cur.pending.hive)} HIVE · {f3(cur.pending.hbd)} HBD · {f6(cur.pending.vests)} VESTS
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">יתרות-reward שטרם נתבעו — נמדדו עכשיו</p>
                  </div>
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">
                      נמדד ב-{cur.last7d.windowDays} ימים האחרונים
                    </p>
                    {cur.last7d.vests != null && cur.last7d.ops != null ? (
                      <p className="mt-1 font-mono text-sm font-semibold tabular-nums" dir="ltr">
                        {f6(cur.last7d.vests)} VESTS
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">אין נתונים</p>
                    )}
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground" dir="rtl">
                      {cur.last7d.ops != null
                        ? `${cur.last7d.ops} פריעות-קיורציה · ≈${f6(cur.last7d.steem)} STEEM`
                        : "—"}
                      {cur.last7d.usd != null ? ` · ≈ $${f4(cur.last7d.usd)}` : ""}
                    </p>
                    {cur.last7d.note ? (
                      <p className="mt-1 text-[10px] text-muted-foreground">{cur.last7d.note}</p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">קיורציה לכל-החיים</p>
                    {cur.lifetimeVests != null ? (
                      <p className="mt-1 font-mono text-sm font-semibold tabular-nums" dir="ltr">
                        {f6(cur.lifetimeVests)} VESTS
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">אין נתונים</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">שדה curation_rewards של החשבון {cur.account}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 rounded-lg border bg-background/60 p-2.5 text-xs text-muted-foreground">
                  אין נתונים — {cur?.reason ?? "השרשרת לא ענתה"}
                </p>
              )}
            </div>

            {/* 5 המילויים האחרונים מספר-המנוע */}
            <div className="mt-4">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Layers className="size-3.5" aria-hidden /> 5 המילויים האחרונים — ספר-המנוע (ledger.jsonl)
              </p>
              {mm.ledgerFills.length > 0 ? (
                <div className={cn(scrollBoxClass, "border")}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr>
                        <th className="p-2 text-right font-medium">מתי</th>
                        <th className="p-2 text-right font-medium">צד</th>
                        <th className="hidden p-2 text-right font-medium sm:table-cell">מחיר</th>
                        <th className="p-2 text-right font-medium">גודל</th>
                        <th className="hidden p-2 text-right font-medium sm:table-cell">סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mm.ledgerFills.map((row, i) => (
                        <tr key={`${row.at ?? "?"}-${i}`} className="border-t">
                          <td className="whitespace-nowrap p-2 text-muted-foreground">{ago(row.at)}</td>
                          <td className="p-2">
                            {row.side === "buy" ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <TrendingDown className="size-3" aria-hidden /> קנייה
                              </span>
                            ) : row.side === "sell" ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                <TrendingUp className="size-3" aria-hidden /> מכירה
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{row.side ?? "—"}</span>
                            )}
                          </td>
                          <td className="hidden p-2 font-mono tabular-nums sm:table-cell">{f6(row.price)}</td>
                          <td className="p-2 font-mono tabular-nums">{f3(row.amount)}</td>
                          <td className="hidden p-2 font-mono tabular-nums sm:table-cell">{f3(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
                  אין מילויים רשומים — {mm.ledgerReason ?? "הספר ריק"}
                </p>
              )}
            </div>

            {/* הצלבת-אמת: מסריקת-השרשרת העצמאית */}
            {stats ? (
              <p className="mt-3 rounded-lg border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                הצלבת-אמת מסריקת-השרשרת העצמאית (FIFO על fill_order):{" "}
                {stats.capturedSbd != null ? (
                  <span className={cn("font-mono font-semibold", pnlTone(stats.capturedSbd))}>{signed(stats.capturedSbd)} SBD</span>
                ) : (
                  "אין נתונים"
                )}{" "}
                מ-{stats.roundTrips ?? "—"} סבבים · {stats.fillsTotal ?? "—"} מילויים-אי-פעם · מלאי פתוח {f3(stats.openLongSteem)} STEEM
                {" · "}
                אם המנוע והסריקה חלוקים — הסריקה היא השופט (הספר של המנוע אבד עם הנפילה הקודמת, מתועד).
              </p>
            ) : null}
          </>
        ) : null}

        {/* פס-ההצהרה — דגלי-אמת סטטיים */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            אין בקשות מימון — המערכת מממנת את עצמה
          </p>
          <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
            fundingRequests: &quot;none&quot; · selfFunded: true
          </span>
        </div>

        {/* שורת-טריות */}
        {data ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            נמדד {ago(data.at)} · מטמון השרת: {data.cached ? (data.stale ? `עותק-בשל (${data.cacheAgeSec}s, רענון-רקע)` : `טרי (${data.cacheAgeSec}s)`) : "חישוב-חי"}
            {mm?.stateFileMtimeMs != null ? ` · state.json נכתב ${ago(new Date(mm.stateFileMtimeMs).toISOString())}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}
