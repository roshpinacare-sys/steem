"use client";

// ─────────────────────────────────────────────────────────────────────
// ARRAY VIEW · מצב המערך — המפה החיה של כל המערך (R39).
//
// תשובה ל"בחון המערך, הכן את הסוכנים, סדר את הקיים, השלם את החסר":
//   1. תנוחת-מערך חיה: גריד (חמוש/ממתין), דלק (ספירה לנחיתה),
//      צי סוכנים (מהרישום הציבורי), פדיון (SEND-NOW/WAIT).
//   2. נתיב-הכסף: הצינור בחמישה צעדים — powerdown → מלאי → גריד
//      → מילויים → נזילות-חוץ — עם מספרים חיים בכל צעד.
//   3. ספר-הפערים: מה קיים-ולא-היה-מסודר, מה חסר-ונדרש — ומה
//      נעשה בכל שורה. שקיפות מלאה, כלום לא מוסתר.
//
// כל הנתונים מ-URLs ציבוריים בלבד (Pages) — אותה אמת שהעולם רואה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircuitBoard,
  Coins,
  ExternalLink,
  Flame,
  Fuel,
  Gauge,
  Landmark,
  LayoutGrid,
  ListChecks,
  Loader2,
  Package,
  RefreshCw,
  Rocket,
  ShieldCheck,
  TrendingUp,
  Waypoints,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWeave } from "../store";

// ── מקורות-האמת הציבוריים ────────────────────────────────────────────

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";
const MONEY_URL = `${CONSOLE_BASE}/dex/money.json`;
const GRID_URL = `${CONSOLE_BASE}/dex/grid.json`;
const WORLD_URL = `${CONSOLE_BASE}/dex/world.json`;

// ── טיפוסים (משקפים את ה-JSON הציבורי בדיוק) ─────────────────────────

interface MoneyDoc {
  ok: boolean;
  publishedAt: string;
  fuel?: {
    ok: boolean;
    steem: number;
    sbd: number;
    powerdown?: {
      active?: boolean;
      rateSp?: number | null;
      nextPayout?: string | null;
    };
  };
  landing?: { at: string; paymentDue: string; landedSteem: number; dispatched: boolean } | null;
  redemption?: {
    verdict: "SEND-NOW" | "WAIT";
    outboxTrx: number;
    sendThresholdTrx: number;
    action: string;
    usd?: number | null;
    broadcastCostTrx: number;
  };
  invariant?: { sumMu: number; backingMu: number; holds: boolean };
  marks?: { steemUsd?: number | null; trxUsd?: number | null; sbdUsd?: number | null };
}
interface GridDoc {
  ok: boolean;
  armed: boolean;
  verdict: string;
  blocker?: string[] | null;
  fuel?: { weeklySp?: number | null; weeklyUsd?: number | null; remainingWeeks?: number | null; nextPayout?: string | null };
  inventory?: { steem?: number; sbd?: number };
  run?: { placed?: number; filledTotal?: number };
  externalFlowUsd?: number;
  marks?: { steemUsd?: number | null; sbdUsd?: number | null };
}
interface WorldDoc {
  state?: {
    height?: number; treasuryProfit?: number; fills?: number; swaps?: number;
    // FIX(R46): המונה-המונוטוני — מצטבר-לנצח (היתרה-העובדת נשחקת-לדלק-לפי-תכנון)
    income?: { treasuryProfitEverMu?: number; treasuryProfitMu?: number };
    rail?: {
      doses?: number; netMu?: number; equityMu?: number;
      doseLog?: { tick: number; pair: string; side: string; inMu: number; midMu: number; anchorMu: number; premBps: number; ok: boolean | null }[];
      budget?: { usdsMu?: number; energyMu?: number; saosMu?: number; wsteemMu?: number };
      premiums?: { id: string; pair: string; mid: number; anchor: number; premBps: number; active: boolean }[];
    };
    lend?: {
      markets?: { asset: string; sMu: number; bMu: number; utilBps: number; borrowAprBps: number; supplyAprBps: number }[];
      positions?: { who: string; supplies: { asset: string; mu: number }[]; borrows: { asset: string; mu: number }[]; hf: number }[];
      totals?: { suppliesMu: number; borrowsMu: number; opens: number; closes: number };
    };
  };
}

// ── עזרים ────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function countdown(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "נחת";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `עוד ${Math.floor(h / 24)} ימים ו-${h % 24} שע׳`;
  if (h >= 1) return `עוד ${h} שע׳ ו-${m} דק׳`;
  return `עוד ${m} דק׳`;
}
function dataAge(iso: string | undefined): string {
  if (!iso) return "?";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  return `לפני ${Math.round(min / 60)} שע׳`;
}

// ── צ'יפ-מצב ─────────────────────────────────────────────────────────

