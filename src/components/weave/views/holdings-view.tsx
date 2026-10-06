"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Holdings View - איפה כל המטבעים.
//
// התשובה המלאה ל"איפה נמצאים כל מטבעות ה-SAOS הקיימים, אצל מי, איך":
//  · v0 (SAOS-NET) - 126,682 SAOS אצל המנפיק + 11 חיילים + LP + עטופים
//  · v1 (SAOS-LIVE) - הספר החי על Steem (ג'נזיס בהנחה אוטונומית)
//  · DEX - האוצר והארנה של הבורסה הריבונית
// כל מספר עם מקור מדידה. כלום לא מומצא.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Coins,
  Compass,
  Database,
  Landmark,
  Lock,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtDateTime, scrollBoxClass, truncateMiddle } from "../shared";

// ── טיפוסים ──────────────────────────────────────────────────────────

interface V0Account {
  name: string;
  saos: number;
  steem?: number;
  lp?: number;
  lockedSaos?: number;
  wrapped?: Array<{ symbol: string; qty?: number | string }>;
}

interface SaosnetResponse {
  ok: boolean;
  v0: {
    net?: {
      height?: number;
      stateRoot?: string;
      genesisHash?: string;
      issuer?: string;
      supply?: number;
      lastTime?: string;
      lastHeartbeat?: string;
      snapshotHeight?: number;
    } | null;
    economy?: {
      soldiers?: number;
      lpHolders?: number;
      lpSupply?: number;
      wrappedSymbols?: string[];
      accounts?: V0Account[];
    } | null;
    wallets?: {
      total?: number;
      agents?: number;
      last?: Array<{
        agent: string;
        evm?: string;
        tron?: string;
        sol?: string;
        btc?: string;
      }>;
    } | null;
    harvest?: { pot?: number; count?: number } | null;
    measuredBy?: string;
  } | null;
  live: {
    stateRoot?: string | null;
    updatedAt?: string | null;
    genesis?: { done?: boolean; attempted?: boolean; symbol?: string; initialMint?: string; maxSupply?: string } | null;
  } | null;
  dex: { ok: boolean; height?: number; version?: number; error?: string };
  servedAt: string;
}

// ── עזרי תצוגה ───────────────────────────────────────────────────────

function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
      <Search className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          {label}
        </span>
        <span className="truncate font-mono text-lg font-bold">{value}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

// ── התצוגה ────────────────────────────────────────────────────────────

