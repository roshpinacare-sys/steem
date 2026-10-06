// ─────────────────────────────────────────────────────────────────────
// /api/student — התלמיד (R94 · האוטונומיה המתפתחת).
//
// העדה הכנה של האפליקציה לדיבון התלמיד (mini-services/student · פורט
// 3037): קריאת מצבו מ-localhost — צד-שרת בלבד, הדפדפן לא נוגע בפורט.
// המצב כולל: תוצאות בחינה-עצמית, מפת-כיסוי הריפואים, למידה מה-worklog,
// ספר-פוטנציאל וקבלות ריפוי.
//
// דוקטרינה: דיבון שלא ענה תוך 2.5 שניות מדווח כלא-נמדד — בכנות
// מלאה, בלי המצאת מצב.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

const STUDENT_URL = process.env.STUDENT_URL || "http://localhost:3037";

interface StudentStatus {
  ok: boolean;
  service: string;
  version: string;
  alive: boolean;
  bootedAt: string;
  beats: number;
  cycleSec: number;
  examining: boolean;
  lastExamAt: string | null;
  probes: Array<{ probe: string; ok: boolean; ms: number | null; at: string }>;
  probeHistory: Array<{ probe: string; ok: boolean; ms: number | null; at: string }>;
  recurring: Array<{ probe: string; since: string; count: number; resolvedAt: string | null }>;
  coverage: Array<{
    repo: string;
    role: string;
    pushedAt: string | null;
    pushAgeH: number | null;
    workflows: number | null;
    lastRun: { name: string; conclusion: string | null; createdAt: string | null } | null;
    verdict: "AGENTED" | "STALE" | "IDLE" | "UNKNOWN";
  }>;
  coverageAt: string | null;
  findings: Array<{
    id: string;
    title: string;
    detail: string;
    state: string;
    addedAt: string;
    updatedAt: string;
    source: string;
    verify?: { at: string; claim: string; verdict: string; evidence: string };
  }>;
  lessons: {
    rounds: number;
    liveBugsCaught: number;
    fixedMentions: number;
    honestyMentions: number;
    parsedAt: string;
    note: string[];
  } | null;
  economics: {
    at: string;
    fillsTotal: number;
    roundTrips: number;
    capturedSbd: number;
    openLongSteem: number;
    regime: string;
    midVsParityBps: number | null;
    ladderVsMidBps: number | null;
    deployedSteem: number | null;
    sbdBalance: number | null;
  } | null;
  economicsHistory: Array<{ at: string; kind: string; detail: string }>;
  heal: { receipts: Array<{ at: string; action: string; ok: boolean; detail: string }>; today: number; day: string };
  history: Array<{ at: string; kind: string; detail: string }>;
  uptimePct: number | null;
}

async function fetchStudent(): Promise<StudentStatus | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(`${STUDENT_URL}/`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as StudentStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function composeState() {
  const daemon = await fetchStudent();
  const coverage = daemon?.coverage ?? [];
  const agented = coverage.filter((c) => c.verdict === "AGENTED").length;
  const idle = coverage.filter((c) => c.verdict === "IDLE").length;
  const stale = coverage.filter((c) => c.verdict === "STALE").length;
  return {
    ok: true,
    at: new Date().toISOString(),
    daemon, // null = לא נמדד, בכנות
    daemonDown: daemon == null,
    daemonDownHe:
      daemon == null
        ? "התלמיד לא נמדד בסנדבוקס הזה — השירות (mini-services/student · פורט 3037) אינו זמין כרגע. זו מדידה, לא כישלון מוסתר: מה שהדיבון למד חי בקובץ המצב שלו ובקנון."
        : null,
    summary: {
      coverage: coverage.length ? { repos: coverage.length, agented, idle, stale, at: daemon?.coverageAt ?? null } : null,
      uptimePct: daemon?.uptimePct ?? null,
      economics: daemon?.economics
        ? {
            fillsTotal: daemon.economics.fillsTotal,
            roundTrips: daemon.economics.roundTrips,
            capturedSbd: daemon.economics.capturedSbd,
            regime: daemon.economics.regime,
            at: daemon.economics.at,
          }
        : null,
      findings: daemon
        ? {
            done: daemon.findings.filter((f) => f.state === "DONE").length,
            working: daemon.findings.filter((f) => f.state === "WORKING").length,
            open: daemon.findings.filter((f) => f.state === "OPEN").length,
            gated: daemon.findings.filter((f) => f.state === "GATED").length,
            disproven: daemon.findings.filter((f) => f.state === "DISPROVEN").length,
          }
        : null,
    },
    doctrine: [
      "התלמיד בוחן את עצמו כל 10 דקות — מערכות, צי, וכיסוי הרשת. כישלון נרשם כ'לא נמדד', לא מוסתר.",
      "למידה מהיסטוריה: כשל חוזר מסומן RECURRING עד ריפוי — וההתאוששות עצמה נלמדת.",
      "ריפוי-בטוח בלבד: סנכרון ספר וריפוי צ'רטרים — הפעולות האידמפוטנטיות המתועדות, בתקציב 3 ליום.",
      "מפקד האמת (R95): טענה שניתנת למדידה לא נשארת פתוחה מכוח זיכרון — היא נמדדת מול המקור החי, ואמונה שקרית מופרכת בראיה.",
      "למידת כלכלה (R95): התלמיד מבין את הכסף של עצמו — מילויים, סבבים נסגרים, ומשטר כלכלי נמדדים מהשרשרת כל 20 דק'.",
      "לא ריבונות עצלנית: כל מחזור מודד, כל ממצא נשמר, וספר-הפוטנציאל מתעדכן מהשטח.",
    ],
  };
}

export async function GET() {
  const { value, meta } = await swrGet("student:state", 15_000, composeState);
  return NextResponse.json(
    {
      ...value,
      cached: meta.cached,
      stale: meta.stale,
      cacheAgeSec: meta.cacheAgeSec,
      refreshing: meta.refreshing,
    },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
