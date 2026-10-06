"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Holdings-Audit View — מאזן הריבונות (R78).
//
// הוראת המפעיל שיצרה את התצוגה: "בחן את כלל המצב הקיים — מה יש לנו
// בידיים ככל, איזה ערך זה יכול להפיק ומה חסר כדי למקסם. יש לנו גם
// רשתות חברתיות שאפשר לפרסם בהן ולהרוויח. לעשות סדר במערכת כדי
// לנצל ולהפעיל את כולה ולהשלים את המערכים החסרים — כגוף ריבוני
// אוטונומי לא תלוי."
//
// חמש שכבות מוצגות כאן, כולן מה-API החי (/api/sovereign/holdings):
//   · נכסים — מה יש בידיים, לכל נכס המספר החי, מקור המדידה והפוטנציאל.
//   · תזרימי-ערך — מה כבר זורם, מה חמוש-וממתין, מה חסום — והחוסם בכנות.
//   · פערים — מה חסר כדי למקסם, בדרוג חומרה, עם ראיה חיה לכל שורה.
//   · רשתות חברתיות — ערוצי פרסום-והרווחה: חי / מוכן / חסר (בכנות).
//   · מערכים חסרים — מפת השלמה: מה נבנה-ורדום, מה חלקי, מה לא-נבנה.
//
// אין כאן הבטחות — יש מדידות. מקור שנפל מסומן; נכס שאינו ביד
// מסומן MISSING — לא מוסתר. זו רשת הוכחות, לא קטלוג משאלות.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bot,
  Boxes,
  CheckCircle2,
  Coins,
  Database,
  DoorOpen,
  Eye,
  Fuel,
  Globe,
  Hourglass,
  KeyRound,
  Landmark,
  Loader2,
  LucideIcon,
  Megaphone,
  PauseCircle,
  Puzzle,
  RefreshCw,
  Scale,
  ShieldAlert,
  Ship,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  FadeIn,
  Section,
} from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/sovereign/holdings) ───────────────────

type AssetGroup =
  | "identity" | "code" | "capital" | "fuel" | "reach" | "keys" | "agents" | "sandbox";
type AssetState = "LIVE" | "READY" | "WAIT" | "DORMANT" | "EPHEMERAL" | "BASELINE" | "PARTIAL";
type FlowState = "FLOWING" | "ARMED" | "BLOCKED";

interface HoldingAsset {
  id: string; name: string; group: AssetGroup; state: AssetState;
  primary: string; source: string; potential: string;
}

interface ValueStream {
  id: string; name: string; state: FlowState;
  now: string; ceiling: string; blocker: string | null;
}

interface GapItem {
  id: string; title: string; severity: "critical" | "high" | "medium";
  status: "OPEN" | "PARTIAL" | "GATE";
  unlocks: string; evidence: string;
}

interface SocialChannel {
  id: string; name: string; state: "LIVE" | "READY" | "MISSING";
  audience: string; earning: string; detail: string; actionNeeded: string | null;
}

interface MissingSystem {
  id: string; name: string; buildState: "BUILT-DORMANT" | "PARTIAL" | "NOT-BUILT";
  unlocks: string; effort: string; note: string;
}

interface AuditData {
  ok: boolean; at: string; height: number | null;
  assets: HoldingAsset[];
  valueStreams: ValueStream[];
  gaps: GapItem[];
  socialChannels: SocialChannel[];
  missingSystems: MissingSystem[];
  totals: {
    assets: number; liveAssets: number; flowing: number; armed: number;
    blocked: number; openGaps: number; liveChannels: number; missingChannels: number;
  };
  baselines: { label: string; measuredAt: string; what: string }[];
  down: string[];
  cached: boolean; stale: boolean; cacheAgeSec: number; refreshing: boolean;
}

const API = "/api/sovereign/holdings";
const POLL_MS = 90_000;

// ── מטא-נתונים ────────────────────────────────────────────────────────