function StatusPill({
  icon: Icon,
  label,
  value,
  tone = "zinc",
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "emerald" | "rose" | "amber" | "zinc" | "gold" | "accent";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    zinc: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
    gold: "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]",
    accent: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", tones[tone])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-[11px] leading-tight whitespace-normal break-words">
        <span className="opacity-70">{label} </span>
        <span className="font-mono font-semibold">{value}</span>
      </span>
    </div>
  );
}

function ArraySection({
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

// ── צעד בנתיב הכסף ───────────────────────────────────────────────────

function PipeStep({
  n,
  title,
  status,
  tone,
  rows,
}: {
  n: number;
  title: string;
  status: string;
  tone: "emerald" | "gold" | "amber" | "zinc";
  rows: { k: string; v: string }[];
}) {
  const tones = {
    emerald: "border-emerald-500/25 bg-emerald-500/[0.04]",
    gold: "border-[#d4af37]/25 bg-[#d4af37]/[0.04]",
    amber: "border-amber-500/25 bg-amber-500/[0.04]",
    zinc: "border-zinc-700/60 bg-zinc-900/40",
  } as const;
  const statusTones = {
    emerald: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    gold: "text-[#e8cd6e] border-[#d4af37]/30 bg-[#d4af37]/10",
    amber: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    zinc: "text-zinc-400 border-zinc-600/40 bg-zinc-700/20",
  } as const;
  return (
    <Card className={cn("relative border", tones[tone])}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 font-mono text-[11px] font-bold text-[#e8cd6e]">
              {n}
            </span>
            <span className="text-sm font-bold text-zinc-100">{title}</span>
          </div>
          <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold", statusTones[tone])}>{status}</span>
        </div>
        <dl className="grid gap-1">
          {rows.map((r) => (
            <div key={r.k} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-zinc-500">{r.k}</dt>
              <dd className="font-mono text-zinc-200 text-left" dir="ltr">{r.v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── שורת פער בספר הפערים ─────────────────────────────────────────────

interface GapRow {
  what: string;
  detail: string;
  status: "done" | "open" | "partial";
  statusLabel: string;
}

function GapCard({ rows, title, tone, icon: Icon }: { rows: GapRow[]; title: string; tone: string; icon: typeof ListChecks }) {
  return (
    <Card className="border-zinc-700/60 bg-zinc-900/40">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon className={cn("h-4 w-4", tone)} aria-hidden />
          <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
          <Badge variant="outline" className="ml-auto border-zinc-600/50 font-mono text-[10px] text-zinc-400">
            {rows.filter((r) => r.status === "done").length}/{rows.length} טופל
          </Badge>
        </div>
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.what} className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-200">{r.what}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                    r.status === "done"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : r.status === "partial"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        : "border-zinc-600/40 bg-zinc-700/20 text-zinc-400"
                  )}
                >
                  {r.statusLabel}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{r.detail}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════ התצוגה ═════════════════════════════════

export function ArrayView() {
  const reduced = useReducedMotion();
  const { registry, loadRegistry } = useWeave();

  const [money, setMoney] = useState<MoneyDoc | null>(null);
  const [grid, setGrid] = useState<GridDoc | null>(null);
  const [world, setWorld] = useState<WorldDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [m, g, w] = await Promise.all([
        fetch(MONEY_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch(GRID_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch(WORLD_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!m && !g) throw new Error("מקורות המערך לא נענו");
      setMoney(m as MoneyDoc | null);
      setGrid(g as GridDoc | null);
      setWorld(w as WorldDoc | null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  useEffect(() => {
    void loadAll();
    const t = setInterval(() => void loadAll(true), 5 * 60_000);
    return () => clearInterval(t);
  }, [loadAll]);

  // ── צי הסוכנים מהרישום הציבורי ──
  const fleet = useMemo(() => {
    const agents = registry.data?.agents ?? [];
    const byState: Record<string, number> = {};
    for (const a of agents) byState[a.state] = (byState[a.state] ?? 0) + 1;
    return {
      total: agents.length,
      live: byState.live ?? 0,
      degraded: byState.degraded ?? 0,
      dormant: byState.dormant ?? 0,
      auto: byState.auto ?? 0,
      // r124 · כנות: מספר הריפואים נגזר מהרישום החי — לא קבוע ב-JSX
      repos: registry.data?.reposWithAgents?.length ?? null,
    };
  }, [registry.data]);

  const gridVerdict = grid?.verdict ?? "—";
  const gridArmed = grid?.armed ?? false;
  const fuelNext = money?.fuel?.powerdown?.nextPayout ?? grid?.fuel?.nextPayout ?? null;
  const rateSp = money?.fuel?.powerdown?.rateSp ?? null;
  const steemUsdMark = money?.marks?.steemUsd ?? null;
  const weeklyUsd = grid?.fuel?.weeklyUsd ?? (rateSp !== null && steemUsdMark !== null ? rateSp * steemUsdMark : null);
  const redemption = money?.redemption;
  // R45 · גלגל-הפנים — שוק-הכספים והמסילה מהשרשרת הקנונית
  const lend = world?.state?.lend;
  const rail = world?.state?.rail;
  const usdsMkt = lend?.markets?.find((m) => m.asset === "USDS");
  const lendSuppliers = (lend?.positions ?? []).filter((p) => (p.supplies ?? []).some((s) => s.mu > 0));
  const lendBorrowers = (lend?.positions ?? []).filter((p) => (p.borrows ?? []).some((b) => b.mu > 0));
  const railDose = rail?.doseLog?.[0];

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8" aria-busy>
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8">
      {/* ── כותרת ── */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black tracking-tight text-zinc-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10">
              <LayoutGrid className="h-5 w-5 text-[#e8cd6e]" aria-hidden />
            </span>
            מצב המערך
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            המפה החיה של כל המערך — תנוחה, נתיב-כסף, צי, וספר-הפערים. הכל מה-URLs הציבוריים שהעולם רואה.
            {money?.publishedAt && <span className="font-mono"> · עודכן {dataAge(money.publishedAt)}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll(true)} disabled={refreshing} className="gap-2 border-[#d4af37]/30 text-[#e8cd6e] hover:bg-[#d4af37]/10">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          רענון חי
        </Button>
      </motion.div>

      {err && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06]">
          <CardContent className="flex items-center gap-2 p-3 text-xs text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {err} — התצוגה מציגה את הידוע האחרון; נסו רענון.
          </CardContent>
        </Card>
      )}

      {/* ── 1. תנוחת המערך ── */}
      <ArraySection
        id="posture"
        icon={Gauge}
        title="תנוחת המערך — כרגע"
        sub="ששת צווארי-הבקבוק במבט אחד, כולם מדידה חיה"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatusPill
            icon={ShieldCheck}
            label="גריד חוץ"
            value={gridVerdict}
            tone={gridVerdict === "ARMED-LIVE" ? "emerald" : gridArmed ? "gold" : "rose"}
          />
          <StatusPill
            icon={CalendarClock}
            label="דלק נוחת"
            value={countdown(fuelNext)}
            tone="gold"
          />
          <StatusPill
            icon={Waypoints}
            label="צי סוכנים"
            value={`${fleet.live}/${fleet.total} חיים`}
            tone={fleet.degraded > 0 ? "amber" : "emerald"}
          />
          <StatusPill
            icon={Coins}
            label="רווח אוצר לנצח"
            value={`$${fmtUsd((world?.state?.income?.treasuryProfitEverMu ?? world?.state?.treasuryProfit ?? 0) / 1000)}`}
            tone="accent"
          />
          <StatusPill
            icon={Banknote}
            label="פדיון"
            value={redemption?.verdict ?? "—"}
            tone={redemption?.verdict === "SEND-NOW" ? "emerald" : "amber"}
          />
          <StatusPill
            icon={Landmark}
            label="שוק-כספים"
            value={usdsMkt ? `${(usdsMkt.utilBps / 100).toFixed(1)}% ניצולת` : "—"}
            tone={(usdsMkt?.bMu ?? 0) > 0 ? "emerald" : "zinc"}
          />
        </div>
        {grid?.blocker && grid.blocker.length > 0 && (
          <Card className="mt-3 border-amber-500/25 bg-amber-500/[0.04]">
            <CardContent className="p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                חוסמים כנים של הגריד (פורסמו בגלוי — שום דבר לא מדומה)
              </div>
              <ul className="grid gap-0.5">
                {grid.blocker.map((b) => (
                  <li key={b} className="text-[11px] leading-relaxed text-zinc-400" dir="auto">
                    · {b}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </ArraySection>

      {/* ── 2. נתיב הכסף ── */}
      <ArraySection
        id="moneypath"
        icon={Waypoints}
        title="נתיב הכסף — הצינור בחמישה צעדים"
        sub="מה-powerdown ועד נזילות-חוץ נספרת; מספרים חיים בכל צעד"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <PipeStep
            n={1}
            title="עורק החיים — powerdown"
            status="פעיל"
            tone="gold"
            rows={[
              { k: "תשלום הבא", v: fuelNext ? new Date(fuelNext).toLocaleDateString("he-IL") : "—" },
              { k: "קצה שבועי", v: `≈${money?.fuel?.powerdown?.rateSp?.toFixed(0) ?? grid?.fuel?.weeklySp?.toFixed(0) ?? "—"} SP` },
              { k: "שווי לשבוע", v: weeklyUsd != null ? `$${fmtUsd(weeklyUsd)}` : "—" },
              { k: "נותרו", v: `${grid?.fuel?.remainingWeeks ?? "—"} תשלומים` },
            ]}
          />
          <PipeStep
            n={2}
            title="מלאי מחויב — הגריד פורש"
            status={gridArmed ? "חמוש" : "נעול"}
            tone={gridArmed ? "gold" : "zinc"}
            rows={[
              { k: "STEEM נזיל", v: `${(money?.fuel?.steem ?? grid?.inventory?.steem ?? 0).toFixed(3)}` },
              { k: "SBD לצד קנייה", v: `${(money?.fuel?.sbd ?? grid?.inventory?.sbd ?? 0).toFixed(3)}` },
              { k: "התחייבות", v: "90% מהנזיל בלבד" },
              { k: "עוגן מכירה", v: "מעל קו-הזהות החוץ תמיד" },
            ]}
          />
          <PipeStep
            n={3}
            title="הגריד בשוק"
            status={gridVerdict}
            tone={gridVerdict === "ARMED-LIVE" ? "emerald" : gridArmed ? "gold" : "amber"}
            rows={[
              { k: "שורות שהוצבו", v: `${grid?.run?.placed ?? 0}` },
              { k: "מחיר STEEM", v: `$${fmtUsd(grid?.marks?.steemUsd, 4)}` },
              { k: "מחיר SBD", v: `$${fmtUsd(grid?.marks?.sbdUsd, 4)}` },
              { k: "הספר החי", v: "STEEM-internal-market" },
            ]}
          />
          <PipeStep
            n={4}
            title="מילויים נספרים"
            status={`${grid?.run?.filledTotal ?? 0} מילויים`}
            tone="emerald"
            rows={[
              { k: "סה״כ מילויים", v: `${grid?.run?.filledTotal ?? 0}` },
              { k: "מילוי אחרון", v: grid?.marks ? "מסומן בזמן גילוי" : "—" },
              { k: "נזילות-חוץ נטו", v: `$${fmtUsd(grid?.externalFlowUsd, 4)}` },
              { k: "צד קנייה", v: "מתחדש ממילויי המכירה" },
            ]}
          />
          <PipeStep
            n={5}
            title="יציאה — פדיון מגובה"
            status={redemption?.verdict ?? "—"}
            tone={redemption?.verdict === "SEND-NOW" ? "emerald" : "amber"}
            rows={[
              { k: "תיבת יציאה", v: `${redemption?.outboxTrx ?? "—"} TRX` },
              { k: "סף שליחה", v: `${redemption?.sendThresholdTrx ?? "—"} TRX (3× עלות)` },
              { k: "עלות שידור", v: `${redemption?.broadcastCostTrx ?? "—"} TRX` },
              { k: "שליטה", v: "אינווריאנטה " + (money?.invariant?.holds ? "תקינה ✓" : "בבדיקה") },
            ]}
          />
        </div>
        {redemption && (
          <Card className="mt-3 border-zinc-700/60 bg-zinc-900/40">
            <CardContent className="flex flex-wrap items-center gap-2 p-3 text-[11px] text-zinc-400">
              <Banknote className="h-3.5 w-3.5 text-[#e8cd6e]" aria-hidden />
              <span dir="auto">{redemption.action}</span>
              {redemption.usd != null && (
                <Badge variant="outline" className="border-[#d4af37]/30 font-mono text-[10px] text-[#e8cd6e]">
                  ≈${fmtUsd(redemption.usd, 3)}
                </Badge>
              )}
            </CardContent>
          </Card>
        )}
        {money?.landing && (
          <Card className="mt-3 border-emerald-500/30 bg-emerald-500/[0.06]">
            <CardContent className="flex flex-wrap items-center gap-2 p-3 text-[11px] text-emerald-300">
              <Rocket className="h-3.5 w-3.5" aria-hidden />
              <span dir="auto">
                נחיתת דלק אחרונה נקלטה ב-{new Date(money.landing.at).toLocaleString("he-IL")} —{" "}
                {money.landing.landedSteem.toFixed(1)} STEEM נכנסו לשוק
                {money.landing.dispatched ? " · הגריד הוזנק מיד (money-watch)" : " · ממתין לריצה היומית"}
              </span>
            </CardContent>
          </Card>
        )}
      </ArraySection>

      {/* ── 2.5 גלגל-הפנים: שוק-הכספים + המסילה (R45) ── */}
      <ArraySection
        id="wheel"
        icon={Zap}
        title="גלגל-הפנים — שוק-הכספים והמסילה"
        sub="דבר גורר דבר: ההון הרדום מלווה, הצי שואל, המסילה שופשפת — הכל על השרשרת הקנונית"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-[#d4af37]/25 bg-[#d4af37]/[0.03]">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Landmark className="h-4 w-4 text-[#e8cd6e]" aria-hidden />
                <h3 className="text-sm font-bold text-zinc-100">THE-MARKET · שוק-הכספים</h3>
                <Badge variant="outline" className="ml-auto border-emerald-500/30 font-mono text-[10px] text-emerald-400">
                  חי על-השרשרת
                </Badge>
              </div>
              <dl className="grid gap-1.5">
                {[
                  { k: "אספקת USDS", v: usdsMkt ? `$${fmtUsd(usdsMkt.sMu / 1000)}` : "—" },
                  { k: "חוב חי", v: usdsMkt ? `$${fmtUsd(usdsMkt.bMu / 1000)}` : "—" },
                  { k: "ניצולת / APR שאילה", v: usdsMkt ? `${(usdsMkt.utilBps / 100).toFixed(2)}% · ${(usdsMkt.borrowAprBps / 100).toFixed(2)}%` : "—" },
                  { k: "מלווים עצמאיים", v: `${lendSuppliers.length} (${lendSuppliers.map((p) => p.who).join(", ") || "—"})` },
                  { k: "לווים במחזור", v: `${lendBorrowers.length} (${lendBorrowers.map((p) => p.who).join(", ") || "—"})` },
                  { k: "מחזורים נפתחו/נסגרו", v: `${lend?.totals?.opens ?? 0} / ${lend?.totals?.closes ?? 0}` },
                ].map((r) => (
                  <div key={r.k} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="shrink-0 text-zinc-500">{r.k}</dt>
                    <dd className="font-mono text-zinc-200 text-left" dir="ltr">{r.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
                Aave-style peer-to-pool: עקומת-kink, 90% מהריבית למלווים פרו-ראטה, 10% לאוצר.
                מאז R45 יש עמיתים אמת — soldier-2/4 מזרימים אספקה עצמאית משלהם.
              </p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/25 bg-emerald-500/[0.03]">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-300" aria-hidden />
                <h3 className="text-sm font-bold text-zinc-100">THE-MICRORAIL · המסילה</h3>
                <Badge variant="outline" className="ml-auto border-emerald-500/30 font-mono text-[10px] text-emerald-300">
                  {(rail?.doses ?? 0) > 0 ? `${rail?.doses} מנות בריצה זו` : "ממתינה לפרמיה"}
                </Badge>
              </div>
              <dl className="grid gap-1.5">
                {[
                  { k: "הון-עוגן", v: rail ? `$${fmtUsd((rail.equityMu ?? 0) / 1000)}` : "—" },
                  { k: "מנה אחרונה", v: railDose ? `${railDose.side === "buy" ? "קנייה" : "מכירה"} ${railDose.inMu}µ ${railDose.pair} @ ${railDose.premBps > 0 ? "+" : ""}${railDose.premBps}bps ${railDose.ok ? "✓" : "נדחתה"}` : "—" },
                  { k: "תקציב (USDS/SAOS/ENERGY)", v: rail ? `${fmtUsd((rail.budget?.usdsMu ?? 0) / 1000)}$ / ${fmtUsd((rail.budget?.saosMu ?? 0) / 1000, 0)} / ${fmtUsd((rail.budget?.energyMu ?? 0) / 1000, 0)} µ` : "—" },
                  { k: "פרמיית WSTEEM", v: rail?.premiums?.find((p) => p.id === "wsteem") ? `${rail.premiums.find((p) => p.id === "wsteem")!.premBps}bps ${rail.premiums.find((p) => p.id === "wsteem")!.active ? "(פעילה)" : "(מתחת לסף 200bps)"}` : "—" },
                  { k: "פרמיית ENERGY", v: rail?.premiums?.find((p) => p.id === "energy") ? `${rail.premiums.find((p) => p.id === "energy")!.premBps}bps ${rail.premiums.find((p) => p.id === "energy")!.active ? "(פעילה)" : "(מתחת לסף 200bps)"}` : "—" },
                ].map((r) => (
                  <div key={r.k} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="shrink-0 text-zinc-500">{r.k}</dt>
                    <dd className="font-mono text-zinc-200 text-left" dir="ltr">{r.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
                שפשוף-TWAP מדוד לעוגן: מנה ליניארית-חצי-פער בתקרת-השפעה 25%, minOut fail-closed.
                R45 שבר את הקיפאון המבני — בריכה דקה מקבלת מנות-כנות במקום שתישאר קפואה.
              </p>
            </CardContent>
          </Card>
        </div>
      </ArraySection>

      {/* ── 3. צי הסוכנים ── */}
      <ArraySection
        id="fleet"
        icon={CircuitBoard}
        title="צי הסוכנים — מהרישום הציבורי"
        sub={`נמדד חי מ-agents/registry.json · ${fleet.total} סוכנים${fleet.repos != null ? ` ב-${fleet.repos} ריפואים` : ""}`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusPill icon={Activity} label="חיים" value={`${fleet.live}`} tone="emerald" />
          <StatusPill icon={AlertTriangle} label="מדורדים" value={`${fleet.degraded}`} tone={fleet.degraded > 0 ? "rose" : "zinc"} />
          <StatusPill icon={CalendarClock} label="דורמיטים" value={`${fleet.dormant}`} tone="zinc" />
          <StatusPill icon={Package} label="אוטומטיים" value={`${fleet.auto}`} tone="accent" />
        </div>
        <Card className="mt-3 border-zinc-700/60 bg-zinc-900/40">
          <CardContent className="p-3 text-[11px] leading-relaxed text-zinc-500">
            הרישום המלא בעמוד <span className="text-zinc-300">סוכנים ← הצי החי</span>. החדש שבצי:{" "}
            <span className="font-mono text-[#e8cd6e]">money-watch</span> — צופה נתיב-הכסף (קצב מוגדר: כל רבע-שעה — לא נמדד כאן): קולט את נחיתת
            ה-powerdown ומזניק את הגריד מיד, ופוסק SEND-NOW/WAIT על תיבת הפדיון מול עלות השידור ב-TRON.
          </CardContent>
        </Card>
      </ArraySection>

      {/* ── 4. ספר הפערים ── */}
      <ArraySection
        id="gaps"
        icon={ListChecks}
        title="ספר הפערים — הבחינה שהוזמנה"
        sub="מה קיים ולא היה מסודר · מה חסר ונדרש · מה נעשה בפועל — כל שורה עם מצב אמיתי"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <GapCard
            icon={Package}
            title="קיים ולא היה מסודר — הטיפול"
            tone="text-[#e8cd6e]"
            rows={[
              {
                what: "נחיתת הדלק בלי צופה",
                detail:
                  "תשלום ה-powerdown (עורק החיים, ≈470 SP/שבוע) נחת ב-02:01 והגריד היה תופס אותו רק ב-03:17 — 76 דקות מלאי מת מסחרר. עכשיו: סוכן money-watch קולט את הנחיתה בתוך רבע-שעה ומזניק את הגריד מיד.",
                status: "done",
                statusLabel: "טופל — money-watch חי",
              },
              {
                what: "פסק-דין פדיון לא היה קיים",
                detail:
                  "תיבת היציאה הצטברה בתביעות בלי שאף אחד אומר מתי שווה לשדר. עכשיו: חישוב חי מול עלות שידור TRX (0.35) — סף שליחה = פי 3, עם המספר החסר במדויק.",
                status: "done",
                statusLabel: "טופל — פסק חי",
              },
              {
                what: "מסמכי מנוע מיושנים בשורש הריפו",
                detail:
                  "למעלה מ-25 מסמכי SAOS-PULSE/DAILY-REPORT מספטמבר המוקדם הועברו ל-docs/archive עם README מסביר (commit 8a17920) — שורש המנוע נקי, ההיסטוריה שמורה.",
                status: "done",
                statusLabel: "טופל — הועבר לארכיון",
              },
              {
                what: "שוק-כספים בלי עמיתים (R45)",
                detail:
                  "THE-MARKET נולד (R44) עם מלווה אחד — האוצר. חלוקת-ה-90% זרמה-כולה-חזרה-אליו וה-pro-rata היה תיאורטי. עכשיו: soldier-2/4 מנהלים אספקה-אדפטיבית-עצמאית משלהם (יעד 3× חוב-חי, רצפה 10kµ, תקרה 150kµ) — שלושה כיסים עצמאיים בפועל.",
                status: "done",
                statusLabel: "טופל — THE-PEERS חי",
              },
              {
                what: "מסילה בקיפאון מבני (R45)",
                detail:
                  "נמדד-חי: בריכת-ENERGY/SAOS החזיקה-3,162µ SAOS בלבד ← תקרת-ההשפעה rIn/4=790µ נפלה-מתחת-למינימום-המנה-1,000µ ← המסילה החזיקה-201,838µ SAOS ולעולם-לא-ירתה. הריפוי: רצפת-אבק 300µ במקום מינימום-שוק — נמדד-חי על-השרשרת: 3 מנות (קנייה@49 ← קנייה@77 ← מכירה@120 מעל-העוגן-94) — לכידת-פרמיה לשני-הכיוונים, הבריכה העמיקה.",
                status: "done",
                statusLabel: "טופל — thin-pool-cure",
              },
              {
                what: "מנעולי-nonce בין-ריצות (R45)",
                detail:
                  "17 נקודות-דחיפה של סוכנים השתמשו ב-nonce-מבוסס-טיק — אבל tickCount מתאפס-בכל-אתחול-תהליך וטבעת-ה-nonce זוכרת-לנצח ← כל ריצת-ענן נעלה-על המנעולים של קודמתה (נמדד: refuel-replay-rejected). כעת: הכל מבוסס-גובה — ייחודי-לנצח. גם הזמנות-הצי קיבלו בעלים ב-nonce (קוד-ה-seeding היה מת).",
                status: "done",
                statusLabel: "טופל — nonce-height",
              },
              {
                what: "ראצ'ט אוצר שקרס (R46)",
                detail:
                  "חוזה הגרעין אמר \"רווח-אוצר מצטבר-מונוטוני\" — אבל ה-economy מנקז את היתרה לדלק-סולם/גז, והיא צנחה מ-213,752µ (גיט-מוכח) ל-200,000µ. טענת A38 (ראצ'ט-האוצר) תפסה את זה בדיוק-כמתוכנן: 49/52. הריפוי: מונה-מונוטוני-אמיתי treasuryProfitEver — עולה-בכל-קציר, לעולם-לא-נשחק, זרוע-מהשיא-הגיט-מוכח. הוכחה-מבודדת 13/13 + חי על-השרשרת ב-h30748: 213,752µ · 52/52.",
                status: "done",
                statusLabel: "טופל — treasuryProfitEver",
              },
              {
                what: "טיפוגרפיה ציבורית מופרת (R46)",
                detail:
                  "טענות-הניקיון של הקונסולה (A14/A42) נכשלו-חי: 36 מקפי-אמה אסורים בדף-הבית + 3 בדף-הרוסט. הוחלפו-כירורגית (ערכי-נפילה ל-\"-\", פרוזה לנקודת-אמצע) — אימות-עצמאי-חוזר: אפס-תווים-אסורים, 52/52 ALL_PASS מ-GitHub Actions.",
                status: "done",
                statusLabel: "טופל — 52/52 ALL_PASS",
              },
              {
                what: "חיסכון מת-מלידה (R47)",
                detail:
                  "נמדד-מהגיט על-12-פעימות-פרסום: saveAPY=0 לכל-אורך-ההיסטוריה — בסיס-ההכנסה היה ריבית-כספת-בלבד, והכספת לא-נפרעה מעולם. גם-כשתיפרע: 0.3µ/יום על קרן-500,000µ = אפס-מובנה. הריפוי: בסיס-ההכנסה הורחב להבטחת-העיצוב המקורית — 30% מחית-עמלות-הבריכות + ריבית-כספת + עתודת-אוצר-שוק-הכספים, בכיסוי-אמת-של-יתרת-האוצר. חי-על-השרשרת ב-h31228: 77,201µ שולמו-לחוסכים, חלון-היום מתגלגל.",
                status: "done",
                statusLabel: "טופל — income-base חי",
              },
              {
                what: "שעון-ריבית מכחיש-מציאות (R47)",
                detail:
                  "BLOCKS_PER_YEAR=10,483,200 הניח שרשרת-רציפה בת-3s/בלוק — אבל הקצב-הנמדד הוא 15s/גובה (480 גבהים לכל-פעימה-של-שעתיים). הריבית זרמה-ב-1/5 מהמציאות, ועיגול-השלמים איפס-אותה-לנצח (נמדד: floor(1368µ×131bps×מחזור)=0). הריפוי: הקבון תוקן-לקצב-הנמדד (2,102,400) + סדרי-גודל-עמדות הותאמו (כספת 250kµ בטחונות · לווים עם-רגל-SAOS שנייה) — הריבית מתממשת-בפועל.",
                status: "done",
                statusLabel: "טופל — time-truth",
              },
              {
                what: "מפת-האחזקות מיושנת",
                detail:
                  `AGENT-ESTATE-MAP.md מתאר את 2026-09-08. האמת החיה: agents/registry.json — ${fleet.total > 0 ? `${fleet.total} סוכנים` : "—"}${registry.data?.reposWithAgents?.length ? ` ב-${registry.data.reposWithAgents.length} ריפואים` : ""}, נמדד אוטומטית. המפה הזו קוראת מהרישום, לא מהמסמך.`,
                status: "done",
                statusLabel: "טופל — קריאה מהרישום",
              },
              {
                what: "דוחות מחקר קבורים",
                detail:
                  "money-path-research.md ו-systems-inventory.md (מיפוי נתיבי הכסף ומלאי המערכות) יושבים ב-Upload פנימי בלי נקודת כניסה. מוצגים עכשיו דרך הידע.",
                status: "partial",
                statusLabel: "חלקי — קישורים הוספו",
              },
            ]}
          />
          <GapCard
            icon={Rocket}
            title="חסר ונדרש — מניתוח נתיב הכסף"
            tone="text-emerald-400"
            rows={[
              {
                what: "צופה נחיתת דלק + הזנקה מיידית",
                detail:
                  "הפער הכי יקר במערך: הכניסה היחידה של ערך חוץ המתינה 76 דקות כל שבוע. נבנה, נפרס, ריצה ראשונה ירוקה (35303619186) — בכל נחיתה הוא קולט בתוך רבע-שעה ומזניק את הגריד מיד.",
                status: "done",
                statusLabel: "נבנה — חי בענן",
              },
              {
                what: "אוטומציית סף הפדיון",
                detail:
                  "כל פדיון עתידי נמדד אוטומטית: הצטברות מול סף רווחיות (3× עלות שידור) — במקום שהמפעיל ינחש. הפסק החי מתפרסם לציבור.",
                status: "done",
                statusLabel: "נבנה — ב-money-watch",
              },
              {
                what: "מקור דלק לצד הקנייה (SBD)",
                detail:
                  `צד הקנייה של הגריד חסום על מלאי SBD (כרגע ${money?.fuel?.sbd != null ? money.fuel.sbd.toFixed(3) : "—"} נזיל מול סף-החימוש שנקבע בקוד — החי בלוח-הכספים). המנגנון הקיים: מילויי המכירה מעל קו-הזהות מזרימים SBD שמחמש את צד הקנייה בריצה הבאה — הצינור מזין את עצמו, לא צריך מקור חוץ.`,
                status: "done",
                statusLabel: "קיים — מזרים מעצמו",
              },
              {
                what: "שוק-כספים ריבוני (DeFi gap)",
                detail:
                  "מול Aave/Compound הרשת היתה עם כספת-CDP וחיסכון אבל בלי שוק-עמיתים. R44: THE-MARKET נולד — עקומת-kink, 5 אופס קנוניים, ניזולת בחסר-HF. השאלה הראשונה בהיסטוריה: h28764, 1,368µ USDS ב-HF 1.62 — מתועדת לנצח ב-op-log.",
                status: "done",
                statusLabel: "נולד — R44 THE-MARKET",
              },
              {
                what: "עיגון-Hive של אבני-הדרך",
                detail:
                  "מנוע-העיגון (אבני-P&L על-Hive, תקציב-RC-מודע) בנוי-ומוכח — אבל כספת-הצי (posting keys) הוסרה מהריפו אחרי תקרית-האבטחה R11 ולא נאטמה-מחדש. דלת-המפעיל: איטום מחדש בדפוס-ה-STEEM-המוכח (sealed-box ← Actions secret), ואז הוא חי בענן.",
                status: "open",
                statusLabel: "דלת מפעיל — מפתח-צי",
              },
              {
                what: "הפקדות חוץ — 0 עדיין",
                detail:
                  "כתובות ההפקדה ב-4 רשתות (TRON/EVM/SOL/BTC) נצפות בקצב מוגדר בקוד (כל 20 דקות — לא נמדד כאן), אך אף הפקדה חיצונית לא נכנסה. זהו הצעד שתלוי בעולם — המערך מוכן לקלוט.",
                status: "open",
                statusLabel: "פתוח — תלוי-חוץ",
              },
              {
                what: "שידור TRON פיזי של הפדיון",
                detail:
                  "הכסף יוצא מהמשמרת רק בחתימת המפעיל (הסקלר של ה-active) — נכון לתכנון. המערך מודד ומזהה את הרגע; השידור נשאר בידיים שלך. כשהתיבה תגיע לסף — יופיע SEND-NOW.",
                status: "open",
                statusLabel: "מוכן — ידי מפעיל",
              },
            ]}
          />
        </div>
        <Card className="mt-3 border-[#d4af37]/25 bg-[#d4af37]/[0.04]">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#e8cd6e]">
              <TrendingUp className="h-4 w-4" aria-hidden />
              איך מפעילים באמת את המערך — שלושת המנופים
            </div>
            <ol className="grid gap-2 text-[11px] leading-relaxed text-zinc-400">
              <li dir="auto">
                <span className="font-semibold text-zinc-300">1. דלק אוטומטי:</span> תשלומי ה-powerdown נכנסים לשוק לבד —
                money-watch קולט, הגריד מציב מעל קו-הזהות, מילויים נספרים. שום פעולה לא נדרשת.
              </li>
              <li dir="auto">
                <span className="font-semibold text-zinc-300">2. הפקדות חוץ:</span> כל TRX/ETH/SOL/BTC לכתובות ב-dex-watch
                נקלט אוטומטית (ספירה → תביעה → זיכוי USDS). זה עורק הצמיחה — המערך מוכן, מחכה לעולם.
              </li>
              <li dir="auto">
                <span className="font-semibold text-zinc-300">3. פדיון:</span> כשהתיבה מגיעה לסף — SEND-NOW יופיע כאן
                ובקונסולה הציבורית. השידור הפיזי בידי המפעיל בלבד (חתימת ה-active).
              </li>
            </ol>
          </CardContent>
        </Card>
      </ArraySection>

      {/* ── קישורי הוכחה ── */}
      <ArraySection id="proofs" icon={ExternalLink} title="קישורי אמת חיה" sub="כל מספר בעמוד ניתן לאימות עצמאי">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "money.json — צופה נתיב הכסף", url: MONEY_URL },
            { label: "grid.json — הגריד החוץ", url: GRID_URL },
            { label: "world.json — השרשרת הקנונית", url: WORLD_URL },
            { label: "Actions — ריצות הצי", url: "https://github.com/roshpinacare-sys/saos-dex/actions" },
          ].map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-[#d4af37]/40 hover:text-[#e8cd6e]"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              {l.label}
            </a>
          ))}
        </div>
      </ArraySection>
    </div>
  );
}
