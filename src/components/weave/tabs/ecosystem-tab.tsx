"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 5 - אקוסיסטם
// מלאי 13 הריפוים: נפח, שכפול מדוד, מטרות מבניות וממצאים
// ─────────────────────────────────────────────────────────────────────

import { useEffect, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Boxes,
  Database,
  GitBranch,
  HardDrive,
  LayoutGrid,
  Ruler,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RepoDTO } from "@/lib/weave/types";
import { useWeave } from "../store";
import {
  ErrorBox,
  FadeIn,
  MotionCard,
  scrollBoxClass,
  TableSkeleton,
  truncateEnd,
} from "../shared";

function dupTone(score: number): { bar: string; text: string } {
  if (score > 0.6) {
    return {
      bar: "bg-rose-500",
      text: "text-rose-600 dark:text-rose-400",
    };
  }
  if (score >= 0.3) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    bar: "bg-zinc-500",
    text: "text-zinc-600 dark:text-zinc-400",
  };
}

export function EcosystemTab() {
  const { repos, loadRepos } = useWeave();

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const list = repos.data ?? [];
  const totalMb = list.reduce((acc, r) => acc + (r.sizeMb ?? 0), 0);
  const avgDup =
    list.length > 0 ? list.reduce((acc, r) => acc + r.dupScore, 0) / list.length : 0;
  const avgTone = dupTone(avgDup);
  // יושר: המיון מבוצע בפועל כפי שנטען בכותרת - שכפול מדוד, המשוכפל ביותר ראשון
  // (עותק בלבד - כרטיסי הסיכום ממשיכים לחשב על הרשימה המקורית; חסרי-מדידה בסוף)
  const sorted = [...list].sort((a, b) => {
    const ad = a.dupScore ?? -1;
    const bd = b.dupScore ?? -1;
    return bd - ad;
  });

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* כרטיסי סיכום */}
      {repos.loading && !repos.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 sm:p-6">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" />
            </Card>
          ))}
        </div>
      ) : repos.error && !repos.data ? (
        <ErrorBox message={repos.error} onRetry={loadRepos} retrying={repos.loading} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MotionCard className="p-4 sm:p-6">
              <p className="text-xs font-medium text-muted-foreground">ריפוים במלאי</p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums">{list.length}</p>
              <p className="mt-2 text-xs text-muted-foreground">ביקורת שכפול - מדידה חלקית מתועדת</p>
            </MotionCard>
            <MotionCard className="p-4 sm:p-6">
              <p className="text-xs font-medium text-muted-foreground">נפח כולל</p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums" dir="ltr">
                {totalMb} MB
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                רק חלק מהריפוים נמדד בפועל - השאר ממתינים למלאי מדוד
              </p>
            </MotionCard>
            <MotionCard className="p-4 sm:p-6">
              <p className="text-xs font-medium text-muted-foreground">שכפול ממוצע (מדוד)</p>
              <p
                className={cn("mt-1 font-mono text-3xl font-bold tabular-nums", avgTone.text)}
                dir="ltr"
              >
                {Math.round(avgDup * 100)}%
              </p>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(avgDup * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="שכפול ממוצע"
              >
                <div
                  className={cn("h-full rounded-full transition-all", avgTone.bar)}
                  style={{ width: `${Math.round(avgDup * 100)}%` }}
                />
              </div>
            </MotionCard>
          </div>

          <Card className="flex flex-wrap items-center gap-2 border-amber-500/30 bg-amber-500/[0.05] p-3 sm:p-4">
            <Ruler className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed sm:text-sm">
              <span className="font-semibold">סטטוס: ביקורת 2026-09</span> - מבוסס מדידה,
              לא התרשמות. כל ציון שכפול נמדד ותועד; ריפו לא מדוד מסומן במפורש.
            </p>
          </Card>
        </>
      )}

      {/* טבלת ריפוים */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
            <GitBranch className="size-4" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">מלאי הריפוים</h2>
            <p className="text-xs text-muted-foreground sm:text-sm">
              מסודר לפי שכפול מדוד - המשוכפל ביותר ראשון
            </p>
          </div>
        </div>
        {repos.loading && !repos.data ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className={cn(scrollBoxClass, "border")}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">ריפו</TableHead>
                  <TableHead className="text-right">נפח</TableHead>
                  <TableHead className="text-right">מסלול</TableHead>
                  <TableHead className="text-right">שכפול (dupScore)</TableHead>
                  <TableHead className="text-right">ממצאים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((repo) => (
                  <RepoRow key={repo.id} repo={repo} />
                ))}
                {list.length === 0 && !repos.loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      אין נתוני מלאי
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* מבנה יעד */}
      <MotionCard className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
            <LayoutGrid className="size-4" />
          </span>
          <div>
            <h3 className="font-semibold">מבנה יעד</h3>
            <p className="text-xs text-muted-foreground">
              ארבעה יעדים קנוניים במקום 13 ריפוים מפוזרים
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TargetItem
            icon={<Boxes className="size-4" />}
            name="weave-core"
            description="פלטפורמת האימות - הפרויקט הזה"
          />
          <TargetItem
            icon={<Database className="size-4" />}
            name="saos-ops"
            description="runbooks + state מבצעי"
          />
          <TargetItem
            icon={<Archive className="size-4" />}
            name="vault-of-record"
            description="כספת מוצפנת, branch-protected, passphrase מנותק"
          />
          <TargetItem
            icon={<HardDrive className="size-4" />}
            name="archive"
            description="ארכיון קרא-בלבד"
          />
        </div>
        <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          כל מעבר ריפו נעול מאחורי שער R1 עם מדידת שכפול חוזרת - המטרה: שכפול
          ממוצע מדוד מתחת ל-0.2.
        </p>
      </MotionCard>
    </FadeIn>
  );
}

function RepoRow({ repo }: { repo: RepoDTO }) {
  const tone = dupTone(repo.dupScore);
  const pct = Math.round(repo.dupScore * 100);
  return (
    <TableRow>
      <TableCell dir="ltr" className="font-mono text-xs font-bold">
        {repo.name}
      </TableCell>
      <TableCell className="font-mono text-xs tabular-nums" dir="ltr">
        {repo.sizeMb > 0 ? `${repo.sizeMb} MB` : "-"}
      </TableCell>
      <TableCell className="max-w-[13rem] sm:max-w-[18rem]">
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{repo.currentRole}</span>
          <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            {repo.targetRole}
          </span>
        </span>
      </TableCell>
      <TableCell className="min-w-[8rem]">
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:w-24"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`שכפול ${repo.name}`}
          >
            <div
              className={cn("h-full rounded-full", tone.bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={cn("font-mono text-[11px] font-semibold tabular-nums", tone.text)} dir="ltr">
            {pct}%
          </span>
        </div>
      </TableCell>
      <TableCell className="max-w-[12rem] sm:max-w-[20rem]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block truncate text-xs text-muted-foreground">
              {repo.findings}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[340px]">
            <p className="text-xs leading-relaxed">{truncateEnd(repo.findings, 240)}</p>
          </TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

function TargetItem({
  icon,
  name,
  description,
}: {
  icon: ReactNode;
  name: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p dir="ltr" className="font-mono text-sm font-semibold">
          {name}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
