"use client";

// ─────────────────────────────────────────────────────────────────────
// HUNTER VIEW · ציד ההזדמנויות הריבוני (R82 · THE HUNTER).
//
// הוראת המפעיל שיצרה את התצוגה: "לא צריך קהל חוץ בכלל — אנחנו
// הקהל והכל... המערכת צריכה להיות דינמית ומבינה בשוק חי ולא
// לחכות אלא לפעול ותמיד לחפש הזדמנויות טובות יותר מתוך מה
// שיש לנו ברשת... שברגע שבאמת יפתח השער הכל יזרום באופן
// שוטף איכותי ולגיטימי."
//
// ארבע מחלקות, הכול מה-API החי (/api/hunter):
//   · דופק הצייד — הסוכן החי, מחזור הסריקה, הקנרית האחרונה.
//   · השערים — מה סוגר את הזרימה עכשיו, בכנות, עם המספר הנמדד:
//     שער-הדקות (הקנרית) · פאריטה · חימוש SBD · פדיון TRX · פאוורדאון.
//     לכל שער — מה פותח אותו ומה זורם ברגע הפתיחה.
//   · לוח ההזדמנויות — מדורג: מה המערכת עושה עכשיו עם מה שיש
//     ביד, אוטונומיה מלאה מול שער-מפעיל — שום המתנה פסיבית.
//   · אמת-התשתית — מחסנים, הרצות אמת (ציבורי מול פרטי),
//     התפלגות סודות, דפי-ענן חיים.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlarmClock,
  Banknote,
  Bird,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Crosshair,
  Database,
  DoorClosed,
  DoorOpen,
  ExternalLink,
  Eye,
  Fuel,
  Gauge,
  GitBranch,
  Globe,
  Hourglass,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  LockOpen,
  Megaphone,
  PauseCircle,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch, errorMessage } from "@/components/weave/api";
import { ErrorBox, FadeIn, MotionCard, Section } from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/hunter) ──────────────────────────────

interface Gate {
  id: string;
  title: string;
  state: "OPEN" | "CLOSED" | "ARMED" | "WAIT" | "UNKNOWN";
  number: string;
  detail: string;
  opensWhen: string;
  flowsWhen: string;
  evidence: Record<string, string | number | null>;
}

interface Opportunity {
  id: string;
  title: string;
  state: "HUNTING" | "ARMED" | "GATED" | "FLOWING" | "WAITING" | "STALLED";
  number: string;
  detail: string;
  action: string;
  autonomy: "מלאה" | "שער-מפעיל";
  rank: number;
}

interface RepoItem {
  name: string;
  visibility: string;
  pushedAt: string;
  sizeKb: number;
}

interface RunEvidence {
  repo: string;
  name: string;
  conclusion: string | null;
  createdAt: string;
}

interface HunterBoard {
  ok: boolean;
  at: string;
  cached?: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
  daemon: {
    alive: boolean;
    beats: number;
    scanIntervalSec: number;
    lastScanAt: string | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    canonLast: { at: string; ok: boolean; path: string } | null;
  } | null;
  canary: {
    lastRun: { id: number; conclusion: string | null; createdAt: string; stepsRun: number } | null;
    lastSuccessAt: string | null;
    nextDueAt: string | null;
  } | null;
  gates: Gate[];
  opportunities: Opportunity[];
  infra: {
    repos: { total: number; privateCount: number; publicCount: number; totalSizeKb: number; items: RepoItem[] };
    runs: { publicEvidence: RunEvidence[]; privateEvidence: RunEvidence[] };
    secrets: Array<{ repo: string; count: number; names: string[] }>;
    pages: Array<{ name: string; url: string; live: boolean; httpStatus: number | null }>;
  };
  money: {
    ok: boolean;
    parity: number | null;
    deployedSteem: number;
    idleSteem: number;
    distanceBps: number | null;
    powerdown: { nextPayment: string; paymentsLeft: number; totalRemainingSteem: number; weeklySteem: number } | null;
  };
  treasury: { ok: boolean; usdTotal: number | null; usdLiquid: number | null };
  pulse: { alive: boolean; nextDueAt: string | null } | null;
}

