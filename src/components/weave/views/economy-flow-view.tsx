"use client";

// ─────────────────────────────────────────────────────────────────────
// ECONOMY FLOW VIEW · כלכלה ריבונית: זרימות וחסימות (R98).
//
// הוראת המפעיל שיצרה את התצוגה: "הבן את כל המכלול שבידינו נסה ליישם
// ככל הניתן או לפחות לתכנן ככל הניתן ריבונות שוק וכלכלה ריבונית
// אוטונומית... לבחון איך לטפל ולפתוח סתימות חסימות דימומים מה שנמצא
// חסום (ולמה)".
//
// חמש שכבות בתצוגה אחת, כולן מ-/api/economy (מדידה חיה):
//   1. מרשם החסימות — מה חסום, למה, ומה פותח אותו
//   2. מטריצת הזרימה — כל רגל נזילות ולאן נגזרות העמלות
//   3. יעילות עוגנים — מה כל עוגן קונה לנו + מסלול הפג
//   4. מנוע ערבוב-הסוואפ — הסוואפ שלנו מעורבב עם הראוטרים שלהם
//   5. דוקטרינה + מקורות
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Anchor,
  ArrowLeftRight,
  Banknote,
  CircleDot,
  Coins,
  Droplets,
  Fuel,
  Gauge,
  HelpCircle,
  Layers,
  Loader2,
  Lock,
  LockKeyhole,
  RefreshCw,
  Scale,
  ShieldCheck,
  Siren,
  Waypoints,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch, errorMessage } from "@/components/weave/api";
import {
  ErrorBox,
  KpiSkeletonRow,
  Section,
  fmtDateTime,
  scrollBoxClass,
} from "@/components/weave/shared";

// ── טיפוסים (מראה את חוזה /api/economy) ─────────────────────────────

type BlockageKind = "CLOG" | "GATE" | "BLEED" | "MOORING";
type BlockageClass =
  | "INTENTIONAL-LEGAL"
  | "INTENTIONAL-SECURITY"
  | "INVENTORY"
  | "OPERATOR"
  | "INFRA"
  | "MEASUREMENT"
  // R102 — מחלקות-מצב לחסימות שנפתחו לחיים
  | "ARMED"
  | "LIVE-INTERNAL"
  | "PARTIAL-LIVE"
  // R103 — רייל מוכח בשרשרת מקצה לקצה
  | "LIVE"
  // R104 — המטבע יוצא לשרשרת-החי במשיכה
  | "LIVE-RAIL";

interface BlockageRow {
  code: string;
  kind: BlockageKind;
  title: string;
  what: string;
  why: string;
  class: BlockageClass;
  measured: string;
  unlock: string;
  sovereignPath: string;
  liveMeasured: string | null;
  progress: number | null;
  liveState: "IN-PROGRESS" | "HOLDING" | "STATIC";
  updatedAt: string;
}

type FlowStatus =
  | "LIVE"
  | "GATED"
  | "QUOTES-ONLY"
  | "PLANNED"
  | "MEASUREMENT"
  | "NOT-MEASURABLE"
  | "MOORING";

type FeeAccrual = "OURS" | "THEIRS" | "NONE" | "PLANNED-OURS";

interface FlowLeg {
  id: string;
  title: string;
  from: string;
  to: string;
  status: FlowStatus;
  feeAccrual: FeeAccrual;
  feeNote: string;
  measured: string;
  gate: string;
}

interface AnchorRow {
  id: string;
  title: string;
  buys: string;
  measured: string;
  verdict: "ARMED" | "ENFORCED" | "ANCHORED" | "LOCAL" | "WAIT";
  note: string;
}

interface MixLeg {
  id: string;
  title: string;
  venue: string;
  feeAccrual: FeeAccrual;
  detail: string;
  numbers: Array<{ label: string; value: string }>;
}

