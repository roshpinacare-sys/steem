// ─────────────────────────────────────────────────────────────────────
// /api/sovereignty/efficiency — מבדק התייעלות המערך האוטונומי (D-017).
//
// הוראת המפעיל (2026-09-28): "יש לבחון את התייעלות המערך האוטונומית
// והפעילות השוטפת 7/24 של האוטונומיה ולדייק את הפעילות והזרימה של
// עצמה שתמיד תפעיל את עצמה ותתגרגר את עצמה כדבר גורר דבר."
//
// החוק היחיד: כל מספר נמדד כרגע ממקור-אמת. מדידה שלא ענתה מדווחת
// כלא-נמדדת (null + הערה כנה) — לעולם לא כהצלחה שנטענת.
//
// מקורות האמת (כולם קריאה-בלבד):
//   · keeper :3036              — חיות-הצי, פעימות-סיור, החייאות
//   · pulse :3033               — פעימות השידור, מועד הפרסום האחרון
//   · ChainRun (DB)             — ריצות שרשראות-הטריגר בפעמיים-עשרים-וארבע שעות
//   · Attestation/Checkpoint    — הספר והעוגנים
//   · fleet-guard state         — סיורי השרת והחייאות-העצמיות
//   · sovereign/income/daily-*  — ההכנסה הנמדדת האחרונה
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLEET_GUARD_STATE = "/home/z/my-project/sovereign/keeper/fleet-guard-state.json";

// ── קוראי-מקור ──────────────────────────────────────────────────────

interface KeeperFleetEntry {
  name: string;
  port: number;
  state: string;
  lastBeats: number | null;
  lastCheckAt: string | null;
  restartsToday: number;
}

interface KeeperState {
  beats: number;
  patrolIntervalSec: number;
  lastDecision: { at: string; kind: string; detail: string } | null;
  fleet: KeeperFleetEntry[];
}

async function readKeeper(): Promise<{ state: KeeperState | null; noteHe: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2_500);
  try {
    const r = await fetch("http://127.0.0.1:3036/", { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { state: (await r.json()) as KeeperState, noteHe: "keeper חי (HTTP)" };
  } catch {
    // נפילה כנה לקובץ-המצב — מדידה אחרונה ידועה, מסומנת ככזו
    try {
      const st = JSON.parse(
        fs.readFileSync("/home/z/my-project/sovereign/keeper/state.json", "utf8"),
      ) as KeeperState;
      return { state: st, noteHe: "keeper לא ענה חי — מוצגת מדידת-המצב האחרונה מהקובץ" };
    } catch {
      return { state: null, noteHe: "השומר לא נמדד (HTTP + קובץ-מצב)" };
    }
  } finally {
    clearTimeout(t);
  }
}

interface PulseState {
  beats: number;
  lastPublishUtcDay: string | null;
  nextDueAt: string | null;
}

async function readPulse(): Promise<{ state: PulseState | null; noteHe: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2_500);
  try {
    const r = await fetch("http://127.0.0.1:3033/", { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as PulseState;
    return {
      state: { beats: j.beats, lastPublishUtcDay: j.lastPublishUtcDay, nextDueAt: j.nextDueAt },
      noteHe: "pulse חי (HTTP)",
    };
  } catch {
    return { state: null, noteHe: "הדופק לא נמדד כרגע" };
  } finally {
    clearTimeout(t);
  }
}

function readFleetGuard(): { cycles: number; lastCycleAt: string | null; lastVerdict: string | null; revives24h: number } | null {
  try {
    const st = JSON.parse(fs.readFileSync(FLEET_GUARD_STATE, "utf8")) as {
      cycles: number;
      lastCycleAt: string | null;
      lastVerdict: string | null;
      revivesLog: Array<{ at: string }>;
    };
    const since = Date.now() - 24 * 3_600_000;
    return {
      cycles: st.cycles,
      lastCycleAt: st.lastCycleAt,
      lastVerdict: st.lastVerdict,
      revives24h: (st.revivesLog ?? []).filter((r) => new Date(r.at).getTime() >= since).length,
    };
  } catch {
    return null;
  }
}

function readIncomeLast(): { date: string; usdToday: number | null } | null {
  const dir = path.join(process.cwd(), "sovereign", "income");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (files.length === 0) return null;
    const j = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8")) as {
      date?: string;
      totals?: { usdToday?: number | null };
    };
    return { date: j.date ?? files[files.length - 1].slice(6, 16), usdToday: j.totals?.usdToday ?? null };
  } catch {
    return null;
  }
}

