"use client";

// ─────────────────────────────────────────────────────────────────────
// BUSINESSES VIEW · עסקים — החזית החיה של חממת-העסקים (r148-c).
//
// הוראת המשימה: להפוך את החממה (D-r147-BIZ) לנראית — כל עסק עם המספרים
// המדודים שלו מ-/api/businesses, שורת-הרג כתובה-מראש, חוק-הקיבולת,
// ויומן-חי שנצרך-אם-קיים (הנתיב עשוי שלא להתקיים עדיין — ירידה חיננית,
// בלי שבירה, בלי המצאה).
//
// חוק-הראיה: מקור-נכשל מדווח "—" בכנות — לעולם לא 0 שנראה כמו מדידה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CalendarClock,
  ChevronDown,
  History,
  Loader2,
  RefreshCw,
  Scale,
  Skull,
  Store,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch, ApiError, errorMessage } from "@/components/weave/api";
import {
  ErrorBox,
  FadeIn,
  MotionCard,
  Section,
  fmtDateTime,
  scrollBoxClass,
} from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/businesses, סובלני לשדות חסרים) ────────

interface BusinessUnitEconomics {
  cost?: unknown;
  output?: unknown;
  measuredNow?: unknown;
  target?: unknown;
}

interface Business {
  id: string;
  nameHe?: string;
  stage?: string;
  thesisHe?: string;
  demandEvidence?: string;
  unitEconomics?: BusinessUnitEconomics | null;
  killLine?: string;
  budgetCap?: string;
  metricSource?: string;
  reviewCadence?: string;
}

interface BusinessRegistry {
  format?: string;
  createdAt?: string;
  decisionId?: string;
  lawHe?: string;
  businesses?: Business[];
  capacityLawHe?: string;
  nextReview?: string;
}

type BusinessMetric = Record<string, unknown>;

interface BusinessesData {
  ok: boolean;
  at: string;
  law?: string;
  registry: BusinessRegistry | null;
  metrics?: Record<string, BusinessMetric>;
  noteHe?: string;
}

type LogEntry = Record<string, unknown>;

// ── סטיילינג שלבים (emerald/amber/rose/violet — אף כחול, אף אינדיגו) ──

const STAGE_META: Record<string, { cls: string; label: string }> = {
  RUNNING: {
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    label: "פעיל",
  },
  PILOT: {
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    label: "פיילוט",
  },
  KILLED: {
    cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
    label: "הורג",
  },
  "FORMAT-REVIEW": {
    cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
    label: "בביקורת-פורמט",
  },
  "CAPITAL-GATE": {
    cls: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
    label: "שער-הון",
  },
};

const UNKNOWN_STAGE_CLS =
  "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";

function stageMeta(stage: string | undefined): { cls: string; label: string } {
  if (!stage) return { cls: UNKNOWN_STAGE_CLS, label: "לא נמדד" };
  const known = STAGE_META[stage];
  if (known) return known;
  return { cls: UNKNOWN_STAGE_CLS, label: stage };
}

// ── עזרי-תצוגה ──────────────────────────────────────────────────────

function timeAgoHe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "כרגע";
  const min = Math.floor(sec / 60);
  if (min < 60) return `לפני ${min} דק'`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} שע'`;
  return `לפני ${Math.floor(hr / 24)} ימים`;
}

function fmtDateHe(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

// "—" כן לכל שדה חסר — לעולם לא ממציאים 0
function truthText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : "—";
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "boolean") return v ? "כן" : "לא";
  return "—";
}

function extractLogEntries(payload: unknown): LogEntry[] {
  if (Array.isArray(payload)) return payload as LogEntry[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["entries", "log", "items", "records"]) {
      if (Array.isArray(o[key])) return o[key] as LogEntry[];
    }
  }
  return [];
}

function logEntryParts(e: LogEntry): { at: string | null; kind: string | null; text: string } {
  const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const at = [e.at, e.ts, e.time].find(str) ?? null;
  const kind = [e.kind, e.type, e.level].find(str) ?? null;
  const raw = [e.detailHe, e.detail, e.message, e.text, e.note].find(str);
  const text = typeof raw === "string" ? raw : JSON.stringify(e).slice(0, 200);
  return { at, kind, text };
}

