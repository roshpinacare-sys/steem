"use client";

// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE PANEL · לוח-הממשל החי (r142 · D-OP-01)
// מציג את הפרוטוקול הריבוני באמת-מדודה בלבד:
//   · אישור-העומד של המפעיל (D-OP-01) — הרשת מחליטה בלי המתנה
//   · הפעולה-הבאה (NEXT_ACTION) עם allowed/forbidden/exitCriteria
//   · ההחלטות האחרונות מתוך היומן hash-chained + אימות-שרשרת חי
// אפס סודות · אפס טענות בלי מדידה — מה שאין, לא מציגים.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { Ban, Check, CheckCircle2, Gavel, Loader2, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn, Section, scrollBoxClass, StatusBadge } from "@/components/weave/shared";

interface DecisionEntry {
  seq: number;
  at: string;
  decisionId: string;
  class: string;
  chosen: string;
  why: string;
  boundary: string;
  evidence?: string;
  entryHash: string;
}

interface GovernanceDTO {
  ok: boolean;
  governance?: {
    protocolOrigin: string;
    operatorStandingApproval: { decisionId: string; givenAt: string; meaning: string } | null;
    programState: { phase: string; status: string; readiness: string; executionBoundary: { auto: string[]; gate: string[]; forbidden: string[] } } | null;
    nextAction: { actionId: string; title: string; allowedActions: string[]; forbiddenActions: string[]; exitCriteria: string[] } | null;
    openDecisions: { decisions: Array<{ id: string; status: string; recommendation?: string; decision?: string; preApprovedBy?: string }> } | null;
    loop: { cycles: number; lastCycleAt: string | null; lastDecisionId: string | null; lastChosen: string | null; lastVerdict: string | null; lastDetail: string | null; brainUsed: boolean } | null;
    chain: { ok: boolean; entries: number; brokenAt: number | null };
    recentDecisions: DecisionEntry[];
  };
  error?: string;
}

export function GovernancePanel() {
  const [data, setData] = useState<GovernanceDTO["governance"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/governance", { cache: "no-store" });
      const json = (await res.json()) as GovernanceDTO;
      if (!json.ok || !json.governance) throw new Error(json.error ?? "טעינת ממשל נכשלה");
      setData(json.governance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCycle = useCallback(async () => {
    setDeciding(true);
    try {
      const res = await fetch("/api/governance/cycle", { method: "POST", cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; skipped?: boolean; reason?: string; error?: string };
      if (!json.ok) throw new Error(json.error ?? "מחזור נכשל");
      await load();
    } catch {
      // שגיאה כנה — הפאנל מציג את המצב האחרון הטוב
    } finally {
      setDeciding(false);
    }
  }, [load]);

  return (
    <Section
      title="הממשל הריבוני — הרשת מחליטה מעצמה"
      icon={<Gavel />}
      description="פרוטוקול ממשל שאומץ מפרויקט העבר של המפעיל · אישור-עומד D-OP-01: החלטות בתוך הגבולות מאושרות מראש · יומן החלטות append-only hash-chained"
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            רענון
          </Button>
          <Button size="sm" onClick={runCycle} disabled={deciding}>
            {deciding ? <Loader2 className="size-4 animate-spin" /> : <Gavel className="size-4" />}
            מחזור החלטה
          </Button>
        </div>
      }
    >
      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {data ? (
        <FadeIn className="flex flex-col gap-4">
          {/* אישור-עומד */}
          {data.operatorStandingApproval ? (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-emerald-500" />
                  אישור-עומד של המפעיל ({data.operatorStandingApproval.decisionId} · {data.operatorStandingApproval.givenAt})
                  <StatusBadge status="VERIFIED" />
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground sm:text-sm">
                {data.operatorStandingApproval.meaning}
              </CardContent>
            </Card>
          ) : null}

          {/* הפעולה-הבאה + שרשרת */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.nextAction ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <ScrollText className="size-4" />
                    הפעולה-הבאה: {data.nextAction.actionId}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-0">
                  <p className="text-xs sm:text-sm">{data.nextAction.title}</p>
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">מותר (בחירת המוח מכאן בלבד)</p>
                    <ul className={`${scrollBoxClass} max-h-28 space-y-1 pe-2 text-[11px] text-muted-foreground`}>
                      {data.nextAction.allowedActions.map((a, i) => (
                        <li key={i} className="flex gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-destructive">אסור — לא נשאל אפילו</p>
                    <ul className={`${scrollBoxClass} max-h-20 space-y-1 pe-2 text-[11px] text-muted-foreground`}>
                      {data.nextAction.forbiddenActions.map((a, i) => (
                        <li key={i} className="flex gap-1.5">
                          <Ban className="mt-0.5 size-3 shrink-0 text-destructive" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4" />
                  יומן-ההחלטות · שרשרת {data.chain.ok ? "תקינה" : "שבורה"}
                  <Badge variant="outline">{data.chain.entries} רשומות</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-0">
                {data.loop ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border bg-muted/40 p-2">
                      <span className="text-muted-foreground">מחזורים: </span>
                      <span className="font-semibold">{data.loop.cycles}</span>
                    </div>
                    <div className="rounded-md border bg-muted/40 p-2">
                      <span className="text-muted-foreground">פסק-דין אחרון: </span>
                      <span className="font-semibold">{data.loop.lastVerdict ?? "—"}</span>
                    </div>
                    <div className="col-span-2 rounded-md border bg-muted/40 p-2">
                      <span className="text-muted-foreground">החלטה אחרונה: </span>
                      <span className="font-semibold">{data.loop.lastChosen ?? "—"}</span>
                      {data.loop.lastDetail ? <p className="mt-1 text-[11px] text-muted-foreground">{data.loop.lastDetail}</p> : null}
                    </div>
                  </div>
                ) : null}
                <div className={`${scrollBoxClass} max-h-48 space-y-2 pe-1`}>
                  {data.recentDecisions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">אין החלטות עדיין — המחזור הראשון יירשם בעוד רגע</p>
                  ) : (
                    data.recentDecisions.map((d) => (
                      <div key={d.entryHash.slice(0, 16)} className="rounded-md border p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-mono text-[10px]">{d.decisionId}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{d.class}</Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(d.at).toLocaleString("he-IL")}</span>
                        </div>
                        <p className="mt-1 font-medium">{d.chosen}</p>
                        <p className="text-[11px] text-muted-foreground">{d.why}</p>
                        {d.evidence ? (
                          <p className="mt-1 border-t pt-1 text-[11px]">
                            <span className="font-medium">ראיה: </span>
                            {d.evidence}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* החלטות-פתוחות */}
          {data.openDecisions?.decisions?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">מרשם-ההחלטות הפתוחות</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className={`${scrollBoxClass} max-h-40 space-y-2 pe-1`}>
                  {data.openDecisions.decisions.map((d) => (
                    <div key={d.id} className="flex flex-col gap-1 rounded-md border p-2 text-xs sm:flex-row sm:items-start sm:gap-3">
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant={d.status === "resolved" ? "outline" : "secondary"} className="font-mono text-[10px]">
                          {d.id}
                        </Badge>
                        <Badge variant={d.status === "resolved" ? "default" : d.status === "open" ? "destructive" : "secondary"} className="text-[10px]">
                          {d.status}
                        </Badge>
                      </div>
                      <span className="min-w-0 text-muted-foreground">{d.decision ?? d.recommendation ?? ""}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </FadeIn>
      ) : loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> טוען את מצב-הממשל החי…
          </CardContent>
        </Card>
      ) : null}
    </Section>
  );
}