// ── עזרי-תצוגה ──────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso.slice(11, 19);
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function gateVisual(state: Gate["state"]): { chip: string; ring: string; icon: React.ReactNode } {
  switch (state) {
    case "OPEN":
      return {
        chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        ring: "border-emerald-500/30",
        icon: <DoorOpen className="size-4 text-emerald-600 dark:text-emerald-400" />,
      };
    case "CLOSED":
      return {
        chip: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
        ring: "border-rose-500/30",
        icon: <DoorClosed className="size-4 text-rose-600 dark:text-rose-400" />,
      };
    case "ARMED":
      return {
        chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        ring: "border-amber-500/30",
        icon: <Target className="size-4 text-amber-600 dark:text-amber-400" />,
      };
    case "WAIT":
      return {
        chip: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
        ring: "border-slate-500/25",
        icon: <Hourglass className="size-4 text-slate-600 dark:text-slate-400" />,
      };
    default:
      return {
        chip: "border-muted bg-muted/40 text-muted-foreground",
        ring: "border-border",
        icon: <Eye className="size-4 text-muted-foreground" />,
      };
  }
}

function oppVisual(state: Opportunity["state"]): string {
  switch (state) {
    case "HUNTING":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "ARMED":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "FLOWING":
      return "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "GATED":
      return "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300";
    case "STALLED":
      return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
    default:
      return "border-muted bg-muted/40 text-muted-foreground";
  }
}

const OPP_LABEL: Record<Opportunity["state"], string> = {
  HUNTING: "צד",
  ARMED: "חמוש",
  FLOWING: "זורם",
  GATED: "שער-מפעיל",
  STALLED: "מתעכב",
  WAITING: "ממתין",
};

const GATE_LABEL: Record<Gate["state"], string> = {
  OPEN: "פתוח",
  CLOSED: "סגור",
  ARMED: "חמוש על הקו",
  WAIT: "ממתין למילוי",
  UNKNOWN: "לא נמדד",
};

// ── התצוגה ──────────────────────────────────────────────────────────

