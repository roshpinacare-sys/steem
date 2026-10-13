import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { OP_COOKIE, readSession } from "@/lib/operator-auth";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * סקירת-המפעיל (מאובטחת): אמת-המנוע (:3040, חוק-הגוף-האחד) + קריאה-חיה של
 * קבצי-state מקומיים. כל-קריאה fail-soft (null, לא-המצאה). אפס-סודות-בתשובות.
 */

const ENGINE_HTTP = "http://127.0.0.1:3040";

function readJson<T = Record<string, unknown>>(rel: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8")) as T;
  } catch {
    return null;
  }
}

function gitHead(): { head: string | null; drift: boolean; lastPushedSha: string | null; pushedAt: string | null; branch: string | null } {
  let head: string | null = null;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), timeout: 5000 })
      .toString()
      .trim();
  } catch {
    head = null;
  }
  const pc = readJson<{ lastPushedSha?: string; pushedAt?: string; branch?: string }>(
    "mini-services/saos-engine/state/push-custody.json"
  );
  return {
    head,
    drift: !!(head && pc?.lastPushedSha && head !== pc.lastPushedSha),
    lastPushedSha: pc?.lastPushedSha ?? null,
    pushedAt: pc?.pushedAt ?? null,
    branch: pc?.branch ?? null,
  };
}

