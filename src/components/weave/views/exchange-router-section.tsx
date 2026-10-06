"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Exchange-Router Section — מקטע ראוטר ההחלפות החי (R96).
//
// הוראת המפעיל: "לעגן exchange של מטבעות אמיתיים על הרשת ולשלב אותם
// עם הרשת שלנו בצורה חכמה שיהיו מניבים ויזרימו נזילות... לאמת לבחון
// לאתגר."
//
// המקטע מצטרף לתצוגת ראוטר ה-DeFi (R77) ומביא את השכבה שהייתה חסרה:
//   · ציטוטים חיים מחוזי הראוטרים האמיתיים ב-4 רשתות — eth_call,
//     חסר-מפתחות, עם השהיה וסטייה מול סימוכין בלתי-תלוי (בינאנס).
//   · שכבת האתגר — פסק-דין לכל ציטוט + תחרות בין ראוטרים על אותו זוג.
//   · סולם התשואה — APY נמדד של כחולות-לבן חוץ מול הכלים הפנימיים שלנו.
//   · מסלולי השילוב — איך הנזילות שלנו זורמת היום (גריד → SBD) ואיפה
//     היא תניב כששער-המפעיל ייפתח (רמפת יציאה → USDT → ענקיות).
// מובייל: כרטיסים בלבד — אפס גלילה אופקית (לקח R94: min-w-0 בכל ילד).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Coins,
  Gauge,
  Landmark,
  Loader2,
  RefreshCw,
  Scale,
  ShieldCheck,
  TrendingDown,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FadeIn, MotionCard, Section, scrollBoxClass } from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/exchange/router) ─────────────────────

type QuoteVerdict = "VERIFIED" | "DEVIANT" | "DOWN";

interface QuoteChannel {
  id: string;
  chain: string;
  chainId: number;
  dex: string;
  route: string;
  pair: string;
  amountInLabel: string;
  quote: number | null;
  quoteUnit: string;
  execPrice: number | null;
  refLabel: string;
  devBps: number | null;
  latencyMs: number | null;
  kind: "v2" | "v3" | "rest";
  contract: string;
  verdict: QuoteVerdict;
  note: string;
}

interface CompetitionGroup {
  pair: string;
  prices: Array<{ dex: string; chain: string; price: number | null }>;
  bestDex: string | null;
  worstDex: string | null;
  best: number | null;
  worst: number | null;
  spreadBps: number | null;
}

interface YieldPool {
  project: string;
  chain: string;
  symbol: string;
  apy: number | null;
  tvlUsd: number;
  stablecoin: boolean;
  ilRisk: string;
}

