"use client";

// ─────────────────────────────────────────────────────────────────────
// SOVEREIGNTY CARDS · שני כרטיסים חיים בבית הרשת (D-017/D-018).
//
// 1) החלטת הריבונות — הקנון העומד, חי מהגיט, עם טביעת-אצבע של המסמך.
// 2) מבדק התייעלות — המערך האוטונומי נספר 24/7: חיות-צי, ריצות-שרשראות,
//    חלק-הפעלה-עצמי (דבר גורר דבר נמדד), פעימות-שומרים, הכנסה-נמדדת.
//
// חוק התצוגה: מדידה שלא ענתה מוצגת כ"לא נמדד" — לעולם לא כהצלחה
// שנטענת. אפס מקפים בתוכן (חוק-הטון D-013).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Gavel, NotebookText, ScrollText, ShieldCheck, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { scrollBoxClass } from "@/components/weave/shared";

interface Decision {
  id: string;
  date: string;
  titleHe: string;
  status: string;
}

interface DecisionsState {
  ok: boolean;
  count: number;
  byStatus: Record<string, number>;
  updatedAt: string | null;
  docHash: string | null;
  errorHe: string | null;
  decisions: Decision[];
}

interface EfficiencyState {
  verdict: { level: string; he: string };
  server: { uptimeSec: number };
  fleet: {
    alive: number;
    total: number;
    aliveShare: number | null;
    source: string;
    daemons: Array<{ name: string; state: string; beats: number | null }>;
    keeper: { beats: number | null; lastDecision: { detail: string } | null };
  };
  chains24h: {
    total: number;
    ok: number;
    failed: number;
    autonomousShare: number | null;
    lastRun: { chain: string; step: string; firedBy: string; ok: boolean; at: string } | null;
  };
  pulse: { state: { beats: number; lastPublishUtcDay: string | null } | null };
  guardians: { fleetGuard: { cycles: number; lastCycleAt: string | null; revives24h: number } | null };
  book: { attestations: number; checkpoints: number };
  income: { lastDay: string | null; usdToday: number | null; honestyHe: string };
}

function statusBadge(status: string) {
  if (status === "ACTIVE")
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        תקף
      </Badge>
    );
  if (status === "OPEN-OPERATOR")
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        להחלטת מפעיל
      </Badge>
    );
  return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
}

function useLiveJson<T>(url: string, intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) setData((await r.json()) as T);
    } catch {
      // המדידה הקודמת נשארת על המסך; אין מדידה חדשה = אין שינוי תצוגה
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, loading };
}

// ── כרטיס 1: החלטת הריבונות ─────────────────────────────────────────

export function SovereigntyDecisionsCard() {
  const { data, loading } = useLiveJson<DecisionsState>("/api/sovereignty/decisions");
  const reduced = useReducedMotion();
  const latest = data?.decisions.slice(-4).reverse() ?? [];

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Gavel className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            החלטת הריבונות
          </div>
          {loading ? (
            <Skeleton className="h-5 w-16" />
          ) : data?.ok ? (
            <Badge variant="outline" className="font-mono" dir="ltr">
              {data.count} החלטות
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-300">לא נמדד</Badge>
          )}
        </div>

        {data?.docHash && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            SOVEREIGNTY-DECISIONS.md · sha256 {data.docHash.slice(0, 16)}…
          </p>
        )}
        {data?.errorHe && (
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-300" dir="auto">
            {data.errorHe}
          </p>
        )}

        <div className="grid gap-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : latest.length > 0 ? (
            latest.map((d) => (
              <div key={d.id} className="flex items-start gap-3 rounded-lg border bg-card/60 p-3">
                <span className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                  {d.id}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90" dir="auto">
                  {d.titleHe}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{d.date}</span>
                </span>
                {statusBadge(d.status)}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">אין החלטות נמדדות כרגע.</p>
          )}
        </div>

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          הקנון חי בגיט: החלטות חדשות נוספות בסוף בלבד, שום החלטה לא נערכת לאחור, והחלטה שנפסלת מסומנת בכנות.
        </p>
      </Card>
    </motion.div>
  );
}

// ── כרטיס 2: מבדק התייעלות המערך ────────────────────────────────────

function EffTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card/60 p-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" dir="auto">
        {label}
      </span>
      <span className="text-lg font-bold tabular-nums leading-none" dir="ltr">
        {value}
      </span>
      {sub && (
        <span className="text-[10px] leading-snug text-muted-foreground" dir="auto">
          {sub}
        </span>
      )}
    </div>
  );
}

