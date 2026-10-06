"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 1 - לוח בקרה
// KPI + תקפות שרשרת (אימות אוטומטי בעת טעינה) + סטטוסים + 8 אחרונים
//
// שני מצבי אמת (Task 38):
//  · cloud - המראה הציבורית של הספר החי. תקפות מוצגת כעד משקיף
//    (Steem block + txid · explorer · טריות) - חישוב-מחדש מלא הוא
//    מנגנון שרץ על עותק מקומי, ולכן נעול במצב סנדבוקס.
//  · local - כמו תמיד: אימות אוטומטי + כפתור "אמת מחדש" חי.
// ─────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { toast } from "sonner";
import {
  Anchor,
  Bot,
  Cloud,
  ExternalLink,
  HardDrive,
  History,
  Link2,
  Activity,
  Quote,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorMessage } from "../api";
import { useWeave, type LiveOverview } from "../store";
import {
  ClaimTypeBadge,
  ErrorBox,
  FadeIn,
  HashChip,
  KpiSkeletonRow,
  ListSkeleton,
  MotionCard,
  scrollBoxClass,
  StatusBadge,
  truncateEnd,
  truncateMiddle,
} from "../shared";

const STATUS_COLORS: Record<string, string> = {
  VERIFIED: "bg-emerald-500",
  REFUTED: "bg-rose-500",
  UNMEASURED: "bg-amber-500",
  CONTESTED: "bg-rose-400",
};

// ── תג מקור הנתונים: ענן חי / סנדבוקס מקומי ─────────────────────────