interface ExchangeData {
  ok: boolean;
  at: string;
  chains: Array<{ name: string; chainId: number; rpc: string; height: number | null; ok: boolean }>;
  channels: QuoteChannel[];
  reference: { ethUsdt: number | null; bnbUsdt: number | null; solUsdt: number | null; at: string | null; down: string[] };
  competition: CompetitionGroup[];
  challenge: { verified: number; deviant: number; down: number; summary: string; notes: string[] };
  yields: { at: string | null; pools: YieldPool[]; down?: string };
  doctrine: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

interface PnlData {
  ok: boolean;
  stats: { fillsTotal: number; roundTrips: number; capturedSbd: number; openLongSteem: number; quietDays: number };
  market: { midVsParityBps: number | null; sbdUsd: number | null; steemUsd: number | null };
  ladder: { deployedSteem: number | null };
  balances: { sbd: number | null };
  regime: { verdict: string; detail: string };
}

interface RouterDataLike {
  tools: Array<{ id: string; category: string; apy: number | null; apr: number | null; tvl: number | null; primary: string }>;
  networks: Array<{ chain: string; ok: boolean | null }>;
  at: string;
}

const API = "/api/exchange/router";
const PNL_API = "/api/money/pnl";
const POLL_MS = 60_000;
const PNL_POLL_MS = 120_000;

// ── מטא-נתונים ────────────────────────────────────────────────────────

const VERDICT_META: Record<QuoteVerdict, { he: string; cls: string; icon: typeof ShieldCheck }> = {
  VERIFIED: {
    he: "אומת",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: ShieldCheck,
  },
  DEVIANT: {
    he: "אותגר · נכשל",
    cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
    icon: TrendingDown,
  },
  DOWN: {
    he: "נפל",
    cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    icon: Loader2,
  },
};

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const fmtBps = (b: number | null | undefined) => (b == null ? "—" : `${b > 0 ? "+" : ""}${b.toLocaleString("en-US")}bps`);

const devCls = (b: number | null, tol = 75) =>
  b == null
    ? "text-muted-foreground"
    : Math.abs(b) <= tol
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";

// ── המקטע ─────────────────────────────────────────────────────────────

export function ExchangeRouterSection({ router }: { router: RouterDataLike | null }) {
  const [data, setData] = useState<ExchangeData | null>(null);
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as ExchangeData;
      if (!alive.current) return;
      setData(j);
      setErr(null);
    } catch (e) {
      if (alive.current) setErr(String((e as Error).message));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadPnl = useCallback(async () => {
    try {
      const res = await fetch(PNL_API, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as PnlData;
      if (alive.current && j?.ok) setPnl(j);
    } catch {
      /* ה-P&L מוגש מה-SWR — כשל כאן לא שובר את הראוטר */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    void loadPnl();
    const t = setInterval(() => void load(), POLL_MS);
    const tp = setInterval(() => void loadPnl(), PNL_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
      clearInterval(tp);
    };
  }, [load, loadPnl]);

  // כלים פנימיים מתצוגת האם (נמדדו שם מ-/api/defi/router)
  const savings = router?.tools.find((t) => t.id === "save-pot") ?? null;
  const usdsMarket = router?.tools.find((t) => t.id === "mm-usds") ?? null;
  const bridgeTron = router?.networks.find((n) => n.chain === "tron") ?? null;

  const channels = data?.channels ?? [];
  const verified = channels.filter((c) => c.verdict === "VERIFIED").length;
  const deviant = channels.filter((c) => c.verdict === "DEVIANT").length;
  const down = channels.filter((c) => c.verdict === "DOWN").length;
  const chainsLive = data?.chains.filter((c) => c.ok).length ?? 0;
  const bestEth = data?.channels
    .filter((c) => c.pair === "ETH/USD" && c.execPrice != null)
    .sort((a, b) => (b.execPrice ?? 0) - (a.execPrice ?? 0))[0];

  return (
    <div id="defi-router-exchange" className="scroll-mt-24">
      <Section
        className="mt-10"
        title="ראוטר ההחלפות — ציטוטים חיים מחוזי ה-DEX בארבע רשתות"
        description="חיבור ישיר וחסר-מפתחות לראוטרים האמיתיים: Uniswap v2/v3 · PancakeSwap v2 · SushiSwap — על Ethereum, BNB, Arbitrum ו-Base. כל ציטוט נשפט מול סימוכין בלתי-תלוי ומול ערוצים מקבילים. ביצוע עסקה דורש מפתח — שער-מפעיל."
        icon={<ArrowLeftRight />}
        action={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5">
            {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
            מדידה מחדש
          </Button>
        }
      >
        {/* צ'יפים חיים */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "ערוצי ציטוט", value: data ? `${channels.length}` : "—", note: "חוזים אמיתיים" },
            { label: "אומתו מול סימוכין", value: data ? `${verified}/${channels.length}` : "—", note: deviant ? `${deviant} אותגרו` : verified > 0 ? "כולם עמדו" : "טרם אומתו ערוצים במחזור זה" },
            { label: "רשתות חיות", value: data ? `${chainsLive}/${data.chains.length}` : "—", note: "גובה-שרשרת נמדד" },
            { label: "ETH · בינאנס", value: data ? `$${fmt(data.reference.ethUsdt)}` : "—", note: "סימוכין עצמאי" },
            { label: "BNB · בינאנס", value: data ? `$${fmt(data.reference.bnbUsdt)}` : "—", note: "סימוכין עצמאי" },
            { label: "ערוצים שנפלו", value: data ? `${down}` : "—", note: "מתועד בגלוי" },
          ].map((k) => (
            <Card key={k.label} className="min-w-0 bg-muted/30">
              <CardContent className="min-w-0 p-3">
                <p className="truncate text-[11px] text-muted-foreground">{k.label}</p>
                <p dir="ltr" className="truncate text-start font-mono text-sm font-semibold">
                  {loading ? "…" : k.value}
                </p>
                <p className="truncate text-[10px] text-muted-foreground/70">{k.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* שורת סיכום-האתגר */}
        {data ? (
          <FadeIn className="mt-4">
            <MotionCard className="border-emerald-500/20 bg-emerald-500/[0.04]">
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Scale className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="min-w-0 text-sm font-semibold">שכבת האתגר — {data.challenge.summary}</p>
                </div>
                <ul className="ms-6 list-disc space-y-1 text-[13px] leading-relaxed text-muted-foreground">
                  {data.challenge.notes.map((n, i) => (
                    <li key={i} className="min-w-0">{n}</li>
                  ))}
                </ul>
              </CardContent>
            </MotionCard>
          </FadeIn>
        ) : loading ? (
          <Skeleton className="mt-4 h-20 w-full" />
        ) : null}

        {/* טבלת הערוצים — דסקטופ */}
        <div className="mt-4 hidden md:block">
          <div className={cn("w-full overflow-auto", scrollBoxClass)}>
            <table className="w-full min-w-[820px] border-collapse text-sm" dir="rtl">
              <thead>
                <tr className="border-b text-start text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">רשת</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">ראוטר</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">מסלול</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">קלט</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">הציטוט שחזר</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">מחיר ביצוע</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">מול סימוכין</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">השהיה</th>
                  <th className="whitespace-nowrap px-2 py-2 text-start font-medium">פסק-דין</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td colSpan={9} className="px-2 py-2"><Skeleton className="h-6 w-full" /></td>
                      </tr>
                    ))
                  : channels.map((c) => {
                      const v = VERDICT_META[c.verdict];
                      return (
                        <tr key={c.id} className="border-b border-border/40 transition-colors hover:bg-muted/30">
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{c.chain}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium">{c.dex}</td>
                          <td dir="ltr" className="whitespace-nowrap px-2 py-2 text-start font-mono text-[12px] text-muted-foreground">{c.route}</td>
                          <td dir="ltr" className="whitespace-nowrap px-2 py-2 text-start font-mono text-[12px]">{c.amountInLabel}</td>
                          <td dir="ltr" className="whitespace-nowrap px-2 py-2 text-start font-mono text-[12px] font-semibold">
                            {c.quote != null ? `${fmt(c.quote, 4)} ${c.quoteUnit}` : "—"}
                          </td>
                          <td dir="ltr" className="whitespace-nowrap px-2 py-2 text-start font-mono text-[12px]">
                            {c.execPrice != null ? (c.execPrice < 10 ? fmt(c.execPrice, 5) : `$${fmt(c.execPrice)}`) : "—"}
                          </td>
                          <td dir="ltr" className={cn("whitespace-nowrap px-2 py-2 text-start font-mono text-[12px]", devCls(c.devBps))}>
                            {fmtBps(c.devBps)}
                          </td>
                          <td dir="ltr" className="whitespace-nowrap px-2 py-2 text-start font-mono text-[12px] text-muted-foreground">
                            {c.latencyMs != null ? `${c.latencyMs}ms` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2">
                            <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", v.cls)}>
                              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                              {v.he}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          {err ? <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-400">שגיאת טעינה: {err} — ננסה שוב במחזור הבא</p> : null}
        </div>

        {/* כרטיסי ערוצים — מובייל בלבד (אפס גלילה אופקית) */}
        <div className="mt-4 grid gap-2 md:hidden">
          {loading && !data
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            : channels.map((c) => {
                const v = VERDICT_META[c.verdict];
                return (
                  <Card key={c.id} className="min-w-0">
                    <CardContent className="min-w-0 space-y-1.5 p-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {c.dex} <span className="font-normal text-muted-foreground">· {c.chain}</span>
                          </p>
                          <p dir="ltr" className="truncate text-start font-mono text-[11px] text-muted-foreground">{c.route}</p>
                        </div>
                        <Badge variant="outline" dir="rtl" className={cn("shrink-0 gap-1 text-[10px]", v.cls)}>
                          {v.he}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[12px]">
                        <p className="min-w-0 truncate">
                          <span className="text-muted-foreground">קלט: </span>
                          <span dir="ltr" className="font-mono">{c.amountInLabel}</span>
                        </p>
                        <p className="min-w-0 truncate">
                          <span className="text-muted-foreground">ציטוט: </span>
                          <span dir="ltr" className="font-mono font-semibold">
                            {c.quote != null ? `${fmt(c.quote, 3)} ${c.quoteUnit}` : "—"}
                          </span>
                        </p>
                        <p className="min-w-0 truncate">
                          <span className="text-muted-foreground">מול סימוכין: </span>
                          <span dir="ltr" className={cn("font-mono", devCls(c.devBps))}>{fmtBps(c.devBps)}</span>
                        </p>
                        <p className="min-w-0 truncate">
                          <span className="text-muted-foreground">השהיה: </span>
                          <span dir="ltr" className="font-mono">{c.latencyMs != null ? `${c.latencyMs}ms` : "—"}</span>
                        </p>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground/80">{c.note}</p>
                    </CardContent>
                  </Card>
                );
              })}
        </div>

        {/* תחרות בין ראוטרים */}
        {data && data.competition.length ? (
          <FadeIn className="mt-6" delay={0.05}>
            <div className="grid gap-3 md:grid-cols-3">
              {data.competition.map((g) => (
                <MotionCard key={g.pair} className="min-w-0">
                  <CardContent className="min-w-0 space-y-2 p-4">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold" dir="ltr">{g.pair}</p>
                      <Badge
                        variant="outline"
                        dir="rtl"
                        className={cn(
                          "shrink-0 gap-1 font-mono text-[11px]",
                          (g.spreadBps ?? 0) <= 50
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        פער {fmtBps(g.spreadBps)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {g.prices.map((p, i) => (
                        <div key={i} className="flex min-w-0 items-center justify-between gap-2 text-[12px]">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {p.dex} · {p.chain}
                          </span>
                          <span dir="ltr" className="shrink-0 font-mono">
                            {p.price != null ? (p.price < 10 ? fmt(p.price, 5) : `$${fmt(p.price)}`) : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="min-w-0 border-t pt-2 text-[12px] leading-snug text-muted-foreground">
                      הזול למוכר: <span className="font-semibold text-foreground">{g.bestDex}</span>
                      {g.spreadBps != null && g.spreadBps > 100 ? ` — פער ${fmtBps(g.spreadBps)} מעיד על נזילות דקה בגודל הזמנה` : " — שוק תחרותי"}
                    </p>
                  </CardContent>
                </MotionCard>
              ))}
            </div>
          </FadeIn>
        ) : null}

        {/* סולם התשואה — פנים מול חוץ */}
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <FadeIn>
            <MotionCard className="h-full">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Gauge className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">הכלים שלנו — תשואה פנימית נמדדת</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
                    <p className="truncate text-[11px] text-muted-foreground">קרן החיסכון (USDS)</p>
                    <p dir="ltr" className="truncate text-start font-mono text-lg font-bold">
                      {savings?.apy != null ? `${(savings.apy * 100).toFixed(2)}%` : "—"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/70">
                      {savings?.tvl != null ? `קרן ${savings.tvl.toFixed(0)} USDS` : "ממתין לכיול"}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
                    <p className="truncate text-[11px] text-muted-foreground">שוק-הכספים (אספקת USDS)</p>
                    <p dir="ltr" className="truncate text-start font-mono text-lg font-bold">
                      {usdsMarket?.apr != null ? `${(usdsMarket.apr * 100).toFixed(2)}%` : "—"}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/70">{usdsMarket?.primary ?? "APR נמדד-שרשרת"}</p>
                  </div>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  הגריד החוץ (STEEM/SBD):{" "}
                  {pnl ? (
                    <>
                      <span className="font-mono font-semibold">{pnl.ladder.deployedSteem?.toFixed(1)} STEEM</span> מוצב · משטר{" "}
                      <span className="font-semibold">{pnl.regime.verdict}</span> · {pnl.stats.fillsTotal} מילויים · נלכד{" "}
                      <span className="font-mono font-semibold">{pnl.stats.capturedSbd.toFixed(4)} SBD</span> — P&L כנה מהשרשרת
                    </>
                  ) : (
                    "ה-P&L נטען…"
                  )}
                </p>
              </CardContent>
            </MotionCard>
          </FadeIn>

          <FadeIn delay={0.05}>
            <MotionCard className="h-full">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Landmark className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">האוקיינוס החיצוני — APY נמדד של כחולות-לבן</p>
                </div>
                <div className={cn("space-y-1.5", scrollBoxClass)}>
                  {data?.yields.pools.length ? (
                    data.yields.pools.map((p, i) => (
                      <div key={`${p.project}-${p.chain}-${i}`} className="flex min-w-0 items-center justify-between gap-2 border-b border-border/30 pb-1.5 text-[12px] last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.project}</p>
                          <p dir="ltr" className="truncate text-start font-mono text-[11px] text-muted-foreground">
                            {p.symbol} · {p.chain}
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p dir="ltr" className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                            {p.apy != null ? `${p.apy.toFixed(2)}%` : "—"}
                          </p>
                          <p dir="ltr" className="font-mono text-[10px] text-muted-foreground/70">
                            ${(p.tvlUsd / 1e9).toFixed(2)}B
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      {data?.yields.down ? `DefiLlama נפל במחזור זה (${data.yields.down}) — בכנות` : "נטען…"}
                    </p>
                  )}
                </div>
              </CardContent>
            </MotionCard>
          </FadeIn>
        </div>

        {/* מסלולי השילוב — איך הנזילות זורמת ומניבה */}
        <FadeIn className="mt-6" delay={0.1}>
          <MotionCard className="border-amber-500/20">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Coins className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p className="text-sm font-semibold">שילוב חכם עם הרשת — מסלולי זרימת הנזילות</p>
                <Badge variant="outline" dir="rtl" className="gap-1 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">
                  שער-מפעיל על כל רגל חיצונית
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  {
                    n: 1,
                    title: "הגריד החי — STEEM ← SBD",
                    state: "LIVE",
                    stateCls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    body: pnl
                      ? `${pnl.ladder.deployedSteem?.toFixed(1) ?? "—"} STEEM מוצבים בסולם · השוק הפנימי ${pnl.market.midVsParityBps != null ? `${fmtBps(pnl.market.midVsParityBps)} מהפאריטה` : "—"} · SBD נגזר $${fmt(pnl.market.sbdUsd, 3)} — הרגל היחידה שכבר רצה לבד על השרשרת`
                      : "מצטרף לנתוני ה-P&L…",
                  },
                  {
                    n: 2,
                    title: "רמפת היציאה — SBD ← USDT חיצוני",
                    state: "OPERATOR-GATE",
                    stateCls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    body: pnl
                      ? `מלאי ${fmt(pnl.balances.sbd, 3)} SBD (≈$${fmt((pnl.balances.sbd ?? 0) * (pnl.market.sbdUsd ?? 0), 3)}) ממתין · ההמרה דורשת חשבון בורסה חיצונית עם מפתח — שער-מפעיל מפורש, לא נעשה בשקט`
                      : "—",
                  },
                  {
                    n: 3,
                    title: "גשר ההפקדות — USDT-TRON ← USDS",
                    state: bridgeTron?.ok ? "READY" : "WAIT",
                    stateCls: bridgeTron?.ok
                      ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                      : "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
                    body: "כתובת הצפייה ב-TRON חיה ונצפית חסר-מפתחות · כל הפקדה נטענת לספר הפתוח וזוכה USDS בשער הרשת — הדלת בנויה וממתינה למפקיד הראשון",
                  },
                  {
                    n: 4,
                    title: "נזילות מניבה — פנים מול האוקיינוס",
                    state: "LIVE / GATED",
                    stateCls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    body: `פנים: USDS ← קרן החיסכון (${savings?.apy != null ? `${(savings.apy * 100).toFixed(2)}%` : "—"} נמדד) · חוץ: USDC ← ${data?.yields.pools[0] ? `${data.yields.pools[0].project} ${data.yields.pools[0].apy?.toFixed(2)}%` : "כחולות-לבן"} — ההחלטה היא של המפעיל; המנוע מודד את שני הצדדים בכנות`,
                  },
                ].map((p) => (
                  <div key={p.n} className="min-w-0 rounded-lg border bg-muted/20 p-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 text-[13px] font-semibold">
                        <span className="me-1.5 inline-flex size-5 items-center justify-center rounded-full border bg-background font-mono text-[10px]">{p.n}</span>
                        {p.title}
                      </p>
                      <Badge variant="outline" dir="rtl" className={cn("shrink-0 text-[10px]", p.stateCls)}>
                        {p.state}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                ))}
              </div>
              {bestEth ? (
                <p className="border-t pt-2 text-[12px] leading-relaxed text-muted-foreground">
                  הראוטר הטוב ביותר ל-ETH כרגע:{" "}
                  <span className="font-semibold text-foreground">
                    {bestEth.dex} · {bestEth.chain}
                  </span>{" "}
                  <span dir="ltr" className="font-mono">(${fmt(bestEth.execPrice)})</span> — נמדד מהחוזה, לא מפרסומת.
                </p>
              ) : null}
            </CardContent>
          </MotionCard>
        </FadeIn>

        {/* דוקטרינה */}
        {data ? (
          <ul className="mt-4 ms-4 list-disc space-y-1 text-[12px] leading-relaxed text-muted-foreground">
            {data.doctrine.map((d, i) => (
              <li key={i} className="min-w-0">{d}</li>
            ))}
            <li className="min-w-0">
              מקור הציטוטים: <Banknote className="inline size-3" aria-hidden="true" /> eth_call חי · סימוכין:{" "}
              <Trophy className="inline size-3" aria-hidden="true" /> בינאנס · תשואות: DefiLlama · נמדד{" "}
              <span dir="ltr" className="font-mono">{new Date(data.at).toISOString().slice(11, 19)}Z</span>
              {data.cacheAgeSec != null ? ` · מטמון ${data.cacheAgeSec}ש׳` : ""}
            </li>
          </ul>
        ) : null}
      </Section>
    </div>
  );
}
