"use client";

// ─────────────────────────────────────────────────────────────────────
// GATE VIEW · שער המפעיל — התשובה ל"איפה אני מתחבר ומה באמת רץ".
//
// חמישה גופים, כולם ממדידה חיה בלבד (שום טענה לא נטענת מסתם):
//   1. מלאי-אמת: כל ארנקי הרשת על כל השרשרות, נקראים מה-RPC הציבורי.
//   2. הדלת: חימוש-מחדש מבוקר של הגריד — אימות מול השרשרת, חתימה
//      לסוד-GitHub, אפס אחסון מקומי. המפתח הנוכחי כבר חי בכספת המנוע.
//   3. מה-רץ-בפועל: עמודת אמת — רץ / חסום / מדמם, עם הוכחה לשורה.
//   4. הבנת-הרגע: קריאת-שוק חיה (משטר, קו-זהות, עומקים, תובנות)
//      מול צליבת סוכן-הענן — לא תוכנית קבועה אלא מה שרלוונטי עכשיו.
//   5. איך-מתחילים-להזרים: צינור-הערך מה-powerdown ועד חלון-הפדיון.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Coins,
  DoorOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Fuel,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  PlayCircle,
  Radar,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Activity,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TxGateCard } from "@/components/weave/views/tx-gate-card";
import { ActivationDoorCard } from "@/components/weave/views/admin/activation-door-card";

// ── טיפוסי-הבנת-הרגע (משקפים את /api/moment בדיוק) ────────────────

interface MomentPrice {
  usd: number | null;
  chg24h: number | null;
}
interface MomentData {
  ok: boolean;
  fetchedAt: string;
  cached?: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
  down?: string[];
  priceSource?: string;
  thresholds?: {
    btc24hPct: number;
    fgLow: number;
    fgHigh: number;
    steemMovePct: number;
    gridStaleHours: number;
  } | null;
  market: {
    steem: MomentPrice;
    sbd: MomentPrice;
    btc: MomentPrice;
    eth: MomentPrice;
    trx: MomentPrice;
    global: { totalMarketCapUsd: number | null; marketCapChg24hPct: number | null; btcDominance: number | null } | null;
    fearGreed: { value: number | null; label: string | null } | null;
  };
  paritySbdPerSteem: number | null;
  liveBook: {
    bestBid: number | null;
    bestAsk: number | null;
    bidsDepthSbd: number;
    asksDepthSteem: number;
    levels: number;
    bidSurplusBps: number | null;
    askPositionBps: number | null;
  } | null;
  engineBook: { bestBid: number; bestAsk: number; mid: number; spreadBps: number } | null;
  grid: { verdict: string | null; armed: boolean | null; blocker: string | null; externalFlowUsd: number | null; publishedAt: string | null } | null;
  runway: {
    active: boolean;
    weeklySp: number;
    nextPayment: string | null;
    remainingSp: number;
    weeklyUsd: number | null;
    treasuryUsd: number | null;
  } | null;
  regime: { label: "RISK_ON" | "RISK_OFF" | "NEUTRAL" | "UNKNOWN"; drivers: string[]; reason?: string };
  insights: Array<{ kind: string; tone: "good" | "info" | "warn"; text: string }>;
  fleet: {
    url: string;
    publishedAt: string | null;
    regime: string | null;
    call: string | null;
    callStats: { resolved: number; hits: number; hitRatePct: number } | null;
    fleetFreshMin: number | null;
  } | null;
}

const REGIME_HE: Record<string, { label: string; cls: string }> = {
  RISK_ON: { label: "תיאבון (Risk-On)", cls: "text-emerald-300" },
  RISK_OFF: { label: "הימנעות (Risk-Off)", cls: "text-rose-300" },
  NEUTRAL: { label: "ניטרלי", cls: "text-zinc-300" },
  UNKNOWN: { label: "לא-נמדד", cls: "text-amber-300" },
};

// ── טיפוסי-המלאי (משקפים את /api/treasury בדיוק) ────────────────────

interface SteemAccountRow {
  name: string;
  steem: number;
  sbd: number;
  sp: number;
  receivedSp: number;
}
interface TreasuryData {
  ok: boolean;
  fetchedAt: string;
  cached?: boolean;
  cacheAgeSec?: number;
  down?: string[];
  usd: { total: number | null; liquid: number; vesting: number; deployed?: number; deployedExit?: number; missingPrices: string[] };
  steem?: {
    accounts: SteemAccountRow[];
    deployed?: { steem: number; sbd: number; sbdTarget: number; orders: number };
    powerdown: {
      active: boolean;
      weeklySteem: number;
      nextPayment: string | null;
      paymentsLeft: number;
      totalRemainingSteem: number;
    };
  };
  hive?: { accounts: Array<{ name: string; hive: number; hbd: number; hp: number }> };
  tron?: Array<{ label: string; address: string; trx: number; trc20: number }>;
  evm?: Array<{ label: string; address: string; eth: number; txsSent: number | null }>;
  sol?: Array<{ label: string; address: string; sol: number }>;
  btc?: Array<{ label: string; address: string; btc: number; txs: number }>;
  prices?: Record<string, number | null>;
  network?: {
    height?: number | null;
    treasuryProfitUsds?: number | null;
    backingWsteem?: number | null;
    depositsTotal?: number | null;
    gridVerdict?: string | null;
    gridArmed?: boolean | null;
    chains?: Record<string, string> | null;
    halted?: boolean | null;
    // r141 · אמת-בית: נוכחות-מפתח נמדדת (בוליאני, אפס-סוד) — לפתיח-השער
    house?: { keyPresent?: boolean } | null;
  };
}

interface ArmResult {
  ok: boolean;
  stage: string;
  reason?: string;
  secretName?: string;
  secretVerified?: boolean;
  gridDispatched?: boolean;
  publicKey?: string;
  links?: { gridLive?: string; actionsRuns?: string; secretsSettings?: string };
}

// ── עזרים ────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}
function dataAge(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "לפני פחות מדקה";
  if (s < 3600) return `לפני ${Math.round(s / 60)} דקות`;
  return `לפני ${Math.round(s / 3600)} שעות`;
}

// ── צ'יפ-מצב ────────────────────────────────────────────────────────

function StatusPill({
  icon: Icon,
  label,
  value,
  tone = "zinc",
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "emerald" | "rose" | "amber" | "zinc" | "gold";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    zinc: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
    gold: "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]",
  };
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", tones[tone])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-[11px] leading-tight">
        <span className="opacity-70">{label} </span>
        <span className="font-mono font-semibold">{value}</span>
      </span>
    </div>
  );
}