function SourceBadge() {
  const { mode } = useWeave();
  const cloud = mode === "cloud";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "cursor-help gap-1.5 text-[11px]",
            cloud
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {cloud ? (
            <Cloud className="size-3" aria-hidden="true" />
          ) : (
            <HardDrive className="size-3" aria-hidden="true" />
          )}
          {cloud ? "ענן חי · מראה ציבורית" : "סנדבוקס מקומי · מרחב טסט"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px]">
        <p className="text-xs leading-relaxed">
          {cloud
            ? "מראה ציבורית קריאה-בלבד של הספר החי - נכתבת על-ידי הסוכנים בענן ומתעדכנת אוטומטית"
            : "עותק SQLite מקומי בסנדבוקס - כאן פועלות כל פעולות הכתיבה והתרגילים"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── גיל עד המשקיף - מחושב רק בצד הלקוח, אחרי שהמראה נטענה ──────────

function witnessAge(at: string): string {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return "";
  const hours = Math.max(0, (Date.now() - t) / 3_600_000);
  if (hours < 1) {
    return ` · לפני ${Math.max(1, Math.round(hours * 60))} דק׳`;
  }
  return ` · לפני ~${Math.round(hours)} שעות`;
}

function explorerHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ── תקפות בענן: עד המשקיף של השרשרת + מדד הטריות ─────────────────────

function WitnessStatus({
  live,
  loading,
}: {
  live: LiveOverview | null;
  loading: boolean;
}) {
  if (loading && !live) {
    return <Skeleton className="mt-2 h-7 w-44" />;
  }
  const w = live?.witness ?? null;
  const f = live?.freshness ?? null;
  if (!w && !f) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        אין עד משקיף פעיל במראה הציבורית
      </p>
    );
  }
  const fresh = f?.verdict === "FRESH";
  const host = w ? explorerHost(w.explorer) : "";
  return (
    <>
      {f ? (
        <Badge
          dir="ltr"
          className={cn(
            "mt-1.5 gap-1 text-sm",
            fresh
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          <Activity className="size-4" aria-hidden="true" />
          {f.verdict} · ~{f.ageHours.toFixed(1)}h
        </Badge>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {f ? (
          <>
            גיל הספר מול סף{" "}
            <span dir="ltr" className="font-mono">
              {f.thresholdHours}h
            </span>{" "}
            · קצב{" "}
            <span dir="ltr" className="font-mono">
              {f.cadence}
            </span>
          </>
        ) : null}
        {f && w ? " · " : null}
        {w ? (
          <>
            עד אחרון בשרשרת{" "}
            <span dir="ltr" className="font-mono">
              {host || "chain"}
            </span>{" "}
            · בלוק{" "}
            <span dir="ltr" className="font-mono">
              #{w.block}
            </span>
            {witnessAge(w.at)}
          </>
        ) : null}
      </p>
      {w ? (
        <a
          href={w.explorer}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-1 font-mono text-[11px] text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
        >
          <span className="truncate">{truncateMiddle(w.txid, 12, 8)}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        הלב מאמת את השרשרת בכל פעימה - חישוב-מחדש מלא זמין במצב סנדבוקס
      </p>
    </>
  );
}

export function DashboardTab() {
  const { mode, state, attestations, report, live, loadState, loadAttestations, runVerify } =
    useWeave();
  const cloud = mode === "cloud";
  const lv = live.data;

  useEffect(() => {
    loadState();
    loadAttestations();
    // אימות אוטומטי של השרשרת בכל כניסה ללוח הבקרה (read-only, מהיר).
    // משמעותי רק על העותק המקומי - בענן הלב מאמת בכל פעימה ומוצג עד משקיף.
    if (mode === "local") {
      runVerify().catch(() => undefined);
    }
  }, [mode, loadState, loadAttestations, runVerify]);

  const onManualVerify = async () => {
    try {
      const r = await runVerify();
      if (r.valid) {
        toast.success(`שרשרת תקינה (${r.checked} רשומות)`, {
          description: `חתימות EIP-191 תקינות: ${r.sigOk}/${r.checked}`,
        });
      } else {
        toast.error(`שבר בשרשרת - seq ${r.firstBreak ?? "?"}`, {
          description: "חישוב מחדש לכל אורך השרשרת גילה סטייה",
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const stateLoading = state.loading && !state.data;
  const stateError = state.error && !state.data;
  const latest = (attestations.data ?? []).slice(0, 8);
  // בענן: אם פרוסת ה-state עוד לא הגיעה, נופלים בכנות לסטטיסטיקות המראה
  const stats = state.data?.stats ?? (cloud ? lv?.stats.attByStatus : undefined) ?? {};
  const chainCount = state.data?.chainCount ?? (cloud ? lv?.stats.attestations : undefined) ?? 0;
  const agentsCount = state.data?.agents ?? (cloud ? lv?.stats.agents : undefined) ?? 0;
  const checkpointsCount =
    state.data?.checkpoints ?? (cloud ? lv?.stats.checkpoints : undefined) ?? 0;
  const headHash = state.data?.headHash ?? (cloud ? lv?.stats.headHash : undefined) ?? null;
  const lastAnchorStatus = state.data?.lastAnchorStatus ?? null;
  const anchoredBadge = (lastAnchorStatus ?? "").startsWith("ANCHORED");

  if (stateError) {
    return (
      <FadeIn className="flex flex-col gap-4">
        <ErrorBox message={state.error ?? ""} onRetry={loadState} retrying={state.loading} />
      </FadeIn>
    );
  }

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* פס הדוקטרינה */}
      <Card className="border-emerald-500/25 bg-gradient-to-l from-emerald-500/10 via-transparent to-transparent p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Quote className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold sm:text-base">
              שום טענה בלי מדידה - חישוב מחדש, לא סמיכות
            </p>
            <p className="text-xs text-muted-foreground">
              טענה שלא נמדדה היא רעש · השרת קובע סטטוס, לא הלקוח · תווית אמת מוצהרת
              תמיד: REAL / LOCAL / NOT-YET
            </p>
          </div>
          <div className="ms-auto shrink-0">
            <SourceBadge />
          </div>
        </div>
      </Card>

      {/* שורת KPI */}
      {stateLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">ספירת שרשרת</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">{chainCount}</p>
                <div className="mt-3">
                  <HashChip value={headHash} label="HEAD" head={8} tail={6} />
                </div>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Link2 className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">סוכנים רשומים</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">{agentsCount}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  זהויות EVM · secp256k1
                </p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Bot className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Checkpoints</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">
                  {checkpointsCount}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  {lastAnchorStatus ? (
                    <Badge
                      dir="ltr"
                      className={cn(
                        "font-mono text-[10px]",
                        anchoredBadge
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {lastAnchorStatus}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {state.data?.lastRoot ? "Merkle root קיים" : "טרם נוצר checkpoint"}
                  </span>
                </div>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Anchor className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {cloud ? "תקפות · עד משקיף חי" : "תקפות שרשרת"}
                </p>
                {cloud ? (
                  <WitnessStatus live={lv} loading={live.loading} />
                ) : report.loading ? (
                  <Skeleton className="mt-2 h-7 w-36" />
                ) : report.data ? (
                  report.data.valid ? (
                    <Badge className="mt-1.5 gap-1 border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="size-4" />
                      שרשרת תקינה ({report.data.checked} רשומות)
                    </Badge>
                  ) : (
                    <Badge className="mt-1.5 gap-1 border-rose-500/40 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-400">
                      <ShieldAlert className="size-4" />
                      שבר ב-seq {report.data.firstBreak ?? "?"}
                    </Badge>
                  )
                ) : report.error ? (
                  <Badge className="mt-1.5 border-rose-500/40 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-400">
                    האימות נכשל
                  </Badge>
                ) : (
                  <Skeleton className="mt-2 h-7 w-36" />
                )}
                {cloud ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mt-3 inline-flex">
                        <Button variant="outline" size="sm" className="h-11" disabled>
                          <ShieldCheck />
                          אמת מחדש
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px]">
                      <p className="text-xs leading-relaxed">
                        אימות חישוב-מחדש רץ על עותק מקומי - עבור למצב סנדבוקס
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-11"
                    onClick={onManualVerify}
                    disabled={report.loading}
                  >
                    <ShieldCheck />
                    אמת מחדש
                  </Button>
                )}
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <ShieldCheck className="size-4" />
              </span>
            </div>
          </MotionCard>
        </div>
      )}

      {/* חיות 24ש׳ - רק בענן, פס דק מהמראה החיה */}
      {cloud && lv ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <Activity className="size-3.5" aria-hidden="true" />
            חיות 24ש׳
          </span>
          <span className="text-xs text-muted-foreground">
            <span dir="ltr" className="font-mono font-bold tabular-nums text-foreground">
              {lv.vitality.atts24h}
            </span>{" "}
            אימותים
          </span>
          <span className="text-xs text-muted-foreground">
            <span dir="ltr" className="font-mono font-bold tabular-nums text-foreground">
              {lv.vitality.checkpoints24h}
            </span>{" "}
            checkpoints
          </span>
          <span className="text-xs text-muted-foreground">
            {/* R119 · חוק ההגדרה-היחידה: "רצף" הוא רצף-ספר אמיתי; חלון-מראה מתויג בכנות */}
            {lv.vitality.windowLimited ? "חלון-מראה" : "רצף"}{" "}
            <span dir="ltr" className="font-mono font-bold tabular-nums text-foreground">
              {lv.vitality.aliveDays}
            </span>{" "}
            ימים
          </span>
          <span className="text-xs text-muted-foreground">
            אימות אחרון לפני{" "}
            <span dir="ltr" className="font-mono font-bold tabular-nums text-foreground">
              {lv.vitality.lastAttAgeMin}
            </span>{" "}
            דק׳
          </span>
          <span className="ms-auto text-[10px] text-muted-foreground">
            מראה עודכנה{" "}
            {new Date(lv.mirrorGeneratedAt).toLocaleTimeString("he-IL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      ) : null}

      {/* סטטיסטיקה לפי סטטוס */}
      {stateLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-12" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["VERIFIED", "REFUTED", "UNMEASURED", "CONTESTED"] as const).map((status) => (
            <MotionCard key={status} className="p-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn("size-2 shrink-0 rounded-full", STATUS_COLORS[status])}
                  aria-hidden="true"
                />
                <StatusBadge status={status} className="text-[10px]" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
                {stats[status] ?? 0}
              </p>
            </MotionCard>
          ))}
        </div>
      )}

      {/* 8 האימותים האחרונים */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
            <History className="size-4" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
              אימותים אחרונים
            </h2>
            <p className="text-xs text-muted-foreground">
              8 הרשומות החדשות בספר - מסודרות לפי seq
            </p>
          </div>
        </div>
        {attestations.loading && !attestations.data ? (
          <ListSkeleton rows={5} />
        ) : attestations.error && !attestations.data ? (
          <ErrorBox
            message={attestations.error}
            onRetry={loadAttestations}
            retrying={attestations.loading}
          />
        ) : (
          <div className={cn(scrollBoxClass, "border")}>
            <ul className="divide-y">
              {latest.map((entry) => (
                <li
                  key={entry.seq}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 transition-colors hover:bg-muted/40"
                >
                  <span className="font-mono text-xs font-semibold text-muted-foreground" dir="ltr">
                    #{entry.seq}
                  </span>
                  <span className="text-sm font-medium">{entry.agentName}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 max-w-[16rem] flex-1 truncate text-xs text-muted-foreground sm:max-w-[24rem]">
                        {entry.claim}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[360px]">
                      <p className="text-xs leading-relaxed">{truncateEnd(entry.claim, 220)}</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="flex items-center gap-2 sm:ms-auto">
                    <ClaimTypeBadge type={String(entry.claimType)} />
                    <StatusBadge status={String(entry.status)} />
                  </span>
                </li>
              ))}
              {latest.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  אין עדיין אימותים בספר
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </section>
    </FadeIn>
  );
}
