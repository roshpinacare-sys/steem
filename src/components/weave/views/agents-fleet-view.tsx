"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Agents Fleet View - הצי החי.
//
// רישום חי מ-agents-watch (מתעדכן שעתית מה-API של גיטהאב) + נקודת
// חיים לפי זמן הריצה האחרונה. מי שמת - נראה מת. הכל עובדות.
// r140: מפעל-האימות המקומי והעותקים בענן מוצגים מתחת לאותם חוקי-אמת.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  Clock3,
  Cpu,
  GitBranch,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWeave } from "../store";
import { PageWash } from "../shared";

// ── עזרי זמן ────────────────────────────────────────────────────────

function ageLabel(iso: string | undefined): string {
  if (!iso) return "לא נמדד";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

function lifeLevel(iso: string | undefined): "live" | "ok" | "slow" | "dead" {
  if (!iso) return "dead";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 2) return "live";
  if (h < 26) return "ok";
  if (h < 50) return "slow";
  return "dead";
}

/** r121 · השלמת חוק ההגדרה-היחידה (r117): הנקודה שעל הכרטיס נגזרת
 *  מהמצב הרשמי של הרישום (state=live/degraded/dormant) — בדיוק כמו
 *  כרטיס הסיכום. גיל-ריצה אחרון נשאר רמז-משנה בלבד, לא מקור-חיים:
 *  סוכן שהריצה לאחרונה אבל מסומן degraded הוא מדורד — לא "חי". */
function stateLevel(state: string | undefined, iso: string | undefined): "live" | "ok" | "slow" | "dead" {
  if (state === "live") return "live";
  if (state === "degraded") return "slow";
  if (state === "dormant") return "dead";
  return lifeLevel(iso);
}

const LIFE_STYLE: Record<ReturnType<typeof lifeLevel>, { dot: string; label: string }> = {
  live: { dot: "bg-emerald-500", label: "חי" },
  ok: { dot: "bg-emerald-400", label: "חי" },
  slow: { dot: "bg-amber-500", label: "מדורד" },
  dead: { dot: "bg-rose-500", label: "דורם" },
};

const LAYER_STYLE: Record<string, string> = {
  "ALWAYS-UP": "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  WITNESS: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  MIRROR: "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]",
  PUBLISH: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ENFORCEMENT: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  RECOVERY: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  QA: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// ── כרטיס סוכן ──────────────────────────────────────────────────────