export function ArrayEfficiencyCard() {
  const { data, loading } = useLiveJson<EfficiencyState>("/api/sovereignty/efficiency");
  const reduced = useReducedMotion();

  const v = data?.verdict?.level;
  const verdictBadge =
    v === "GREEN" ? (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="size-3" aria-hidden="true" /> ירוק
      </Badge>
    ) : v === "AMBER" ? (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        ענבר
      </Badge>
    ) : v ? (
      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">
        אדום
      </Badge>
    ) : (
      <Skeleton className="h-5 w-16" />
    );

  const pct = (x: number | null | undefined) =>
    x == null ? "לא נמדד" : `${Math.round(x * 100)}%`;

  const uptime = data?.server?.uptimeSec;
  const uptimeStr =
    uptime == null
      ? "…"
      : uptime < 3600
        ? `${Math.round(uptime / 60)} דק'`
        : `${Math.floor(uptime / 3600)}ש' ${Math.round((uptime % 3600) / 60)}דק'`;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Activity className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            תייעלות המערך 24/7
          </div>
          {verdictBadge}
        </div>

        {data?.verdict?.he && (
          <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
            {data.verdict.he}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <EffTile
            label="צי חי"
            value={data ? `${data.fleet.alive}/${data.fleet.total}` : "…"}
            sub={data?.fleet?.source}
          />
          <EffTile
            label="ריצות שרשרת 24ש'"
            value={data ? `${data.chains24h.total}` : "…"}
            sub={data ? `${data.chains24h.ok} תקינות · ${data.chains24h.failed} כישלונות` : undefined}
          />
          <EffTile
            label="הפעלה עצמית"
            value={data ? pct(data.chains24h.autonomousShare) : "…"}
            sub="דבר גורר דבר: חלק הריצות שהציתו את עצמן"
          />
          <EffTile
            label="פעימות שומר"
            value={data?.fleet?.keeper?.beats != null ? String(data.fleet.keeper.beats) : "…"}
            sub="סיור keeper כל 30ש'"
          />
          <EffTile
            label="סיורי שרת"
            value={data?.guardians?.fleetGuard ? String(data.guardians.fleetGuard.cycles) : "לא נמדד"}
            sub="fleet-guard כל 60ש' · החייאות 24ש'"
          />
          <EffTile
            label="הכנסה נמדדת"
            value={data?.income?.usdToday != null ? `$${data.income.usdToday.toFixed(4)}` : "לא נמדד"}
            sub={data?.income?.lastDay ? `יום ${data.income.lastDay}` : data?.income?.honestyHe}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(data?.fleet?.daemons ?? []).map((d) => (
            <span
              key={d.name}
              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              dir="ltr"
              title={`${d.name}: ${d.state}`}
            >
              <span
                className={`inline-block size-1.5 rounded-full ${
                  d.state === "UP" ? "bg-emerald-500" : d.state === "BUSY" ? "bg-amber-500" : "bg-red-500"
                }`}
                aria-hidden="true"
              />
              {d.name}
            </span>
          ))}
          {!data && loading && <Skeleton className="h-5 w-40" />}
        </div>

        {data?.chains24h?.lastRun && (
          <p className="mt-auto font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            last: {data.chains24h.lastRun.chain}/{data.chains24h.lastRun.step} by {data.chains24h.lastRun.firedBy}{" "}
            {data.chains24h.lastRun.ok ? "ok" : "fail"}
          </p>
        )}
        {uptime && (
          <p className="text-[11px] text-muted-foreground" dir="auto">
            זמן-ריצת שרת: {uptimeStr} · הספר: {data?.book?.attestations ?? "…"} אימותים ·{" "}
            {data?.book?.checkpoints ?? "…"} צ'קפוינטים
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          <ScrollText className="mr-1 inline size-3" aria-hidden="true" />
          כל מספר נמדד כרגע ממקורות-אמת: keeper, הדופק, ChainRun והספר. מדידה שלא ענתה מוצגת כלא-נמדדת, לעולם לא כהצלחה.
        </p>
      </Card>
    </motion.div>
  );
}

// ── כרטיס 3: מרשם-האוטונומיה (D-022 · r134) ─────────────────────────

interface AutonomyCapability {
  id: string;
  titleHe: string;
  mode: "AUTONOMOUS" | "OPERATOR-GATED";
  evidenceHe: string;
  cadenceHe?: string;
  unblockHe?: string;
  gateRef?: string;
}

interface AutonomyDomain {
  id: string;
  titleHe: string;
  capabilities: AutonomyCapability[];
}

interface AutonomyState {
  ok: boolean;
  at: string;
  format: string;
  verdict: {
    total: number;
    autonomous: number;
    operatorGated: number;
    share: number | null;
    operationBlocked?: boolean;
    growthGates?: number;
    he: string;
  };
  domains: AutonomyDomain[];
  dominos24h: Array<{ at: string; chain: string; step: string; firedBy: string; ok: boolean; detail: string }>;
  honestyHe: string;
  errorHe: string | null;
}

function modeDot(mode: string) {
  return (
    <span
      className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${
        mode === "AUTONOMOUS" ? "bg-emerald-500" : "bg-amber-500"
      }`}
      aria-hidden="true"
      title={mode}
    />
  );
}

function CapRow({ c }: { c: AutonomyCapability }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-card/60 p-3">
      {modeDot(c.mode)}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug text-foreground/90" dir="auto">
          {c.titleHe}
          {c.gateRef && (
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
              [{c.gateRef}]
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          {c.evidenceHe}
        </p>
        {c.mode === "OPERATOR-GATED" && c.unblockHe && (
          <p className="mt-1 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300" dir="auto">
            {c.unblockHe}
          </p>
        )}
      </div>
    </div>
  );
}

export function AutonomyLedgerCard() {
  const { data, loading } = useLiveJson<AutonomyState>("/api/sovereignty/autonomy");
  const reduced = useReducedMotion();

  const v = data?.verdict;
  const pct = v?.share == null ? null : Math.round(v.share * 100);
  const shareBadge = pct == null ? (
    <Skeleton className="h-5 w-16" />
  ) : (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 font-mono text-emerald-700 dark:text-emerald-300" dir="ltr">
      {pct}% autonomous
    </Badge>
  );

  const fleetDomains = data?.domains.filter((d) => d.id !== "operator") ?? [];
  const operatorDomain = data?.domains.find((d) => d.id === "operator");
  const dominos = data?.dominos24h ?? [];

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0 lg:col-span-2"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Waypoints className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            מרשם-האוטונומיה
          </div>
          {shareBadge}
        </div>

        {v?.he && (
          <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
            {v.he}
          </p>
        )}
        {data?.errorHe && (
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-300" dir="auto">
            {data.errorHe}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <EffTile label="יכולות במרשם" value={v ? String(v.total) : "…"} sub="כל יכולת נרשמת — אף אחת לא מוסתרת" />
          <EffTile label="אוטונומיות" value={v ? String(v.autonomous) : "…"} sub="רצות קצה-אל-קצה בלי אדם" />
          <EffTile label="שערי-החזקה וצמיחה" value={v ? String(v.operatorGated) : "…"} sub="מפתחות והון — לא חוסמים הפעלה" />
          <EffTile label="דומינוס 24ש'" value={data ? String(dominos.length) : "…"} sub="שרשראות שהציתו את עצמן" />
        </div>

        {v?.operationBlocked === false && (
          <p className="flex items-start gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300" dir="auto">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            אפס תלות-הפעלה: המערכת מחוברת קבוע ופועלת 7/24 בלי לחיצה שלך. השערים הנותרים הם החלטות-צמיחה בידיים שלך — לא מנעולים בצינור.
          </p>
        )}

        <div className={`grid gap-4 md:grid-cols-2 ${scrollBoxClass}`}>
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          {fleetDomains.map((d) => (
            <div key={d.id} className="flex flex-col gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground" dir="auto">
                {d.titleHe}
              </p>
              <div className="flex flex-col gap-1.5">
                {d.capabilities.map((c) => (
                  <CapRow key={c.id} c={c} />
                ))}
              </div>
            </div>
          ))}
          {operatorDomain && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-300" dir="auto">
                {operatorDomain.titleHe}
              </p>
              <div className="flex flex-col gap-1.5">
                {operatorDomain.capabilities.map((c) => (
                  <CapRow key={c.id} c={c} />
                ))}
              </div>
            </div>
          )}
        </div>

        {dominos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground" dir="auto">
              דבר גורר דבר — ההצתות העצמיות האחרונות
            </p>
            <div className={`${scrollBoxClass} rounded-lg border bg-card/60 p-3`}>
              <ul className="flex flex-col gap-1 font-mono text-[10px] leading-relaxed text-muted-foreground" dir="ltr">
                {dominos.map((d, i) => (
                  <li key={`${d.at}-${d.chain}-${i}`}>
                    {d.at.slice(11, 16)}Z {d.chain}/{d.step} ← {d.firedBy} {d.ok ? "ok" : "FAIL"}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          <ScrollText className="mr-1 inline size-3" aria-hidden="true" />
          {data?.honestyHe ?? "מרשם שלא נמדד מוצג כלא-נמדד — לעולם לא כהצלחה שנטענת."}
        </p>
      </Card>
    </motion.div>
  );
}

// ── כרטיס 4: דוח-הערוצים החוצה (r135 · D-023) ──────────────────────
// הלקח החי של 2026-09-29: הרשת רצה ומדידה, אבל ערוצי-החוצה נחסמו
// אחד-אחר-השני והמפעיל ראה שתיקה בלי הסבר. החוק החדש: ערוץ חסום
// מדווח על עצמו — מצב, ראיה, ונתיב-השחרור. אף ערוץ לא שותק בשקט שוב.

interface Lane {
  id: string;
  titleHe: string;
  state: "OPEN" | "GATED" | "STALE" | "UNMEASURED";
  lastGoodAt: string | null;
  evidenceHe: string;
  unlockHe: string;
}

interface LanesState {
  ok: boolean;
  verdict: "OK" | "SOFT-MUTE" | "MUTE";
  verdictHe: string;
  lanes: Lane[];
}

function laneDot(state: Lane["state"]) {
  if (state === "OPEN") return "bg-emerald-500";
  if (state === "UNMEASURED") return "bg-slate-400";
  return "bg-amber-500";
}

export function LanesCard() {
  const { data, loading } = useLiveJson<LanesState>("/api/sovereignty/lanes");
  const reduced = useReducedMotion();

  const verdictBadge = loading ? (
    <Skeleton className="h-5 w-20" />
  ) : data?.verdict === "OK" ? (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 font-mono text-emerald-700 dark:text-emerald-300" dir="ltr">
      all lanes open
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 font-mono text-amber-700 dark:text-amber-300" dir="ltr">
      {data?.verdict.toLowerCase() ?? "…"}
    </Badge>
  );

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Activity className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            דוח-הערוצים החוצה
          </div>
          {verdictBadge}
        </div>

        {data?.verdictHe && (
          <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
            {data.verdictHe}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {loading &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          {data?.lanes.map((l) => (
            <div key={l.id} className="rounded-lg border bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${laneDot(l.state)}`} aria-hidden="true" />
                <span className="text-xs font-bold" dir="auto">
                  {l.titleHe}
                </span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground" dir="ltr">
                  {l.state}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                {l.evidenceHe}
              </p>
              {l.state !== "OPEN" && l.state !== "UNMEASURED" && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-300" dir="auto">
                  נתיב-שחרור: {l.unlockHe}
                </p>
              )}
            </div>
          ))}
        </div>

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          <ShieldCheck className="mr-1 inline size-3" aria-hidden="true" />
          D-023 — ערוץ חסום מדווח על עצמו: מצב, ראיה, נתיב-שחרור. אף ערוץ לא שותק בשקט שוב.
        </p>
      </Card>
    </motion.div>
  );
}

