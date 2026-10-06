"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 2 - ספר אימותים
// פעולות: אימות חדש · אמת שרשרת · ערעור מדומה (red-team)
// טבלה מלאה עם הדגשת שורה שבורה לפי firstBreak
//
// שני מצבי אמת (Task 38):
//  · cloud - הספר מהמראה הציבורית. entryHash/חתימות לא נחשפים במראה
//    ומוצגים כ-placeholder מושתק וכנה; דוח האימות המקומי מוסתר
//    ובמקומו שורת טריות + עד משקיף מהשכבה החיה.
//  · local - כמו תמיד: חישוב-מחדש מלא, חתימות, entryHash לכל רשומה.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Check,
  Cloud,
  ExternalLink,
  FilePlus2,
  FlaskConical,
  HardDrive,
  Minus,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentDTO, AttestationDTO, VerifyReportDTO } from "@/lib/weave/types";
import { CLAIM_TYPES } from "@/lib/weave/types";
import { errorMessage } from "../api";
import { useWeave, type LiveOverview } from "../store";
import {
  ClaimTypeBadge,
  ErrorBox,
  FadeIn,
  HashChip,
  MotionCard,
  RoleBadge,
  scrollBoxClass,
  StatusBadge,
  TableSkeleton,
  truncateEnd,
  truncateMiddle,
} from "../shared";

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

// ── שורת טריות + עד משקיף (תחליף הוגן לדוח האימות המקומי בענן) ───────

function WitnessFreshnessLine({
  freshness,
  witness,
}: {
  freshness: NonNullable<LiveOverview["freshness"]>;
  witness: LiveOverview["witness"];
}) {
  const fresh = freshness.verdict === "FRESH";
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 border-emerald-500/25 bg-emerald-500/[0.04] p-4 sm:p-5">
      <Badge
        dir="ltr"
        className={cn(
          "gap-1",
          fresh
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        )}
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        {freshness.verdict} · ~{freshness.ageHours.toFixed(1)}h
      </Badge>
      <span className="text-xs leading-relaxed text-muted-foreground">
        סף{" "}
        <span dir="ltr" className="font-mono">
          {freshness.thresholdHours}h
        </span>{" "}
        · קצב{" "}
        <span dir="ltr" className="font-mono">
          {freshness.cadence}
        </span>{" "}
        · הלב מאמת את השרשרת בכל פעימה
      </span>
      {witness ? (
        <a
          href={witness.explorer}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="ms-auto inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-1 font-mono text-[11px] text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
        >
          <span className="truncate">witness {truncateMiddle(witness.txid, 10, 6)}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ) : null}
    </Card>
  );
}

