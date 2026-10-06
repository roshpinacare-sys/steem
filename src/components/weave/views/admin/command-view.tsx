"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Admin - מרכז הפיקוד.
//
// היד של המפעיל על הענן: פעימת כל ריפו, ריצות אחרונות לכל סוכן,
// וכפתור הזנקה ישיר (workflow_dispatch) לסוכנים שתומכים בזה.
// ה-PAT חי רק צד-שרת - הדפדפן לעולם לא רואה אותו.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CircleCheck,
  Cloud,
  ExternalLink,
  GitBranch,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AdminGate, useOperator } from "@/components/weave/operator";
import { GridArmCard } from "@/components/weave/views/admin/grid-arm-card";
import { AutonomyGateCard } from "@/components/weave/views/admin/autonomy-gate-card";
import { ActivationDoorCard } from "@/components/weave/views/admin/activation-door-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PageWash } from "@/components/weave/shared";

interface CloudData {
  repos: Array<{ name: string; pushedAt: string; private: boolean; archived: boolean }>;
  runs: Record<
    string,
    Array<{
      name: string;
      status: string;
      conclusion: string | null;
      createdAt: string;
      event: string;
      htmlUrl: string;
    }>
  >;
  // r125a · סמן down פר-ריפו: ריצות שלא נקראו אינן "אין ריצות"
  runsErrors?: Record<string, string>;
  dispatchable: Array<{ repo: string; workflow: string; label: string; description: string }>;
  canDispatch: boolean;
  servedAt: string;
}

function ageLabel(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

export function AdminCommandView() {
  const { authedFetch, status } = useOperator();
  const [data, setData] = useState<CloudData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/admin/cloud");
      const j = (await res.json()) as { ok: boolean; error?: string } & CloudData;
      if (!res.ok || !j.ok) {
        throw new Error(
          j.error ??
            (res.status === 401
              ? "אזור האדמין נעול — התחבר עם מפתח המפעיל"
              : "שגיאה")
        );
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הענן לא נענה");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status === "in") void load();
  }, [load, status]);

  const dispatch = useCallback(
    async (repo: string, workflow: string, label: string) => {
      const key = `${repo}/${workflow}`;
      setDispatching(key);
      try {
        const res = await authedFetch("/api/admin/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, workflow }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !j.ok) throw new Error(j.error ?? "ההזנקה נכשלה");
        toast.success(`הזנקת "${label}" נשלחה לענן`, {
          description: "הסוכן יתחיל לרוץ בתוך דקה - רענן לראות את הריצה",
        });
        setTimeout(() => void load(), 30_000);
      } catch (e) {
        toast.error("ההזנקה נכשלה", {
          description: e instanceof Error ? e.message : "נסה שוב",
        });
      } finally {
        setDispatching(null);
      }
    },
    [load, authedFetch]
  );

  return (
    <AdminGate>
      <div className="relative isolate mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageWash className="-inset-x-4 -inset-y-3 rounded-2xl" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <ShieldCheck className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            מרכז הפיקוד
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            שליטה ישירה בצי הענן: מי רץ, מתי לאחרונה, והזנקה ידנית של כל סוכן.
            הכל דרך ה-API של גיטהאב - האסמכתה נשארת צד-שרת.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          רענן
        </Button>
      </div>

      {/* שער-העצירה והחשיבה — הוראת-המפעיל r197: קודם חושבים, אחר-כך עושים */}
      <AutonomyGateCard />

      {/* חימום הגריד החוץ — עורק הכסף האמיתי */}
      <ActivationDoorCard />
      <GridArmCard />

      {/* הזנקה מהירה */}
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className="size-4 text-amber-500" aria-hidden="true" />
            הזנקת סוכן עכשיו
          </div>
          {data && !data.canDispatch ? (
            <p className="text-sm text-muted-foreground">
              אין אסמכתת צד-שרת לגיטהאב בסביבה זו - הצגה בלבד.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(data?.dispatchable ?? []).map((d) => {
                const key = `${d.repo}/${d.workflow}`;
                return (
                  <Button
                    key={key}
                    variant="outline"
                    className="h-auto flex-col items-start gap-1 whitespace-normal p-4 text-start break-words"
                    disabled={dispatching !== null}
                    onClick={() => void dispatch(d.repo, d.workflow, d.label)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-bold">{d.label}</span>
                      {dispatching === key ? (
                        <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      )}
                    </span>
                    <span className="text-[11px] font-normal leading-relaxed text-muted-foreground">
                      {d.description}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                      {d.repo} · {d.workflow.replace(".yml", "")}
                    </span>
                  </Button>
                );
              })}
              {!data &&
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-6 border-rose-500/40">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <XCircle className="size-5 shrink-0 text-rose-500" aria-hidden="true" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* ריצות אחרונות לפי ריפו */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        ריצות אחרונות בענן
      </h2>
      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.entries(data.runs).map(([repo, runs]) => {
            const repoInfo = data.repos.find((r) => r.name === repo);
            return (
              <Card key={repo}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono text-sm font-bold">{repo}</span>
                      {repoInfo?.private && (
                        <Badge variant="outline" className="text-[10px]">
                          פרטי
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      push {ageLabel(repoInfo?.pushedAt ?? "")}
                    </span>
                  </div>
                  {runs.length === 0 ? (
                    data.runsErrors?.[repo] ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        קריאת הריצות נכשלה — הריפו מסומן down (לא מדידה של אין-ריצות): {data.runsErrors[repo]}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">אין ריצות מתועדות.</p>
                    )
                  ) : (
                    <div className="grid gap-1.5">
                      {runs.map((r, i) => (
                        <a
                          key={`${r.name}-${i}`}
                          href={r.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg border bg-card/60 px-3 py-2 text-xs transition-colors hover:bg-muted/50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {r.conclusion === "success" ? (
                              <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            ) : r.conclusion === "failure" ? (
                              <XCircle className="size-3.5 shrink-0 text-rose-500" aria-hidden="true" />
                            ) : (
                              <Activity className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            )}
                            <span className="truncate font-mono">{r.name}</span>
                            {r.event === "workflow_dispatch" && (
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                ידני
                              </Badge>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                            {ageLabel(r.createdAt)}
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* כל הריפואים */}
      {data && (
        <div className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Cloud className="size-4" aria-hidden="true" />
            {data.repos.length} הריפואים במערכת
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.repos.map((r) => {
              const h = (Date.now() - new Date(r.pushedAt).getTime()) / 3_600_000;
              const fresh = h < 3;
              const sleepy = h < 72;
              return (
                <div
                  key={r.name}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-card/60 px-3 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        fresh ? "bg-emerald-500" : sleepy ? "bg-amber-500" : "bg-zinc-400"
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-xs">{r.name}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {ageLabel(r.pushedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AdminGate>
  );
}