// ── כרטיס 5: בריפינג-ריבוני (r189 · חיווט-היתום /api/sovereignty/briefing) ──
// עצרת-מדידה אחת חיה: התקדמות-24ש׳, ניסויים, כסף, אפשרויות-רווח ושאילתות —
// כל ערך נושא מקור, ומה שלא נמדד נכתב כלא-נמדד (חוק-הטון D-013).

interface BriefingState {
  ok: boolean;
  at: string;
  format: string;
  honestyHe: string;
  progress24h: {
    attestations: number;
    chainRuns: Array<{ step: string; ok: boolean; firedBy: string; at: string }>;
    chainRunCount: number;
    lastCheckpoint: { index: number; createdAt: string; anchorStatus: string } | null;
  };
  experiments: {
    grid: {
      verdict: string;
      armed: boolean;
      publishedAt: string;
      inventory: { steem: number; sbd: number } | null;
      marks: { steemUsd: number; sbdUsd: number; paritySbdPerSteem: number } | null;
    } | null;
    fleet: { noteHe: string };
  };
  money: {
    fills7d: number;
    bought7d: { steem: number; sbd: number };
    sold7d: { steem: number; sbd: number };
    lastFill: { idx: number; at: string; side: string; price: number; steem: number; sbd: number; maker: boolean } | null;
    pnlScanAt: string | null;
  };
  profitOptions: Array<{ titleHe: string; basisHe: string; source: string; state: string }>;
  queries: { attestationTotal: number; agentTotal: number; lastCheckpointIndex: number | null; bookHeadHe: string };
  anchor: { at: string | null; mode: string | null; checkpoint: number | null } | null;
}