async function engineStatus(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${ENGINE_HTTP}/status`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(OP_COOKIE)?.value ?? null;
  if (!readSession(token).valid) {
    return NextResponse.json({ ok: false, error: "דורש אימות" }, { status: 401 });
  }

  const s = await engineStatus();
  const pick = <T,>(o: unknown, key: string): T | null =>
    o && typeof o === "object" && key in (o as Record<string, unknown>) ? ((o as Record<string, unknown>)[key] as T) : null;

  /* אמת-מנוע: שדות-תצוגה-בלבד, אפס-חישוב-דומיין כאן */
  const rawStream = pick<Record<string, unknown>>(s, "stream");
  /* נרמול-תצוגה: todayCount→today · runwayDrafts→runway (המנוע קובע, השכבה משנמת שמות) */
  const stream = rawStream
    ? {
        ...rawStream,
        today: rawStream.todayCount ?? rawStream.today ?? null,
        runway: rawStream.runwayDrafts ?? rawStream.runway ?? null,
      }
    : null;
  const economics = pick<Record<string, unknown>>(s, "economics");
  const curator = pick<Record<string, unknown>>(s, "curator");
  const fleet = pick<Record<string, unknown>>(s, "fleet");
  const credential = pick<Record<string, unknown>>(s, "credential");
  const events = (pick<unknown[]>(s, "events") ?? []).slice(0, 8);
  const grid = pick<Record<string, unknown>>(pick<Record<string, unknown>>(s, "state") ?? {}, "") ?? pick<Record<string, unknown>>(s, "state");

  const selftest = readJson<{ pass?: number; fail?: number; at?: string; vectors?: number }>(
    "mini-services/saos-engine/state/selftest-last-run.json"
  );
  const quietAlarm = readJson<Record<string, unknown>>("sanbox/autonomy/quiet-alarm.json");
  const rewards = readJson<Record<string, unknown>>("sanbox/autonomy/rewards-attribution.json");
  const tasksRaw = readJson<{ queue?: Array<Record<string, unknown>>; updatedAt?: string }>("sanbox/autonomy/tasks.json");
  const yieldBoard = readJson<Record<string, unknown>>("sanbox/autonomy/yield-board.json");

  const openTasks = (tasksRaw?.queue ?? [])
    .filter((t) => t.done !== true)
    .slice(0, 10)
    .map((t) => ({ id: t.id, priority: t.priority, title: t.title, cmd: t.cmd }));

  /* R323 · DEX-FLOW: השכבה החיה של הדקס האמיתי (שוק-הפנימי של Steem, צמד STEEM/SBD)
   * + הדקס הפנימי שלנו (grid98). אמת-מנוע + קובץ-state מקומי, אפס-חישוב-דומיין. */
  const dexRaw = pick<Record<string, unknown>>(s, "dexflow");
  const dexRt = (dexRaw?.runtime ?? null) as Record<string, unknown> | null;
  const g98 = readJson<Record<string, unknown>>("sovereign/node/grid98-state.json");

  const data = {
    ok: true,
    asof: new Date().toISOString(),
    engine: {
      up: !!s,
      /* החתימה נמדדת אצל המנוע: קובץ-מפתח קיים ובאחזקת-הדוקטרינה */
      signing: (() => {
        const cred = credential as Record<string, unknown> | null;
        if (!cred) return null;
        if (typeof cred.present === "boolean") return cred.present;
        return null;
      })(),
    },
    account: pick<string>(s, "account"),
    stream,
    curator: curator
      ? {
          votesToday: Array.isArray(curator.votesToday) ? (curator.votesToday as unknown[]).length : 0,
          maxPerDay: curator.maxPerDay ?? null,
          vpEff: curator.vpEff ?? null,
          verdict: curator.verdict ?? null,
          /* R314 · המדיניות-החיה של התהליך (execution.curate) — תמונת-המחזור עלולה לפגר מחזור אחד */
          liveCap: (() => {
            const ex = pick<Record<string, unknown>>(s, "execution");
            const cu = ex && typeof ex === "object" ? (ex as Record<string, unknown>).curate : null;
            return cu && typeof cu === "object" ? ((cu as Record<string, unknown>).maxPerDay as number) ?? null : null;
          })(),
        }
      : null,
    fleet,
    economics: economics
      ? {
          totalMeasuredUsdPerDay: economics.totalMeasuredUsdPerDay ?? null,
          totalEstUsdPerDay: economics.totalEstUsdPerDay ?? null,
          rails: (economics.rails ?? []).slice(0, 6),
          pendingRewards: economics.pendingRewards ?? null,
        }
      : null,
    grid: grid ? { runCount: grid.runCount ?? null, active: (grid.grids ?? [])?.filter?.((g: { active?: boolean }) => g.active).length ?? null } : null,
    selftest: selftest ? { pass: selftest.pass ?? null, fail: selftest.fail ?? null, at: selftest.at ?? null } : null,
    quietAlarm: quietAlarm ?? null,
    rewards: rewards
      ? { status: rewards.status ?? null, summary: rewards.summary ?? null, plan: (rewards.plan ?? []).slice(0, 6) }
      : null,
    tasks: { updatedAt: tasksRaw?.updatedAt ?? null, open: openTasks },
    yieldBoard: yieldBoard
      ? { updatedAt: yieldBoard.updatedAt ?? null, purpose: yieldBoard.purpose ?? null, tiers: (yieldBoard.tiers ?? []).slice(0, 6) }
      : null,
    git: gitHead(),
    dexflow: dexRt
      ? {
          running: dexRt.running ?? null,
          verdict: dexRt.lastVerdict ?? null,
          at: (dexRt.lastVerdictAt as string) ?? (dexRt.lastTickAt as string) ?? null,
          ticks: dexRt.ticks ?? null,
          trips: dexRt.trips ?? 0,
          completions: dexRt.completions ?? 0,
          sweeps: dexRt.sweeps ?? null,
          opsToday: dexRt.opsToday ?? 0,
          fillsToday: dexRt.fillsToday ?? null,
          volumeSteemToday: dexRt.volumeSteemToday ?? null,
          volumeSbdToday: dexRt.volumeSbdToday ?? null,
          realizedEdgeSbd: dexRt.realizedEdgeSbd ?? 0,
          rcPct: dexRt.rcPct ?? null,
          lastFillAt: (dexRt.chainLastFillAt as string) ?? null,
          trigger: dexRt.trigger ?? null,
          error: dexRt.lastError ?? null,
        }
      : null,
    grid98: g98
      ? {
          at: g98.at ?? null,
          paused: g98.paused ?? null,
          tradesToday: g98.tradesToday ?? null,
          txsToday: g98.txsToday ?? null,
          ratePerMin: g98.ratePerMin ?? null,
          floor: g98.floor ?? null,
          treasuryPnlSaos: typeof g98.treasuryPnlµ === "number" ? Math.round((g98.treasuryPnlµ as number) / 1e6) : null,
          pairs: g98.anchors ? Object.keys(g98.anchors as Record<string, unknown>).length : null,
          leaderboard: Array.isArray(g98.leaderboard) ? (g98.leaderboard as unknown[]).slice(0, 5) : [],
        }
      : null,
    events,
  };

  return NextResponse.json(deDashDeep(data));
}