export function HunterView() {
  const [data, setData] = useState<HunterBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllRepos, setShowAllRepos] = useState(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const d = await apiFetch<HunterBoard>("/api/hunter");
      if (!alive.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
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
    timer.current = setInterval(() => void load(true), 60_000);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  // ── טעינה ────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorBox message={error} onRetry={() => void load()} retrying={refreshing} />;
  }

  const d = data;
  if (!d) return null;

  const daemon = d.daemon;
  const canary = d.canary;
  const minutesGate = d.gates.find((g) => g.id === "minutes");
  const parityGate = d.gates.find((g) => g.id === "parity");
  const shownRepos = showAllRepos ? d.infra.repos.items : d.infra.repos.items.slice(0, 8);
  const freshAge = d.cacheAgeSec != null ? (d.cacheAgeSec < 120 ? "חי" : `${d.cacheAgeSec}ש'`) : "—";

  return (
    <div className="flex flex-col gap-6">
      {/* ── פתיח: דופק הצייד ─────────────────────────────────── */}
      <Section
        title="הצייד — הרשת לא מחכה"
        description="סוכן אוטונומי שסורק את הרשת כל 10 דקות, משגר קנרית כל 6 שעות, וברגע ששער נפתח — מפעיל את הזרימה מיד. אנחנו הקהל."
        icon={<Crosshair />}
        action={
          <div className="flex items-center gap-2">
            {d.stale ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                מטומן {freshAge}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                <Activity /> חי
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing} className="h-9">
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              רענן
            </Button>
          </div>
        }
      >
        <FadeIn>
          <MotionCard className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Radar className="size-3.5" /> הצייד
                  </span>
                  {daemon ? (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                      </span>
                      חי · {daemon.beats} פעימות
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-rose-600 dark:text-rose-400">
                      <XCircle className="size-4" /> לא נמדד
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    סריקה אחרונה {fmtTime(daemon?.lastScanAt)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Bird className="size-3.5" /> הקנרית (שער-הדקות)
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-semibold",
                      canary?.lastSuccessAt
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {canary?.lastSuccessAt ? <CheckCircle2 className="size-4" /> : <DoorClosed className="size-4" />}
                    {canary?.lastSuccessAt
                      ? "צייצה — פתוח"
                      : canary?.lastRun
                        ? `סגור · ${canary.lastRun.stepsRun} צעדים`
                        : "סגור"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    בדיקה הבאה {canary?.nextDueAt ? canary.nextDueAt.slice(11, 16) + "Z" : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Gauge className="size-3.5" /> מלכודת הפאריטה
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {d.money.distanceBps != null ? `${d.money.distanceBps.toLocaleString("en-US")}bps` : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {d.money.deployedSteem.toFixed(1)} STEEM בסולם
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Wallet className="size-3.5" /> אוצר
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {d.treasury.usdTotal != null ? `$${d.treasury.usdTotal.toFixed(2)}` : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    נזיל {d.treasury.usdLiquid != null ? `$${d.treasury.usdLiquid.toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Fuel className="size-3.5" /> דלק בדרך
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {d.money.powerdown ? `~${d.money.powerdown.weeklySteem.toFixed(0)} STEEM` : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {d.money.powerdown ? `ב-${d.money.powerdown.nextPayment.slice(5, 16).replace("T", " ")}Z` : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Megaphone className="size-3.5" /> הדופק
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-semibold",
                      d.pulse?.alive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    {d.pulse?.alive ? <Activity className="size-4" /> : <PauseCircle className="size-4" />}
                    {d.pulse?.alive ? "חי" : "לא נמדד"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    שידור הבא {d.pulse?.nextDueAt ? d.pulse.nextDueAt.slice(0, 10) : "—"}
                  </span>
                </div>
              </div>
              {daemon?.lastDecision ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {daemon.lastDecision.kind}
                  </Badge>
                  <span className="text-muted-foreground">{daemon.lastDecision.detail}</span>
                  <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
                    {fmtTime(daemon.lastDecision.at)}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </MotionCard>
        </FadeIn>
      </Section>

      {/* ── השערים ───────────────────────────────────────────── */}
      <Section
        title="השערים — מה סוגר את הזרימה, בכנות"
        description="כל שער עם המספר הנמדד, מה פותח אותו, ומה זורם ברגע הפתיחה. שום המתנה פסיבית — הצייד בודק כל שער בכל מחזור."
        icon={<DoorOpen />}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d.gates.map((g, i) => {
            const v = gateVisual(g.state);
            const isMinutes = g.id === "minutes";
            return (
              <FadeIn key={g.id} delay={i * 0.05}>
                <MotionCard
                  className={cn(
                    v.ring,
                    isMinutes && "md:col-span-2 xl:col-span-1",
                    isMinutes && g.state === "CLOSED" && "bg-gradient-to-br from-rose-500/5 via-transparent to-transparent",
                  )}
                >
                  <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/60 [&_svg]:size-4">
                          {isMinutes ? <Bird /> : g.id === "parity" ? <Gauge /> : g.id === "sbd" ? <Coins /> : g.id === "trx" ? <Banknote /> : <CalendarClock />}
                        </span>
                        <h3 className="truncate text-sm font-semibold">{g.title}</h3>
                      </div>
                      <span className={cn("flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", v.chip)}>
                        {v.icon}
                        {GATE_LABEL[g.state]}
                      </span>
                    </div>
                    <div className="text-2xl font-bold tabular-nums tracking-tight">{g.number}</div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{g.detail}</p>
                    <div className="mt-auto grid gap-2 border-t pt-3 text-[11px]">
                      <div className="flex items-start gap-2">
                        <LockOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">נפתח כש:</span> {g.opensWhen}
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Zap className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">אז זורם:</span> {g.flowsWhen}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </MotionCard>
              </FadeIn>
            );
          })}
        </div>
      </Section>

      {/* ── לוח ההזדמנויות ───────────────────────────────────── */}
      <Section
        title="לוח ההזדמנויות — מה המערכת עושה עכשיו"
        description="מדורג לפי קרבה-לפעולה. כל שורה עם המספר הנמדד ומה נעשה בפועל — אוטונומיה מלאה או שער-מפעיל, בכנות מלאה."
        icon={<Target />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {d.opportunities.map((o, i) => (
            <FadeIn key={o.id} delay={i * 0.04}>
              <MotionCard>
                <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted/60 font-mono text-[11px] font-bold text-muted-foreground">
                        {o.rank}
                      </span>
                      <h3 className="truncate text-sm font-semibold">{o.title}</h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", oppVisual(o.state))}>
                        {o.state === "FLOWING" ? <Sparkles className="size-3" /> : o.state === "HUNTING" ? <Crosshair className="size-3" /> : null}
                        {OPP_LABEL[o.state]}
                      </span>
                    </div>
                  </div>
                  <div className="text-xl font-bold tabular-nums tracking-tight">{o.number}</div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{o.detail}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <TrendingUp className="size-3.5" />
                      {o.action}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px]",
                        o.autonomy === "מלאה"
                          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                          : "border-amber-500/40 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {o.autonomy === "מלאה" ? <ShieldCheck className="size-3" /> : <KeyRound className="size-3" />}
                      אוטונומיה {o.autonomy}
                    </Badge>
                  </div>
                </CardContent>
              </MotionCard>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* ── אמת-התשתית ───────────────────────────────────────── */}
      <Section
        title="אמת-התשתית — המחסנים, ההרצות, הסודות"
        description="נמדד חי מ-GitHub: מלאי המחסנים, הרצות-אמת (הצד הציבורי רץ חופשי — הפרטי חסום דקות), התפלגות סודות לפי שם בלבד, ודפי-הענן."
        icon={<Database />}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {/* מחסנים */}
          <FadeIn delay={0.05}>
            <MotionCard className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">מחסני הרשת</h3>
                  <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                    {d.infra.repos.total} מחסנים
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <div className="text-lg font-bold tabular-nums">{d.infra.repos.privateCount}</div>
                    <div className="text-[10px] text-muted-foreground">פרטיים</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <div className="text-lg font-bold tabular-nums">{d.infra.repos.publicCount}</div>
                    <div className="text-[10px] text-muted-foreground">ציבוריים</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <div className="text-lg font-bold tabular-nums">
                      {Math.round(d.infra.repos.totalSizeKb / 1024)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">MB סה״כ</div>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {shownRepos.map((r) => (
                        <tr key={r.name} className="border-b last:border-0">
                          <td className="py-1.5 pe-2 font-mono">{r.name}</td>
                          <td className="py-1.5 pe-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-[10px]",
                                r.visibility === "private" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
                              )}
                            >
                              {r.visibility === "private" ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                              {r.visibility === "private" ? "פרטי" : "ציבורי"}
                            </span>
                          </td>
                          <td className="py-1.5 text-end text-[10px] tabular-nums text-muted-foreground">
                            {r.pushedAt.slice(5, 10).replace("-", "/")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.infra.repos.items.length > 8 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-auto h-9 w-full"
                    onClick={() => setShowAllRepos((v) => !v)}
                  >
                    <ChevronDown className={cn("transition-transform", showAllRepos && "rotate-180")} />
                    {showAllRepos ? "הצג פחות" : `עוד ${d.infra.repos.items.length - 8} מחסנים`}
                  </Button>
                ) : null}
              </CardContent>
            </MotionCard>
          </FadeIn>

          {/* הרצות אמת */}
          <FadeIn delay={0.1}>
            <MotionCard className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">הרצות-אמת — הפיצול החי</h3>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  המחסנים הציבוריים רצים על דקות-חינם בלתי-מוגבלות וממשיכים להתפרסם. הפרטיים נכשלו בלי שצעד
                  אחד רץ (חתימת דלדול-הדקות) עד 2026-09-24 — מאז הופעלו מאמתים מקומיים (r118) שמחזירים את
                  האמת לגיט מדי יום.
                </p>
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    ציבוריים (דקות חינם)
                  </div>
                  {d.infra.runs.publicEvidence.map((r) => (
                    <div key={r.repo} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate">
                        <span className="font-mono font-medium">{r.repo}</span>
                        <span className="text-muted-foreground"> · {r.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5" />
                        {fmtDateTime(r.createdAt)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    פרטיים (חסומי-דקות)
                  </div>
                  {d.infra.runs.privateEvidence.map((r) => (
                    <div key={r.repo} className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate">
                        <span className="font-mono font-medium">{r.repo}</span>
                        <span className="text-muted-foreground"> · {r.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-rose-600 dark:text-rose-400">
                        <XCircle className="size-3.5" />
                        {fmtDateTime(r.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px]">
                  <Bird className="size-4 shrink-0" />
                  <span className="text-muted-foreground">
                    הקנרית האחרונה:{" "}
                    {canary?.lastRun ? (
                      <>
                        #{canary.lastRun.id} · {canary.lastRun.conclusion ?? "?"} ·{" "}
                        {canary.lastRun.stepsRun} צעדים · {fmtDateTime(canary.lastRun.createdAt)}
                      </>
                    ) : (
                      "טרם נמדדה"
                    )}
                  </span>
                </div>
              </CardContent>
            </MotionCard>
          </FadeIn>

          {/* סודות + דפים */}
          <FadeIn delay={0.15}>
            <MotionCard className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">התפלגות הסודות</h3>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  שמות בלבד — ערכים לעולם לא נקראים מהרשת. הכלים שמשתמשים בסוד מסומנים בכנות.
                </p>
                <div className="flex flex-col gap-1.5">
                  {d.infra.secrets.map((s) => (
                    <div key={s.repo} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs">
                      <span className="font-mono font-medium">{s.repo}</span>
                      {s.count === 0 ? (
                        <span className="text-[10px] text-muted-foreground">אין סודות</span>
                      ) : (
                        <span className="flex flex-wrap items-center justify-end gap-1">
                          {s.names.map((n) => (
                            <span key={n} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                              {n}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Globe className="size-4 text-muted-foreground" />
                    דפי-הענן
                  </div>
                  {d.infra.pages.map((p) => (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-1",
                          p.live ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {p.live ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                        {p.live ? `חי ${p.httpStatus ?? ""}` : `מטומן ${p.httpStatus ?? ""}`}
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </span>
                    </a>
                  ))}
                </div>
              </CardContent>
            </MotionCard>
          </FadeIn>
        </div>
      </Section>

      {/* ── חוקי הצייד ────────────────────────────────────────── */}
      <Section
        title="חוקי הצייד"
        description="הדוקטרינה שמאחורי הלוח — לא משאלות, חוקים שנאכפים בקוד."
        icon={<Landmark />}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: <Clock className="size-4" />,
              title: "אפס המתנה פסיבית",
              body: "כל שער נבדק במחזור קבוע (קצב מוגדר בקוד — לא נמדד כאן): הקנרית, המוביל והצופה. שער שנפתח — הזרימה מופעלת מיד באותו מחזור.",
            },
            {
              icon: <Eye className="size-4" />,
              title: "שום סטטוס מומצא",
              body: "מקור שנפל מסומן לא-נמדד. הקנרית היא הוכחה חיה: כישלון בלי צעד אחד = הראנר לא קם = הדקות אזלו. לא טענה — מדידה.",
            },
            {
              icon: <ShieldCheck className="size-4" />,
              title: "אנחנו הקהל",
              body: "אין תלות במשתמשים חיצוניים: הסוכנים הם הביקוש וההיצע, הרשת היא השופטת, והשידור היומי הוא עוגן-אמת — לא בידוד לקהל.",
            },
            {
              icon: <Boxes className="size-4" />,
              title: "כל נכס בעבודה",
              body: "הדלק פרוש על הקו, הנחיתה הבאה נתפסת בתוך מחזור, הפקדות-חוץ נקראות בקצב מוגדר בקוד (כל 20 דקות — לא נמדד כאן). הון שיושב = תקלה שמתועדת ומטופלת.",
            },
          ].map((law, i) => (
            <FadeIn key={law.title} delay={i * 0.05}>
              <MotionCard className="h-full">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <span className="flex size-8 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground [&_svg]:size-4">
                    {law.icon}
                  </span>
                  <h4 className="text-sm font-semibold">{law.title}</h4>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{law.body}</p>
                </CardContent>
              </MotionCard>
            </FadeIn>
          ))}
        </div>
        {daemon?.canonLast ? (
          <FadeIn delay={0.2}>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <Database className="size-3.5" />
              <span>
                קבלה אחרונה בקנון (ריפו Defi): {daemon.canonLast.ok ? "נדחפה בהצלחה" : "נכשלה"} ·{" "}
                <span className="font-mono">{daemon.canonLast.path}</span> · {fmtDateTime(daemon.canonLast.at)}
              </span>
            </div>
          </FadeIn>
        ) : null}
      </Section>
    </div>
  );
}
