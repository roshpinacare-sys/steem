"use client";

// ─────────────────────────────────────────────────────────────────────
// SOVEREIGN ARENA · זירת-המסחר הריבונית (R102)
//
// הוראת המפעיל: "להפוך את השוק שלנו לחי אמיתי... טיפול ראוי במטבעות
// הפנימיים כדי לשמור על הערך שלהם ועדיין לייצר יכולת להחליף אותם."
//
// מה מוצג כאן — הכל מה-API החי (/api/exchange), אפס מספר מומצא:
//   · USDS בגיבוי-רזרבה מלא — היצע = נעול, תמיד; שמירת-הערך במבנה
//   · בריכות AMM חיות (SAOS/USDS · WBLURT/USDS · WSTEEM/WSBD) — עמלת
//     30bps נשארת בבריכה, ערך ה-LP של האוצר צומח מהעמלות
//   · ספר-פנים hash-chained — כל אירוע קנוני, החישוב-חדש מאומת בכל ריענון
//   · דלת-ההפקדות הציבורית — memo "wx:<member>" לאוצר, היסטוריה שופטת
//   · הוכחות-רייל חיות: משיכת WSBD txid אמיתי · SOL confirmed
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Bot,
  Coins,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Vault,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOperator } from "@/components/weave/operator";

// ── חוזה הנתונים (מ-/api/exchange) ───────────────────────────────────

interface ArenaPool {
  pair: string;
  assetA: string;
  assetB: string;
  reserveA: number;
  reserveB: number;
  price: number;
  priceLabel: string;
  feeBps: number;
  volumeA: number;
  volumeB: number;
  swaps: number;
  depthUsd: number | null;
}
interface ArenaSnapshot {
  ok: boolean;
  at: string;
  genesis: boolean;
  pools: ArenaPool[];
  reserve: { usdsSupply: number; sbdLocked: number; hbdLocked: number; ratio: string };
  backingMark?: { usdsUsd: number | null; sbdUsd: number | null; hbdUsd: number | null; wsbd: number; whbd: number; note: string };
  treasury: Record<string, number>;
  members: Array<{ member: string; balances: Record<string, number> }>;
  prices: Record<string, number | null>;
  recentEvents: Array<{ seq: number; kind: string; member: string; payload: string; hash: string; usdValue?: number | null; createdAt?: string }>;
  bookIntegrity: { events: number; headHash: string | null; recomputeOk: boolean | null };
  depositDoor: { memo: string; treasury: string; chain: string; doors: Array<{ chain: string; account?: string; address?: string; hint?: string }> };
  note: string;
}
interface QuoteResult {
  ok?: boolean;
  detail?: string;
  quote?: {
    pair: string;
    side: "A2B" | "B2A";
    amountIn: number;
    expectedOut: number;
    price: number;
    feeBps: number;
    reserveA: number;
    reserveB: number;
    usdValue: number | null;
  };
}

const KIND_LABEL: Record<string, string> = {
  GENESIS: "ג'נזיס",
  SWAP: "החלפה",
  USDS_MINT: "הטבעת USDS",
  USDS_BURN: "פדיון USDS",
  DEPOSIT_CREDIT: "הפקדה שנזקפה",
  WITHDRAW_EXEC: "משיכה בוצעה",
  WITHDRAW_REQUEST: "בקשת משיכה",
  LP_SEED: "זריעת בריכה",
  LP_ADD: "הוספת נזילות",
  LP_MIGRATE: "הגירת בעלות-LP",
  LP_REMOVE: "חילוץ נזילות",
  TREASURY_WRAP: "עטיפת אוצר",
  REWARD_PAY: "תגמול עבודה",
  FEE: "עמלה",
};

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(digits).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));
}

