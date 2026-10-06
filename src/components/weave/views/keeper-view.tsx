"use client";

// ─────────────────────────────────────────────────────────────────────
// KEEPER VIEW · שומר הדיבונים (R84 · THE KEEPER).
//
// הוראת המפעיל שיצרה את התצוגה: "אין מצב שעושים תוכנית ואז מחכים
// למשהו תקוע שיזוז... תמיד צריך לוודא יעילות ומה קורה ולקדם דברים."
//
// האמת שנמדדה ב-R83: שלושת הדיבונים (דופק · מוביל · צייד) חיו ללא
// עין — דיבון שהיה קורס היה נותר מת בשקט, והכסף היה חוזר לשבת על
// מחיר אתמול. השומר (R84) סוגר את החור: עין-צי שמסיירת כל 30 שנ'
// ומחזירה לחיים כל דיבון שמת — בתוך חוקי-ברזל שנראים כאן בשקיפות
// מלאה, כולל פקודת-ההחייאה שכל סשן חדש מתחיל בה.
//
// ארבע מחלקות, הכול מה-API החי (/api/keeper):
//   · דופק השומר — הסיורים, ההחלטה האחרונה, קבלות הקנון.
//   · טבלת הצי — כל דיבון: מצב חי, פעימות, הקמות היום, החלטתו שלו.
//   · חוקי-הברזל — כולל חוק הפעולה: אף דיבון לא נהרג באמצע
//     פעולת-כסף.
//   · ההחייאה — הפקודה האחת שמחזירה את הצי בכל סשן חדש, ושובל
//     ההחלטות המלא של השומר.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Gauge,
  HeartPulse,
  History,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Siren,
  Terminal,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch, errorMessage } from "@/components/weave/api";
import { ErrorBox, FadeIn, MotionCard, Section, fmtDateTime } from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/keeper) ──────────────────────────────

interface FleetDaemon {
  name: string;
  port: number;
  roleHe: string;
  up: boolean;
  beats: number | null;
  bootedAt: string | null;
  patrolIntervalSec: number | null;
  acting: boolean | null;
  lastDecision: { at: string; kind: string; detail: string } | null;
  state: "UP" | "DOWN" | "BUSY" | "RESTARTING" | "GAVE-UP" | "UNKNOWN";
  since: string;
  restartsToday: number;
  lastRestartAt: string | null;
  lastHealthyAt: string | null;
  lastBeats: number | null;
}

interface KeeperBoard {
  ok: boolean;
  at: string;
  keeper: {
    up: boolean;
    beats: number | null;
    patrolIntervalSec: number | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    history: Array<{ at: string; kind: string; detail: string }>;
    canon: {
      pushesToday: number;
      day: string;
      lastAt: string | null;
      lastOk: boolean | null;
      lastPath: string | null;
    } | null;
  };
  fleet: FleetDaemon[];
  laws: Array<{ id: string; title: string; detail: string }>;
  revival: { command: string; noteHe: string; canonPath: string | null };
  honestGaps: string[];
  cached?: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
}

// ── מפות מצב ────────────────────────────────────────────────────────