// ── כרטיס-מקטע ───────────────────────────────────────────────────────

function GateSection({
  icon: Icon,
  title,
  sub,
  children,
  id,
}: {
  icon: typeof Gauge;
  title: string;
  sub: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="scroll-mt-24" aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10">
          <Icon className="h-4.5 w-4.5 text-[#e8cd6e]" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{title}</h2>
          <p className="text-xs text-zinc-500">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ── הטיפה-הראשונה: הוכחה-חיה מהאתר-הציבורי ──────────────────────────

const DROP_TXID = "8d84e637f3ebc87b8248361a58342eb05014315beb9a9e9b6f3c1c403de9e917";
const DROP_CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const WORLD_URL = "https://roshpinacare-sys.github.io/Console/dex/world.json";

interface WorldMirror {
  ok?: boolean;
  publishedAt?: string;
  state?: { height?: number; backing?: Record<string, number> };
  wallets?: Array<{ name?: string; balances?: Record<string, number> }>;
}

function FirstDropProof() {
  const [w, setW] = useState<WorldMirror | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${WORLD_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setW((await r.json()) as WorldMirror);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 60));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const operatorWtrx =
    w?.wallets?.find((x) => x.name === "operator")?.balances?.WTRX ?? null;
  const backingWtrx = w?.state?.backing?.WTRX ?? null;
  const live = operatorWtrx != null && operatorWtrx > 0;
  return (
    <Card
      className={cn(
        "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.07] to-transparent",
      )}
    >
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xl" aria-hidden>💧</span>
          <h3 className="text-base font-bold text-zinc-100">
            הטיפה הראשונה — הכסף האמת הראשון בדלת
          </h3>
          <Badge
            className={cn(
              live
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-600/40 bg-zinc-600/10 text-zinc-400",
            )}
          >
            {live ? "נטען-חי מהאתר-הציבורי" : "ממתין לקריאה…"}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-zinc-300">
          הפקדה-אמיתית של <span className="font-semibold text-zinc-100">2.000 TRX</span> (TransferContract
          על-רשת-TRON) אומתה מול-RPC-ציבורי, והוטבעו מולה{" "}
          <span className="font-semibold text-emerald-300">2,000µ WTRX</span> — הנכס-העטוף הראשון
          בהיסטוריה-של-הרשת שמגובה 1:1 בכסף-אמת שנמדד-חי. ה-TRX של ההפקדה נשאר בכתובת-המשמורת
          כגיבוי-פיזי — הגיבוי נמדד-חי למטה;{" "}
          ה-WTRX הוא זכות-הפדיון המתועדת.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">כתובת-המשמורת (TRON)</div>
            <a
              className="break-all font-mono text-[11px] text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]"
              href={`https://tronscan.org/#/address/${DROP_CUSTODY}`}
              target="_blank"
              rel="noreferrer"
            >
              {DROP_CUSTODY}
            </a>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">העסקה על-השרשרת (Tronscan)</div>
            <a
              className="break-all font-mono text-[11px] text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]"
              href={`https://tronscan.org/#/transaction/${DROP_TXID}`}
              target="_blank"
              rel="noreferrer"
            >
              {DROP_TXID.slice(0, 26)}…
            </a>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">התביעה בספר (חד-פעמית)</div>
            <div className="break-all font-mono text-[11px] text-zinc-300">trx:{DROP_TXID.slice(0, 18)}…</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">יתרת-המפעיל (חי)</div>
            <div className="font-mono text-lg font-bold text-emerald-300">
              {operatorWtrx != null ? `${operatorWtrx.toLocaleString()}µ WTRX` : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">גיבוי-האוצר (חי)</div>
            <div className="font-mono text-lg font-bold text-emerald-300">
              {backingWtrx != null ? `${backingWtrx.toLocaleString()}µ` : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">מקור-המדידה</div>
            <div className="font-mono text-[11px] text-zinc-400">
              {w ? `world.json · h${w.state?.height} · ${w.publishedAt?.slice(11, 16) ?? "?"}Z` : err ? `קריאה נכשלה (${err})` : "…"}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            כל-מספר בכרטיס נקרא בזמן-פתיחת-העמוד מהמראה-הציבורית שפרסם הלב (GitHub Pages) — לא מהאתר-הזה. אם-הוא
            מופיע-כאן, הוא נכתב על-ידי השרשרת-הקנונית ונראה-לכל-אדם.
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} className="shrink-0">
            <RefreshCw className="ml-1 h-3.5 w-3.5" aria-hidden />
            רענן
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── המחזור-המלא-הראשון: הוכחה-חיה מהמראה-הציבורית ────────────────────

const RECEIPT_URL = "https://roshpinacare-sys.github.io/Console/receipts/r35-full-cycle.json";
const ENGINE_COMMIT = "https://github.com/roshpinacare-sys/saos-dex/commit/afccfff";

interface CycleMirror {
  ok?: boolean;
  publishedAt?: string;
  version?: number;
  state?: {
    height?: number;
    backing?: Record<string, number>;
    assets?: Record<string, { refPrice?: number; listed?: number }>;
    oracle?: Record<string, { mu?: number; atH?: number; src?: string }>;
  };
  pools?: Array<{ a?: string; b?: string; ra?: number; rb?: number; lp?: number; swaps?: number; feeAccruedTreasury?: number }>;
  wallets?: Array<{ name?: string; balances?: Record<string, number> }>;
}

function FullCycleProof() {
  const [w, setW] = useState<CycleMirror | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${WORLD_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setW((await r.json()) as CycleMirror);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 60));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const pool = w?.pools?.find((p) => p.a === "USDS" && p.b === "WTRX") ?? null;
  const wallet = (n: string) => w?.wallets?.find((x) => x.name === n)?.balances ?? null;
  const op = wallet("operator");
  const outbox = wallet("peg-outbox");
  const treasury = wallet("treasury"); // r124 · מפקד-אמת: לאוצר יש מלאי-מעמלות WTRX משלו
  const oracleMu = w?.state?.oracle?.WTRX?.mu ?? null;
  const midMilli = pool && pool.rb ? Math.floor(((pool.ra ?? 0) * 1000) / pool.rb) : null;
  const oracleMilli = oracleMu != null ? Math.round(oracleMu / 1000) : null;
  const spreadBps =
    midMilli != null && oracleMilli
      ? Math.round(((midMilli - oracleMilli) / oracleMilli) * 10_000)
      : null;
  const verdict =
    spreadBps == null ? null : Math.abs(spreadBps) < 300 ? "CONVERGED" : Math.abs(spreadBps) < 1500 ? "DRIFT" : "DIVERGENT";
  // r124 · חוק הסכום המלא: ההבטחה הקנונית היא “סך-כל ה-WTRX בעולם = הגיבוי”. הנוסחה
  // הישנה (מפעיל+תיבת-יציאה+בריכה) שכחה את ארנק האוצר — נתפס חי לאחר שהוי
  // התמידי הוסר ב-r124: 1,568µ ≠ 2,000µ שקר נגד אמת של 432µ באוצר. האינווריאנטה
  // בשרשרת תקינה; הנוסחה במראה היא שהייתה שבורה.
  const sumLive =
    (op?.WTRX ?? 0) + (outbox?.WTRX ?? 0) + (pool?.rb ?? 0) + (treasury?.WTRX ?? 0);
  const backingWtrx = w?.state?.backing?.WTRX ?? null;
  const live = pool != null && op != null && outbox != null;

  return (
    <Card className="border-[#d4af37]/30 bg-gradient-to-b from-[#d4af37]/[0.08] to-transparent">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Coins className="h-5 w-5 text-[#e8cd6e]" aria-hidden />
          <h3 className="text-base font-bold text-zinc-100">
            המחזור-המלא-הראשון — מהפקדה ועד תביעת-פדיון
          </h3>
          <Badge
            className={cn(
              verdict === "CONVERGED"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : verdict
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-zinc-600/40 bg-zinc-600/10 text-zinc-400",
            )}
          >
            {live ? (verdict ? `שוק-חי · ${verdict}` : "נטען…") : "ממתין לקריאה…"}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-zinc-300">
          הכסף-האמת שנכנן בדלת (2.0 TRX → 2,000µ WTRX) עבר את כל המסלול הכלכלי על השרשרת-הקנונית:{" "}
          <span className="font-semibold text-zinc-100">רישום בסולם-הערך</span> (refPrice 335, h21496) ·{" "}
          <span className="font-semibold text-zinc-100">פתיחת שוק-חי USDS/WTRX</span> במחיר-האורקל ·{" "}
          <span className="font-semibold text-zinc-100">המכירה-האמיתית הראשונה</span> 30µ WTRX → 9µ USDS ·{" "}
          <span className="font-semibold text-zinc-100">קנייה-חזרה</span> 9µ USDS → 27µ WTRX (שוק דו-כיווני) ·{" "}
          <span className="font-semibold text-zinc-100">תביעת-הפדיון הראשונה</span> — 100µ לתיבת-היציאה
          עם יעד-TRON חתום.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[#d4af37]/20 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">השוק החי (USDS/WTRX)</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-[#e8cd6e]">
              {pool ? `${(pool.ra ?? 0).toLocaleString()}µ USDS + ${(pool.rb ?? 0).toLocaleString()}µ WTRX` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {pool ? `LP ${pool.lp?.toLocaleString() ?? 0}µ · ${pool.swaps ?? 0} החלפות` : "ממתין למראה"}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">עוגן-חי מול אורקל</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
              {midMilli != null && oracleMilli ? `mid ${midMilli} מול ${oracleMilli}mµ` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {spreadBps != null ? `${spreadBps > 0 ? "+" : ""}${spreadBps}bps · ${verdict}` : "ממתין למראה"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">תיבת-היציאה — תביעת-פדיון</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-[#e8cd6e]">
              {outbox ? `${(outbox.WTRX ?? 0).toLocaleString()}µ WTRX` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">ממתין לשידור-המפעיל מהמשמרת</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">יתרת-המפעיל אחרי המחזור (חי)</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-zinc-100">
              {op ? `${(op.WTRX ?? 0).toLocaleString()}µ WTRX · ${(op.USDS ?? 0).toLocaleString()}µ USDS` : "…"}
            </div>
          </div>
          <div
            className={
              live && backingWtrx != null && sumLive !== backingWtrx
                ? "rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3"
                : "rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3"
            }
          >
            <div className="text-[11px] text-zinc-500">אינווריאנטה חיה (סכום = גיבוי)</div>
            <div
              className={
                "mt-0.5 font-mono text-sm font-bold " +
                  (live && backingWtrx != null && sumLive !== backingWtrx
                    ? "text-rose-300"
                    : "text-emerald-300")
              }
            >
              {live && backingWtrx != null
                ? sumLive === backingWtrx
                  ? `${sumLive.toLocaleString()}µ = ${backingWtrx.toLocaleString()}µ ✓`
                  : `${sumLive.toLocaleString()}µ ≠ ${backingWtrx.toLocaleString()}µ ✗ שבר-אינווריאנטה`
                : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">מפעיל + תיבת-יציאה + בריכה + אוצר = 2.0 TRX במשמרת</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">מקור-המדידה</div>
            <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
              {w ? `world.json · h${w.state?.height} · ${w.publishedAt?.slice(11, 16) ?? "?"}Z` : err ? `קריאה נכשלה (${err})` : "…"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={RECEIPT_URL} target="_blank" rel="noreferrer">
              קבלת-מכונה (JSON)
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href="https://roshpinacare-sys.github.io/Console/receipts/" target="_blank" rel="noreferrer">
              קיר-הקבלות
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={ENGINE_COMMIT} target="_blank" rel="noreferrer">
              commit השרשרת (afccfff)
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={`https://tronscan.org/#/transaction/${DROP_TXID}`} target="_blank" rel="noreferrer">
              הפקדה ב-Tronscan
            </a>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} className="shrink-0">
            <RefreshCw className="ml-1 h-3.5 w-3.5" aria-hidden />
            רענן
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── הדלת: הזנת-המפתח ────────────────────────────────────────────────

function ArmDoor({ onArmed }: { onArmed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ArmResult | null>(null);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      // r185 · D-OP-01: אפס קלט — השרת שואב את ה-WIF מכספת הסוכנים בעצמו
      const r = await fetch("/api/arm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as ArmResult;
      setResult(j);
      if (j.ok) {
        toast.success(
          j.gridDispatched
            ? "המפתח נשאב מהכספת, אומת מול השרשרת ונחתם כסוד-GitHub. הגריד שוגר."
            : "המפתח נשאב מהכספת, אומת מול השרשרת ונחתם כסוד-GitHub. הגריד לא שוגר מכאן — לוח-הזמנים בענן יריץ.",
        );
        onArmed();
      } else {
        toast.error(j.reason ?? "האימות נכשל");
      }
    } catch (e) {
      toast.error(`שגיאת רשת: ${String((e as Error).message).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, onArmed]);

  return (
    <Card className="border-[#d4af37]/25 bg-gradient-to-b from-[#d4af37]/[0.06] to-transparent">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-[auto_1fr]">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#e8cd6e]" aria-hidden />
            <span className="font-semibold text-zinc-100">איך הדלת בנויה:</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <li>
              <span className="text-zinc-200">אימות מול השרשרת:</span> המפתח נשאב מכספת הסוכנים בשרת (r185 — אפס קלט), נגזר למפתח-ציבורי ומושווה ביט-מול-ביט מול
              הסמכות החיה של <span className="font-mono">@headcorner</span> ב-api.steemit.com. אין התאמה — הבקשה נעצרת לפני שנוגעים במשהו.
            </li>
            <li>
              <span className="text-zinc-200">אפס אחסון מקומי:</span> המפתח לא נכתב לדיסק, ללוג, או לתשובה — רק עובר
              בזיכרון הבקשה אל חתימת-סגור של libsodium (sealed box) שרק GitHub יכול לפתוח, ונשמר כסוד-Actions בשם{" "}
              <span className="font-mono">STEEM_ACTIVE_WIF</span> בריפו המנוע הפרטי.
            </li>
            <li>
              <span className="text-zinc-200">ההדלקה מידית:</span> מיד אחרי האטימה משוגר רץ-ה-dex-grid (לא מחכים ל-03:17) —
              ואפשר לראות את הגריד מתחמש בפומבי.
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              onClick={submit}
              disabled={busy}
              className="gap-2 border-[#d4af37]/40 bg-[#d4af37]/15 text-[#e8cd6e] hover:bg-[#d4af37]/25"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {busy ? "שואב מהכספת ומאמת מול השרשרת…" : "אמת וחמש את הגריד — אפס קלט"}
            </Button>
            <span className="text-[11px] text-zinc-500">
              אין כאן הזנת-מפתח ולא תהיה: המקור הוא כספת הסוכנים בשרת, והשרשרת היא השופט.
            </span>
          </div>
        </div>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-lg border p-4 text-sm",
              result.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200",
            )}
            role="status"
          >
            {result.ok ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  הדלת נפתחה: הסוד {result.secretName} נשמר ואומר ברשימת הסודות
                  {result.secretVerified ? "" : " (אימות-חוזר לא הושלם — בדוק בקישור)"}
                </p>
                <p className="text-xs text-emerald-300/80">
                  dex-grid {result.gridDispatched ? "שוגר כעת — הריצה החיה תתפרסם בקונסולה בתוך דקות" : "ירוץ בלוח-הזמנים היומי (03:17 UTC)"}
                </p>
                <div className="flex flex-wrap gap-3 pt-1 text-xs">
                  {result.links?.gridLive && (
                    <a href={result.links.gridLive} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      מצב-הגריד החי <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {result.links?.actionsRuns && (
                    <a href={result.links.actionsRuns} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      ריצות-ה-Actions <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {result.links?.secretsSettings && (
                    <a href={result.links.secretsSettings} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      הגדרות-הסודות בריפו <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {result.reason} <span className="opacity-70">(שלב: {result.stage})</span>
                </span>
              </p>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

// ── הבנת-הרגע: לא תוכנית קבועה — קריאת-שוק חיה ────────────────────

function MomentSection() {
  const [m, setM] = useState<MomentData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/moment", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setM((await r.json()) as MomentData);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 60));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const regime = m ? (REGIME_HE[m.regime.label] ?? REGIME_HE.UNKNOWN) : null;
  const bidSurplus = m?.liveBook?.bidSurplusBps ?? null;
  const steem = m?.market.steem;
  const sbd = m?.market.sbd;
  const btc = m?.market.btc;
  const fg = m?.market.fearGreed;
  const g = m?.market.global;

  const toneIcon = (tone: "good" | "info" | "warn", cls: string) =>
    tone === "good" ? (
      <CheckCircle2 className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", cls)} aria-hidden />
    ) : tone === "warn" ? (
      <ShieldAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", cls)} aria-hidden />
    ) : (
      <Activity className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", cls)} aria-hidden />
    );

  return (
    <GateSection
      id="moment"
      icon={Radar}
      title="הבנת-הרגע — מה השוק אומר עכשיו"
      sub="לא תוכנית קבועה אלא קריאה חיה: משטר, קו-זהות, עומקים ותובנות — כל מספר נמדד ברגע הזה, ונצלב מול סוכן-הענן."
    >
      <div className="space-y-3">
        {/* כרטיסי-הרגע */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Gauge className="h-3.5 w-3.5" aria-hidden /> משטר-השוק
              </div>
              {m ? (
                <>
                  <p className={cn("mt-1 text-lg font-black", regime?.cls)}>{regime?.label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    {m.regime.drivers.join(" · ")}
                    {g?.marketCapChg24hPct != null &&
                      ` · שווי-עולמי ${g.marketCapChg24hPct >= 0 ? "+" : ""}${g.marketCapChg24hPct.toFixed(1)}%`}
                  </p>
                </>
              ) : (
                <Skeleton className="mt-2 h-7 w-24" />
              )}
            </CardContent>
          </Card>

          <Card className={cn(bidSurplus != null && bidSurplus < 0 && "border-emerald-500/25")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Coins className="h-3.5 w-3.5" aria-hidden /> קו-הזהות מול הספר החי
              </div>
              {m?.liveBook ? (
                <>
                  <p className="mt-1 font-mono text-lg font-bold text-zinc-100">
                    {bidSurplus != null ? (
                      <span className={bidSurplus < 0 ? "text-emerald-300" : "text-amber-300"}>
                        {bidSurplus < 0 ? "−" : "+"}
                        {Math.abs(bidSurplus).toLocaleString()} bps
                      </span>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    {bidSurplus != null && bidSurplus < 0
                      ? "עומק-קנייה מתחת לקו — עודף מדוד לגריד"
                      : "הספר מעל הקו — הגריד ממתין"}{" "}
                    · bid {m.liveBook.bestBid?.toFixed(4)} / ask {m.liveBook.bestAsk?.toFixed(4)} · parity{" "}
                    {m.paritySbdPerSteem?.toFixed(4)}
                  </p>
                </>
              ) : (
                <Skeleton className="mt-2 h-7 w-24" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden /> הנכסים שלנו (חי)
              </div>
              {steem ? (
                <>
                  <p className="mt-1 font-mono text-lg font-bold text-zinc-100">
                    ${steem.usd?.toFixed(4) ?? "—"}{" "}
                    <span
                      className={cn(
                        "text-xs",
                        (steem.chg24h ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {(steem.chg24h ?? 0) >= 0 ? "+" : ""}
                      {steem.chg24h?.toFixed(1)}%
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    STEEM · SBD ${sbd?.usd?.toFixed(4) ?? "—"} · BTC{" "}
                    {(btc?.chg24h ?? 0) >= 0 ? "+" : ""}
                    {btc?.chg24h?.toFixed(1) ?? "—"}%
                  </p>
                </>
              ) : (
                <Skeleton className="mt-2 h-7 w-24" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Banknote className="h-3.5 w-3.5" aria-hidden /> אוצר-המפקד (סימון חי)
              </div>
              {m?.runway ? (
                <>
                  <p className="mt-1 font-mono text-lg font-bold text-[#e8cd6e]">
                    {m.runway.treasuryUsd != null ? `$${m.runway.treasuryUsd.toFixed(0)}` : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    דלק שבועי ≈ ${m.runway.weeklyUsd?.toFixed(1) ?? "—"} · הבא{" "}
                    {m.runway.nextPayment?.slice(5, 10) ?? "—"}
                  </p>
                </>
              ) : (
                <Skeleton className="mt-2 h-7 w-24" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* תובנות-הרגע */}
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <p className="text-sm font-bold text-zinc-200">תובנות-הרגע — מה רלוונטי עכשיו</p>
              {fg?.value != null && (
                <span className="font-mono text-[11px] text-zinc-500">
                  פחד-ותאווה: {fg.value} ({fg.label})
                </span>
              )}
            </div>
            <ul className="max-h-64 space-y-2.5 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-zinc-300">
              {err && (
                <li className="flex gap-2">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                  <span>קריאת-הרגע נכשלה ({err}) — שום מספר לא הומצא.</span>
                </li>
              )}
              {!err && !m && (
                <li className="flex gap-2">
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" aria-hidden />
                  <span>מודד את הרגע…</span>
                </li>
              )}
              {(m?.insights ?? []).map((ins, i) => (
                <li key={`${ins.kind}-${i}`} className="flex gap-2">
                  {toneIcon(
                    ins.tone,
                    ins.tone === "good" ? "text-emerald-400" : ins.tone === "warn" ? "text-amber-400" : "text-zinc-400",
                  )}
                  <span>{ins.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* צליבת-הצי */}
        <Card className="border-zinc-800">
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {m?.fleet ? (
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              ) : (
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
              )}
              <div>
                <p className="text-sm font-bold text-zinc-200">צליבת-הצי — סוכן הבנת-הרגע בענן</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  {m?.fleet?.publishedAt ? (
                    <>
                      פרסם לפני {m.fleet.fleetFreshMin ?? "?"} דק\' · משטר שנמדד שם: {m.fleet.regime ?? "—"}
                      {m.fleet.callStats &&
                        ` · קריאות-כיוון שהוכרעו: ${m.fleet.callStats.resolved}${m.fleet.callStats.hitRatePct != null ? ` (דיוק ${m.fleet.callStats.hitRatePct}%)` : " — הדיוק יימדד מהקריאה המוכרעת הראשונה"}`}
                    </>
                  ) : (
                    "סוכן moment-watch ממתין לריצתו הראשונה בענן — עד אז עמוד זה הוא המודד היחיד, וזו האמת."
                  )}
                </p>
              </div>
            </div>
            <a
              href="https://github.com/roshpinacare-sys/Domain/actions/workflows/moment-watch.yml"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]"
            >
              ריצות הסוכן בענן ↗
            </a>
          </CardContent>
        </Card>

        <p className="text-[11px] leading-relaxed text-zinc-600">
          ספי-המדיניות מפורסמים ומוצגים: BTC ±{m?.thresholds ? m.thresholds.btc24hPct : "?"}% · פחד-ותאווה{" "}
          {m?.thresholds ? `${m.thresholds.fgLow}/${m.thresholds.fgHigh}` : "?"} · STEEM ±
          {m?.thresholds ? m.thresholds.steemMovePct : "?"}% · ישנות-מראה{" "}
          {m?.thresholds ? m.thresholds.gridStaleHours : "?"}ש\'. מקורות: CoinGecko · alternative.me · api.steemit.com ·
          מראות הצי ב-GitHub Pages. אין כאן ניבוי — רק מה שנמדד.
        </p>
      </div>
    </GateSection>
  );
}

// ── התצוגה הראשית ────────────────────────────────────────────────────────

export function GateView() {
  const [data, setData] = useState<TreasuryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const reduced = useReducedMotion();
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/treasury", { cache: "no-store" });
      const j = (await r.json()) as TreasuryData;
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 90));
    } finally {
      setRefreshing(false);
      firstLoad.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const head = useMemo(
    () => data?.steem?.accounts.find((a) => a.name === "headcorner") ?? null,
    [data],
  );
  const gridArmed = data?.network?.gridArmed === true;
  const powerdown = data?.steem?.powerdown;

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: Math.min(i * 0.06, 0.3), duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
      {/* ── פתיח-השער ── */}
      <motion.div {...fade(0)} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]">שער המפעיל</Badge>
          <span className="text-xs text-zinc-500">הדלת היחידה שבה המערכת מתחברת לכסף האמת</span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50 sm:text-3xl">
          איפה הכסף, איפה המפתח, ומה באמת רץ
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          כל מספר בעמוד הזה נקרא כרגע מהשרשרות הציבוריות (Steem, Hive, TRON, Ethereum, Solana,
          Bitcoin) ומהבורסות — לא מהזיכרון, לא מהצהרות.{" "}
          {gridArmed
            ? data?.network?.house?.keyPresent === true
              ? "מפתח-המנוע חי בבית ובענן — הסולם החי נחתם ומוצב מהבית (קבלות txid) והגריד החוץ חמוש"
              : "מפתח-המנוע חי בענן (סוד-GitHub) והגריד מניח פקודות אמת עם txids"
            : "מפתח-המנוע לא נמדד כחמוש כרגע — דלת-ההפעלה למטה מזינה אותו"}
          ; מה שעדיין חסום — כתוב בעמודת "חסום (ולמה)" עם הסיבה המדויקת לכל שורה.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusPill
            icon={Gauge}
            label="גובה-השרשרת הפנימית"
            value={data?.network?.height != null ? `h${data.network.height}` : "…"}
            tone="zinc"
          />
          <StatusPill
            icon={gridArmed ? ShieldCheck : CircleSlash}
            label="הגריד החוץ"
            value={gridArmed ? "חמוש" : data?.network?.gridVerdict ?? "…"}
            tone={gridArmed ? "emerald" : "rose"}
          />
          <StatusPill
            icon={Wallet}
            label="הפקדות חוץ שנספרו"
            value={String(data?.network?.depositsTotal ?? "…")}
            tone={Number(data?.network?.depositsTotal ?? 0) > 0 ? "emerald" : "zinc"}
          />
          <StatusPill
            icon={Fuel}
            label="דלק-ה-powerdown"
            value={
              powerdown?.active
                ? `${fmtNum(powerdown.weeklySteem, 0)} STEEM בשבוע, עוד ${powerdown.paymentsLeft} תשלומים`
                : "לא פעיל"
            }
            tone={powerdown?.active ? "gold" : "zinc"}
          />
          {data?.cached && (
            <span className="text-[11px] text-zinc-600">
              מטמון {data.cacheAgeSec}s · נמדד {dataAge(data.fetchedAt)}
            </span>
          )}
        </div>
        {err && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            קריאת-המלאי נכשלה: {err} — נסה רענון. אף מספר לא מוצג מסתם.
          </p>
        )}
        {data?.down && data.down.length > 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            מקורות שלא ענו כרגע: {data.down.join(" · ")} — הם לא נספרים בסכומים.
          </p>
        )}
      </motion.div>

      {/* ── הטיפה הראשונה — הוכחה חיה ── */}
      <motion.div {...fade(1)}>
        <FirstDropProof />
      </motion.div>

      {/* ── המחזור-המלא-הראשון — הוכחה חיה ── */}
      <motion.div {...fade(1)}>
        <FullCycleProof />
      </motion.div>

      {/* ── מלאי-אמת ── */}
      <motion.div {...fade(1)}>
        <GateSection
          id="inventory"
          icon={Banknote}
          title="מה יש באמת — מלאי חי של כל ארנקי הרשת"
          sub="נקרא עכשיו מכל שרשרת ב-RPC ציבורי. ארנק שלא ענה לא נספר."
        >
          {firstLoad.current && !data ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">שווי-כסף אמת (כל השרשרות)</p>
                    <p className="mt-1 font-mono text-2xl font-black text-[#e8cd6e]">
                      ${fmtUsd(data?.usd.total)}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      נזיל + פרוש-בסולם + כלוא — במחירים חיים ({dataAge(data?.fetchedAt ?? new Date().toISOString())})
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">נזיל כרגע (מימוש מיידי)</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-zinc-100">${fmtUsd(data?.usd.liquid)}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">STEEM, SBD, TRX, אבק-ETH — הכל נזיל</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-500/25">
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">פרוש בסולם-המכירה — עובד עכשיו</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-emerald-300">${fmtUsd(data?.usd.deployed ?? 0)}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {data?.steem?.deployed?.steem != null && data.steem.deployed.steem > 0
                        ? `${fmtNum(data.steem.deployed.steem, 3)} STEEM ב-${data.steem.deployed.orders} פקודות · יציאה מלאה ${fmtUsd(data.usd.deployedExit ?? 0)}$`
                        : "המוביל מחזיק את הסולם על קו-הפאריטה — כל דלק נכנס נפרש מיד"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">כלוא ב-Steam-Power (13 שבועות שחרור)</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-zinc-100">${fmtUsd(data?.usd.vesting)}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {fmtNum(head?.sp ?? null, 0)} SP של המפקד + הצי —{" "}
                      {data?.usd?.vesting != null && data.usd.total != null && data.usd.total > 0
                        ? `זה כ-${Math.round((data.usd.vesting / data.usd.total) * 100)}% מההון`
                        : "רוב ההון"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* דלק-ה-powerdown */}
              {powerdown?.active && (
                <Card className="border-[#d4af37]/25">
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Flame className="mt-0.5 h-5 w-5 shrink-0 text-[#e8cd6e]" aria-hidden />
                      <div>
                        <p className="text-sm font-bold text-zinc-100">דלק-המסילה: ה-powerdown הפעיל של המפקד</p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          ההעברה האוטומטית היחידה שמזרימה כסף אמת פנימה בלי הפקדות: תשלום-ה-powerdown מנחית
                          {" "}{fmtNum(powerdown.weeklySteem)} STEEM נזילים בחשבון. זה מה שהגריד החמוש יסחר.
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-1 text-left" dir="ltr">
                      <p className="font-mono text-lg font-bold text-[#e8cd6e]">
                        {fmtNum(powerdown.totalRemainingSteem, 0)} STEEM
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        נותרו {powerdown.paymentsLeft} תשלומים · הבא:{" "}
                        {powerdown.nextPayment ? new Date(powerdown.nextPayment).toLocaleDateString("he-IL") : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* טבלאות-השרשרות */}
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardContent className="p-0">
                    <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                      Steem — צי ה-13 (STEEM נזיל + SP)
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-950/95 text-zinc-500">
                          <tr>
                            <th className="px-4 py-2 text-right font-medium">חשבון</th>
                            <th className="px-2 py-2 text-left font-mono font-medium">STEEM</th>
                            <th className="px-2 py-2 text-left font-mono font-medium">SBD</th>
                            <th className="px-4 py-2 text-left font-mono font-medium">SP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data?.steem?.accounts ?? []).map((a) => (
                            <tr key={a.name} className="border-t border-zinc-900">
                              <td className="px-4 py-2 font-mono text-zinc-300">{a.name}</td>
                              <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.steem)}</td>
                              <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.sbd)}</td>
                              <td className="px-4 py-2 text-left font-mono text-zinc-200">
                                {a.sp > 0.5 ? fmtNum(a.sp, 0) : "—"}
                                {a.receivedSp > 0.5 && (
                                  <span className="text-[10px] text-zinc-600"> (+{fmtNum(a.receivedSp, 0)} מואצל)</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {[
                    {
                      title: "Hive — אותם 13 חשבונות",
                      rows: (data?.hive?.accounts ?? []).filter((a) => a.hive > 0 || a.hbd > 0 || a.hp > 0.01),
                      cols: ["hive", "hbd", "hp"],
                    },
                  ].map((sec) => (
                    <Card key={sec.title}>
                      <CardContent className="p-0">
                        <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                          {sec.title}
                        </div>
                        <div className="max-h-32 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-zinc-950/95 text-zinc-500">
                              <tr>
                                <th className="px-4 py-2 text-right font-medium">חשבון</th>
                                <th className="px-2 py-2 text-left font-mono font-medium">HIVE</th>
                                <th className="px-2 py-2 text-left font-mono font-medium">HBD</th>
                                <th className="px-4 py-2 text-left font-mono font-medium">HP</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-4 py-3 text-center text-zinc-600">
                                    אפס נזיל — ה-RC של העיגון אכל הכל
                                  </td>
                                </tr>
                              ) : (
                                sec.rows.map((a: any) => (
                                  <tr key={a.name} className="border-t border-zinc-900">
                                    <td className="px-4 py-2 font-mono text-zinc-300">{a.name}</td>
                                    <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.hive)}</td>
                                    <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.hbd)}</td>
                                    <td className="px-4 py-2 text-left font-mono text-zinc-200">{fmtNum(a.hp, 1)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <Card>
                    <CardContent className="p-0">
                      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                        ארנקי-החוץ (TRON / ETH / SOL / BTC)
                      </div>
                      <div className="max-h-44 overflow-y-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {(data?.tron ?? []).map((t) => (
                              <tr key={t.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{t.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(t.trx)} TRX</td>
                              </tr>
                            ))}
                            {(data?.evm ?? []).map((e) => (
                              <tr key={e.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">
                                  {e.label}
                                  {e.txsSent != null && e.txsSent > 0 && (
                                    <span className="text-[10px] text-zinc-600"> · {e.txsSent} עסקאות נשלחו מהכתובת</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">
                                  {e.eth > 0 ? e.eth.toExponential(2) : "0"} ETH
                                </td>
                              </tr>
                            ))}
                            {(data?.sol ?? []).map((s) => (
                              <tr key={s.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{s.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(s.sol)} SOL</td>
                              </tr>
                            ))}
                            {(data?.btc ?? []).map((b) => (
                              <tr key={b.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{b.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(b.btc, 8)} BTC</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-500">
                הערת-אמת על ההיסטוריה שנמדדה בשרשרות: ה-ETH של כתובת-ההפקדה קיבל פעם אחת 0.0002 ETH
                ונשלח משם 0.000186 ETH לסוכן הלב — שכל אותם חתימות-לב-פעימות שרפו כמעט הכל בגז. מה שנשאר
                בחוץ זה אבק. ההון האמת חי ב-Steam-Power של המפקד, והוא משתחרר ב-powerdown שבועי.
              </p>
            </div>
          )}
        </GateSection>
      </motion.div>

      {/* ── הדלת ── */}
      <motion.div {...fade(2)}>
        <GateSection
          id="door"
          icon={DoorOpen}
          title="הדלת — חימוש-מחדש מבוקר של הגריד"
          sub="הדלת מזינה את מקור-החתימה המקומי של הבית; מצב-החי של הבית (חתום/עיוור) מוצג בפס-המדידה בכרטיס ההפעלה."
        >
          <ActivationDoorCard />
          <ArmDoor
            onArmed={() => {
              setTimeout(load, 20_000);
              setTimeout(load, 90_000);
            }}
          />
        </GateSection>
      </motion.div>

      {/* ── שער-העסקאות (R97) ── */}
      <motion.div {...fade(3)}>
        <GateSection
          id="tx-gate"
          icon={Scale}
          title="שער-העסקאות — אוטונומיה עד הסף החי, אישור-מפעיל מעליו"
          sub="הוראת המפעיל: המערכת פועלת לבד; רק עסקאות באמת גדולות (מעל הסף) ממתינות להחלטת המפעיל. כל הכרעה — עם ערך-USD חי וקבלה."
        >
          <TxGateCard />
        </GateSection>
      </motion.div>

      {/* ── מה-רץ-בפועל ── */}
      <motion.div {...fade(3)}>
        <GateSection
          id="truth"
          icon={ShieldAlert}
          title="מה רץ בפועל — עמודת-האמת של היום"
          sub="לא מה שכתוב. מה שנמדד כרגע, עם הסיבה לכל שורה."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-emerald-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-emerald-300">
                  <PlayCircle className="h-4 w-4" aria-hidden /> רץ באמת (נמדד כרגע)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      לב-הבורסה בענן: שרשרת פנימית בגובה{" "}
                      <span className="font-mono text-emerald-300">h{data?.network?.height ?? "…"}</span>, פועם כל-שעתיים,
                      רווח-אוצר פנימי {fmtUsd(data?.network?.treasuryProfitUsds, 0)}$ מעמלות.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      צופה-ההפקדות: ארבע שרשרות נקראות בלי-מפתח (קצב מוגדר בקוד: כל 20 דקות — לא נמדד כאן)
                      {data?.network?.chains ? ` (${Object.values(data.network.chains).join(" · ")})` : ""}.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      פרימיטיבים ציבוריים חיים בכל-טיק: אצוות-CoW, DCA, טריגרים, ארביטראז'-פרוטוקול, ראוטר-שריפה —
                      מונים אמת במראה הציבורי.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      מסדרון-העוגן מרפא את עצמו כל-פעימה מאז התיקון: מחיר-ה-WSTEEM הפנימי נצמד למחיר החוץ האמת.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-rose-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-rose-300">
                  <CircleSlash className="h-4 w-4" aria-hidden /> חסום (ולמה)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      {gridArmed ? (
                        <>
                          הגריד-החוץ חי ומזוין — אבל צד-הקנייה {" "}
                          {(head?.sbd ?? 0) * 0.9 < 0.15 ? (
                            <>חסום על מלאי-SBD: ‏{fmtNum(head?.sbd, 3)} נזיל כרגע מול סף-החימוש שנקבע בקוד (0.15 SBD לאחר פקטור-מחויבות 0.9 — המלאי והסף החיים מוצגים בלוח-הכספים).</>
                          ) : (
                            <>מחומש: מלאי ה-SBD החי ({fmtNum(head?.sbd, 3)}) מעל סף-החימוש — סולם-הקנייה יכול להיפתח בפעולה הבאה.</>
                          )}{" "}
                          המפתח כבר חי בכספת המנוע (STEEM_ACTIVE_WIF, נמדד ב-API) ופקודות אמת מונחות עם txids;
                        </>
                      ) : (
                        <>הגריד-החוץ לא נמדד כחמוש — ממתין להזנה; דלת-ההפעלה למטה היא שמזינה את מפתח-המנוע;</>
                      )}{" "}
                      ה-SBD היחיד שזורם מגיע ממכירות-הפרימיה שלנו עצמנו — זהו קצב-הבנייה של הצד השני.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      שידור-ETH/SOL כבוי בשערי-מדיניות (ETH_BROADCAST_ENABLED=false וכן ב-SOL) והמפתחות נמחקו עם
                      איפוסי-הסנדבוקס — אין ערוץ-חוץ חי מלבד Steem, וזה נכון כך: שידור-חוץ אוטומי בלי גוף
                      מורשה הוא סיכון חוקי וכספי שאנחנו לא לוקחים.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      משמרת המפתחות של הצי (כספת מוצפנת) חיה בריפו הפרטי — לא במכונה הזו, ובכוונה אין לה דלת
                      אוטומטית: דלת מתועדת לסוכנים היא דלת מתועדת לכל פורץ. גישה — אדם בלבד, ידנית, מתועדת.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      אפס הפקדות-חוץ מאז פתיחת הדלת לציבור — המעגל האמיתי טרם נסגר אף-פעם בכסף של מישהו אחר.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      המרת-הטוקנים לנזילות אמת: SAOS/USDS הם יחידות-פנים — אין להם ערך-חוץ, והבטחת המרה לציבור
                      היא נייר-ערך לא-רשום. נזילות אמת נוצרת רק מעודף-הגריד המדוד ומדלק-ה-powerdown — עד
                      גוף משפטי מורשה. חסימה שנשארת בכוונה, לא תקלה.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-amber-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-amber-300">
                  <TrendingDown className="h-4 w-4" aria-hidden /> מדמם (עלות אמת)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      גז-ETH שנשרף בפעימות-הסוכנים: 93% ממה שהיה (0.0002 ETH) — הודלק בלי שער-עלות. התוקן: השערים
                      כבויים עד תקציב מודע.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      ההון ({
                        data?.usd?.vesting != null && data?.usd?.total != null && data.usd.total > 0
                          ? Math.round((data.usd.vesting / data.usd.total) * 100)
                          : "רוב"
                      }%) יושב ב-Steam-Power שלא מייצר כלום מלבד RC — חלון-13-השבועות מונע מימוש מהיר,
                      {powerdown?.paymentsLeft != null
                        ? `ה-powerdown מחלק אותו ב-${powerdown.paymentsLeft} תשלומים ונגמר.`
                        : "ה-powerdown מחלק אותו ונגמר — מספר-התשלומים לא נמדד."}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      הפער הפנימי: אלפי USDS פנימיים מול גיבוי-נזיל של{" "}
                      {data?.network?.backingWsteem != null ? `${fmtNum(data.network.backingWsteem, 0)} WSTEEM` : "—"} בערך
                      של עשרות דולרים בודדים. הזיכוי להפקדות תלוי בהון שיגיע, לא במה שיש.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </GateSection>
      </motion.div>

      {/* ── הבנת-הרגע ── */}
      <motion.div {...fade(4)}>
        <MomentSection />
      </motion.div>

      {/* ── איך-מתחילים-להזרים ── */}
      <motion.div {...fade(5)}>
        <GateSection
          id="flow"
          icon={Coins}
          title="איך מתחילים להזרים — צינור-הערך מכאן והלאה"
          sub="בלי המצאת כסף: הדלק הקיים, היתרון המדוד, והדלת שפותחת אותם."
        >
          <div className="space-y-3">
            {[
              {
                icon: CalendarClock,
                head: "תשלום-ה-powerdown השבועי — הדלק נוחת",
                body: "תשלום-ה-powerdown השבועי ממיר SP ל-STEEM נזיל בחשבון המפקד. זו הכניסה החד-משמעית של ערך אמת, בלי הפקדה של אף אחד.",
              },
              {
                icon: KeyRound,
                head: "הדלת — הסוד שפותח את הגריד",
                body: "ה-active נחתם כסוד-Actions ורץ-ה-dex-grid מתחמש: הוא קורא את ספר-STEEM הפנימי הציבורי, מפרוש מדפים של BID מתחת לקו-הזהות ו-ASK מעליו — יצרן-בלבד, אף-פעם לא חוצה את הספר.",
              },
              {
                icon: TrendingDown,
                head: "היתרון שנמדד — פער 20.7% בין השוק הפנימי לחוץ (נמדד 2026-09-24)",
                body: "הספר הפנימי של Steem סחר SBD/STEEM מתחת לקו-הזהות של הערך החיצוני. כל קנייה שם היא עודף מדוד (18% עד 29% במדידה מ-2026-09-24; עסקה אמיתית אחת לכדה אז 26.28%). מכירה רק מעל הקו — הפרמיה היא אופציה חינם. הפער החי נמדד בכל רגע בסעיף הבנת-הרגע.",
              },
              {
                icon: Banknote,
                head: "מילויים שנספרים בכנות",
                body: "כל מילוי-חוץ של הגריד נרשם בספר-הגריד הציבורי (grid.json) עם המחיר, השווי ב-USD והבקע מול הציון. הנזילות החוץ שנספרת היא זו שבאמת מגבה את חלון-הפדיון.",
              },
              {
                icon: DoorOpen,
                head: "ומהכיוון השני — הפקדות",
                body: "כתובות-ההפקדה בארבע שרשרות נצפות בלי-מפתח; תביעה חתומה של המפקיד מזוכה ב-USDS פנימי (תקרה למשתמש), ומשם: הבורסה הפנימית, האצוות, ה-DCA — וחלון-הפדיון שנפתח ככל שהגיבוי-הנזיל גדל מהגריד.",
              },
            ].map((s, i) => (
              <Card key={s.head}>
                <CardContent className="flex items-start gap-4 p-4 sm:p-5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 font-mono text-sm font-bold text-[#e8cd6e]">
                    {i + 1}
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                      <s.icon className="h-4 w-4 text-[#e8cd6e]" aria-hidden />
                      {s.head}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{s.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </GateSection>
      </motion.div>

      {/* ── רענון ── */}
      <motion.div {...fade(6)} className="flex items-center justify-between border-t border-zinc-900 pt-4">
        <p className="text-[11px] text-zinc-600">
          מקורות-המדידה: api.steemit.com · api.hive.blog · tronscan · publicnode · blockchain.info · binance ·
          הקונסולה הציבורית. רענון-אוטומטי כל-דקה.
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
          רענן מדידה
        </Button>
      </motion.div>
    </div>
  );
}
