import { NextRequest, NextResponse } from "next/server";

import { readAgentEnv } from "@/lib/agent-env";
import { journal } from "@/lib/brain";
import { computeLadder, fetchSovereignSnapshot } from "@/lib/steem/sovereign";
import { getLiveAccount } from "@/lib/steem/steem-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/sovereign/ladder?username=…
// Read-only sovereign capital ladder: live SPS/DHF pool + funding threshold +
// the account's dead capital, compiled into rungs and a step-by-step plan.
// 60s memory cache · journals the headline at most once per 6h · never 500.
// ─────────────────────────────────────────────────────────────────────────────

interface CacheShape {
  at: number;
  payload: unknown;
}
const g = globalThis as unknown as { __saosSovereignCache?: CacheShape; __saosSovereignJournal?: number };
const TTL_MS = 60_000;
const JOURNAL_EVERY_MS = 6 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "").replace(/^@/, "").trim();
  if (!username) {
    return NextResponse.json({ ok: false, error: "חסר username" }, { status: 400 });
  }

  const cached = g.__saosSovereignCache;
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  try {
    const [snapshotRes, liveRes] = await Promise.allSettled([
      fetchSovereignSnapshot(),
      getLiveAccount(username),
    ]);

    if (snapshotRes.status !== "fulfilled") {
      throw snapshotRes.reason instanceof Error ? snapshotRes.reason : new Error("snapshot failed");
    }
    const snapshot = snapshotRes.value;

    const live = liveRes.status === "fulfilled" ? liveRes.value : null;
    if (!live || live.ok !== true) {
      throw new Error(live && live.ok === false ? live.error : "live account unavailable");
    }

    const env = readAgentEnv();
    const ladder = computeLadder(snapshot, live, env);
    const payload = {
      ok: true as const,
      username,
      fetchedAt: new Date().toISOString(),
      snapshot,
      ladder,
      account: {
        spOwn: live.balances.spOwn,
        spOut: live.balances.spOut,
        spEffective: live.balances.spEffective,
        liquidSteem: live.balances.steem,
        liquidSbd: live.balances.sbd,
        steemUsd: live.chain.steemUsd,
        sbdUsd: live.chain.sbdUsd,
        vpPct: live.power.votingPower,
        rcPct: live.power.rcPct,
      },
    };

    g.__saosSovereignCache = { at: Date.now(), payload };

    // journal the headline at most once per 6h
    if (!g.__saosSovereignJournal || Date.now() - g.__saosSovereignJournal > JOURNAL_EVERY_MS) {
      g.__saosSovereignJournal = Date.now();
      void journal("sovereign_scan", "סריקת סולם ריבוני", ladder.headline.slice(0, 400));
    }

    return NextResponse.json(payload);
  } catch (e) {
    const error = e instanceof Error ? e.message : "שגיאת רשת";
    return NextResponse.json({ ok: false as const, error }, { status: 200 });
  }
}
