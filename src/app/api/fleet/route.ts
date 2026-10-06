// ─────────────────────────────────────────────────────────────────────
// /api/fleet — r140 · רישום-על מאוחד של הצי, ארבע שכבות, אמת מדידה אחת.
//
// הבעיה ההנדסית שנפתרת: המונה "סוכנים" הופיע בדפים בשלוש הגדרות שונות
// בלי הפרדה (69 זרימות-ענן · 13 זהויות-ספר · 9 דיבונים מקומיים · 10
// מאמתי-מפעל) — מה שייצר את הפער בין "69 סוכנים" ל"רובם מתים".
// מעתה: שכבה אחת, מקור אחד לכל שכבה, חלוקת-חיים נמדדת לכל אחת.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getAgentsRegistry } from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

// ההגדרה החיה של דיבוני-הבית (זהה ל-freshFleet של keeper — מקור אחד לשניים)
const DAEMON_DEFS: Array<{ name: string; port: number; roleHe: string }> = [
  { name: "pulse", port: 3033, roleHe: "הדופק — השידור היומי לשרשרת" },
  { name: "money", port: 3034, roleHe: "מוביל הכסף — סולם הפאריטה על הקו" },
  { name: "hunter", port: 3035, roleHe: "הצייד — שער הדקות ולוח ההזדמנויות" },
  { name: "keeper", port: 3036, roleHe: "השומר — חיות-הצי והקמת-נופלים" },
  { name: "student", port: 3037, roleHe: "התלמיד — בחינה עצמית וכיסוי" },
  { name: "fleet-verify", port: 3038, roleHe: "מפעל האימות המקומי" },
  { name: "weblift", port: 3039, roleHe: "מעלה התוכן — הגירת רשת-האחסון" },
  { name: "curation", port: 3040, roleHe: "דיבון האוצרות — כוח-הצבעה להכנסה" },
  { name: "kpi", port: 3041, roleHe: "מפקיד ה-KPI — הספר היומי הנמדד" },
];

async function probeDaemon(port: number, timeoutMs = 2500): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: ac.signal, cache: "no-store" });
    return r.ok || (r.status >= 400 && r.status < 500);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const at = new Date().toISOString();

  // ── שכבה 1: דיבוני-הבית — מדידה חיה של כל פת ──────────────────────
  const daemons = await Promise.all(
    DAEMON_DEFS.map(async (d) => ({
      name: d.name,
      port: d.port,
      roleHe: d.roleHe,
      up: await probeDaemon(d.port),
    })),
  );

  // ── שכבה 2: זהויות-הספר (EVM) — נמדד מה-DB ─────────────────────────
  let identities: { total: number; active: number; error: string | null } = {
    total: 0,
    active: 0,
    error: null,
  };
  try {
    const [total, active] = await Promise.all([
      db.agent.count(),
      db.agent.count({ where: { status: "ACTIVE" } }),
    ]);
    identities = { total, active, error: null };
  } catch (e) {
    identities = {
      total: 0,
      active: 0,
      error: e instanceof Error ? e.message.slice(0, 120) : "db-error",
    };
  }

  // ── שכבה 3: זרימות-הענן (GitHub Actions) — מהרישום הציבורי ────────
  let cloud: {
    ok: boolean;
    total: number;
    live: number;
    degraded: number;
    dormant: number;
    generatedAt: string | null;
  } = { ok: false, total: 0, live: 0, degraded: 0, dormant: 0, generatedAt: null };
  try {
    const reg = await getAgentsRegistry();
    cloud = {
      ok: true,
      total: reg.agents.length,
      live: reg.agents.filter((a) => a.state === "live").length,
      degraded: reg.agents.filter((a) => a.state === "degraded").length,
      dormant: reg.agents.filter((a) => a.state === "dormant").length,
      generatedAt: reg.generatedAt,
    };
  } catch {
    /* כנות: הענן לא נענה */
  }

  // ── שכבה 4: מפעל-האימות המקומי — מספר-המצב של fleet-verify ────────
  let verify: {
    total: number;
    pass: number;
    fresh: number; // פסק-דין מ-26 שע׳
    stale: number; // פסק-דין ישן מדי — נמדד ומוצג
    newestRunAt: string | null;
  } = { total: 0, pass: 0, fresh: 0, stale: 0, newestRunAt: null };
  try {
    const p = path.join("/home/z/my-project", "sovereign", "fleet-verify", "state.json");
    const st = JSON.parse(fs.readFileSync(p, "utf8")) as {
      jobs?: Array<{ verdict?: string; lastRunAt?: string | null }>;
    };
    const jobs = st.jobs ?? [];
    const freshCut = Date.now() - 26 * 3_600_000;
    verify = {
      total: jobs.length,
      pass: jobs.filter((j) => j.verdict === "PASS").length,
      fresh: jobs.filter((j) => j.lastRunAt && Date.parse(j.lastRunAt) >= freshCut).length,
      stale: jobs.filter((j) => !j.lastRunAt || Date.parse(j.lastRunAt) < freshCut).length,
      newestRunAt:
        jobs
          .map((j) => j.lastRunAt)
          .filter((x): x is string => Boolean(x))
          .sort()
          .at(-1) ?? null,
    };
  } catch {
    /* כנות: אין מספר-מצב */
  }

  return NextResponse.json(
    {
      ok: true,
      at,
      layers: {
        daemons: {
          total: daemons.length,
          up: daemons.filter((d) => d.up).length,
          list: daemons,
        },
        identities,
        cloud,
        verify,
      },
      // הספירה-העל — עם ההגדרה בגלוי, כדי שאף דף לא יציג "69 סוכנים" כאילו
      // הם אחד-לאחד זהים ל-9 הדיבונים או ל-13 הזהויות.
      totals: {
        grand: daemons.length + identities.total + cloud.total + verify.total,
        byLayer: {
          daemons: daemons.length,
          identities: identities.total,
          cloud: cloud.total,
          verifyJobs: verify.total,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
