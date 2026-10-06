"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Defi-Router View — מנוע ניתוב הכלים (R77).
//
// הוראת המפעיל שיצרה את התצוגה: "פתחתי תיקיה חדשה בשם defi — להבין
// איך לנתב כלי defi ולהשתמש בהם נכון לטובת הרשת. המטרה חוסר תלות
// במשתמשים — הסוכנים הם המשתמשים בהקמת ריבונות כלכלית אוטונומית
// מתפתחת. להשיג כלים ולהבין איך המערכת משתמשת בהם כדי לייצר ראוטרים
// לרשתות אחרות כדי לייצר נזילות יש מאין."
//
// שלוש שכבות מוצגות כאן, כולן מה-API החי (/api/defi/router):
//   · מנוע הניתוב — שישה מסלולים מחושבים ממספרים חיים, עם חוליות
//     פעילות/ממתינות, חוסמים כנים וזרימה נטו.
//   · מפת הכלים — כל כלי DeFi שהרשת מחזיקה לפי קטגוריה, עם המספר
//     החי שלו (תשואה/יתרה/TVL) ומפעילו.
//   · הסוכנים-המשתמשים — מי מפעיל כל ראוטר ובאיזו אוטונומיה.
// אין כאן הבטחות — יש מדידות. ה"יש מאין" מוסבר בכנות:
// פעילות-עצמה → עמלות → קרן → חוסכים → שוק.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  Banknote,
  Bot,
  Boxes,
  Compass,
  Coins,
  DoorOpen,
  Fuel,
  Landmark,
  Layers,
  Loader2,
  LucideIcon,
  Network,
  PiggyBank,
  RefreshCw,
  Route as RouteIcon,
  Ship,
  Sparkles,
  Vault,
  Wallet,
  Waypoints,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ExchangeRouterSection } from "@/components/weave/views/exchange-router-section";
import { SovereignDexSection } from "@/components/weave/views/sovereign-dex-section";
import {
  FadeIn,
  HashChip,
  MotionCard,
  Section,
  scrollBoxClass,
} from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/defi/router) ─────────────────────────

type ToolCategory =
  | "market" | "vault" | "savings" | "grid" | "fuel" | "bridge" | "external" | "tron";
type ToolState = "LIVE" | "READY" | "WAIT" | "DORMANT" | "EXTERNAL";

interface RouterTool {
  id: string; name: string; category: ToolCategory; state: ToolState;
  primary: string; primaryNote: string;
  apr: number | null; apy: number | null; tvl: number | null;
  detail: string; operatesBy: string;
}

interface RouteHop {
  n: number; toolId: string; toolName: string;
  action: string; live: string; done: boolean;
}

interface ComputedRoute {
  id: string; goal: string; headline: string;
  hops: RouteHop[]; blockers: string[]; netFlow: string;
}

interface RouterAgent {
  id: string; name: string; role: string; operates: string[];
  status: string; autonomy: "AUTONOMOUS" | "SUPERVISED" | "OPERATOR-GATE";
  evidence: string;
}

interface BridgeNetwork {
  chain: string; address: string | null;
  ok: boolean | null; deposits: number | null; note: string;
}

interface RouterData {
  ok: boolean; at: string; height: number | null;
  tools: RouterTool[]; routes: ComputedRoute[]; agents: RouterAgent[];
  networks: BridgeNetwork[];
  idle: { deployableUsds: number; arenaReserveUsds: number };
  down: string[]; doctrine: string;
  cached: boolean; stale: boolean; cacheAgeSec: number; refreshing: boolean;
}

const API = "/api/defi/router";
const POLL_MS = 90_000;

// ── מטא-נתוני קטגוריות ומצבים ────────────────────────────────────────