export function HoldingsView() {
  const [data, setData] = useState<SaosnetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/saosnet", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as SaosnetResponse;
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const v0 = data?.v0 ?? null;
  const net = v0?.net ?? null;
  const eco = v0?.economy ?? null;
  const accounts = eco?.accounts ?? [];
  const soldiersTotal = accounts.reduce((s, a) => s + (a.saos ?? 0), 0);
  const issuerAcct = accounts.find((a) => a.name === net?.issuer);
  const armyWallets = v0?.wallets?.last ?? [];
  const live = data?.live ?? null;
  const dex = data?.dex;
  // r121 — גיל ה-pack בכנות: replay אמיתי על תמונה קפואה אינו "מצב נוכחי"
  // (אותו כלל-סף כמו ה-runner: pack מעל 24 שעות מתויג FROZEN-PACK)
  const packLastAdvanced = net?.lastTime ?? null;
  const packAgeHours =
    packLastAdvanced != null
      ? Math.floor((Date.now() - new Date(packLastAdvanced).getTime()) / 3_600_000)
      : null;
  const packFrozen = packAgeHours != null && packAgeHours > 24;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          >
            <Coins className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              איפה המטבעים - המפה המלאה
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              כל SAOS שקיים, אצל מי הוא נמצא, ומאיפה זה נמדד
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          רענן
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4 text-sm">
            טעינת המפה נכשלה: {error}
          </CardContent>
        </Card>
      )}

      {/* שלוש שכבות האמת */}
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {/* v0 */}
        <Card className="relative overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Landmark className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                SAOS-NET v0
              </h2>
              <Badge
                variant="outline"
                className={
                  packFrozen
                    ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                    : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                }
              >
                {packFrozen ? "מאומת מתמטית · חבילה קפואה" : "מאומת מתמטית"}
              </Badge>
            </div>
            {loading && !net ? (
              <Skeleton className="h-24 w-full" />
            ) : net ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">היצע כולל</dt>
                    <dd className="font-mono text-base font-bold">
                      {(net.supply ?? 0).toLocaleString("he-IL")} SAOS
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">מנפיק</dt>
                    <dd className="font-mono text-base font-bold">{net.issuer}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">גובה</dt>
                    <dd className="font-mono">
                      {(net.height ?? 0).toLocaleString("he-IL")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">פעימה אחרונה</dt>
                    <dd className="font-mono text-[11px]">
                      {fmtDateTime(net.lastTime ?? null)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">stateRoot</dt>
                    <dd className="font-mono text-[11px]" dir="ltr">
                      {truncateMiddle(net.stateRoot ?? "", 16, 10)}
                    </dd>
                  </div>
                </dl>
                <SourceNote>
                  נמדד ב-replay מתמטי מלא (38/38 בלוקים, שורש זהה להצהרת
                  הצומת) - {v0?.measuredBy ?? "scripts/saosnet-status.cjs"}.{" "}
                  {packFrozen && (
                    <>
                      חבילה קפואה — לא התקדמה מאז {packLastAdvanced?.slice(0, 10)} (עדכון
                      חד-פעמי, גיל{" "}
                      {packAgeHours != null ? packAgeHours.toLocaleString("he-IL") : "?"} שעות):
                      replay מושלם על תמונה קפואה אינו מצב נוכחי.
                    </>
                  )}
                </SourceNote>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                תמונת המצב לא נמצאה - יש להריץ את ה-replay.
              </p>
            )}
          </CardContent>
        </Card>

        {/* v1 */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <ArrowLeftRight className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                SAOS-LIVE v1
              </h2>
              <Badge
                variant="outline"
                className={
                  live?.genesis?.done
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                }
              >
                {live?.genesis?.done ? "ג'נזיס נחת" : "ג'נזיס בהנחה"}
              </Badge>
            </div>
            {loading && !live ? (
              <Skeleton className="h-24 w-full" />
            ) : live ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">הטבעה ראשונה</dt>
                    <dd className="font-mono text-base font-bold">
                      {Number(live.genesis?.initialMint ?? 0).toLocaleString("he-IL")}{" "}
                      SAOS
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">תקרת חוזה</dt>
                    <dd className="font-mono text-base font-bold">
                      {(Number(live.genesis?.maxSupply ?? 0) / 1000).toLocaleString(
                        "he-IL",
                        { maximumFractionDigits: 0 }
                      )}{" "}
                      M
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">עדכון אחרון</dt>
                    <dd className="font-mono text-[11px]">
                      {fmtDateTime(live.updatedAt ?? null)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">שורש אחרון</dt>
                    <dd className="font-mono text-[11px]" dir="ltr">
                      {truncateMiddle(live.stateRoot ?? "", 8, 6)}
                    </dd>
                  </div>
                </dl>
                <SourceNote>
                  הספר החי על שרשרת Steem הציבורית (saos.weave.live.v1) -
                  הלב מניח את הג'נזיס בשלבים כשתקציב ה-RC מתאושש,
                  אוטונומית ללא יד אדם. כל פעולה חתומה ומאומתת על ידי כל
                  דפדפן.
                </SourceNote>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* DEX */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Database className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                הבורסה הריבונית
              </h2>
              <Badge
                variant="outline"
                className={
                  dex?.ok
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                }
              >
                {dex?.ok ? "חיה" : "ממתינה"}
              </Badge>
            </div>
            {loading && !dex ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">גובה שרשרת</dt>
                    <dd className="font-mono text-base font-bold">
                      {dex?.ok ? dex.height : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">גרסת מצב</dt>
                    <dd className="font-mono text-base font-bold">
                      {dex?.ok ? dex.version : "-"}
                    </dd>
                  </div>
                </dl>
                <SourceNote>
                  שרשרת הדקס (saos-dex, ריפו פרטי): מראת ענן פועמת כל ~2 שעות (480 טיקים לפעימה), ספר
                  זמנות בערבות, AMM, ארנת חיילים אוטונומית. המטבעות של
                  הבורסה נרשמים בספר המקומי שלה{" "}
                  {dex?.ok ? "" : `(${dex?.error ?? "לא נמדד"})`}
                </SourceNote>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* טבלת החיילים */}
      <Card className="mb-8">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Users className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              מחזיקי SAOS - {eco?.soldiers ?? 0} חיילי רשת
            </h2>
            <div className="flex gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <Wallet className="size-3" aria-hidden="true" />
                בחשבונות: {soldiersTotal.toFixed(3)}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" aria-hidden="true" />
                נעול:{" "}
                {accounts
                  .reduce((s, a) => s + (a.lockedSaos ?? 0), 0)
                  .toFixed(3)}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ArrowLeftRight className="size-3" aria-hidden="true" />
                LP: {(eco?.lpSupply ?? 0).toFixed(3)}
              </Badge>
            </div>
          </div>

          {loading && accounts.length === 0 ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className={cn("overflow-x-auto", scrollBoxClass)}>
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0 bg-background/95 backdrop-blur">
                    <tr className="border-b text-start text-[11px] uppercase tracking-wide text-muted-foreground/70">
                      <th className="px-3 py-2 text-start font-medium">חשבון</th>
                      <th className="px-3 py-2 text-end font-medium">SAOS</th>
                      <th className="px-3 py-2 text-end font-medium">STEEM</th>
                      <th className="px-3 py-2 text-end font-medium">LP</th>
                      <th className="px-3 py-2 text-end font-medium">נעול</th>
                      <th className="px-3 py-2 text-start font-medium">עטופים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => {
                      const isIssuer = a.name === net?.issuer;
                      return (
                        <tr
                          key={a.name}
                          className={cn(
                            "border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40",
                            isIssuer && "bg-emerald-500/5"
                          )}
                        >
                          <td className="px-3 py-2 font-mono font-semibold">
                            {a.name}
                            {isIssuer && (
                              <Badge
                                variant="outline"
                                className="ms-2 h-5 border-emerald-500/40 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                              >
                                מנפיק
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-end font-mono tabular-nums">
                            {a.saos.toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                            {(a.steem ?? 0).toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                            {(a.lp ?? 0).toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                            {(a.lockedSaos ?? 0).toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {(a.wrapped ?? [])
                              .map((w) => `${w.symbol}`)
                              .join(" · ") || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td className="px-3 py-2">סהכ נמדד בחשבונות</td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {soldiersTotal.toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {accounts
                          .reduce((s, a) => s + (a.steem ?? 0), 0)
                          .toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {accounts
                          .reduce((s, a) => s + (a.lp ?? 0), 0)
                          .toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {accounts
                          .reduce((s, a) => s + (a.lockedSaos ?? 0), 0)
                          .toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {(eco?.wrappedSymbols ?? []).join(" · ") || "-"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <SourceNote>
                ההיצע הכולל ({(net?.supply ?? 0).toLocaleString("he-IL")} SAOS)
                נטבע למנפיק {net?.issuer} בג&apos;נזיס; היתרה מוחזקת בחשבון
                המנפיק ומופצת לחיילים לפי פעולות הרשת (מדוד מה-replay).
                הפער בין ההיצע לסהכ בחשבונות = יתרת המנפיק והנאמנויות.
              </SourceNote>
            </>
          )}
        </CardContent>
      </Card>

      {/* ארנקי הצבא + קציר */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Compass className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ארנקי הצבא - {v0?.wallets?.total ?? 0} זהויות רב-שרשרתיות
            </h2>
            <div className={cn("overflow-x-auto", scrollBoxClass)}>
              <table className="w-full min-w-[520px] text-xs">
                <thead className="sticky top-0 bg-background/95 backdrop-blur">
                  <tr className="border-b text-start text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    <th className="px-2 py-2 text-start font-medium">סוכן</th>
                    <th className="px-2 py-2 text-start font-medium">EVM</th>
                    <th className="px-2 py-2 text-start font-medium">TRON</th>
                    <th className="px-2 py-2 text-start font-medium">SOL</th>
                  </tr>
                </thead>
                <tbody>
                  {armyWallets.map((w) => (
                    <tr
                      key={w.agent}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-2 py-1.5 font-mono font-semibold">
                        {w.agent}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground" dir="ltr">
                        {truncateMiddle(w.evm ?? "", 8, 6)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground" dir="ltr">
                        {truncateMiddle(w.tron ?? "", 8, 6)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground" dir="ltr">
                        {truncateMiddle(w.sol ?? "", 8, 6)}
                      </td>
                    </tr>
                  ))}
                  {armyWallets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        {loading ? "טוען…" : "לא נמדדו ארנקים"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <SourceNote>
              זהויות נגזרות-מפתח שנולדו בכליה של הרשת (kernel v0) - לכל סוכן
              כתובות על 4 משפחות שרשראות, נמדד מתוך ה-replay.
            </SourceNote>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="min-w-0">
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-bold">קציר ונזילות</h2>
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  icon={Coins}
                  label="סיר קציר"
                  value={`${(v0?.harvest?.pot ?? 0).toFixed(3)}`}
                  sub="SAOS שנצברו מעמלות"
                />
                <StatTile
                  icon={Users}
                  label="מקבלים"
                  value={String(v0?.harvest?.count ?? 0)}
                  sub="זרמים פעילים"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 text-sm font-bold">מה זה אומר?</h2>
              <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  ההיצע מוקבע בג&apos;נזיס ({net?.supply != null ? net.supply.toLocaleString("he-IL") : "—"} SAOS) - אין הנפקה
                  נוספת ב-v0; v1 מגביל בחוזה ל-21 מיליון.
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  ההפצה היא בפעולות חתומות של הרשת - כל העברה נמדדת
                  ב-replay הציבורי.
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  הבורסה הריבונית מנהלת מאזני מסחר נפרדים (USDS/WSTEEM
                  ועוד) עם אוצר שקוף.
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {data && (
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          נמדד והוגש: {fmtDateTime(data.servedAt)} · המקורות: replay v0 ·
          saos-live.json מהלב · הדקס החי
        </p>
      )}
    </div>
  );
}
