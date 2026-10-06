"use client";

// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE CARD · ממשל ריבוני · לולאת ההחלטות (r143-b · D-OP-01)
// כרטיס חי שצורך GET /api/governance בלבד: שרשרת-ההחלטות hash-chained,
// מצב-הלולאה (מחזורים, הכרעה אחרונה, מוח חי מול רוטציה — שניהם לגיטימיים
// ושניהם מתויגים בכנות), ההחלטות האחרונות ומרשם-ההחלטות הפתוחות.
//
// חוק-התצוגה: אפס טענה בלי מדידה. מדידה שלא ענתה מוצגת "לא נמדד" —
// לעולם לא כאפס ולא כהצלחה שנטענת. כל מספר כאן קשור לשדה שנמדד.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Brain, Gavel, ScrollText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { scrollBoxClass, truncateEnd } from "@/components/weave/shared";

interface DecisionEntry {
  seq: number;
  decisionId: string;
  class: string;
  chosen: string;
}

interface OpenDecision {
  id: string;
  status: string;
}

interface GovernanceState {
  ok: boolean;
  governance?: {
    operatorStandingApproval: { decisionId: string; givenAt: string } | null;
    loop: {
      cycles: number;
      lastCycleAt: string | null;
      lastDecisionId: string | null;
      lastChosen: string | null;
      lastVerdict: string | null;
      brainUsed: boolean;
    } | null;
    chain: { ok: boolean; entries: number; brokenAt: number | null } | null;
    recentDecisions: DecisionEntry[];
    openDecisions: { decisions: OpenDecision[] } | null;
  };
}

// טריות יחסית מהשדה החי — null כשאין מדידה (אף תווית מומצאת)
function fmtAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "כרגע";
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours}ש' ${mins % 60}דק'`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function openDecisionChip(status: string) {
  if (status === "open")
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        פתוחה
      </Badge>
    );
  if (status === "provisional")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        זמנית
      </Badge>
    );
  if (status === "resolved")
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        הוכרעה
      </Badge>
    );
  return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
}

export function GovernanceCard() {
  const reduced = useReducedMotion();
  const [data, setData] = useState<GovernanceState["governance"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/governance", { cache: "no-store" });
      const json = (await res.json()) as GovernanceState;
      if (json.ok && json.governance) {
        setData(json.governance);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      // המדידה שלא ענתה — התג יישאר "לא נמדד", אף מספר לא מומצא
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const chain = data?.chain ?? null;
  const loop = data?.loop ?? null;
  const recent = (data?.recentDecisions ?? []).slice(0, 3);
  const open = data?.openDecisions?.decisions ?? [];
  const standing = data?.operatorStandingApproval ?? null;
  const lastAgo = fmtAgo(loop?.lastCycleAt);

  const statusBadge =
    loading && !data ? (
      <Skeleton className="h-5 w-16" />
    ) : failed && !data ? (
      <Badge variant="outline" className="text-muted-foreground">לא נמדד</Badge>
    ) : chain && !chain.ok ? (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        שרשרת שבורה
      </Badge>
    ) : chain?.ok && loop?.lastVerdict ? (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        מחליט
      </Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">טרם הכריע</Badge>
    );

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.3, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-[border-color,box-shadow] duration-200 hover:border-emerald-500/30 hover:shadow-md hover:shadow-emerald-950/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Gavel className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ממשל ריבוני · לולאת ההחלטות
          </div>
          {statusBadge}
        </div>

        {/* D-OP-01 — אישור-העומד (מוצג רק כשהשדה קיים בפועל) */}
        {standing ? (
          <p className="flex items-start gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300" dir="auto">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              אישור-שוטף {standing.decisionId} · הכל אושר מראש — הרשת לא ממתינה למפעיל
              {standing.givenAt ? <span className="block text-[10px] font-normal text-muted-foreground">ניתן {standing.givenAt}</span> : null}
            </span>
          </p>
        ) : null}

        {/* שרשרת ההחלטות — נמדדה חי */}
        {chain ? (
          <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
            <ScrollText className="mr-1 inline size-3" aria-hidden="true" />
            יומן-החלטות hash-chained ·{" "}
            <span className="font-semibold tabular-nums text-foreground">{chain.entries}</span> החלטות חתומות
            {chain.ok ? " · שרשרת מאומתת" : (
              <span className="text-amber-600 dark:text-amber-300"> · שבורה ב-seq {chain.brokenAt ?? "?"}</span>
            )}
          </p>
        ) : loading ? (
          <Skeleton className="h-4 w-56" />
        ) : (
          <p className="text-xs text-muted-foreground">השרשרת לא נמדדה — המדידה לא ענתה.</p>
        )}

        {/* מצב הלולאה — מחזורים, הכרעה אחרונה, ומוח חי מול רוטציה (שניהם כנים) */}
        {loop ? (
          <div className="flex flex-col gap-1.5 text-xs" dir="auto">
            <p>
              <span className="text-muted-foreground">מחזורים: </span>
              <span className="font-semibold tabular-nums">{loop.cycles}</span>
              {lastAgo ? <span className="text-muted-foreground"> · הכרעה אחרונה {lastAgo}</span> : null}
            </p>
            {loop.lastDecisionId ? (
              <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                {loop.lastDecisionId}
              </p>
            ) : null}
            {loop.lastChosen ? (
              <p className="leading-relaxed">{truncateEnd(loop.lastChosen, 60)}</p>
            ) : null}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Brain className="size-3" aria-hidden="true" />
              {loop.brainUsed ? "מוח חי" : "רוטציה דטרמיניסטית — המוח לא השיב, הרשת ממשיכה בלי המתנה"}
            </p>
          </div>
        ) : loading ? (
          <Skeleton className="h-16 w-full" />
        ) : null}

        {/* ההחלטות האחרונות — מהיומן החתום, בלי עריכה */}
        {recent.length > 0 ? (
          <div className={`${scrollBoxClass} max-h-40 rounded-lg border bg-card/60 p-2`}>
            <ul className="flex flex-col gap-1.5">
              {recent.map((d) => (
                <li key={`${d.seq}-${d.decisionId}`} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span className="shrink-0 font-mono text-muted-foreground" dir="ltr">
                    #{d.seq} {d.decisionId}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">{d.class}</Badge>
                  <span className="min-w-0 text-foreground/90" dir="auto">{truncateEnd(d.chosen, 60)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : loading ? (
          <Skeleton className="h-20 w-full" />
        ) : null}

        {/* מרשם-ההחלטות הפתוחות — כל הסטטוסים כפי שנרשמו */}
        {open.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {open.map((d) => (
              <span key={d.id} className="flex items-center gap-1 rounded-md border px-1.5 py-0.5" dir="ltr" title={d.status}>
                <span className="font-mono text-[10px] text-muted-foreground">{d.id}</span>
                {openDecisionChip(d.status)}
              </span>
            ))}
          </div>
        ) : loading ? (
          <Skeleton className="h-6 w-48" />
        ) : null}

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          מקור: /api/governance · כל החלטה חתומה גיבוב append-only — אי-אפשר לשכתב את העבר, רק להוסיף. מדידה שלא ענתה מוצגת כלא-נמדדת.
        </p>
      </Card>
    </motion.div>
  );
}