// ── התצוגה ─────────────────────────────────────────────────────────

export function BusinessesView() {
  const [data, setData] = useState<BusinessesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failSoft, setFailSoft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const j = await apiFetch<BusinessesData>("/api/businesses");
      if (!alive.current) return;
      setData(j);
      setFailSoft(!j.registry);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 200) {
        // ok:false מהשרת — fail-soft כן (הרישום עוד לא נקרא מהדיסק)
        setData(null);
        setFailSoft(true);
        setError(null);
      } else {
        setError(errorMessage(e));
        setFailSoft(false);
      }
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // יומן-חי: צריכה-אם-קיים בלבד. 404/שגיאה = מצב ריק כן, לא שגיאה.
  const loadLog = useCallback(async () => {
    try {
      const j = await apiFetch<unknown>("/api/businesses/log");
      if (!alive.current) return;
      const entries = extractLogEntries(j);
      setLogEntries(entries.length > 0 ? entries : null);
    } catch {
      if (!alive.current) return;
      setLogEntries(null);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    void loadLog();
    timer.current = setInterval(() => {
      void load(true);
      void loadLog();
    }, 60_000);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, loadLog]);

  const registry = data?.registry ?? null;
  const businesses = Array.isArray(registry?.businesses) ? registry!.businesses! : [];
  const metrics = data?.metrics ?? null;
  const hasRegistry = businesses.length > 0;

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── טעינה ראשונה ──────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-6">
        {/* ── כותרת: העסקים של הרשת ─────────────────────────────── */}
        <FadeIn>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10">
              <Store className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold sm:text-xl">העסקים של הרשת</h1>
              {registry?.lawHe ? (
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{registry.lawHe}</p>
              ) : (
                <Skeleton className="mt-1 h-4 w-64" />
              )}
              {data && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    title="מועד ביקורת-המחזור הבאה של החממה"
                  >
                    <CalendarClock aria-hidden />
                    ביקורת הבאה: {fmtDateHe(registry?.nextReview)}
                  </Badge>
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={`עודכן ${fmtDateTime(data.at)}`}
                  >
                    עודכן {timeAgoHe(data.at)}
                  </span>
                  {registry?.decisionId && (
                    <Badge variant="outline" className="border-zinc-500/40 text-zinc-500">
                      {registry.decisionId}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void load()}
              disabled={refreshing}
              aria-label="רענן נתוני עסקים"
            >
              {refreshing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              רענן
            </Button>
          </div>
        </FadeIn>

        {error && <ErrorBox message={error} onRetry={() => void load()} retrying={refreshing} />}

        {failSoft && !error && (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 p-4 sm:p-6">
              <p className="text-sm font-semibold">הרישום עוד לא נטען</p>
              <p className="text-xs text-muted-foreground">
                {data?.noteHe ??
                  "משטח-העסקים מדווח בכנות: אין רישום עסקים קריא כרגע — שום מספר לא הומצא כאן."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
                {refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                נסה שוב
              </Button>
            </CardContent>
          </Card>
        )}

        {!failSoft && registry && hasRegistry && (
          <>
            {/* ── חוק-הקיבולת — קריאה עדינה בגבול, לא גוש-צבע ──────── */}
            {registry.capacityLawHe && (
              <FadeIn delay={0.05}>
                <section
                  aria-label="חוק-הקיבולת של החממה"
                  className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4"
                >
                  <Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground">חוק-הקיבולת</p>
                    <p className="mt-0.5 text-sm leading-relaxed">{registry.capacityLawHe}</p>
                  </div>
                </section>
              </FadeIn>
            )}

            {/* ── כרטיסי-העסקים ─────────────────────────────────────── */}
            <section aria-label="כרטיסי-העסקים" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {businesses.map((b, i) => {
                const stage = stageMeta(b.stage);
                const ue = b.unitEconomics ?? null;
                const m = (b.id && metrics?.[b.id]) || null;
                const mNote = typeof m?.noteHe === "string" ? (m.noteHe as string) : null;
                const mAt = typeof m?.measuredAt === "string" ? (m.measuredAt as string) : null;
                const isOpen = !!expanded[b.id];
                const thesis = b.thesisHe ?? "";
                const expandable = thesis.length > 140 || !!b.demandEvidence;
                return (
                  <MotionCard key={b.id} className={cn(i === 0 && "md:col-span-2 xl:col-span-1")}>
                    <CardContent className="flex h-full flex-col gap-3 p-4">
                      <header className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 text-base font-bold leading-tight">{b.nameHe ?? b.id}</h3>
                        <Badge variant="outline" className={cn("shrink-0 border", stage.cls)}>
                          {stage.label}
                        </Badge>
                      </header>

                      <div className="min-w-0">
                        <p className={cn("text-sm leading-relaxed text-muted-foreground", !isOpen && "line-clamp-3")}>
                          {thesis || "—"}
                        </p>
                        {isOpen && b.demandEvidence && (
                          <p className="mt-2 rounded-lg bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
                            <span className="font-semibold">ראית-ביקוש: </span>
                            {b.demandEvidence}
                          </p>
                        )}
                        {expandable && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(b.id)}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "הצג פחות" : "הצג עוד"}
                            className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                            {isOpen ? "הצג פחות" : "הצג עוד"}
                          </button>
                        )}
                      </div>

                      {/* מספרים חיים — מדוד בלבד, חסר = "—" */}
                      <div className="overflow-hidden rounded-lg border" aria-label={`מספרים חיים: ${b.nameHe ?? b.id}`}>
                        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                          <Activity className="size-3" aria-hidden /> מספרים חיים
                        </div>
                        <dl className="divide-y text-xs">
                          {[
                            ["עלות", truthText(ue?.cost)],
                            ["מדידה-נוכחית", truthText(ue?.measuredNow)],
                            ["יעד", truthText(ue?.target)],
                            ["מקור-המדידה", truthText(b.metricSource)],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-3 px-3 py-1.5">
                              <dt className="shrink-0 text-muted-foreground">{label}</dt>
                              <dd className="min-w-0 text-end leading-relaxed">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>

                      {m && (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          <Activity className="me-1 inline size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          {mNote ?? "מדידה חיה זמינה"}
                          {mAt ? ` · נמדד ${timeAgoHe(mAt)}` : ""}
                        </p>
                      )}

                      {b.killLine && (
                        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-600 dark:text-rose-400">
                          <Skull className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>שורת-הרג: {b.killLine}</span>
                        </p>
                      )}

                      {b.budgetCap && (
                        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>תקציב: {b.budgetCap}</span>
                        </p>
                      )}
                    </CardContent>
                  </MotionCard>
                );
              })}
            </section>

            {/* ── יומן-חי: צריכה-אם-קיים, ירידה חיננית לריק כן ───────── */}
            <FadeIn delay={0.1}>
              <Section
                title="יומן-חי"
                description="רשומות-מחזור של מנוע-העסקים — כפי שנכתבו בפועל, בלי עריכה"
                icon={<History />}
              >
                {logEntries ? (
                  <div className={cn("rounded-xl border bg-card", scrollBoxClass)}>
                    <ol className="divide-y">
                      {logEntries.map((e, i) => {
                        const { at, kind, text } = logEntryParts(e);
                        return (
                          <li key={i} className="flex items-start gap-3 px-3 py-2 text-xs">
                            {at && (
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground" dir="ltr">
                                {fmtDateTime(at)}
                              </span>
                            )}
                            {kind && (
                              <Badge variant="outline" className="shrink-0 border-zinc-500/40 text-[10px] text-muted-foreground">
                                {kind}
                              </Badge>
                            )}
                            <span className="min-w-0 leading-relaxed">{text}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-4 text-sm leading-relaxed text-muted-foreground">
                      היומן החי נפתח כשהמנוע יריץ את המחזור הראשון — אין עדיין רשומות להציג
                    </CardContent>
                  </Card>
                )}
              </Section>
            </FadeIn>
          </>
        )}
      </div>
    </div>
  );
}