const GROUP_META: Record<AssetGroup, { he: string; icon: LucideIcon }> = {
  identity: { he: "זהויות", icon: Users },
  code: { he: "צי-קוד", icon: Database },
  capital: { he: "הון", icon: Landmark },
  fuel: { he: "דלק", icon: Fuel },
  reach: { he: "תפוצה", icon: Globe },
  keys: { he: "מפתחות", icon: KeyRound },
  agents: { he: "סוכנים", icon: Bot },
  sandbox: { he: "סנדבוקס", icon: Smartphone },
};

const ASSET_STATE_META: Record<AssetState, { he: string; cls: string }> = {
  LIVE: { he: "חי", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  READY: { he: "מוכן", cls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" },
  WAIT: { he: "ממתין", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  DORMANT: { he: "רדום", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  EPHEMERAL: { he: "ארעי", cls: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  BASELINE: { he: "בסיס-מפגש", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  PARTIAL: { he: "חלקי", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

const FLOW_META: Record<FlowState, { he: string; icon: LucideIcon; cls: string; card: string }> = {
  FLOWING: {
    he: "זורם",
    icon: TrendingUp,
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    card: "border-emerald-500/25",
  },
  ARMED: {
    he: "חמוש-ממתין",
    icon: Hourglass,
    cls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    card: "border-teal-500/25",
  },
  BLOCKED: {
    he: "חסום",
    icon: PauseCircle,
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    card: "border-amber-500/30",
  },
};

const SEVERITY_META: Record<GapItem["severity"], { he: string; cls: string }> = {
  critical: { he: "קריטי", cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400" },
  high: { he: "גבוה", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  medium: { he: "בינוני", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
};

const BUILD_META: Record<MissingSystem["buildState"], { he: string; cls: string }> = {
  "BUILT-DORMANT": { he: "נבנה — רדום", cls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" },
  PARTIAL: { he: "חלקי", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "NOT-BUILT": { he: "לא-נבנה", cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400" },
};

const SEV_ORDER: Record<GapItem["severity"], number> = { critical: 0, high: 1, medium: 2 };

// ── צ'יפים ────────────────────────────────────────────────────────────

function AssetStateChip({ state }: { state: AssetState }) {
  const meta = ASSET_STATE_META[state] ?? ASSET_STATE_META.WAIT;
  return (
    <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", meta.cls)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {meta.he}
    </Badge>
  );
}

function FlowChip({ state }: { state: FlowState }) {
  const meta = FLOW_META[state];
  return (
    <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", meta.cls)}>
      <meta.icon className="size-3" aria-hidden="true" />
      {meta.he}
    </Badge>
  );
}

// ── התצוגה ─────────────────────────────────────────────────────────────

const SECTION_ANCHORS: Record<string, string> = {
  assets: "holdings-assets",
  value: "holdings-value",
  gaps: "holdings-gaps",
  networks: "holdings-networks",
  systems: "holdings-systems",
};

export function HoldingsAuditView({ section = "assets" }: { section?: string }) {
  const [data, setData] = useState<AuditData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState<AssetGroup | "all">("all");
  const alive = useRef(true);
  const anchors = useRef<Record<string, HTMLElement | null>>({});

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as AuditData;
      if (!alive.current) return;
      setData(j);
      setErr(null);
    } catch (e) {
      if (!alive.current) return;
      setErr(String((e as Error).message));
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
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (loading) return;
    const el = anchors.current[SECTION_ANCHORS[section] ?? section];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, loading]);

  const assets = data?.assets ?? [];
  const shownAssets = group === "all" ? assets : assets.filter((a) => a.group === group);
  const streams = data?.valueStreams ?? [];
  const gaps = [...(data?.gaps ?? [])].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const channels = data?.socialChannels ?? [];
  const systems = data?.missingSystems ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      {/* ── פתיח: הבקשה והתשובה ─────────────────────────────────── */}
      <FadeIn className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              >
                <Scale className="size-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  מאזן הריבונות
                </h1>
                <p className="text-sm text-muted-foreground">
                  SOVEREIGN-HOLDINGS · מה יש בידיים · איזה ערך זה מפיק · מה חסר כדי למקסם
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data ? (
              <Badge
                variant="outline"
                dir="rtl"
                className={cn(
                  "gap-1.5 font-mono text-[11px]",
                  data.stale
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                )}
              >
                {data.stale ? `מוגש בשל (${data.cacheAgeSec} שנ׳)` : `טרי (${data.cacheAgeSec} שנ׳)`}
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="gap-1.5"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              רענון
            </Button>
          </div>
        </div>

        <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">
          בחינה מלאה של הגוף הריבוני: כל נכס שביד — עם מספרו החי ומקור מדידתו;
          כל תזרים ערך — זורם, חמוש או חסום בכנות; כל פער — עם הראיה ומה
          פתירתו פותחת; ערוצי הפרסום-וההרווחה; ומפת השלמת המערכים החסרים.
          מה שאין ביד מסומן כחסר — כי זו רשת הוכחות, לא קטלוג משאלות.
        </p>

        {/* צ'יפים חיים */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              label: "נכסים ביד",
              value: data ? `${data.totals.assets} (${data.totals.liveAssets} חיים)` : "—",
            },
            {
              label: "תזרימים זורמים",
              value: data ? `${data.totals.flowing} כרגע` : "—",
            },
            {
              label: "חמושים-ממתינים",
              value: data ? `${data.totals.armed}` : "—",
            },
            {
              label: "פערים פתוחים",
              value: data ? `${data.totals.openGaps}` : "—",
            },
            {
              label: "ערוצי פרסום",
              value: data ? `${data.totals.liveChannels} חיים · ${data.totals.missingChannels} חסרים` : "—",
            },
          ].map((k) => (
            <Card key={k.label} className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">{k.label}</p>
                <p dir="rtl" className="truncate text-start text-sm font-semibold">
                  {loading ? "…" : k.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {err ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            נפילת קריאה: {err} — מנסה שוב אוטומטית בעוד {POLL_MS / 1000} שנ׳
          </div>
        ) : null}
        {!loading && data && data.down.length > 0 ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-medium">מקורות שנפלו (בכנות):</span>
            {data.down.map((d) => (
              <code key={d} dir="ltr" className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono">
                {d}
              </code>
            ))}
          </div>
        ) : null}
      </FadeIn>

      {/* ── שכבה 1: נכסים ──────────────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["holdings-assets"] = el;
        }}
        className="scroll-mt-24"
      >
        <Section
          className="mt-10"
          title="נכסים — מה יש לנו בידיים"
          description="כל נכס עם המספר החי שלו, מקור המדידה, והערך שהוא יכול להפיק. בסיסי-מפגש מסומנים בכנות — הם נמדדו עם גישת-מפעיל ואינם קריאים חסר-מפתח."
          icon={<Boxes />}
        >
          {/* בורר קבוצות */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="סינון קבוצות נכסים">
            <button
              type="button"
              onClick={() => setGroup("all")}
              aria-pressed={group === "all"}
              className={cn(
                "flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                group === "all"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              הכל ({assets.length})
            </button>
            {(Object.keys(GROUP_META) as AssetGroup[])
              .filter((g) => assets.some((a) => a.group === g))
              .map((g) => {
                const meta = GROUP_META[g];
                const active = group === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroup(g)}
                    aria-pressed={active}
                    className={cn(
                      "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                      active
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <meta.icon className="size-3.5" aria-hidden="true" />
                    {meta.he} ({assets.filter((a) => a.group === g).length})
                  </button>
                );
              })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="space-y-2.5 p-4">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))
              : shownAssets.map((a) => (
                  <Card key={a.id} className="flex flex-col">
                    <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold leading-snug">{a.name}</h3>
                        <AssetStateChip state={a.state} />
                      </div>
                      <p dir="rtl" className="font-mono text-sm font-semibold leading-relaxed text-foreground">
                        {a.primary}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <Eye className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                        {a.source}
                      </p>
                      <p className="mt-auto rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
                        <TrendingUp className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                        {a.potential}
                      </p>
                    </CardContent>
                  </Card>
                ))}
          </div>
        </Section>
      </div>

      {/* ── שכבה 2: תזרימי-ערך ─────────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["holdings-value"] = el;
        }}
        className="scroll-mt-24"
      >
        <Section
          className="mt-12"
          title="תזרימי-ערך — מה כבר מפיק, מה ממתין, מה חסום"
          description="כל תזרים עם המספר החי שלו עכשיו, התקרה שלו, והחוסם בכנות אם קיים. זורם = קורה בשרשרת; חמוש = בנוי וממתין; חסום = חסם מדוד."
          icon={<Wallet />}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(["FLOWING", "ARMED", "BLOCKED"] as FlowState[]).flatMap((st) =>
              streams
                .filter((v) => v.state === st)
                .map((v) => {
                  const meta = FLOW_META[v.state];
                  return (
                    <Card key={v.id} className={cn("flex flex-col", meta.card)}>
                      <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug">{v.name}</h3>
                          <FlowChip state={v.state} />
                        </div>
                        <p dir="rtl" className="font-mono text-sm font-semibold leading-relaxed">
                          {v.now}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <TrendingUp className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                          תקרה: {v.ceiling}
                        </p>
                        {v.blocker ? (
                          <p className="mt-auto flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                            <PauseCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            {v.blocker}
                          </p>
                        ) : (
                          <p className="mt-auto flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            ללא חוסם — הזרימה חופשית
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                }),
            )}
          </div>
        </Section>
      </div>

      {/* ── שכבה 3: פערים ─────────────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["holdings-gaps"] = el;
        }}
        className="scroll-mt-24"
      >
        <Section
          className="mt-12"
          title="פערים — מה חסר כדי למקסם"
          description="כל פער עם ראיה חיה לקיומו ומה סגירתו פותחת. הדרוג לפי חומרה — קריטי קודם."
          icon={<ShieldAlert />}
        >
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[28rem] overflow-auto overscroll-contain [scrollbar-width:thin]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                    <tr className="text-start text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 text-start font-medium">חומרה</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium">הפער</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-start font-medium md:table-cell">מה סגירתו פותחת</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium">ראיה חיה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-t">
                            <td colSpan={4} className="px-4 py-3">
                              <Skeleton className="h-5 w-full" />
                            </td>
                          </tr>
                        ))
                      : gaps.map((g) => {
                          const sev = SEVERITY_META[g.severity];
                          return (
                            <tr key={g.id} className="border-t align-top transition-colors hover:bg-muted/30">
                              <td className="px-4 py-3">
                                <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", sev.cls)}>
                                  {sev.he}
                                </Badge>
                                {g.status === "PARTIAL" ? (
                                  <span className="mt-1 block text-[10px] text-muted-foreground">מוקל</span>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 font-medium leading-snug">{g.title}</td>
                              <td className="hidden px-4 py-3 text-xs leading-relaxed text-muted-foreground md:table-cell">
                                {g.unlocks}
                              </td>
                              <td className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                                <code dir="auto" className="font-mono">{g.evidence}</code>
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </Section>
      </div>

      {/* ── שכבה 4: רשתות חברתיות ─────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["holdings-networks"] = el;
        }}
        className="scroll-mt-24"
      >
        <Section
          className="mt-12"
          title="רשתות חברתיות — ערוצי פרסום והרווחה"
          description="מה חי, מה מוכן, ומה חסר בכנות. ערוץ שאין לו חשבון ביד מסומן חסר — השלמתו היא החלטת-מפעיל מתועדת, לא טענה."
          icon={<Megaphone />}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="space-y-2.5 p-4">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))
              : channels.map((c) => {
                  const stateCls =
                    c.state === "LIVE"
                      ? ASSET_STATE_META.LIVE.cls
                      : c.state === "READY"
                        ? ASSET_STATE_META.READY.cls
                        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
                  const stateHe = c.state === "LIVE" ? "חי" : c.state === "READY" ? "מוכן" : "חסר";
                  return (
                    <Card key={c.id} className="flex flex-col">
                      <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug">{c.name}</h3>
                          <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", stateCls)}>
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            {stateHe}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <Users className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                          {c.audience}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <Banknote className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                          {c.earning}
                        </p>
                        <p className="text-xs leading-relaxed text-foreground/80">{c.detail}</p>
                        {c.actionNeeded ? (
                          <p className="mt-auto flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                            <DoorOpen className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            {c.actionNeeded}
                          </p>
                        ) : (
                          <p className="mt-auto flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            פעיל — אין פעולה נדרשת
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </Section>
      </div>

      {/* ── שכבה 5: מערכים חסרים ──────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["holdings-systems"] = el;
        }}
        className="scroll-mt-24"
      >
        <Section
          className="mt-12"
          title="מערכים חסרים — מפת ההשלמה"
          description="מה נבנה ורדום (מוכן להערה), מה חלקי, ומה טרם נבנה. כל השלמה עם מה שהיא פותחת ומאמץ הקמתה — הסדר לפי ערך."
          icon={<Puzzle />}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="space-y-2.5 p-4">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))
              : systems.map((m) => {
                  const bm = BUILD_META[m.buildState];
                  return (
                    <Card key={m.id} className="flex flex-col">
                      <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug">{m.name}</h3>
                          <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", bm.cls)}>
                            <Ship className="size-3" aria-hidden="true" />
                            {bm.he}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
                          <TrendingUp className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                          פותח: {m.unlocks}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <Coins className="me-1 inline size-3 align-[-2px]" aria-hidden="true" />
                          מאמץ: {m.effort}
                        </p>
                        <p className="mt-auto text-xs leading-relaxed text-foreground/80">{m.note}</p>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </Section>
      </div>

      {/* ── בסיסי-מפגש — כנות החותמות ──────────────────────────── */}
      {!loading && data && data.baselines.length > 0 ? (
        <FadeIn className="mt-12" delay={0.1}>
          <Section
            title="בסיסי-מפגש — מה שנמדד עם גישה ואינו קריא חסר-מפתח"
            description="ריפואים פרטיים וסודות מערכת אינם נגישים לקריאה ציבורית — הנתונים האלה נמדדו במפגש עם גישת-מפעיל, ומוצגים עם חותמת המדידה שלהם. כל השאר בדף זה נקרא חי בכל קריאה."
            icon={<KeyRound />}
          >
            <div className="max-h-64 overflow-auto overscroll-contain rounded-lg border [scrollbar-width:thin]">
              <table className="w-full text-sm">
                <tbody>
                  {data.baselines.map((b) => (
                    <tr key={b.label} className="border-t first:border-t-0 align-top">
                      <td className="px-4 py-2.5 font-medium">{b.label}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground" dir="ltr">
                        {b.measuredAt}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{b.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </FadeIn>
      ) : null}

      {/* ── שורת דוקטרינה ───────────────────────────────────────── */}
      <FadeIn className="mt-10" delay={0.15}>
        <p className="border-t pt-6 text-center text-xs leading-relaxed text-muted-foreground">
          מאזן זה הוא מדידה, לא הבטחה: נכס שאינו ביד מסומן חסר · מקור שנפל מסומן בנפילתו ·
          וכל תשואה היא נמדדת ואינה מובטחת.{" "}
          <span className="font-mono text-foreground/70">
            THE WEAVE · R78 · SOVEREIGN-HOLDINGS
          </span>
        </p>
      </FadeIn>
    </div>
  );
}