// ── הרכבת המבדק ─────────────────────────────────────────────────────

async function compose() {
  const since = new Date(Date.now() - 24 * 3_600_000);

  const [keeper, pulse, runsByChain, runsByFired, attCount, cpCount, lastRun] = await Promise.all([
    readKeeper(),
    readPulse(),
    db.chainRun.groupBy({ by: ["chain", "ok"], _count: true, where: { createdAt: { gte: since } } }),
    db.chainRun.groupBy({ by: ["firedBy"], _count: true, where: { createdAt: { gte: since } } }),
    db.attestation.count(),
    db.checkpoint.count(),
    db.chainRun.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const runsTotal = runsByChain.reduce((a, r) => a + r._count, 0);
  const runsOk = runsByChain.filter((r) => r.ok).reduce((a, r) => a + r._count, 0);
  const runsFailed = runsTotal - runsOk;

  // דבר-גורר-דבר נמדד: חלק הריצות שלא הופעלו בידי מפעיל
  const operatorFired = runsByFired.find((r) => r.firedBy === "operator")?._count ?? 0;
  const autonomousShare = runsTotal > 0 ? 1 - operatorFired / runsTotal : null;

  const fleet = keeper.state?.fleet ?? [];
  const alive = fleet.filter((f) => f.state === "UP").length;
  const fleetAliveShare = fleet.length > 0 ? alive / fleet.length : null;

  const fg = readFleetGuard();
  const income = readIncomeLast();

  const verdict =
    fleetAliveShare != null && fleetAliveShare >= 1 && runsFailed === 0
      ? { level: "GREEN", he: "המערך שלם: הצי חי, השרשראות זורמות, אפס כישלונות ב-24ש'." }
      : fleetAliveShare != null && fleetAliveShare >= 0.75
        ? { level: "AMBER", he: "המערך חי עם פגמים: יש דיבונים לא-למעלה או כישלונות ריצה — גלויים כאן בכנות." }
        : { level: "RED", he: "המערך לא שלם כרגע — המספרים למטה הם האמת, ולא תמונה מעוצבת." };

  return {
    ok: true,
    at: new Date().toISOString(),
    verdict,
    server: {
      uptimeSec: Math.round(process.uptime()),
      noteHe: "זמן-ריצה של תהליך השרת הנוכחי",
    },
    fleet: {
      alive,
      total: fleet.length,
      aliveShare: fleetAliveShare,
      source: keeper.noteHe,
      daemons: fleet.map((f) => ({
        name: f.name,
        port: f.port,
        state: f.state,
        beats: f.lastBeats,
        restartsToday: f.restartsToday,
      })),
      keeper: {
        beats: keeper.state?.beats ?? null,
        patrolIntervalSec: keeper.state?.patrolIntervalSec ?? null,
        lastDecision: keeper.state?.lastDecision,
      },
    },
    chains24h: {
      total: runsTotal,
      ok: runsOk,
      failed: runsFailed,
      autonomousShare,
      operatorFired,
      byChain: runsByChain.map((r) => ({ chain: r.chain, ok: r.ok, count: r._count })),
      byFiredBy: runsByFired.map((r) => ({ firedBy: r.firedBy, count: r._count })),
      lastRun: lastRun
        ? { chain: lastRun.chain, step: lastRun.step, firedBy: lastRun.firedBy, ok: lastRun.ok, at: lastRun.createdAt }
        : null,
      noteHe:
        "דבר גורר דבר נמדד: autonomousShare הוא חלק הריצות שהציתו את עצמן (לא על-ידי המפעיל) ב-24ש'.",
    },
    pulse,
    guardians: {
      keeperRestartBudget: { rollingWindow: "4/6h per daemon", cooldownMin: 2 },
      fleetGuard: fg,
      doctrineHe:
        "הפעלה-עצמית כפולה (D-016): keeper מחייה את השרת; השרת מחייה את keeper. כל החייאה נרשמת ב-ChainRun (chain=fleet).",
    },
    book: { attestations: attCount, checkpoints: cpCount },
    income: income
      ? { lastDay: income.date, usdToday: income.usdToday, honestyHe: "ההכנסה הנמדדת של היום המתועד האחרון — לעולם לא מקושטת (D-012)" }
      : { lastDay: null, usdToday: null, honestyHe: "אין רשומת-הכנסה נמדדת עדיין" },
  };
}

export async function GET() {
  const { value, meta } = await swrGet("sovereignty:efficiency", 15_000, compose);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