interface EconomyData {
  ok: boolean;
  at: string;
  kpis: {
    sbdCommitable: number | null;
    sbdNeeded: number;
    sbdProgress: number | null;
    quotesVerified: number | null;
    quotesTotal: number | null;
    powerdownWeeklySteem: number | null;
    powerdownPaymentsLeft: number | null;
    deployedSteem: number | null;
    ladderLevels: number;
    gateAllowed: number | null;
    gateQueued: number | null;
    gateRefused: number | null;
  };
  blockages: BlockageRow[];
  flows: FlowLeg[];
  anchors: AnchorRow[];
  peg: {
    sbdNominal: number;
    sbdExternal: number | null;
    sbdImpliedInternal: number | null;
    internalVsExternalBps: number | null;
    externalDepegBps: number | null;
    regime: "VALUE-TRAP" | "NEUTRAL" | "NOT-MEASURED";
    note: string;
  };
  sbdBuild: {
    fillsInWindow: number;
    sbdCaptured: number;
    windowDays: number | null;
    sbdPerDay: number | null;
    commitableNow: number | null;
    needed: number;
    etaDays: number | null;
    note: string;
  };
  mix: {
    sizeSteem: number;
    sizeUsd: number | null;
    usdBasis: string;
    gateVerdict: "AUTONOMOUS" | "OPERATOR-QUEUE" | "NO-MARK";
    gateDetail: string;
    legs: MixLeg[];
    mixingVerdict: string;
    doctrine: string[];
  };
  doctrine: string[];
  down: string[];
  sources: Record<string, string>;
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
}

// ── סמנטיקה ויזואלית ────────────────────────────────────────────────