function AgentCard({
  agent,
  delay,
}: {
  agent: NonNullable<ReturnType<typeof useWeave>["registry"]["data"]>["agents"][number];
  delay: number;
}) {
  const life = stateLevel(agent.state, agent.lastRun?.at);
  const style = LIFE_STYLE[life];
  const success = agent.stats?.successRate;
  return (
    <Card
      className="group relative overflow-hidden transition-colors hover:border-emerald-500/30"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
              <span className="truncate font-mono text-sm font-bold">{agent.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {agent.repo}
              {agent.visibility === "public" ? " · ציבורי" : " · פרטי"}
            </span>
          </div>
          <Badge variant="outline" className={cn("shrink-0", LAYER_STYLE[agent.layer] ?? "")}>
            {agent.layer}
          </Badge>
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          {agent.role.he}
        </p>

        <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats ? `${Math.round(agent.stats.successRate)}%` : "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">הצלחה</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats?.runs_sampled ?? "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">ריצות שנדגמו</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats ? `${agent.stats.avgDurS.toFixed(0)}ש׳` : "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">משך ממוצע</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {ageLabel(agent.lastRun?.at)}
          </span>
          {agent.lastRun && (
            <span
              className={cn(
                "flex items-center gap-1",
                agent.lastRun.conclusion === "success"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {agent.lastRun.conclusion === "success" ? (
                <CircleCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <XCircle className="size-3.5" aria-hidden="true" />
              )}
              {agent.lastRun.conclusion === "success" ? "הצליח" : agent.lastRun.conclusion}
            </span>
          )}
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed">
          <span className="font-medium">קלט:</span> {agent.input.he}
          <br />
          <span className="font-medium">פלט:</span> {agent.output.he}
        </div>
      </CardContent>
    </Card>
  );
}

// ── מפעל האימות המקומי (R109) — הריבונות מהמכסה · R118: האמת חוזרת לגיט ─

interface VerifyJob {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  verdict: "PENDING" | "RUNNING" | "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
  lastRunAt: string | null;
  durationMs: number | null;
  checks: Record<string, unknown> | null;
  reason: string | null;
  outputTail: string[];
  nextDueAt: string;
  commit: string | null;
  runs: number;
  // R118 — חוק דחיפת פסק-הדין: מה חזר לגיט ומתי
  push?: { at: string; commit: string | null; verdict: string; detail: string } | null;
}

interface FleetVerifyDTO {
  ok: boolean;
  service?: string;
  version?: string;
  beats?: number;
  patAvailable?: boolean;
  current?: { id: string; startedAt: string } | null;
  lastDecision?: { at: string; kind: string; detail: string } | null;
  summary?: { total: number; pass: number; fail: number; pending: number };
  jobs?: VerifyJob[];
  error?: string;
}

// r140 — רישום-העל המאוחד: ארבע שכבות הצי, מדידה חיה לכל אחת
interface UnifiedFleetDTO {
  ok: boolean;
  at: string;
  layers: {
    daemons: { total: number; up: number; list: Array<{ name: string; port: number; up: boolean }> };
    identities: { total: number; active: number; error: string | null };
    cloud: { ok: boolean; total: number; live: number; degraded: number; dormant: number };
    verify: { total: number; pass: number; fresh: number; stale: number };
  };
  totals: { grand: number; byLayer: { daemons: number; identities: number; cloud: number; verifyJobs: number } };
  error?: string;
}

const VERIFY_VERDICT_STYLE: Record<string, { badge: string; label: string }> = {
  PASS: { badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "עבר" },
  FAIL: { badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300", label: "נכשל" },
  ERROR: { badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300", label: "שגיאה" },
  TIMEOUT: { badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "פסק-זמן" },
  RUNNING: { badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "רץ עכשיו" },
  PENDING: { badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300", label: "ממתין" },
};

function VerifyCard({ job, delay }: { job: VerifyJob; delay: number }) {
  const style = VERIFY_VERDICT_STYLE[job.verdict] ?? VERIFY_VERDICT_STYLE.PENDING;
  const checks = job.checks ? Object.entries(job.checks) : [];
  const pushed = job.push && (job.push.verdict === "PASS" || job.push.verdict === "FAIL");
  return (
    <Card
      className="group relative overflow-hidden transition-colors hover:border-emerald-500/30"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              {job.verdict === "RUNNING" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-emerald-500" aria-hidden="true" />
              ) : (
                // r140 — הנקודה נגזרת מפסק-הדין, לא ירוקה בכוח: כישלון נראה כישלון
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    job.verdict === "PASS"
                      ? "bg-emerald-500"
                      : job.verdict === "FAIL" || job.verdict === "ERROR" || job.verdict === "TIMEOUT"
                        ? "bg-rose-500"
                        : "bg-zinc-400",
                  )}
                  aria-hidden="true"
                />
              )}
              <span className="truncate font-mono text-sm font-bold">{job.id}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {job.repo}
              {job.commit ? ` @ ${job.commit}` : ""} · מקומי
            </span>
          </div>
          <Badge variant="outline" className={cn("shrink-0", style.badge)}>
            {job.verdict === "RUNNING" && <Loader2 className="ml-1 size-3 animate-spin" aria-hidden="true" />}
            {style.label}
          </Badge>
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">{job.roleHe}</p>

        {checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checks.slice(0, 5).map(([k, v]) => (
              <span
                key={k}
                className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                dir="ltr"
              >
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {job.lastRunAt ? ageLabel(job.lastRunAt) : "טרם רץ"}
          </span>
          <span className="tabular-nums">
            {job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}ש׳` : "-"} · {job.runs} ריצות
          </span>
        </div>

        {/* R118 — חוק דחיפת פסק-הדין: מה חזר לגיט */}
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
            pushed
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
          dir="auto"
        >
          <span className="flex items-center gap-1.5">
            {pushed ? <UploadCloud className="size-3.5 shrink-0" aria-hidden="true" /> : <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />}
            {pushed && job.push ? (
              <span className="truncate">
                נדחף לגיט · <span className="font-mono" dir="ltr">{job.push.commit ?? "—"}</span> · {ageLabel(job.push.at)}
              </span>
            ) : job.push ? (
              <span className="truncate">{job.push.detail}</span>
            ) : (
              <span>פסק-דין טרם נדחף לגיט (חוק R118 ממתין לריצה הבאה)</span>
            )}
          </span>
        </div>

        {job.reason && (
          <p className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed" dir="auto">
            {job.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── מערך הריפואים המלא (R118: השמשת הגיט) ──────────────────────

interface RepoEcosystem {
  name: string;
  roleHe: string;
  kind: "verified" | "live";
  cloud: {
    ok: boolean;
    pushedAt: string | null;
    ageMinutes: number | null;
    sizeKb: number | null;
    lastCommit: { sha: string; message: string; author: string; date: string } | null;
    error?: string;
  };
  factory: {
    covered: boolean;
    jobId: string | null;
    verdict: string | null;
    lastRunAt: string | null;
    push: { at: string; commit: string | null; verdict: string; detail: string } | null;
  };
}

interface ReposEcosystemDTO {
  ok: boolean;
  org?: string;
  generatedAt?: string;
  summary?: { total: number; covered: number; pushedByFactory: number; frozenOver24h: number; patAvailable: boolean };
  repos?: RepoEcosystem[];
  error?: string;
}

function repoAgeLabel(min: number | null): string {
  if (min == null) return "לא נמדד";
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

function repoLifeLevel(min: number | null): "live" | "ok" | "frozen" {
  if (min == null) return "frozen";
  if (min < 120) return "live";
  if (min < 24 * 60) return "ok";
  return "frozen";
}

const REPO_LIFE_STYLE: Record<ReturnType<typeof repoLifeLevel>, { dot: string; label: string; text: string }> = {
  live: { dot: "bg-emerald-500", label: "חי", text: "text-emerald-600 dark:text-emerald-400" },
  ok: { dot: "bg-emerald-400", label: "פעיל", text: "text-emerald-600 dark:text-emerald-400" },
  frozen: { dot: "bg-rose-500", label: "קפוא", text: "text-rose-600 dark:text-rose-400" },
};

function RepoCard({ repo, delay }: { repo: RepoEcosystem; delay: number }) {
  const life = repoLifeLevel(repo.cloud.ageMinutes);
  const style = REPO_LIFE_STYLE[life];
  const pushed = repo.factory.push && (repo.factory.push.verdict === "PASS" || repo.factory.push.verdict === "FAIL");
  return (
    <Card
      className="group relative overflow-hidden transition-colors hover:border-emerald-500/30"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
              <span className="truncate font-mono text-sm font-bold">{repo.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">{repo.roleHe}</span>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0",
              repo.kind === "live" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : style.text,
            )}
          >
            {repo.kind === "live" ? "בית · ענן" : style.label}
          </Badge>
        </div>

        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed">
          {repo.cloud.lastCommit ? (
            <>
              <span className="flex items-center gap-1.5" dir="ltr">
                <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                <span className="font-mono">{repo.cloud.lastCommit.sha}</span>
                <span className="text-muted-foreground">{repo.cloud.lastCommit.author}</span>
              </span>
              <span className="truncate text-muted-foreground" dir="auto" title={repo.cloud.lastCommit.message}>
                {repo.cloud.lastCommit.message}
              </span>
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-400" dir="auto">
              {repo.cloud.error ?? "הענן לא נענה"}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5" aria-hidden="true" />
            עדכון אחרון: {repoAgeLabel(repo.cloud.ageMinutes)}
          </span>
          <span className="flex items-center gap-1.5" dir="ltr">
            {repo.cloud.sizeKb != null ? `${(repo.cloud.sizeKb / 1024).toFixed(1)}MB` : "—"}
          </span>
        </div>

        {repo.kind === "verified" && (
          <div
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
              pushed
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                : repo.factory.covered
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                  : "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
            )}
            dir="auto"
          >
            {pushed ? (
              <span className="flex items-center gap-1.5">
                <UploadCloud className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{repo.factory.jobId} · {repo.factory.push?.verdict} · נדחף {ageLabel(repo.factory.push!.at)}</span>
              </span>
            ) : repo.factory.covered ? (
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{repo.factory.jobId} · מכוסה · טרם נדחף (ממתין לריצה)</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>אין מאמת — מחוץ לכיסוי המפעל</span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── העמוד ───────────────────────────────────────────────────────────

export function AgentsFleetView() {
  const { registry, loadRegistry } = useWeave();
  const [tick, setTick] = useState(0);
  const [verify, setVerify] = useState<FleetVerifyDTO | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [repos, setRepos] = useState<ReposEcosystemDTO | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [unified, setUnified] = useState<UnifiedFleetDTO | null>(null);

  const loadUnified = () => {
    fetch("/api/fleet", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: UnifiedFleetDTO) => setUnified(d))
      .catch(() => setUnified({ ok: false } as UnifiedFleetDTO));
  };

  const loadVerify = () => {
    setVerifyLoading(true);
    fetch("/api/fleet-verify", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: FleetVerifyDTO) => setVerify(d))
      .catch(() => setVerify({ ok: false, error: "המפעל לא ענה" }))
      .finally(() => setVerifyLoading(false));
  };

  const loadRepos = () => {
    setReposLoading(true);
    fetch("/api/weave/repos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ReposEcosystemDTO) => setRepos(d))
      .catch(() => setRepos({ ok: false, error: "מערך הריפואים לא נענה" }))
      .finally(() => setReposLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(loadUnified, 100);
    const iv = setInterval(loadUnified, 90_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(loadVerify, 0);
    const iv = setInterval(loadVerify, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(loadRepos, 400);
    const iv = setInterval(loadRepos, 120_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  // רענון גילאים כל דקה - בלי לרדוף אחרי הענן
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  void tick;

  const data = registry.data;

  // r140 — כנות-טריות: "10/10 עברו" על פסקי-דין בני יומיים-שלושה הוא
  // סימון שקרי. אם יש פסק-דין שגילו מעבר ל-26 שע׳ — התג נצבע ענבר ואומר זאת.
  const verifySummaryStale = useMemo(() => {
    const jobs = verify?.jobs ?? [];
    if (jobs.length === 0) return false;
    const cut = Date.now() - 26 * 3_600_000;
    return jobs.some((j) => !j.lastRunAt || Date.parse(j.lastRunAt) < cut);
  }, [verify]);
  const loading = registry.loading && !data;

  const summary = useMemo(() => {
    if (!data) return null;
    const agents = data.agents;
    // R117 — חוק ההגדרה-היחידה: "חי" הוא שדה ה-state הרשמי של הרישום
    // (agents-watch כותב אותו מדי שעה ממדידת GitHub Actions). בעבר חישבנו
    // כאן הגדרה מקומית (lastRun<7ש') שסתרה את עמוד המערך (8 מול 10) —
    // שתי דעות על אותה עובדה. מעתה: מקור אחד, הגדרה אחת, מוצגת בגלוי.
    const live = agents.filter((a) => a.state === "live").length;
    const slow = agents.filter((a) => a.state === "degraded").length;
    const dead = agents.filter((a) => a.state === "dormant").length;
    const avg =
      agents.filter((a) => a.stats).reduce((s, a) => s + (a.stats?.successRate ?? 0), 0) /
      Math.max(1, agents.filter((a) => a.stats).length);
    return { total: agents.length, live, slow, dead, avg };
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="relative isolate mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageWash className="-inset-x-4 -inset-y-3 rounded-2xl" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Users className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            הצי החי
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            הסוכנים האוטונומיים שמפעילים את הרשת — חלוקת-אמת: זרימות-הענן
            (לב, עוגנים, גריד) רצות ב-GitHub Actions של הארגון; צי הדיבונים
            (דופק · מוביל · צייד · שומר · תלמיד · מאמתים · מעלה) פועל בבית
            הריבוני. הרישום מתעדכן שעתית על-ידי agents-watch מה-API של גיטהאב.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => loadRegistry()}
          disabled={registry.loading}
        >
          <RefreshCw className={cn("size-4", registry.loading && "animate-spin")} aria-hidden="true" />
          רענן
        </Button>
      </div>

      {/* סיכום */}
      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Activity className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {summary.live}/{summary.total}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  חיים (state=live ברישום הרשמי)
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Clock3 className="size-5 text-amber-500" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{summary.slow}</div>
                <div className="mt-1 text-xs text-muted-foreground">מזדקנים</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="size-5 text-rose-500" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{summary.dead}</div>
                <div className="mt-1 text-xs text-muted-foreground">דורמים</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {Math.round(summary.avg)}%
                </div>
                <div className="mt-1 text-xs text-muted-foreground">הצלחה משוקללת</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
      )}

      {/* r140 — רישום-העל המאוחד: ארבע שכבות הצי במדידה חיה, הגדרה בגלוי */}
      {unified?.ok ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="ארבע שכבות הצי">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Cpu
                className={cn(
                  "size-5",
                  unified.layers.daemons.up === unified.layers.daemons.total
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-500",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {unified.layers.daemons.up}/{unified.layers.daemons.total}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">דיבוני-הבית חיים עכשיו</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Users className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {unified.layers.identities.error ? "—" : unified.layers.identities.total}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">זהויות-ספר (EVM)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Globe
                className={cn(
                  "size-5",
                  unified.layers.cloud.ok && unified.layers.cloud.dormant === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-500",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {unified.layers.cloud.ok ? `${unified.layers.cloud.live}/${unified.layers.cloud.total}` : "—"}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  זרימות-ענן חיות (מתוכן {unified.layers.cloud.degraded} מדורדות · {unified.layers.cloud.dormant} דורמות)
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ShieldCheck
                className={cn(
                  "size-5",
                  unified.layers.verify.stale === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-500",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {unified.layers.verify.total ? `${unified.layers.verify.fresh}/${unified.layers.verify.total}` : "—"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">מאמתי-המפעל · פסק-דין טרי (26ש׳)</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
      )}

      {/* מפעל האימות המקומי — הריבונות מהמכסה (R109) · חוק דחיפת פסק-הדין (R118) */}
      <section className="mb-8" aria-label="מפעל האימות המקומי">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Cpu className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              מפעל האימות המקומי
              <Badge
                variant="outline"
                className={cn(
                  verifySummaryStale
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                )}
              >
                {verify?.summary
                  ? verifySummaryStale
                    ? `${verify.summary.pass}/${verify.summary.total} עברו · פסק-דין ישן — טרם נמדד טרי`
                    : `${verify.summary.pass}/${verify.summary.total} עברו`
                  : "טוען"}
              </Badge>
              {verify?.jobs?.some((j) => j.push && (j.push.verdict === "PASS" || j.push.verdict === "FAIL")) && (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <UploadCloud className="ml-1 size-3" aria-hidden="true" />
                  פסקי-דין חוזרים לגיט
                </Badge>
              )}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              עשרת סוכני-האימות של הרשת מתו עם מכסת ה-Actions של הארגון (R109) — הריבונות: אותן בדיקות
              בדיוק, רצות כאן, בבית. עד R118 האמת נשארה כלואה בקובץ מקומי והריפואים בגיט קפאו למשך
              שבוע. חוק דחיפת פסק-הדין: כל פסק-דין — PASS או FAIL כאחד — חוזר לגיט בזהות
              <span className="font-mono" dir="ltr"> &lt;job&gt;[bot]</span> מיד לאחר הבדיקה, באותו חוק שהענן כתב בעצמו.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {verify?.lastDecision && (
              <span className="hidden max-w-xs truncate text-[11px] text-muted-foreground sm:inline" dir="auto">
                {verify.lastDecision.detail}
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={loadVerify} disabled={verifyLoading}>
              <RefreshCw className={cn("size-4", verifyLoading && "animate-spin")} aria-hidden="true" />
              רענן מפעל
            </Button>
          </div>
        </div>

        {verify?.ok ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(verify.jobs ?? []).map((job, i) => (
              <VerifyCard key={job.id} job={job} delay={i * 50} />
            ))}
          </div>
        ) : verify ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <ShieldCheck className="size-7 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground" dir="auto">
                {verify.error ?? "המפעל לא כתב עדיין את קובץ-האמת — הדיבון עולה או ממתין לסמכות."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        )}
      </section>

      {/* הכרטיסים */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} delay={i * 60} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {registry.error ?? "הרישום לא נטען - הענן לא נענה."}
            </p>
            <Button variant="outline" size="sm" onClick={() => loadRegistry()}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      )}

      {/* מערך הריפואים המלא — השמשת הגיט (R118) */}
      <section className="mt-8" aria-label="מערך הריפואים של הארגון">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <GitBranch className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              מערך הריפואים — הארגון המלא
              {repos?.summary && (
                <Badge
                  variant="outline"
                  className={cn(
                    repos.summary.frozenOver24h === 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {repos.summary.frozenOver24h === 0
                    ? `${repos.summary.total} ריפואים · אפס קפואים`
                    : `${repos.summary.frozenOver24h} קפואים מעל יום`}
                </Badge>
              )}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              אמת חיה מ-GitHub על כל ריפו בארגון — קומיט אחרון, גיל וזהות כותב — ממוזגת עם כיסוי המפעל
              וחוק דחיפת פסק-הדין. שלושת שערי-הענן (הבית, הקונסולה והדומיין) מוזנים ישירות מהמערכת;
              עשרת השאר — על-ידי המאמתים שמחזירים את האמת לגיט מדי יום.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {repos?.generatedAt && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline" dir="auto">
                נמדד {ageLabel(repos.generatedAt)}
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={loadRepos} disabled={reposLoading}>
              <RefreshCw className={cn("size-4", reposLoading && "animate-spin")} aria-hidden="true" />
              רענן מערך
            </Button>
          </div>
        </div>

        {repos?.ok && repos.repos ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {repos.repos.map((repo, i) => (
              <RepoCard key={repo.name} repo={repo} delay={i * 40} />
            ))}
          </div>
        ) : repos ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <ShieldCheck className="size-7 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground" dir="auto">
                {repos.error ?? "מערך הריפואים לא נקרא — אין סמכות או שהענן לא ענה."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
