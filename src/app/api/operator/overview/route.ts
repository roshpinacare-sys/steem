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
    events,
  };

  return NextResponse.json(deDashDeep(data));
}