const CATEGORY_META: Record<ToolCategory, { he: string; icon: LucideIcon; hint: string }> = {
  market: { he: "שוק-הכספים", icon: Landmark, hint: "שווקי הלוואות פנימיים על השרשרת" },
  vault: { he: "כספות הבריכות", icon: Vault, hint: "תשואת LP נמדדת מעומק הבריכות" },
  savings: { he: "קרן החיסכון", icon: PiggyBank, hint: "ריבית יומית מהכנסה מדודה" },
  grid: { he: "הגריד החוץ", icon: Ship, hint: "שער היציאה לשוק STEEM החיצוני" },
  fuel: { he: "מנוע הדלק", icon: Fuel, hint: "powerdown שבועי — דלק נכנס" },
  bridge: { he: "גשרי הפקדות", icon: Network, hint: "4 רשתות נצפות חסר-מפתחות" },
  tron: { he: "TRON", icon: Coins, hint: "המשמרת החיה וכליה" },
  external: { he: "הענקיות החיצוניות", icon: Compass, hint: "האוקיינוס שאליו הראוטר ינתב" },
};

const STATE_META: Record<ToolState, { he: string; cls: string }> = {
  LIVE: { he: "חי", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  READY: { he: "מוכן", cls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" },
  WAIT: { he: "ממתין", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  DORMANT: { he: "רדום", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400" },
  EXTERNAL: { he: "חוץ", cls: "border-zinc-500/30 bg-zinc-500/5 text-zinc-600 dark:text-zinc-500" },
};

const ROUTE_TITLES: Record<string, { he: string; icon: LucideIcon }> = {
  bootstrap: { he: "נזילות יש מאין", icon: Sparkles },
  "external-in": { he: "גשר-פנימה", icon: DoorOpen },
  "deploy-idle": { he: "פריסת הון פנוי", icon: Wallet },
  compound: { he: "ריבית-דריבית", icon: Layers },
  "fuel-in": { he: "דלק-פנימה", icon: Fuel },
  "tron-route": { he: "נתיב TRON", icon: Coins },
};

const AUTONOMY_META: Record<string, { he: string; cls: string }> = {
  AUTONOMOUS: { he: "אוטונומי", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  SUPERVISED: { he: "מפוקח", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "OPERATOR-GATE": { he: "שער-מפעיל", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

// ── קומפוננטת עזר: צ'יפ מצב ──────────────────────────────────────────

function StateChip({ state }: { state: ToolState }) {
  const meta = STATE_META[state];
  return (
    <Badge variant="outline" dir="rtl" className={cn("gap-1 text-[11px]", meta.cls)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {meta.he}
    </Badge>
  );
}

// ── התצוגה ───────────────────────────────────────────────────────────

const SECTION_ANCHORS: Record<string, string> = {
  router: "defi-router-engine",
  tools: "defi-router-tools",
  agents: "defi-router-agents",
  bridges: "defi-router-bridges",
};

export function DefiRouterView({ section = "router" }: { section?: string }) {
  const [data, setData] = useState<RouterData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [routeId, setRouteId] = useState<string>("bootstrap");
  const [category, setCategory] = useState<ToolCategory | "all">("all");
  const alive = useRef(true);
  const anchors = useRef<Record<string, HTMLElement | null>>({});

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as RouterData;
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

  // ניווט-תת-סעיף: גלילה חלקה לשכבה המבוקשת כשהיא נטענה
  useEffect(() => {
    if (loading) return;
    const el = anchors.current[SECTION_ANCHORS[section] ?? section];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, loading]);

  const route = data?.routes.find((r) => r.id === routeId) ?? null;
  const tools = data?.tools ?? [];
  const shown =
    category === "all" ? tools : tools.filter((t) => t.category === category);
  const liveCount = tools.filter((t) => t.state === "LIVE").length;
  const autoCount = data?.agents.filter((a) => a.autonomy === "AUTONOMOUS").length ?? 0;
  // כותרת-אמת: מספר-המסלולים נמדד מה-API, לא קבוע בקוד. כשאין נתונים — בלי מספר בכלל.
  const engineTitle =
    data == null
      ? "מנוע הניתוב — מסלולים מחושבים מהמספרים החיים"
      : `מנוע הניתוב — ${data.routes.length} מסלולים מחושבים מהמספרים החיים`;

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      {/* ── פתיח: המשימה והתשובה ─────────────────────────────────── */}
      <FadeIn className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              >
                <Waypoints className="size-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  מנוע ניתוב הכלים
                </h1>
                <p className="text-sm text-muted-foreground">
                  THE-DEFI-ROUTER · ריבונות כלכלית אוטונומית מתפתחת — הסוכנים הם המשתמשים
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
          הרשת לא ממתינה למשתמשים אנושיים — היא מנתבת את הונה דרך כלי DeFi
          שפועלים עכשיו, מפעילה ראוטרים לרשתות אחרות, ומייצרת נזילות מפעילות-עצמה:
          פעילות → עמלות → קרן → חוסכים → שוק. כל מספר בדף זה נמדד חי מהקונסולה
          הציבורית, מ-DefiLlama ומ-trongrid — כלום לא מומצא.
        </p>

        {/* צ'יפים חיים */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "גובה השרשרת", value: data?.height?.toLocaleString("en-US") ?? "—" },
            { label: "כלים במפה", value: data ? `${tools.length} (${liveCount} חיים)` : "—" },
            { label: "מסלולי ניתוב", value: data ? `${data.routes.length}` : "—" },
            { label: "סוכנים-מפעילים", value: data ? `${data.agents.length} (${autoCount} אוטונומיים)` : "—" },
            { label: "הון פנוי לפריסה", value: data ? `${data.idle.deployableUsds.toFixed(0)} USDS` : "—" },
          ].map((k) => (
            <Card key={k.label} className="bg-muted/30">
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">{k.label}</p>
                <p dir="ltr" className="truncate text-start font-mono text-sm font-semibold">
                  {loading ? "…" : k.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </FadeIn>

      {/* ── שכבה 0: ראוטר ההחלפות — ציטוטים חיים מ-4 רשתות (R96) ── */}
      <ExchangeRouterSection router={data} />

      {/* ── שכבה 0.5: ה-DEX הריבוני — ראוטר-עומק · גריד-מתנגד · ארביטראז-רישתי (r193) ── */}
      <SovereignDexSection />

      {/* ── שכבה 1: מנוע הניתוב ──────────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["defi-router-engine"] = el;
        }}
        className="scroll-mt-24"
      >
      <Section
        className="mt-10"
        title={engineTitle}
        description="כל מסלול הוא שרשרת חוליות: מה כבר קורה בשרשרת (ירוק) ומה בנוי וממתין. החוסמים כתובים בכנות — זו רשת הוכחות, לא הבטחות."
        icon={<RouteIcon />}
      >
        {/* בורר מסלול */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="בחירת מסלול">
          {(data?.routes ?? []).map((r) => {
            const meta = ROUTE_TITLES[r.id] ?? { he: r.goal, icon: RouteIcon };
            const active = r.id === routeId;
            return (
              <button
                key={r.id}
                role="tab"
                aria-selected={active}
                onClick={() => setRouteId(r.id)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                  active
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <meta.icon className="size-3.5" aria-hidden="true" />
                {meta.he}
              </button>
            );
          })}
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-full" />
              ))
            : null}
        </div>

        {/* המסלול הנבחר */}
        {loading && !route ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="space-y-4 pt-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : route ? (
          <MotionCard>
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{route.goal}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {route.headline}
                  </p>
                </div>
                <Badge variant="outline" dir="rtl" className="gap-1 text-[11px]">
                  {route.hops.filter((h) => h.done).length}/{route.hops.length} חוליות חיות
                </Badge>
              </div>

              {/* סולם החוליות */}
              <ol className="relative mt-6 space-y-0">
                {route.hops.map((hop, i) => (
                  <li key={hop.n} className="relative flex gap-4 pb-6 last:pb-0">
                    {/* קו מחבר */}
                    {i < route.hops.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-9 start-[15px] h-[calc(100%-2.25rem)] w-px",
                          hop.done ? "bg-emerald-500/40" : "bg-zinc-300 dark:bg-zinc-700"
                        )}
                      />
                    ) : null}
                    {/* מספר החוליה */}
                    <span
                      className={cn(
                        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold",
                        hop.done
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "border-dashed border-zinc-400 bg-muted text-muted-foreground"
                      )}
                    >
                      {hop.done ? "✓" : hop.n}
                    </span>
                    {/* תוכן החוליה */}
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{hop.toolName}</p>
                        {hop.done ? (
                          <Badge variant="outline" dir="rtl" className="border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                            פועל
                          </Badge>
                        ) : (
                          <Badge variant="outline" dir="rtl" className="border-zinc-500/40 bg-zinc-500/10 px-1.5 text-[10px] text-zinc-600 dark:text-zinc-400">
                            בנוי וממתין
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
                        {hop.action}
                      </p>
                      <p dir="rtl" className="mt-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {hop.live}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {/* זרימה נטו */}
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5 sm:flex-row sm:items-center sm:gap-3">
                <ArrowDown className="size-4 shrink-0 rotate-[-90deg] text-emerald-600 sm:rotate-0 dark:text-emerald-400" aria-hidden="true" />
                <p className="text-[13px] leading-relaxed">
                  <span className="font-semibold">זרימה נטו:</span>{" "}
                  <span className="text-muted-foreground">{route.netFlow}</span>
                </p>
              </div>

              {/* חוסמים */}
              {route.blockers.length > 0 ? (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
                  {route.blockers.map((b) => (
                    <p key={b} className="flex items-start gap-2 text-[13px] leading-relaxed text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {b}
                    </p>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </MotionCard>
        ) : err ? (
          <Card className="border-rose-500/30">
            <CardContent className="p-5 text-sm text-rose-700 dark:text-rose-300">
              נכשל קריאת מנוע הניתוב: {err}
            </CardContent>
          </Card>
        ) : null}
      </Section>
      </div>

      {/* ── שכבה 2: מפת הכלים ────────────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["defi-router-tools"] = el;
        }}
        className="scroll-mt-24"
      >
      <Section
        className="mt-12"
        title="מפת הכלים — כל מה שהרשת השיגה ומפעילה"
        description="כל כלי הוא קוד שרץ עכשיו עם מספר נמדד. התשואות ב-bps מהשרשרת; הענקיות הן יעדי הניתוב החיצוני."
        icon={<Boxes />}
      >
        {/* בורר קטגוריה */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...(Object.keys(CATEGORY_META) as ToolCategory[])]).map((c) => {
            const active = category === c;
            const count = c === "all" ? tools.length : tools.filter((t) => t.category === c).length;
            const label = c === "all" ? "הכל" : CATEGORY_META[c].he;
            return (
              <button
                key={c}
                onClick={() => setCategory(c as ToolCategory | "all")}
                aria-pressed={active}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground/25 bg-foreground text-background"
                    : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {label}
                <span className="font-mono text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* רשת הכלים */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loading && !tools.length
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-2.5 p-4">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </CardContent>
                </Card>
              ))
            : shown.map((t, i) => {
                const catMeta = CATEGORY_META[t.category];
                return (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
                    className="h-full min-w-0"
                  >
                    <Card className="group flex h-full flex-col transition-colors hover:border-emerald-500/30">
                      <CardContent className="flex flex-1 flex-col gap-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/60 text-muted-foreground [&_svg]:size-3.5"
                              title={catMeta.hint}
                            >
                              <catMeta.icon aria-hidden="true" />
                            </span>
                            <p className="truncate text-sm font-semibold">{t.name}</p>
                          </div>
                          <StateChip state={t.state} />
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span dir="ltr" className="font-mono text-lg font-bold tracking-tight">
                            {t.primary}
                          </span>
                          {t.apr != null && t.apy != null && t.category !== "savings" && t.apr > 0 ? (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              → APY {(100 * t.apy).toFixed(2)}%
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t.primaryNote}</p>
                        {t.tvl != null && t.tvl > 0 ? (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            הון: {t.tvl >= 1000 ? t.tvl.toLocaleString("en-US", { maximumFractionDigits: 0 }) : t.tvl.toFixed(1)} {t.category === "external" ? "$" : "USDS"}
                          </p>
                        ) : null}
                        <p className="mt-auto pt-1.5 text-[12px] leading-relaxed text-foreground/70">
                          {t.detail}
                        </p>
                        <p className="flex items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
                          <Bot className="size-3 shrink-0" aria-hidden="true" />
                          מופעל על-ידי: <span className="font-medium text-foreground/80">{t.operatesBy}</span>
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
        </div>
      </Section>
      </div>

      {/* ── שכבה 3: הסוכנים-המשתמשים ─────────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["defi-router-agents"] = el;
        }}
        className="scroll-mt-24"
      >
      <Section
        className="mt-12"
        title="הסוכנים הם המשתמשים — מפעילי הראוטרים"
        description="המטרה: חוסר תלות במשתמשים אנושיים. כל ראוטר מופעל על-ידי סוכן אוטונומי שפועל מהמדידה עצמה; מה שדורש החלטת-הון אנושית מסומן בשער-מפעיל — בכנות."
        icon={<Bot />}
      >
        <div className={cn("grid gap-3 md:grid-cols-2", scrollBoxClass)}>
          {(data?.agents ?? []).map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3) }}
              className="h-full min-w-0"
            >
              <Card className="h-full">
                <CardContent className="flex flex-col gap-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Bot className="size-3.5" aria-hidden="true" />
                      </span>
                      <p className="text-sm font-semibold">{a.name}</p>
                    </div>
                    <Badge variant="outline" dir="rtl" className={cn("text-[11px]", AUTONOMY_META[a.autonomy]?.cls ?? "")}>
                      {AUTONOMY_META[a.autonomy]?.he ?? a.autonomy}
                    </Badge>
                  </div>
                  <p className="text-[12px] leading-relaxed text-foreground/75">{a.role}</p>
                  <p dir="rtl" className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {a.status}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <p className="text-[11px] text-muted-foreground">
                      מפעיל: <span className="font-mono text-foreground/75">{a.operates.join(" · ")}</span>
                    </p>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                    מקור המדידה: {a.evidence}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          {loading && !data
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-2.5 p-4">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </CardContent>
                </Card>
              ))
            : null}
        </div>
      </Section>
      </div>

      {/* ── שכבה 4: רשתות אחרות — הגשרים ──────────────────────────── */}
      <div
        ref={(el) => {
          anchors.current["defi-router-bridges"] = el;
        }}
        className="scroll-mt-24"
      >
      <Section
        className="mt-12"
        title="ראוטרים לרשתות אחרות — הגשרים החיים"
        description="ארבע רשתות נצפות בקריאה חסרת-מפתחות בקצב מוגדר בקוד (כל 20 דקות — לא נמדד כאן). ההפקדה הראשונה בכל רשת תפתח את זרימת הנזילות פנימה — השער בנוי וממתין."
        icon={<Network />}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(data?.networks ?? []).map((n, i) => (
            <motion.div
              key={n.chain}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.05, 0.3) }}
              className="h-full min-w-0"
            >
              <Card className="h-full">
                <CardContent className="flex flex-col gap-2.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Banknote className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {n.chain}
                    </p>
                    {n.ok != null ? (
                      <Badge
                        variant="outline"
                        dir="rtl"
                        className={cn(
                          "text-[10px]",
                          n.ok
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {n.ok ? "צופה חי" : "ממתין"}
                      </Badge>
                    ) : null}
                  </div>
                  <HashChip value={n.address} label="כתובת" head={8} tail={6} className="w-fit" />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{n.note}</p>
                  <p className="mt-auto border-t pt-2 font-mono text-[11px] text-muted-foreground">
                    הפקדות שנטענו: {n.deposits ?? 0}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </Section>
      </div>

      {/* ── דוקטרינת הכנות ───────────────────────────────────────── */}
      {data ? (
        <FadeIn className="mt-12">
          <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
            <CardContent className="flex flex-col gap-2 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Waypoints className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                דוקטרינת הניתוב
              </p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{data.doctrine}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 font-mono text-[11px] text-muted-foreground">
                <span>עודכן: {new Date(data.at).toLocaleTimeString("he-IL")}</span>
                <span>מקורות שנפלו: {data.down.length === 0 ? "אפס — הכל חי" : data.down.join(" · ")}</span>
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      ) : null}
    </div>
  );
}