export function SovereignArenaView() {
  // R105 — פעולות הזירה פועלות בזהות המפעיל כשסשן חי (חברות-אמת בספר,
  // לא "treasury" אנונימי — תיקון שורש שנתפס בביקורת)
  const { authedFetch } = useOperator();
  const [snap, setSnap] = useState<ArenaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quotePair, setQuotePair] = useState("SAOS/USDS");
  const [quoteSide, setQuoteSide] = useState<"A2B" | "B2A">("A2B");
  const [quoteAmount, setQuoteAmount] = useState("50");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapResult, setSwapResult] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  // R104 — רייל משיכת SAOS-LIVE: הכתובת העצמאית של המפעיל מה-API
  const [saosLive, setSaosLive] = useState<{ operatorSaosAddr: string | null; treasuryBalSaos: number | null; envelopes: number | null; wallets: string[] | null } | null>(null);
  const [wxAmount, setWxAmount] = useState("2");
  const [wxResult, setWxResult] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  // R105 — רייל משיכה לא-גרפני (WSOL/WETH)
  const [ngAsset, setNgAsset] = useState<"WSOL" | "WETH">("WSOL");
  const [ngAmount, setNgAmount] = useState("0.001");
  const [ngTo, setNgTo] = useState("");
  const [ngResult, setNgResult] = useState<string | null>(null);
  const [ngBusy, setNgBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (withSpin = true) => {
    if (withSpin) setRefreshing(true);
    try {
      const res = await fetch("/api/exchange", { cache: "no-store" });
      const j = (await res.json()) as ArenaSnapshot;
      setSnap(j);
    } catch {
      /* הריענון הבא ינסה שוב */
    } finally {
      setLoading(false);
      if (withSpin) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(false), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  // מצב שרשרת-החי — קיפול נטול-מפתח מה-API (הצומת הוא השופט)
  useEffect(() => {
    let alive = true;
    const loadLive = async () => {
      try {
        const res = await fetch("/api/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "saos-live" }),
        });
        const j = (await res.json()) as typeof saosLive & { ok?: boolean };
        if (alive) setSaosLive(j);
      } catch {
        /* הריענון הבא */
      }
    };
    void loadLive();
    const t = setInterval(() => void loadLive(), 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const runQuote = useCallback(async () => {
    const amt = Number(quoteAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setQuoting(true);
    setSwapResult(null);
    try {
      const res = await fetch(
        `/api/exchange?with=quote&pair=${encodeURIComponent(quotePair)}&side=${quoteSide}&amountIn=${amt}`,
        { cache: "no-store" },
      );
      const j = (await res.json()) as QuoteResult;
      setQuote(j);
    } catch {
      setQuote({ ok: false, detail: "הציטוט לא נענה" });
    } finally {
      setQuoting(false);
    }
  }, [quoteAmount, quotePair, quoteSide]);

  const runSwap = useCallback(async () => {
    const amt = Number(quoteAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSwapping(true);
    setSwapResult(null);
    try {
      const res = await authedFetch("/api/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "swap", pair: quotePair, side: quoteSide, amountIn: amt }),
      });
      const j = (await res.json()) as { ok?: boolean; detail?: string };
      setSwapResult(j.detail ?? (j.ok ? "בוצע" : "נכשל"));
      await load(false);
    } catch {
      setSwapResult("הפעולה לא נענתה");
    } finally {
      setSwapping(false);
    }
  }, [quoteAmount, quotePair, quoteSide, load, authedFetch]);

  // R104 — משיכת SAOS דרך רייל SAOS-LIVE: שריפת תביעה פנימית ← העברה
  // חתומה מהאוצר על השרשרת החיה. השער מכסה; הקיפול הוא השופט.
  const runSaosWithdraw = useCallback(async () => {
    const amt = Number(wxAmount);
    const to = saosLive?.operatorSaosAddr;
    if (!Number.isFinite(amt) || amt <= 0 || !to) return;
    setWithdrawing(true);
    setWxResult(null);
    try {
      const res = await authedFetch("/api/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw", asset: "SAOS", amount: amt, toAccount: to }),
      });
      const j = (await res.json()) as { ok?: boolean; detail?: string; txid?: string };
      setWxResult(j.ok ? `${j.detail ?? "נמשך"}${j.txid ? ` (txid ${j.txid.slice(0, 14)}…)` : ""}` : (j.detail ?? "נכשל"));
      await load(false);
    } catch {
      setWxResult("הפעולה לא נענתה");
    } finally {
      setWithdrawing(false);
    }
  }, [wxAmount, saosLive, load, authedFetch]);

  // R105 — משיכת WSOL/WETH: שריפת עטיפה ← שידור אמתי מאוצר cashmachine.
  // NO-GAS ב-ETH הוא קבלה כנה עד הגעת הון — העטיפה מוחזרת במלואה.
  const runNgWithdraw = useCallback(async () => {
    const amt = Number(ngAmount);
    if (!Number.isFinite(amt) || amt <= 0 || !ngTo) return;
    setNgBusy(true);
    setNgResult(null);
    try {
      const res = await authedFetch("/api/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw", asset: ngAsset, amount: amt, toAccount: ngTo }),
      });
      const j = (await res.json()) as { ok?: boolean; detail?: string; txid?: string };
      setNgResult(j.ok ? `${j.detail ?? "נמשך"}${j.txid ? ` (txid ${j.txid.slice(0, 16)}…)` : ""}` : (j.detail ?? "נכשל"));
      await load(false);
    } catch {
      setNgResult("הפעולה לא נענתה");
    } finally {
      setNgBusy(false);
    }
  }, [ngAmount, ngAsset, ngTo, load, authedFetch]);

  const activePool = useMemo(
    () => snap?.pools.find((p) => p.pair === quotePair) ?? null,
    [snap, quotePair],
  );
  const totalSwaps = useMemo(() => (snap?.pools ?? []).reduce((s, p) => s + p.swaps, 0), [snap]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── כותרת + כפתור ריענון ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Flame className="size-5 text-primary" aria-hidden />
            זירת-המסחר הריבונית
            {snap?.bookIntegrity.recomputeOk === true && (
              <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                <ShieldCheck className="size-3" aria-hidden />
                ספר מאומת · {snap.bookIntegrity.events} אירועים
              </Badge>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            השוק הפנימי החי: USDS בגיבוי-רזרבה מלא (הטבעה=נעילה 1:1, פדיון=שריפה 1:1), בריכות AMM
            בעמלת-אוצר, דלת-הפקדות ציבורית על השרשרת, ורייל-משיכות שהוכח עד הבלוק.{" "}
            {snap?.note}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          מדידה-מחדש
        </Button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-800/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" aria-hidden />
              USDS בגיבוי מלא
            </div>
            <p className="text-2xl font-bold mt-1">{fmt(snap?.reserve.usdsSupply)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              רזרבה נעולה: {fmt(snap?.reserve.sbdLocked)} WSBD{snap?.reserve.hbdLocked ? ` + ${fmt(snap.reserve.hbdLocked)} WHBD` : ""} · 1:1 תמיד
            </p>
            {snap?.backingMark?.usdsUsd != null ? (
              <p className="text-[11px] mt-1.5 leading-relaxed text-amber-700 dark:text-amber-400">
                עוגן-אמת: שווי-היציאה הכן ${snap.backingMark.usdsUsd.toFixed(4)} ל-USDS
                {snap.backingMark.sbdUsd != null ? ` (SBD חיצוני $${snap.backingMark.sbdUsd.toFixed(3)}` : ""}
                {snap.backingMark.hbdUsd != null ? ` · HBD $${snap.backingMark.hbdUsd.toFixed(3)}` : ""}
                {snap.backingMark.sbdUsd != null ? ")" : ""} — הסטיות נמדדות במונחים האלה, לא בנומינל
              </p>
            ) : (
              <p className="text-[11px] mt-1.5 text-muted-foreground">{snap?.backingMark?.note ?? ""}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="size-4" aria-hidden />
              בריכות AMM חיות
            </div>
            <p className="text-2xl font-bold mt-1">{snap?.pools.filter((p) => p.reserveA > 0 && p.reserveB > 0).length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">עמלת 30bps — נשארת בבריכה שלנו</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowLeftRight className="size-4" aria-hidden />
              החלפות שבוצעו
            </div>
            <p className="text-2xl font-bold mt-1">{totalSwaps}</p>
            <p className="text-xs text-muted-foreground mt-1">כל אחת משורשרת בספר ומאומתת בחישוב-חדש</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="size-4" aria-hidden />
              חברי הזירה
            </div>
            <p className="text-2xl font-bold mt-1">{snap?.members.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              דלת הציבור: memo <span className="font-mono text-xs">{snap?.depositDoor.memo}</span> ← {snap?.depositDoor.treasury}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── בריכות ── */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
          <Coins className="size-4" aria-hidden />
          בריכות הזירה — עומק = ההון הריאלי בלבד
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          {(snap?.pools ?? []).map((p, i) => (
            <motion.div
              key={p.pair}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className={cn("h-full", p.reserveA <= 0 || p.reserveB <= 0 && "opacity-60")}>
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">{p.pair}</span>
                    <Badge variant={p.swaps > 0 ? "default" : "secondary"}>{p.swaps > 0 ? `${p.swaps} החלפות` : "ממתינה"}</Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{p.assetA}</span><span className="font-mono">{fmt(p.reserveA)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{p.assetB}</span><span className="font-mono">{fmt(p.reserveB)}</span></div>
                    <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">מחיר</span><span className="font-mono">{p.price > 0 ? p.priceLabel : "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">עמלה</span><span className="font-mono">{(p.feeBps / 100).toFixed(2)}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">עומק</span><span className="font-mono">{p.depthUsd != null ? `$${p.depthUsd.toFixed(4)}` : "USDS-מושתת"}</span></div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── מנוע ההחלפה ── */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            מנוע ההחלפה החי — האוצר סוחר, העמלות זורמות פנימה
          </h3>
          <div className="grid gap-4 md:grid-cols-[1fr_auto] items-start">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor="arena-pair" className="text-xs text-muted-foreground">זוג</label>
                  <select
                    id="arena-pair"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={quotePair}
                    onChange={(e) => { setQuotePair(e.target.value); setQuote(null); }}
                  >
                    {(snap?.pools ?? []).map((p) => (
                      <option key={p.pair} value={p.pair}>{p.pair}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="arena-side" className="text-xs text-muted-foreground">כיוון</label>
                  <select
                    id="arena-side"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={quoteSide}
                    onChange={(e) => { setQuoteSide(e.target.value === "B2A" ? "B2A" : "A2B"); setQuote(null); }}
                  >
                    <option value="A2B">{activePool?.assetA ?? "A"} ← {activePool?.assetB ?? "B"}</option>
                    <option value="B2A">{activePool?.assetB ?? "B"} ← {activePool?.assetA ?? "A"}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="arena-amount" className="text-xs text-muted-foreground">כמות כניסה</label>
                  <Input
                    id="arena-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={quoteAmount}
                    onChange={(e) => { setQuoteAmount(e.target.value); setQuote(null); }}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void runQuote()} disabled={quoting}>
                  {quoting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BookOpen className="size-4" aria-hidden />}
                  צטט מהבריכה החיה
                </Button>
                <Button size="sm" onClick={() => void runSwap()} disabled={swapping || !quote}>
                  {swapping ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowLeftRight className="size-4" aria-hidden />}
                  בצע החלפה (אוצר)
                </Button>
              </div>
            </div>
            <div className="min-w-56 rounded-lg border bg-muted/40 p-4 text-sm space-y-1.5" aria-live="polite">
              {quote?.quote ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">מוצא צפוי</span><span className="font-mono font-bold">{fmt(quote.quote.expectedOut, 6)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">מחיר ביצוע</span><span className="font-mono">{quote.quote.price.toPrecision(4)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">ערך</span><span className="font-mono">{quote.quote.usdValue != null ? `$${quote.quote.usdValue.toFixed(4)}` : "לא נמדד"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">רזרבות אחרי</span><span className="font-mono text-xs">{fmt(quote.quote.reserveA)} / {fmt(quote.quote.reserveB)}</span></div>
                </>
              ) : quote ? (
                <p className="text-muted-foreground">{quote.detail}</p>
              ) : (
                <p className="text-muted-foreground">הצטט מהבריכה — המספרים מגיעים מה-AMM החי, לא מחושבים בדפדפן.</p>
              )}
              {swapResult && <p className="border-t pt-2 text-xs leading-relaxed">{swapResult}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── הוכחות-רייל חיות ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-800/40">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BadgeCheck className="size-4 text-emerald-500" aria-hidden />
              הוכחת משיכה — הבלוק שופט
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              0.005 WSBD נמשכו מהזירה: העטיפה נשרפה, ההעברה שודרה ב-STEEM ואושרה עם txid אמיתי —
              רייל-היציאה עובד מהספר ועד השרשרת.
            </p>
            <a
              href="https://steemit.com/tx/4e90bfda5c585d3c5684eea7f45bebfbffb6f220"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              4e90bfda…6f220 <ExternalLink className="size-3" aria-hidden />
            </a>
          </CardContent>
        </Card>
        <Card className="border-emerald-800/40">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BadgeCheck className="size-4 text-emerald-500" aria-hidden />
              הוכחת רגל SOL — זרימה רב-רשתית אמיתית
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              הכספת הריבונית (סיסמת-אב → מפתח-אב) פתחה את מפתח הסולנה, חתמה ed25519, והעברת
              0.001 SOL שודרה ואושרה (10 אישורים, err:null) — הראשונה מחוץ לעולם הגרפן.
            </p>
            <a
              href="https://solscan.io/tx/5amYdKACRm9pAHGpcpof3XANLfSX17yHUNUVcvgNszwAsLieyZ1K3fvX4RrCMpijio4S6D3ReqfoSHGGs5Pi4bGP"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              5amYdKAC…bGP <ExternalLink className="size-3" aria-hidden />
            </a>
          </CardContent>
        </Card>
      </div>

      {/* ── R104 — רייל משיכת SAOS-LIVE: השרשרת החיה כיציאה ── */}
      <Card className="border-amber-700/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-amber-500" aria-hidden />
                משיכת SAOS — רייל שרשרת-חיה (SAOS-LIVE)
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
                התביעה הפנימית נשרפת בזירה, והעברה חתומה מהאוצר משודרת כ-custom_json על STEEM —
                שם היא מקופלת על ידי כל צומת. הכתובת self-certifying: מי שמחזיק במפתח — שלו ה-SAOS.
              </p>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 text-left">
              {saosLive && (
                <>
                  <div>אופס שרשרת: <span className="font-mono">{saosLive.envelopes ?? "—"}</span></div>
                  <div>ארנקים רשומים: <span className="font-mono">{saosLive.wallets?.length ?? "—"}</span></div>
                  <div>אוצר על השרשרת: <span className="font-mono">{fmt(saosLive.treasuryBalSaos, 0)} SAOS</span></div>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-40">
              <label htmlFor="wx-amount" className="text-xs text-muted-foreground">כמות SAOS למשיכה</label>
              <Input
                id="wx-amount"
                type="number"
                min="0.001"
                step="any"
                value={wxAmount}
                onChange={(e) => setWxAmount(e.target.value)}
                className="font-mono w-32"
              />
            </div>
            <div className="min-w-56 flex-1">
              <label htmlFor="wx-addr" className="text-xs text-muted-foreground">כתובת יעד (המפעיל, מהכספת)</label>
              <div id="wx-addr" className="mt-1 h-9 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs truncate" title={saosLive?.operatorSaosAddr ?? ""}>
                {saosLive?.operatorSaosAddr ?? "…"}
              </div>
            </div>
            <Button size="sm" onClick={() => void runSaosWithdraw()} disabled={withdrawing || !saosLive?.operatorSaosAddr}>
              {withdrawing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Coins className="size-4" aria-hidden />}
              משוך דרך השרשרת החיה
            </Button>
          </div>
          {wxResult && (
            <p className="mt-2 text-xs leading-relaxed border-t pt-2" aria-live="polite">{wxResult}</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <a
              href="https://steemit.com/tx/bbc7031a1496d36d6ef2154e16d92a6a16012eb4"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              הוכחת הרשמה: bbc7031a… <ExternalLink className="size-3" aria-hidden />
            </a>
            <a
              href="https://steemit.com/tx/7eef6c5ed8027df6afed064a26704d8574c2d3bf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              הוכחת משיכה: 7eef6c5e… (2 SAOS) <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* ── R105 — רייל משיכה לא-גרפני: WSOL/WETH ── */}
      <Card className="border-emerald-800/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-emerald-500" aria-hidden />
                משיכת WSOL/WETH — רייל סולנה/אתריום
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
                העטיפה נשרפת בזירה, והעברה אמיתית נחתמת מאוצר cashmachine
                (אותו מפתח-אב) ומשודרת לכתובת היד שלך. SOL: legacy-tx חתומה ed25519.
                ETH: EIP-1559 — NO-GAS כנה עד הגעת הון.
              </p>
            </div>
            <div className="text-xs text-muted-foreground text-left">
              <div>מאזן אוצר: <span className="font-mono">{snap?.treasury?.WSOL != null ? `${fmt(snap.treasury.WSOL, 4)} WSOL` : "—"}</span></div>
              <div className="mt-0.5">שער SOL: <span className="font-mono">{snap?.prices?.sol ? `$${snap.prices.sol.toFixed(2)}` : "—"}</span></div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="ng-asset" className="text-xs text-muted-foreground">נכס</label>
              <select
                id="ng-asset"
                className="w-24 rounded-md border bg-background px-3 py-2 text-sm"
                value={ngAsset}
                onChange={(e) => setNgAsset(e.target.value === "WETH" ? "WETH" : "WSOL")}
              >
                <option value="WSOL">WSOL</option>
                <option value="WETH">WETH</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="ng-amount" className="text-xs text-muted-foreground">כמות</label>
              <Input
                id="ng-amount"
                type="number"
                min="0"
                step="any"
                value={ngAmount}
                onChange={(e) => setNgAmount(e.target.value)}
                className="font-mono w-28"
              />
            </div>
            <div className="min-w-56 flex-1">
              <label htmlFor="ng-to" className="text-xs text-muted-foreground">כתובת יעד (base58 / 0x…)</label>
              <Input
                id="ng-to"
                value={ngTo}
                onChange={(e) => setNgTo(e.target.value)}
                placeholder={ngAsset === "WSOL" ? "כתובת סולנה" : "0x…"}
                className="mt-1 font-mono text-xs"
              />
            </div>
            <Button size="sm" onClick={() => void runNgWithdraw()} disabled={ngBusy || !ngTo}>
              {ngBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Coins className="size-4" aria-hidden />}
              משוך לשרשרת
            </Button>
          </div>
          {ngResult && (
            <p className="mt-2 text-xs leading-relaxed border-t pt-2" aria-live="polite">{ngResult}</p>
          )}
        </CardContent>
      </Card>

      {/* ── ספר הזירה + מאזני חברים ── */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <BookOpen className="size-4" aria-hidden />
              ספר הזירה — hash-chained
            </h3>
            <div className="max-h-96 overflow-y-auto overflow-x-hidden rounded-md border divide-y text-sm">
              {(snap?.recentEvents ?? []).map((e) => (
                <div key={e.seq} className="flex items-start gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground pt-0.5 shrink-0">#{e.seq}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[11px]">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
                      <span className="text-xs text-muted-foreground">{e.member}</span>
                      {e.usdValue != null && <span className="text-xs font-mono text-muted-foreground">${e.usdValue.toFixed(4)}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono max-w-full" dir="ltr">{e.payload}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <Vault className="size-4" aria-hidden />
              מאזני חברים
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(snap?.members ?? []).map((m) => {
                const entries = Object.entries(m.balances ?? {}).filter(([, v]) => v > 0);
                return (
                  <div key={m.member} className="rounded-md border p-2.5">
                    <p className="text-sm font-semibold">{m.member === "treasury" ? "אוצר (LP)" : m.member === "reserve" ? "רזרבת USDS" : m.member}</p>
                    {entries.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {entries.map(([k, v]) => (
                          <Badge key={k} variant="outline" className="font-mono text-[11px]">
                            {fmt(v)} {k}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">ריק — ממתין להפקדה</p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── דלת ההפקדות ── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-1 flex items-center gap-2">
            <Vault className="size-4" aria-hidden />
            דלת-ההפקדות הציבורית — ההיסטוריה שופטת
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            כל אחד מפקיד STEEM/SBD בשרשרת הציבורית לחשבון{" "}
            <span className="font-mono text-foreground">{snap?.depositDoor.treasury}</span> עם המזכר{" "}
            <span className="font-mono text-foreground">wx:&lt;שם-החבר&gt;</span> — סריקת ההיסטוריה מאמת
            את ההפקדה מול השרשרת ומזקפת את העטיפה 1:1 בזירה. ההוכחה: txid בספר, נזקף פעם אחת
            בלבד (אידמפוטנטי). סריקת הדיבון רצה כל 5 דקות על חמש רשתות —
            מהרגע שהכסף נוגע לשרשרת ועד חתימתו בספר.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(snap?.depositDoor?.doors ?? []).map((d) => (
              <div key={d.chain} className="rounded-md border bg-muted/30 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{d.chain}</span>
                  <Badge variant="outline" className="text-[10px]">דלת חיה</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] break-all" dir="ltr">{d.address ?? d.account}</p>
                {d.hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{d.hint}</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── r192-c · שער-הסוכנים (ERC-8004 + x402) ── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-1 flex items-center gap-2">
            <Bot className="size-4" aria-hidden />
            שער-הסוכנים — API-סוופ מגודר-זהות (ERC-8004 + x402)
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            סוכני-AI עם זהות ERC-8004 על-השרשרת (13 רשומות) סוחרים בספר-הזירה דרך
            <span className="font-mono text-foreground"> POST /api/exchange/agent</span> — עם לוח-עמלות מוצהר
            (402 + accepts, 50bps רצפת $0.02 ב-USDS/SAOS לאוצר), חתימת personal_sign מול כתובת הרישום,
            מינימום-עסקה $2 (L3) וקפסות $25/עסקה · $50/יום לסוכן (L4) הנמדדות מאירועי AGENT_SWAP בספר.
            ציטוט-חוץ (WETH/SOL/BNB מול Uniswap/PancakeSwap/SushiSwap) = quote-only בכנות עד מימון-קפסות
            מהכנסה (L4) · dry-run מוצהר זמין (L5) · kill-switch <span className="font-mono">~/.sovereign/dex-kill</span> נבדק בכל בקשה.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px]">GET ?sell=SAOS&amp;buy=USDS&amp;amountIn=100</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">GET ?action=challenge</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">POST X-PAYMENT + X-Agent-Signature</Badge>
            <Badge variant="outline" className="text-[10px]">עמלות-x402 → אוצר, נרשמות FEE+AGENT_SWAP</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