export function LedgerTab() {
  const {
    mode,
    attestations,
    attTotal,
    agents,
    report,
    live,
    loadAttestations,
    loadAgents,
    runVerify,
    attest,
    tamper,
  } = useWeave();
  const cloud = mode === "cloud";

  useEffect(() => {
    loadAttestations();
    loadAgents();
  }, [loadAttestations, loadAgents]);

  const [attestOpen, setAttestOpen] = useState(false);
  const [tamperOpen, setTamperOpen] = useState(false);
  const [tamperBusy, setTamperBusy] = useState(false);

  const onVerify = async () => {
    try {
      const r = await runVerify();
      if (r.valid) {
        toast.success(`שרשרת תקינה (${r.checked} רשומות)`, {
          description: `חתימות EIP-191 תקינות: ${r.sigOk}/${r.checked} · head תואם`,
        });
      } else {
        toast.error(`שבר בשרשרת - seq ${r.firstBreak ?? "?"}`, {
          description: r.errors[0] ?? "חישוב מחדש גילה סטייה מהשרשרת הקנונית",
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onTamper = async () => {
    setTamperBusy(true);
    try {
      const res = await tamper();
      toast.error(`שובש seq ${res.seq} · שדה ${res.field}`, {
        description:
          mode === "cloud"
            ? `לפני: ${truncateEnd(res.before, 48)} · אחרי: ${truncateEnd(res.after, 48)} · בעותק המקומי בלבד - הספר החי בענן לא נפגע`
            : `לפני: ${truncateEnd(res.before, 48)} · אחרי: ${truncateEnd(res.after, 48)}`,
      });
      try {
        const r = await runVerify();
        if (!r.valid) {
          if (mode === "cloud") {
            toast.error(`העותק המקומי תפס את השיבוש: שבר ב-seq ${r.firstBreak}`, {
              description:
                "חישוב מחדש על עותק הסנדבוקס - הספר החי בענן לא נפגע",
            });
          } else {
            toast.error(`השרשרת תפסה את השיבוש: שבר ב-seq ${r.firstBreak}`, {
              description: "חישוב מחדש, לא סמיכות - ה-entryHash כבר לא תואם",
            });
          }
        }
      } catch {
        // האימון האוטומטי נכשל - הדוח יציג את המצב בכרטיס
      }
      setTamperOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTamperBusy(false);
    }
  };

  const entries = attestations.data ?? [];
  const sorted = [...entries].sort((a, b) => b.seq - a.seq);
  // הדגשת שבר רלוונטית רק לדוח המקומי - בענן הדוח מוסתר
  const firstBreak = cloud ? null : (report.data?.firstBreak ?? null);

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* שורת פעולות */}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-11" onClick={() => setAttestOpen(true)}>
          <FilePlus2 />
          אימות חדש
        </Button>
        {cloud ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="outline"
                  className="h-11 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
                  disabled
                >
                  <ShieldCheck />
                  אמת שרשרת
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px]">
              <p className="text-xs leading-relaxed">
                אימות חישוב-מחדש רץ על עותק מקומי - עבור למצב סנדבוקס
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            className="h-11 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
            onClick={onVerify}
            disabled={report.loading}
          >
            <ShieldCheck />
            אמת שרשרת
          </Button>
        )}
        <Button
          variant="destructive"
          className="h-11"
          onClick={() => setTamperOpen(true)}
        >
          <FlaskConical />
          ערעור מדומה
        </Button>
        {cloud ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="cursor-help gap-1.5 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
              >
                <FlaskConical className="size-3" aria-hidden="true" />
                כתיבה לעותק הסנדבוקס
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px]">
              <p className="text-xs leading-relaxed">
                פעולות כתיבה פועלות על עותק הסנדבוקס - הספר החי בענן מתעדכן
                על-ידי הסוכנים
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <span className="text-xs text-muted-foreground sm:ms-auto" dir="ltr">
          {attTotal} entries
        </span>
      </div>

      {/* דוח אימות - בענן: שורת טריות + עד משקיף במקום הדוח המקומי */}
      {cloud ? (
        live.data?.freshness ? (
          <WitnessFreshnessLine
            freshness={live.data.freshness}
            witness={live.data.witness}
          />
        ) : null
      ) : report.loading ? (
        <Card className="p-4 sm:p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </Card>
      ) : report.data ? (
        <VerifyReportCard report={report.data} />
      ) : report.error ? (
        <ErrorBox message={report.error} onRetry={() => void runVerify().catch(() => undefined)} />
      ) : null}

      {/* טבלת הספר */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
            <ScrollText className="size-4" />
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight sm:text-lg">ספר האימותים</h2>
              <SourceBadge />
            </div>
            <p className="text-xs text-muted-foreground">
              {cloud
                ? "שרשרת hash-chained מהמראה הציבורית - seq, טענה וסטטוס אמיתיים; חתימות וההאשים הפנימיים נשמרים בספר הריבוני"
                : "שרשרת hash-chained - seq, חתימת EIP-191, entryHash לכל רשומה"}
            </p>
          </div>
        </div>
        {attestations.loading && !attestations.data ? (
          <TableSkeleton rows={6} />
        ) : attestations.error && !attestations.data ? (
          <ErrorBox
            message={attestations.error}
            onRetry={loadAttestations}
            retrying={attestations.loading}
          />
        ) : (
          <div className={cn(scrollBoxClass, "border")}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0] shadow-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">seq</TableHead>
                  <TableHead className="text-right">סוכן</TableHead>
                  <TableHead className="text-right">טענה</TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">entryHash</TableHead>
                  <TableHead className="text-center">חתימה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((entry) => {
                  const broken = firstBreak === entry.seq;
                  const sigOk =
                    Boolean(entry.sig) && entry.signerAddr === entry.agentAddress;
                  return (
                    <TableRow
                      key={entry.seq}
                      className={cn(
                        broken &&
                          "border-rose-500/50 bg-rose-500/10 hover:bg-rose-500/15"
                      )}
                    >
                      <TableCell className="font-mono text-xs font-semibold" dir="ltr">
                        <span className="inline-flex items-center gap-1.5">
                          #{entry.seq}
                          {broken ? (
                            <Badge className="border-rose-500/40 bg-rose-500/10 text-[10px] text-rose-700 dark:text-rose-400">
                              <AlertTriangle className="size-3" />
                              שובש
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{entry.agentName}</span>
                          <HashChip
                            value={entry.agentAddress}
                            head={6}
                            tail={4}
                            copy={false}
                            className="border-0 bg-transparent px-0 text-[11px]"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[14rem] sm:max-w-[22rem]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate text-xs">{entry.claim}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[360px]">
                            <p className="text-xs leading-relaxed">
                              {truncateEnd(entry.claim, 260)}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <ClaimTypeBadge type={String(entry.claimType)} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={String(entry.status)} />
                      </TableCell>
                      <TableCell>
                        {cloud && !entry.entryHash ? (
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            (במראה)
                          </span>
                        ) : (
                          <HashChip value={entry.entryHash} head={8} tail={6} />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {cloud && !entry.sig ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex size-9 items-center justify-center">
                                <Minus
                                  className="size-4 text-muted-foreground/70"
                                  aria-hidden="true"
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs">
                                חתימות נשמרות בספר הריבוני - לא נחשפות במראה
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex size-9 items-center justify-center">
                                {sigOk ? (
                                  <Check className="size-5 text-emerald-500" />
                                ) : (
                                  <X className="size-5 text-rose-500" />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs">
                                {sigOk
                                  ? "תאימות בדפדפן: כתובת-חתומה מושווה לכתובת הסוכן; ecrecover מלא רץ באימות-השרת"
                                  : "חתימה חסרה או לא תואמת לכתובת הסוכן"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      הספר עוד ריק - צור אימות ראשון
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* דיאלוג אימות חדש */}
      <AttestDialog
        open={attestOpen}
        onOpenChange={setAttestOpen}
        agents={agents.data ?? []}
        agentsLoading={agents.loading && !agents.data}
        onSubmit={attest}
      />

      {/* דיאלוג אישור ערעור מדומה */}
      <AlertDialog open={tamperOpen} onOpenChange={setTamperOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <FlaskConical className="size-5" />
              ערעור מדומה - תרגיל red-team
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              זה ישבש רשומה אחת ב-DB כדי להוכיח שהשרשרת תופסת שיבוש post-hoc.
              השרשרת אמורה לזהות את זה בדיוק.
              {cloud
                ? " במצב ענן הערעור רץ על עותק הסנדבוקס בלבד - הספר החי בענן לא ייפגע."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="destructive" className="mt-2">
            <Ban />
            <AlertTitle>פעולה הרסנית (מקומית בלבד)</AlertTitle>
            <AlertDescription>
              השדה ישתנה ישירות ב-SQLite בלי חישוב entryHash מחדש - השורה תישאר
              מסומנת כשבורה עד שחזור ידני.
            </AlertDescription>
          </Alert>
          <AlertDialogFooter className="mt-2 gap-2 sm:gap-0">
            <AlertDialogCancel className="h-11">ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-rose-600 hover:bg-rose-500 focus-visible:ring-rose-500/40 dark:bg-rose-600 dark:hover:bg-rose-500"
              disabled={tamperBusy}
              onClick={(e) => {
                e.preventDefault();
                void onTamper();
              }}
            >
              {tamperBusy ? <Skeleton className="h-4 w-16" /> : "שבש רשומה"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeIn>
  );
}

// ── כרטיס דוח אימות ──────────────────────────────────────────────────

function VerifyReportCard({ report }: { report: VerifyReportDTO }) {
  const headsMatch = report.headHash === report.recomputedHead;
  return (
    <MotionCard
      className={cn(
        "p-4 sm:p-6",
        report.valid
          ? "border-emerald-500/30"
          : "border-rose-500/40 bg-rose-500/[0.03]"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {report.valid ? (
          <Badge className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 py-1 text-sm text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-4" />
            שרשרת תקינה
          </Badge>
        ) : (
          <Badge className="gap-1.5 border-rose-500/40 bg-rose-500/10 py-1 text-sm text-rose-700 dark:text-rose-400">
            <ShieldAlert className="size-4" />
            שרשרת שבורה - seq {report.firstBreak ?? "?"}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          אומתה בחישוב מחדש · {new Date(report.verifiedAt).toLocaleString("he-IL")}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="רשומות שנבדקו" value={String(report.checked)} tone="zinc" />
        <StatChip label="חתימות תקינות" value={String(report.sigOk)} tone="emerald" />
        <StatChip label="חתימות שנכשלו" value={String(report.sigFail)} tone="rose" />
        <StatChip
          label="שבר ראשון"
          value={report.firstBreak === null ? "-" : `seq ${report.firstBreak}`}
          tone={report.firstBreak === null ? "zinc" : "rose"}
        />
      </div>

      {report.errors.length > 0 ? (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            שגיאות אימות ({report.errors.length}):
          </p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1 text-xs text-rose-700 dark:text-rose-300">
            {report.errors.map((err, i) => (
              <li key={i} className="leading-relaxed">
                • {err}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <HashChip value={report.headHash} label="HEAD" head={8} tail={6} />
        <HashChip value={report.recomputedHead} label="RECOMPUTED" head={8} tail={6} />
        <Badge
          dir="ltr"
          className={cn(
            "font-mono text-[10px]",
            headsMatch
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
          )}
        >
          {headsMatch ? "head = recomputed" : "head mismatch"}
        </Badge>
      </div>
    </MotionCard>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "zinc";
}) {
  const tones = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400",
    zinc: "border-border bg-muted/40 text-foreground",
  } as const;
  return (
    <div className={cn("rounded-lg border p-2.5", tones[tone])}>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  );
}

// ── דיאלוג אימות חדש ─────────────────────────────────────────────────

interface AttestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentDTO[];
  agentsLoading: boolean;
  onSubmit: (input: {
    agentId: string;
    claim: string;
    claimType: string;
    evidence: string;
  }) => Promise<AttestationDTO>;
}

function AttestDialog({ open, onOpenChange, agents, agentsLoading, onSubmit }: AttestDialogProps) {
  const { mode } = useWeave();
  const [agentId, setAgentId] = useState("");
  const [claim, setClaim] = useState("");
  const [claimType, setClaimType] = useState<string>("MEASUREMENT");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAgentId(agents[0]?.id ?? "");
      setClaim("");
      setClaimType("MEASUREMENT");
      setEvidence("");
      setError(null);
    }
  }, [open, agents]);

  const submit = async () => {
    if (!agentId) {
      setError("בחר סוכן חותם");
      return;
    }
    if (!claim.trim()) {
      setError("הטענה ריקה - שום טענה בלי תוכן");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await onSubmit({
        agentId,
        claim: claim.trim(),
        claimType,
        evidence: evidence.trim(),
      });
      if (entry.status === "VERIFIED") {
        toast.success(`אימות #${entry.seq} נרשם בספר · VERIFIED`, {
          description:
            mode === "cloud"
              ? `${entry.agentName} · ${entry.claimType} · נכתב לעותק המקומי - הספר החי בענן מתעדכן על-ידי הסוכנים`
              : `${entry.agentName} · ${entry.claimType} · נחתם ב-EIP-191`,
        });
      } else {
        toast.warning(`אימות #${entry.seq} נרשם · ${entry.status}`, {
          description:
            mode === "cloud"
              ? "טענה ללא מדידה - השרת קבע שהיא לא תסומן VERIFIED · נכתב לעותק המקומי"
              : "טענה ללא מדידה - השרת קבע שהיא לא תסומן VERIFIED",
        });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-5 text-emerald-500" />
            אימות חדש
          </DialogTitle>
          <DialogDescription>
            הטענה תיחתם במפתח ה-EVM של הסוכן ותשורשר לספר. הסטטוס נקבע בשרת בלבד.
            {mode === "cloud"
              ? " במצב ענן הכתיבה מבוצעת לעותק הסנדבוקס המקומי."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="attest-agent">סוכן חותם</Label>
            <Select dir="rtl" value={agentId} onValueChange={setAgentId} disabled={agentsLoading}>
              <SelectTrigger id="attest-agent" className="h-11 w-full">
                <SelectValue placeholder={agentsLoading ? "טוען סוכנים…" : "בחר סוכן"} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{agent.name}</span>
                      <RoleBadge role={agent.role} className="text-[10px]" />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="attest-claim">טענה</Label>
            <Input
              id="attest-claim"
              className="h-11"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="למשל: שכפול נמדד - קבצי X משוכפלים ב-N ריפוים"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="attest-type">סוג טענה</Label>
            <Select dir="rtl" value={claimType} onValueChange={setClaimType}>
              <SelectTrigger id="attest-type" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAIM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    <span dir="ltr" className="font-mono">
                      {type}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="attest-evidence">ראיה / מדידה</Label>
            <Textarea
              id="attest-evidence"
              rows={4}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="פלט מדידה, פקודה, hash, ספירות - כל מה שניתן לחשב מחדש"
              className="text-start"
            />
            <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
              בלי מדידה הטענה תסומן UNMEASURED - השרת קובע, לא הלקוח.
            </p>
          </div>

          {error ? (
            <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            ביטול
          </Button>
          <Button className="h-11" onClick={() => void submit()} disabled={busy}>
            {busy ? "חותם ומשרשר…" : "חתום ורשום בספר"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