function profitStateBadge(state: string) {
  if (state === "חי")
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        {state}
      </Badge>
    );
  if (state === "נמדד")
    return <Badge variant="outline" className="text-foreground/80">{state}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{state}</Badge>;
}

export function SovereignBriefingCard() {
  const { data, loading } = useLiveJson<BriefingState>("/api/sovereignty/briefing");
  const reduced = useReducedMotion();

  const p = data?.progress24h;
  const m = data?.money;
  const grid = data?.experiments?.grid ?? null;
  const options = data?.profitOptions ?? [];
  const lastRun = p?.chainRuns?.[0] ?? null;
  const lastFill = m?.lastFill ?? null;

  const gridBadge = loading ? (
    <Skeleton className="h-5 w-24" />
  ) : grid?.verdict ? (
    <Badge variant="outline" className="font-mono" dir="ltr">
      {grid.verdict}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-amber-600 dark:text-amber-300">לא נמדד</Badge>
  );

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-w-0"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <NotebookText className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            בריפינג-ריבוני
          </div>
          {gridBadge}
        </div>

        {data?.at && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            briefing-v1 · {data.at.slice(11, 16)}Z
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <EffTile
            label="אימותים 24ש'"
            value={p ? String(p.attestations) : "…"}
            sub={data ? `סה\"כ בספר: ${data.queries.attestationTotal}` : undefined}
          />
          <EffTile
            label="ריצות שרשרת 24ש'"
            value={p ? String(p.chainRunCount) : "…"}
            sub={lastRun ? `אחרונה: ${lastRun.step} ← ${lastRun.firedBy}` : "אין ריצות נמדדות"}
          />
          <EffTile
            label="מילויים 7 ימים"
            value={m ? String(m.fills7d) : "…"}
            sub={m ? `נקנה ${m.bought7d.steem.toFixed(1)} · נמכר ${m.sold7d.steem.toFixed(1)} STEEM` : undefined}
          />
          <EffTile
            label="ראש-הספר"
            value={data ? data.queries.bookHeadHe : "…"}
            sub={
              data?.anchor?.mode
                ? `עיגון אחרון: ${data.anchor.mode}${data.anchor.checkpoint != null ? ` · cp#${data.anchor.checkpoint}` : ""}`
                : "עיגון לא נמדד"
            }
          />
        </div>

        {options.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground" dir="auto">
              אפשרויות-רווח — רק מה שנמדד
            </p>
            <div className={`${scrollBoxClass} max-h-60 rounded-lg border bg-card/60 p-3`}>
              <ul className="flex flex-col gap-2">
                {options.map((o, i) => (
                  <li key={`${o.titleHe}-${i}`} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium leading-snug text-foreground/90" dir="auto">
                        {o.titleHe}
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                        {o.basisHe}
                        <span className="mr-1.5 font-mono text-[10px]" dir="ltr">
                          [{o.source}]
                        </span>
                      </p>
                    </div>
                    {profitStateBadge(o.state)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {lastFill && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            last fill: {lastFill.side} {lastFill.steem} STEEM @ {lastFill.price} {lastFill.maker ? "maker" : "taker"}
          </p>
        )}

        {!data && !loading && (
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-300" dir="auto">
            הבריפינג לא נמדד כרגע — מקור-המדידה לא ענה.
          </p>
        )}

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          <ScrollText className="mr-1 inline size-3" aria-hidden="true" />
          {data?.honestyHe ?? "עצרת-מדידה שלא ענתה מוצגת כלא-נמדדת — לעולם לא כהצלחה שנטענת."}
        </p>
      </Card>
    </motion.div>
  );
}