const STATE_META: Record<
  FleetDaemon["state"],
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  UP: {
    label: "חי",
    icon: CheckCircle2,
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  BUSY: {
    label: "בפעולת-כסף (מוגן)",
    icon: Timer,
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  RESTARTING: {
    label: "בהקמה",
    icon: Loader2,
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  DOWN: {
    label: "מת",
    icon: XCircle,
    cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  "GAVE-UP": {
    label: "GAVE-UP כנה",
    icon: Ban,
    cls: "border-red-600/50 bg-red-600/10 text-red-800 dark:text-red-300",
  },
  UNKNOWN: {
    label: "לא נמדד",
    icon: EyeOff,
    cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
};

const DAEMON_META: Record<string, { label: string; icon: typeof HeartPulse }> = {
  pulse: { label: "הדופק", icon: HeartPulse },
  money: { label: "מוביל הכסף", icon: Gauge },
  hunter: { label: "הצייד", icon: Eye },
  keeper: { label: "השומר", icon: ShieldCheck },
};

function sinceLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} דק'`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} שע'` : `${Math.floor(h / 24)} ימים`;
}

// ── התצוגה ──────────────────────────────────────────────────────────

export function KeeperView() {
  const [data, setData] = useState<KeeperBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const d = await apiFetch<KeeperBoard>("/api/keeper");
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
    timer.current = setInterval(() => void load(true), 30_000);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

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

  const k = d.keeper;
  const fleetUp = d.fleet.filter((f) => f.up).length;
  const totalRestarts = d.fleet.reduce((s, f) => s + f.restartsToday, 0);
  const freshAge = d.cacheAgeSec != null ? (d.cacheAgeSec < 60 ? "חי" : `${d.cacheAgeSec}ש'`) : "—";
  const history = [...k.history].reverse().slice(0, 14);

  return (
    <div className="flex flex-col gap-6">
      {/* ── פתיח: דופק השומר ─────────────────────────────────── */}
      <Section
        title="השומר — עין-הצי של הדיבונים"
        description="סיור כל 30 שניות אחרי הדופק, מוביל הכסף והצייד. דיבון שמת חוזר לחיים בעצמו — אף אחד לא צריך לגלות שהכסף ישב בלי עין."
        icon={<ShieldCheck />}
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">מצב השומר</span>
                  {k.up ? (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="size-4" /> עין פקוחה
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
                      <Siren className="size-4" /> לא עונה
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">סיורים (beats)</span>
                  <span className="font-mono text-lg font-semibold tabular-nums" dir="ltr">
                    {k.beats ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">קצב סיור</span>
                  <span className="text-sm font-semibold" dir="ltr">
                    {k.patrolIntervalSec ? `כל ${k.patrolIntervalSec}ש'` : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">הצי חי</span>
                  <span className="text-sm font-semibold">
                    <span className="font-mono" dir="ltr">
                      {fleetUp}/{d.fleet.length}
                    </span>{" "}
                    דיבונים
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">הקמות היום</span>
                  <span className="font-mono text-lg font-semibold tabular-nums" dir="ltr">
                    {totalRestarts}
                  </span>
                </div>
              </div>
              {k.lastDecision && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-3 text-sm">
                  <Badge variant="secondary" dir="ltr" className="font-mono">
                    {k.lastDecision.kind}
                  </Badge>
                  <span className="text-muted-foreground" dir="ltr">
                    {fmtDateTime(k.lastDecision.at)}
                  </span>
                  <span className="min-w-0 flex-1">{k.lastDecision.detail}</span>
                </div>
              )}
              {k.canon && k.canon.lastAt && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className={k.canon.lastOk ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-red-500/40 text-red-600 dark:text-red-400"}>
                    <History /> קבלת קנון אחרונה
                  </Badge>
                  <span dir="ltr">{k.canon.lastPath ?? "—"}</span>
                  <span>·</span>
                  <span dir="ltr">{fmtDateTime(k.canon.lastAt)}</span>
                  <span>·</span>
                  <span dir="ltr">
                    {k.canon.pushesToday}/8 דחיפות היום
                  </span>
                </div>
              )}
            </CardContent>
          </MotionCard>
        </FadeIn>
      </Section>

      {/* ── טבלת הצי ──────────────────────────────────────────── */}
      <Section
        title="טבלת הצי — מי חי, מי מוגן, מי הוקם"
        description="מדידה חיה של כל דיבון + ספירת-ההקמות של השומר. מצב BUSY פירושו פעולת-כסף בעיצומה — השומר ממתין ולא נוגע."
        icon={<Server />}
      >
        <FadeIn>
          <MotionCard>
            <CardContent className="p-0">
              {/* R91: min-w מוודא שהגלילה נשארת בתוך הכרטיס — אפס גלילת-עמוד במובייל */}
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-start text-xs text-muted-foreground">
                      <th className="p-3 text-start font-medium">דיבון</th>
                      <th className="p-3 text-start font-medium">תפקיד</th>
                      <th className="p-3 text-start font-medium">מצב</th>
                      <th className="p-3 text-start font-medium">פעימות</th>
                      <th className="p-3 text-start font-medium">עלה לפני</th>
                      <th className="p-3 text-start font-medium">הקמות היום</th>
                      <th className="p-3 text-start font-medium">ההחלטה שלו</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.fleet.map((f) => {
                      const meta = STATE_META[f.state];
                      const StateIcon = meta.icon;
                      const dMeta = DAEMON_META[f.name] ?? { label: f.name, icon: Server };
                      const DIcon = dMeta.icon;
                      return (
                        <tr key={f.name} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "grid size-8 shrink-0 place-items-center rounded-lg border",
                                  f.up
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
                                )}
                              >
                                <DIcon className="size-4" />
                              </span>
                              <div className="flex flex-col">
                                <span className="font-semibold">{dMeta.label}</span>
                                <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                                  :{f.port} · {f.name}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-44 p-3 text-xs text-muted-foreground">{f.roleHe}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={cn("gap-1", meta.cls)}>
                              <StateIcon className={cn("size-3", f.state === "RESTARTING" && "animate-spin")} />
                              {meta.label}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono tabular-nums" dir="ltr">
                            {f.beats ?? f.lastBeats ?? "—"}
                          </td>
                          <td className="p-3 text-xs">{sinceLabel(f.bootedAt)}</td>
                          <td className="p-3">
                            <span
                              className={cn(
                                "font-mono tabular-nums",
                                f.restartsToday > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                              )}
                              dir="ltr"
                            >
                              {f.restartsToday}/12
                            </span>
                            {f.lastRestartAt && (
                              <div className="text-[10px] text-muted-foreground" dir="ltr">
                                אחרונה {fmtDateTime(f.lastRestartAt).slice(-5)}
                              </div>
                            )}
                          </td>
                          <td className="max-w-64 p-3 text-xs text-muted-foreground">
                            {f.lastDecision ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-[10px] text-primary/80" dir="ltr">
                                  {f.lastDecision.kind}
                                </span>
                                <span className="line-clamp-2">{f.lastDecision.detail}</span>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* שורת השומר עצמו */}
                    <tr className="border-b-2 border-primary/20 bg-primary/[0.03] hover:bg-muted/30">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-lg border",
                              k.up
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
                            )}
                          >
                            <ShieldCheck className="size-4" />
                          </span>
                          <div className="flex flex-col">
                            <span className="font-semibold">השומר</span>
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                              :3036 · keeper
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-44 p-3 text-xs text-muted-foreground">
                        עין-הצי — סיור, הקמה והגנה על הדיבונים
                      </td>
                      <td className="p-3">
                        {k.up ? (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" /> עין פקוחה
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400">
                            <Siren className="size-3" /> לא עונה
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 font-mono tabular-nums" dir="ltr">
                        {k.beats ?? "—"}
                      </td>
                      <td className="p-3 text-xs">—</td>
                      <td className="p-3 font-mono text-muted-foreground" dir="ltr">
                        —
                      </td>
                      <td className="max-w-64 p-3 text-xs text-muted-foreground">
                        {k.lastDecision ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[10px] text-primary/80" dir="ltr">
                              {k.lastDecision.kind}
                            </span>
                            <span className="line-clamp-2">{k.lastDecision.detail}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </MotionCard>
        </FadeIn>
      </Section>

      {/* ── חוקי-הברזל ────────────────────────────────────────── */}
      <Section
        title="חוקי-הברזל של השומר"
        description="ההגנה עצמה חייבת להיות בטוחה: החוק הראשון מגן על פעולות-כסף חיות מפני השומר עצמו."
        icon={<Ban />}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d.laws.map((law, i) => (
            <FadeIn key={law.id} delay={i * 0.04}>
              <MotionCard className="h-full">
                <CardContent className="flex h-full flex-col gap-2 p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                      {law.id === "acting" ? <Zap className="size-4" /> : law.id === "canon" ? <History className="size-4" /> : <ShieldCheck className="size-4" />}
                    </span>
                    <h3 className="text-sm font-semibold leading-tight">{law.title}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{law.detail}</p>
                </CardContent>
              </MotionCard>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* ── ההחייאה + שובל ההחלטות ────────────────────────────── */}
      <Section
        title="ההחייאה — פקודה אחת לסשן חדש"
        description="הצי חי בסשן הסנדבוקס; כשסשן מת, ההחזרה לחיים היא פקודה אחת מתועדת בקנון — לא חיפוש אחרי מה שאבד."
        icon={<Terminal />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <FadeIn>
            <MotionCard className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Terminal className="size-4 text-primary" />
                    פקודת-ההחייאה
                  </h3>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                    אידמפוטנטית
                  </Badge>
                </div>
                <pre
                  dir="ltr"
                  className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed"
                >
{`# כל סשן חדש מתחיל כאן:
${d.revival.command}

# מה שקורה:
#   · דיבון שעונה — לא נוגעים (אין כפילויות)
#   · דיבון שמת — מוקם מחדש
#   · דיבון נעול — מנוקה ואז מוקם
#   · בסוף: דוח בריאות ${d.fleet.length}/${d.fleet.length}`}
                </pre>
                <p className="text-xs leading-relaxed text-muted-foreground">{d.revival.noteHe}</p>
                {d.revival.canonPath && (
                  <p className="text-xs text-muted-foreground">
                    קבלות חיות בקנון:{" "}
                    <span className="font-mono text-[11px] text-primary/80" dir="ltr">
                      Defi/{d.revival.canonPath}
                    </span>
                  </p>
                )}
                <div className="mt-auto flex flex-col gap-1.5">
                  {d.honestGaps.map((gap, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      {gap}
                    </p>
                  ))}
                </div>
              </CardContent>
            </MotionCard>
          </FadeIn>
          <FadeIn delay={0.05}>
            <MotionCard className="h-full">
              <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="size-4 text-primary" />
                    שובל ההחלטות של השומר
                  </h3>
                  <Badge variant="secondary" className="font-mono" dir="ltr">
                    {history.length} אחרונות
                  </Badge>
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">אין עדיין החלטות מתועדות — השומר בסיורים שקטים.</p>
                ) : (
                  <ol className="relative flex max-h-80 flex-col gap-0 overflow-y-auto pe-1">
                    {history.map((h, i) => (
                      <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-3">
                        <div className="flex flex-col items-center">
                          <span
                            className={cn(
                              "mt-1 size-2 shrink-0 rounded-full",
                              h.kind === "RESTARTING" || h.kind === "GAVE-UP"
                                ? "bg-amber-500"
                                : h.kind === "RECOVERED"
                                  ? "bg-emerald-500"
                                  : h.kind === "ERROR"
                                    ? "bg-red-500"
                                    : "bg-primary/40",
                            )}
                          />
                          {i < history.length - 1 && <span className="w-px flex-1 bg-border" />}
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="font-mono text-[10px]" dir="ltr">
                              {h.kind}
                            </Badge>
                            <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                              {fmtDateTime(h.at)}
                            </span>
                          </div>
                          <span className="text-xs leading-relaxed">{h.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </MotionCard>
          </FadeIn>
        </div>
      </Section>
    </div>
  );
}