const KIND_META: Record<BlockageKind, { label: string; badge: string }> = {
  CLOG: { label: "סתימה", badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  GATE: { label: "חסימה", badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  BLEED: { label: "דימום", badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  MOORING: { label: "עגינה מכוונת", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

const CLASS_META: Record<BlockageClass, { label: string; hint: string }> = {
  "INTENTIONAL-LEGAL": { label: "מכוונת · חוק", hint: "חסימה שנשארת בכוונה עד גוף מורשה - לא תקלה" },
  "INTENTIONAL-SECURITY": { label: "מכוונת · ביטחון", hint: "דלת מתועדת לסוכנים היא דלת מתועדת לכל פורץ" },
  INVENTORY: { label: "מלאי", hint: "חסימה חולפת שנפתחת ממילוי אמיתי - לא ממכירה מתחת לערך" },
  OPERATOR: { label: "החלטת מפעיל", hint: "המפעיל הוא השער - נפתחת רק בהחלטה מפורשת" },
  INFRA: { label: "תשתית", hint: "מגבלת סביבה - מוסטת, לא מוסתרת" },
  MEASUREMENT: { label: "מדידה", hint: "בלי מדידה אין מסקנה - מסומן בכנות" },
  ARMED: { label: "חמושה · מוכחת", hint: "הגישה אומתה והרייל שודר בהצלחה - מה שנותר הוא הון, לא סמכות (R102)" },
  "LIVE-INTERNAL": { label: "חיה · פנימית", hint: "המנגנון עובד בכסף אמיתי לחברי הרשת - פתיחה ציבורית דורשת גוף מורשה" },
  "PARTIAL-LIVE": { label: "חיה חלקית", hint: "חלק מהמסלול חי ומוכח; החלק החסר מתועד בכנות עם תנאי פתיחה" },
  LIVE: { label: "חיה · מוכח בשרשרת", hint: "רייל שלם שהוכח מקצה לקצה עם txids — הצמיחה מעתה מדלק אמיתי בלבד (R103)" },
  "LIVE-RAIL": { label: "חיה · רייל-יציאה לשרשרת", hint: "המטבע הפנימי יוצא לשרשרת החיה: התביעה נשרפת בזירה והעברה חתומה מהאוצר מקופלת על ידי כל צומת (R104)" },
};

const FLOW_STATUS_META: Record<FlowStatus, { label: string; badge: string }> = {
  LIVE: { label: "חי", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  GATED: { label: "שער-מפעיל", badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "QUOTES-ONLY": { label: "ציטוט בלבד", badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  PLANNED: { label: "מתוכנן", badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  MEASUREMENT: { label: "מדידה", badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  "NOT-MEASURABLE": { label: "לא נמדד", badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  MOORING: { label: "עגינה מכוונת", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

const FEE_META: Record<FeeAccrual, { label: string; badge: string }> = {
  OURS: { label: "העמלות בבריכות שלנו", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  THEIRS: { label: "העמלות בבריכות שלהם", badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  NONE: { label: "ללא עמלה", badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  "PLANNED-OURS": { label: "מתוכנן: בבריכות שלנו", badge: "border-emerald-500/30 border-dashed bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
};

function FlowStatusBadge({ status }: { status: FlowStatus }) {
  const m = FLOW_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn("shrink-0 font-mono text-[11px]", m.badge)}>
      {m.label}
    </Badge>
  );
}

function FeeBadge({ accrual }: { accrual: FeeAccrual }) {
  const m = FEE_META[accrual];
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[11px]", m.badge)}>
      {m.label}
    </Badge>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={cn("mt-0.5 truncate font-mono text-lg font-semibold tabular-nums", accent)}>{value}</p>
          {sub ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ── התצוגה ────────────────────────────────────────────────────────────

const SIZE_PRESETS = [1, 10, 50, 100, 500, 2000];

// ── R107: שרשרת-הטריגרים · דבר גורר דבר ──────────────────────────────

interface ChainItem {
  chain: string;
  titleHe: string;
  steps: string;
  cooldownMin: number;
  budgetPerDay: number;
  runsToday: number;
  free: boolean;
  lastRun: { step: string; firedBy: string; ok: boolean; detail: string; at: string } | null;
}

interface ArenaPoolRow {
  pair: string;
  assetA: string;
  assetB: string;
  reserveA: number;
  reserveB: number;
  swaps: number;
  feeBps: number;
  lpTotal: number;
  lpShares: Record<string, number>;
}

function TriggerChainMap() {
  const [chains, setChains] = useState<ChainItem[] | null>(null);
  const [pools, setPools] = useState<ArenaPoolRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const j = await apiFetch<{ chains: ChainItem[]; pools: ArenaPoolRow[] }>("/api/exchange");
      setChains(j.chains ?? []);
      setPools((j.pools ?? []).filter((p) => p.reserveA > 0 || p.reserveB > 0));
    } catch {
      /* מצב-השרשרת לעולם לא מפיל את התצוגה */
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fired = (chains ?? []).filter((c) => c.lastRun).length;

  return (
    <Section
      title="שרשרת-הטריגרים · דבר גורר דבר"
      description="כל אירוע כספי מדליק את הבא אחריו: מילוי ← תגמול ← נזילות ← עומק ← עמלות. כל שרשרת נמדדת — צינון, תקציב וריצה אחרונה בשקיפות מלאה."
      icon={<Zap className="size-4" aria-hidden="true" />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {chains
              ? `${fired}/${chains.length} שרשראות רצו לפחות פעם אחת — מדידה חיה מספר-הזירה ה-hash-chained`
              : "טוען מצב-שרשרת..."}
          </p>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
            רענון
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(chains ?? []).map((c) => {
            const state = !c.free
              ? c.runsToday >= c.budgetPerDay
                ? { label: "תקציב נאכל", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" }
                : { label: "בצינון", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" }
              : { label: "חופשית", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
            return (
              <Card key={c.chain} className="min-w-0">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" dir="ltr" className="font-mono text-[11px]">{c.chain}</Badge>
                    <Badge variant="outline" className={cn("text-[11px]", state.cls)}>{state.label}</Badge>
                    <span className="ms-auto font-mono text-[11px] text-muted-foreground" dir="ltr">{c.runsToday}/{c.budgetPerDay} היום</span>
                  </div>
                  <p className="text-sm font-semibold">{c.titleHe}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{c.steps}</p>
                  {c.lastRun ? (
                    <div className="mt-auto rounded-md border bg-muted/40 p-2.5">
                      <div className="flex items-center gap-1.5">
                        {c.lastRun.ok ? (
                          <CircleDot className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Siren className="size-3 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{fmtDateTime(c.lastRun.at)}</span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-foreground/80">{c.lastRun.detail}</p>
                    </div>
                  ) : (
                    <p className="mt-auto text-[11px] text-muted-foreground">עוד לא רצה — ממתינה לטריגר הראשון שלה</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        {/* בעלות-הנזילות (LP) — העומק הוא נכס בעליו, לא תרומה */}
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-semibold">בעלות-הנזילות בבריכות (מניות-LP)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(pools ?? []).map((p) => {
              const owners = Object.entries(p.lpShares ?? {}).filter(([, v]) => v > 0);
              return (
                <div key={p.pair} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold" dir="ltr">{p.pair}</span>
                    <Badge variant="outline" className="text-[10px]">{p.feeBps}bps</Badge>
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
                    {Number(p.reserveA.toPrecision(6))} × {Number(p.reserveB.toPrecision(4))}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{p.swaps} החלפות</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {owners.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">אין בעלים רשומים עדיין</span>
                    ) : (
                      owners.map(([m, sh]) => (
                        <Badge key={m} variant="secondary" className="font-mono text-[10px]" dir="ltr">
                          {m}: {Number(sh.toPrecision(3))} ({p.lpTotal > 0 ? Math.round((sh / p.lpTotal) * 100) : 0}%)
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            חילוץ פרו-רטה פתוח בכל עת (remove-liquidity) — הנזילות אף פעם לא נלכדת בבריכה. העמלות שנצברו מנפחות את שווי-כל-מניה.
          </p>
        </div>
      </div>
    </Section>
  );
}

export function EconomyFlowView() {
  const [data, setData] = useState<EconomyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mixSize, setMixSize] = useState(10);
  const [mixBusy, setMixBusy] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    try {
      const j = await apiFetch<EconomyData>(`/api/economy${fresh ? "?fresh=1" : ""}`);
      setData(j);
      setMixSize(j.mix?.sizeSteem ?? 10);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const runMix = useCallback(async (size: number) => {
    setMixSize(size);
    setMixBusy(true);
    try {
      const j = await apiFetch<EconomyData>("/api/economy", {
        method: "POST",
        body: JSON.stringify({ sizeSteem: size }),
      });
      setData((prev) => (prev ? { ...prev, mix: j.mix, peg: j.peg, at: j.at } : j));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMixBusy(false);
    }
  }, []);

  const b = data;
  const intentionalCount = b?.blockages.filter((x) => x.class.startsWith("INTENTIONAL")).length ?? 0;
  const inProgressCount = b?.blockages.filter((x) => x.liveState === "IN-PROGRESS").length ?? 0;
  const ourFeeLegs = b?.flows.filter((f) => f.feeAccrual === "OURS").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Banknote className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            כלכלה ריבונית · זרימות וחסימות
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            המכלול כולו במקום אחד: מה חסום ולמה, לאן הכסף זורם ולאן נגזרות העמלות, מה כל עוגן קונה לנו -
            ותוכנית ערבוב-הסוואפ שמערבבת את הבריכות שלנו עם הנזילות שלהם. הכל מדידה חיה.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {b ? (
            <Badge variant="outline" className="hidden font-mono text-[11px] text-muted-foreground sm:inline-flex">
              {b.cached ? (b.stale ? `מטמון בשל · ${b.cacheAgeSec}s` : `מטמון טרי · ${b.cacheAgeSec}s`) : "מדידה חיה"}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5">
            {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
            מדידה מחדש
          </Button>
        </div>
      </div>

      {/* טעינה / שגיאה */}
      {loading ? (
        <div className="flex flex-col gap-6">
          <KpiSkeletonRow count={4} />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={() => void load(true)} />
      ) : !b ? null : (
        <div className="flex flex-col gap-8">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              icon={<Coins aria-hidden="true" />}
              label="חימוש צד-הקנייה (SBD)"
              value={b.kpis.sbdCommitable != null ? `${b.kpis.sbdCommitable.toFixed(3)} / ${b.kpis.sbdNeeded}` : "לא נמדד"}
              sub={b.kpis.sbdProgress != null ? `${Math.round(b.kpis.sbdProgress * 100)}% מהסף` : undefined}
              accent={b.kpis.sbdProgress != null && b.kpis.sbdProgress >= 1 ? "text-emerald-600 dark:text-emerald-400" : undefined}
            />
            <Kpi
              icon={<Gauge aria-hidden="true" />}
              label="קצב בניית SBD (מדוד)"
              value={b.sbdBuild.sbdPerDay != null ? `${b.sbdBuild.sbdPerDay.toFixed(4)} /יום` : "לא נמדד"}
              sub={b.sbdBuild.etaDays != null ? `מסלול לפתיחה: עוד ~${b.sbdBuild.etaDays} ימים` : b.sbdBuild.note}
            />
            <Kpi
              icon={<Scale aria-hidden="true" />}
              label={`משטר הפג (${b.peg.regime === "VALUE-TRAP" ? "מלכודת-ערך" : b.peg.regime === "NEUTRAL" ? "ניטרלי" : "לא נמדד"})`}
              value={b.peg.internalVsExternalBps != null ? `${b.peg.internalVsExternalBps}bps` : "לא נמדד"}
              sub={b.peg.sbdExternal != null ? `SBD חיצוני $${b.peg.sbdExternal.toFixed(3)}` : undefined}
              accent={b.peg.regime === "VALUE-TRAP" ? "text-amber-600 dark:text-amber-400" : undefined}
            />
            <Kpi
              icon={<Waypoints aria-hidden="true" />}
              label="ערוצי ציטוט מאומתים"
              value={b.kpis.quotesVerified != null ? `${b.kpis.quotesVerified} / ${b.kpis.quotesTotal ?? "?"}` : "לא נמדד"}
              sub="ראוטרי DEX ב-4 רשתות + REST - כולם נשפטים מול בינאנס"
            />
            <Kpi
              icon={<Fuel aria-hidden="true" />}
              label="דלק פאוורדאון"
              value={b.kpis.powerdownWeeklySteem != null ? `${b.kpis.powerdownWeeklySteem.toFixed(1)} STEEM/שבוע` : "לא נמדד"}
              sub={b.kpis.powerdownPaymentsLeft != null ? `${b.kpis.powerdownPaymentsLeft} תשלומים נותרו` : undefined}
            />
            <Kpi
              icon={<LockKeyhole aria-hidden="true" />}
              label={`שער-העסקאות $100`}
              value={
                b.kpis.gateAllowed != null
                  ? `${b.kpis.gateAllowed} אוטונומיות · ${b.kpis.gateQueued ?? 0} בתור`
                  : "לא נמדד"
              }
              sub={b.kpis.gateRefused != null ? `${b.kpis.gateRefused} סורבו (אין מדידת-USD)` : undefined}
            />
          </div>

          {/* מרשם החסימות */}
{/* R107 — domino trigger chains */}
          <TriggerChainMap />
          <Section
            title="מרשם החסימות והדימומים"
            description={`${b.blockages.length} חסימות רשומות · ${intentionalCount} מכוונות (חוק/ביטחון) · ${inProgressCount} בהתקדמות נמדדת - כל חסימה מסוג עגינה מכוונת נשארת חסומה עד שהחוק מאפשר אחרת`}
            icon={<Lock className="size-4" aria-hidden="true" />}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {b.blockages.map((blk) => {
                const kind = KIND_META[blk.kind];
                const cls = CLASS_META[blk.class];
                return (
                  <Card key={blk.code} className="min-w-0">
                    <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" dir="ltr" className={cn("font-mono text-[11px]", kind.badge)}>
                          {blk.code}
                        </Badge>
                        <Badge variant="secondary" className="text-[11px]">{kind.label}</Badge>
                        <Badge variant="outline" className="text-[11px] text-muted-foreground">{cls.label}</Badge>
                        <span className="ms-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <CircleDot
                            className={cn(
                              "size-3",
                              blk.liveState === "IN-PROGRESS"
                                ? "animate-pulse text-amber-500"
                                : blk.liveState === "HOLDING"
                                  ? "text-emerald-500"
                                  : "text-zinc-400"
                            )}
                            aria-hidden="true"
                          />
                          {blk.liveState === "IN-PROGRESS" ? "בהתקדמות" : blk.liveState === "HOLDING" ? "מוחזק" : "סטטי"}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold leading-snug">{blk.title}</h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">{blk.what}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">למה: </span>
                        {blk.why}
                      </p>
                      {blk.progress != null ? (
                        <div className="flex flex-col gap-1.5">
                          <Progress value={Math.min(100, Math.round(blk.progress * 100))} className="h-1.5" />
                          <p className="text-[11px] text-muted-foreground">
                            התקדמות לפתיחה: {Math.round(blk.progress * 100)}%
                          </p>
                        </div>
                      ) : null}
                      <div className="rounded-lg border bg-muted/40 p-3">
                        <p className="text-[11px] font-medium text-foreground">
                          המצב הנמדד: <span className="font-normal text-muted-foreground">{blk.liveMeasured ?? blk.measured}</span>
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 text-[11px] leading-relaxed">
                        <p>
                          <span className="font-medium text-foreground">תנאי הפתיחה: </span>
                          <span className="text-muted-foreground">{blk.unlock}</span>
                        </p>
                        <p>
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">הנתיב הריבוני: </span>
                          <span className="text-muted-foreground">{blk.sovereignPath}</span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </Section>

          {/* מטריצת הזרימה */}
          <Section
            title="מטריצת הזרימה הרב-כיוונית"
            description={`${b.flows.length} רגלי נזילות · ${ourFeeLegs} מסומנות "העמלות בבריכות שלנו" - הבריכות שלהם הן עומק-נזילות ליתרה, לא מקור ההכנסה`}
            icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
          >
            {/* דסקטופ: טבלה */}
            <div className="hidden overflow-hidden rounded-xl border md:block">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">רגל</th>
                    <th className="px-3 py-2.5 font-medium">מסלול</th>
                    <th className="px-3 py-2.5 font-medium">סטטוס</th>
                    <th className="px-3 py-2.5 font-medium">היכן נגזרות העמלות</th>
                    <th className="px-3 py-2.5 font-medium">מדידה</th>
                    <th className="px-3 py-2.5 font-medium">שער</th>
                  </tr>
                </thead>
                <tbody>
                  {b.flows.map((f, i) => (
                    <tr key={f.id} className={cn("border-t align-top", i % 2 === 0 ? "bg-transparent" : "bg-muted/20")}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium leading-snug">{f.title}</p>
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{f.feeNote}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                          {f.from} -&gt; {f.to}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <FlowStatusBadge status={f.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <FeeBadge accrual={f.feeAccrual} />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-56 leading-snug text-muted-foreground">{f.measured}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-56 leading-snug text-muted-foreground">{f.gate}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* מובייל: כרטיסים */}
            <div className="flex flex-col gap-3 md:hidden">
              {b.flows.map((f) => (
                <Card key={f.id} className="min-w-0">
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <FlowStatusBadge status={f.status} />
                      <FeeBadge accrual={f.feeAccrual} />
                    </div>
                    <p className="text-sm font-semibold leading-snug">{f.title}</p>
                    <p dir="ltr" className="text-right font-mono text-[11px] text-muted-foreground">
                      {f.from} -&gt; {f.to}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{f.feeNote}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">מדידה: </span>
                      {f.measured}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">שער: </span>
                      {f.gate}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>

          {/* יעילות עוגנים */}
          <Section
            title="יעילות העוגנים ומסלול הפג"
            description="כל עוגן נשפט לפי מה הוא קונה לנו בכלכלה - לא לפי מה מצטערים שיהיה. הפג עצמו הוא כלי: SBD זול בחוץ קונה STEEM ביוקר בפנים"
            icon={<Anchor className="size-4" aria-hidden="true" />}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="min-w-0 lg:col-span-1">
                <CardContent className="flex flex-col gap-3 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Droplets className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    מסלול הפג של SBD
                  </h3>
                  <div className="flex flex-col gap-2 font-mono text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">נומינל</span>
                      <span className="tabular-nums">$1.0000</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">חיצוני</span>
                      <span className="tabular-nums">
                        {b.peg.sbdExternal != null ? `$${b.peg.sbdExternal.toFixed(4)}` : "לא נמדד"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">נגזר-פנים</span>
                      <span className="tabular-nums">
                        {b.peg.sbdImpliedInternal != null ? `$${b.peg.sbdImpliedInternal.toFixed(4)}` : "לא נמדד"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">פנים מול חוץ</span>
                      <span className={cn("tabular-nums", b.peg.internalVsExternalBps != null && b.peg.internalVsExternalBps > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                        {b.peg.internalVsExternalBps != null ? `${b.peg.internalVsExternalBps}bps` : "לא נמדד"}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit font-mono text-[11px]",
                      b.peg.regime === "VALUE-TRAP"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
                    )}
                  >
                    {b.peg.regime === "VALUE-TRAP" ? "VALUE-TRAP" : b.peg.regime === "NEUTRAL" ? "NEUTRAL" : "NOT-MEASURED"}
                  </Badge>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{b.peg.note}</p>
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 gap-3 lg:col-span-2 lg:grid-cols-2">
                {b.anchors.map((a) => (
                  <Card key={a.id} className="min-w-0">
                    <CardContent className="flex flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold leading-snug">{a.title}</h4>
                        <Badge
                          variant="outline"
                          dir="ltr"
                          className={cn(
                            "ms-auto shrink-0 font-mono text-[10px]",
                            a.verdict === "ARMED" || a.verdict === "ENFORCED" || a.verdict === "ANCHORED"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : a.verdict === "LOCAL"
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
                          )}
                        >
                          {a.verdict}
                        </Badge>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">קונה לנו: </span>
                        {a.buys}
                      </p>
                      <p className="rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-snug">{a.measured}</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{a.note}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </Section>

          {/* מנוע ערבוב-הסוואפ */}
          <Section
            title='מנוע ערבוב-הסוואפ - "העמלות יגזרו בבריכות שלנו"'
            description="בוחרים גודל הזנה - המנוע מחשב תוכנית מדודה: פנים קודם (ההכנסה שלנו), הנזילות שלהם ליתרה, ושער ההכרעה במקום. מדידה בלבד - המנוע מתכנן, המפעיל חותם"
            icon={<Layers className="size-4" aria-hidden="true" />}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">גודל ההזנה (STEEM):</span>
                {SIZE_PRESETS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={mixSize === s ? "default" : "outline"}
                    onClick={() => void runMix(s)}
                    disabled={mixBusy}
                    className="min-w-11 font-mono tabular-nums"
                  >
                    {s}
                  </Button>
                ))}
                {mixBusy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
              </div>

              <motion.div
                key={`${b.mix.sizeSteem}-${b.mix.gateVerdict}`}
                initial={{ opacity: 0.6, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-4"
              >
                {/* כרטיס השער */}
                <Card
                  className={cn(
                    "min-w-0",
                    b.mix.gateVerdict === "AUTONOMOUS"
                      ? "border-emerald-500/40"
                      : b.mix.gateVerdict === "OPERATOR-QUEUE"
                        ? "border-amber-500/40"
                        : "border-rose-500/40",
                  )}
                >
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <ShieldCheck
                      className={cn(
                        "size-5",
                        b.mix.gateVerdict === "AUTONOMOUS"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : b.mix.gateVerdict === "OPERATOR-QUEUE"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-rose-600 dark:text-rose-400",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        שער-ההכרעה:{" "}
                        {b.mix.gateVerdict === "AUTONOMOUS"
                          ? "אוטונומיה מלאה"
                          : b.mix.gateVerdict === "OPERATOR-QUEUE"
                            ? "תור אישור המפעיל"
                            : "אין מדידת-USD - סירוב"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{b.mix.gateDetail}</p>
                    </div>
                    <div className="text-left">
                      <p className="font-mono text-lg font-semibold tabular-nums">
                        {b.mix.sizeUsd != null ? `$${b.mix.sizeUsd.toFixed(2)}` : "?"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{b.mix.sizeSteem} STEEM</p>
                    </div>
                  </CardContent>
                </Card>

                {/* הרגליים */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {b.mix.legs.map((leg) => (
                    <Card key={leg.id} className="min-w-0">
                      <CardContent className="flex flex-col gap-3 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <FeeBadge accrual={leg.feeAccrual} />
                        </div>
                        <h4 className="text-sm font-semibold leading-snug">{leg.title}</h4>
                        <p className="font-mono text-[11px] text-muted-foreground">{leg.venue}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{leg.detail}</p>
                        <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
                          {leg.numbers.map((n, i) => (
                            <div key={i} className="flex items-start justify-between gap-3 text-[11px]">
                              <span className="text-muted-foreground">{n.label}</span>
                              <span className="text-left font-mono tabular-nums leading-snug">{n.value}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <p className="text-sm font-semibold leading-relaxed">{b.mix.mixingVerdict}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {b.mix.doctrine.map((d, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                        · {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            </div>
          </Section>

          {/* דוקטרינה + מקורות */}
          <Section
            title="דוקטרינת הכלכלה הריבונית"
            description={`נמדד ${fmtDateTime(b.at)}${b.down.length ? ` · נפילות כנות: ${b.down.join(" · ")}` : ""}`}
            icon={<Siren className="size-4" aria-hidden="true" />}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="min-w-0 lg:col-span-2">
                <CardContent className="flex flex-col gap-2 p-4">
                  {b.doctrine.map((d, i) => (
                    <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                      {i + 1}. {d}
                    </p>
                  ))}
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardContent className="flex flex-col gap-2 p-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <HelpCircle className="size-4 text-muted-foreground" aria-hidden="true" />
                    מקורות המדידה
                  </h4>
                  <div className={cn("flex flex-col gap-1.5", scrollBoxClass)}>
                    {Object.entries(b.sources).map(([k, v]) => (
                      <p key={k} className="font-mono text-[11px] leading-snug text-muted-foreground">
                        <span className="font-medium text-foreground">{k}</span>: {v}
                      </p>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    כל מספר שלא נמדד במחזור זה מסומן בכנות - לא מומר לאפס ולא להערכה.
                  </p>
                </CardContent>
              </Card>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
