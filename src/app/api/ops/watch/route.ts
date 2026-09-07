import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  WINDOW_KEY,
  WINDOW_OPEN_THRESHOLD_PCT,
  getMarketSnapshot,
} from "@/lib/steem/market-snapshot";

export const dynamic = "force-dynamic";

/**
 * Console v2 — BOT-3 window watcher (docs/CONSOLE_PLAN.md §7 v2).
 * Persists a WindowSample each time the live feed/ask is scanned; when the
 * window flips open↔closed a WatchAlert row is written. Sampling happens on:
 *   1. a background interval (5 min, started lazily with the first call), and
 *   2. any GET whose newest sample is older than WATCH_TTL_MIN, and
 *   3. GET ?sample=1 (forced — the "scan now" button).
 * READ-ONLY chain access; no keys.
 *
 * GET /api/ops/watch?sample=1
 *   → { ok, key, openThresholdPct, ttlMinutes,
 *       current: { edgePct, feed, ask, open, sampledAt, stale },
 *       stats: { samplesTotal, samples7d, maxEdge7d, minEdge7d,
 *                openSince, lastFlipAt, lastFlipType },
 *       alerts: WatchAlert[≤10 desc], samples: [≤120 asc { t, edgePct, open }] }
 */

const WATCH_TTL_MIN = 5;
const SAMPLER_INTERVAL_MS = 5 * 60 * 1000;

type SamplerTimer = ReturnType<typeof setInterval> & { unref?: () => void };
const g = globalThis as unknown as { __saosWindowSampler?: SamplerTimer };

/** Background sampler — one interval for the whole process, never duplicated
 * across route re-evaluations (same globalThis guard pattern as engine.ts). */
function ensureSampler() {
  if (g.__saosWindowSampler) return;
  const t: SamplerTimer = setInterval(() => {
    void sampleWindow(false).catch(() => undefined);
  }, SAMPLER_INTERVAL_MS);
  t.unref?.(); // never keep the dev process alive just for sampling
  g.__saosWindowSampler = t;
}

async function sampleWindow(force: boolean) {
  const last = await db.windowSample.findFirst({
    where: { key: WINDOW_KEY },
    orderBy: { createdAt: "desc" },
  });
  const ageMs = last ? Date.now() - last.createdAt.getTime() : Number.POSITIVE_INFINITY;
  if (!force && ageMs < WATCH_TTL_MIN * 60_000) {
    return { sampled: false as const, last };
  }

  const snap = await getMarketSnapshot();

  // Flip detection → alert row (only when a previous sample exists).
  if (last && last.open !== snap.openExec) {
    await db.watchAlert.create({
      data: {
        key: WINDOW_KEY,
        type: snap.openExec ? "window_opened" : "window_closed",
        edgePct: snap.execEdgePct,
        message: snap.openExec
          ? `חלון BOT-3 נפתח — edge ניתן-לביצוע ${snap.execEdgePct >= 0 ? "+" : ""}${snap.execEdgePct.toFixed(1)}% ב-100 SBD (feed ${snap.feed.toFixed(4)} / bid ${snap.bidTop.toFixed(5)})`
          : `חלון BOT-3 נסגר — edge ניתן-לביצוע ${snap.execEdgePct >= 0 ? "+" : ""}${snap.execEdgePct.toFixed(1)}% מתחת לסף (${WINDOW_OPEN_THRESHOLD_PCT}%)`,
      },
    });
  }

  const row = await db.windowSample.create({
    data: {
      key: WINDOW_KEY,
      edgePct: snap.edgeInternalPct,
      execEdgePct: snap.execEdgePct,
      vol24hSbd: snap.vol24h?.sbd ?? null,
      feed: snap.feed,
      ask: snap.bidTop,
      open: snap.openExec,
    },
  });
  return { sampled: true as const, last, row, snap };
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("sample") === "1";
  ensureSampler();

  try {
    const result = await sampleWindow(force);

    // History + stats (always returned, even when the live scan failed).
    const [samples, alerts, samples7d] = await Promise.all([
      db.windowSample.findMany({
        where: { key: WINDOW_KEY },
        orderBy: { createdAt: "asc" },
        take: 120,
      }),
      db.watchAlert.findMany({
        where: { key: WINDOW_KEY },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.windowSample.findMany({
        where: {
          key: WINDOW_KEY,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
    ]);

    const totalAll = await db.windowSample.count({ where: { key: WINDOW_KEY } });
    const lastSample = samples.length ? samples[samples.length - 1] : null;
    const edges7d = samples7d.map((s) => s.edgePct);
    const lastFlip = alerts[0] ?? null;
    const openSinceAlert = alerts.find((a) => a.type === "window_opened") ?? null;
    const closedAfterOpen =
      openSinceAlert &&
      alerts.some(
        (a) =>
          a.type === "window_closed" && a.createdAt > openSinceAlert.createdAt,
      );

    const current = lastSample
      ? {
          edgePct: Number(lastSample.edgePct.toFixed(2)),
          execEdgePct:
            lastSample.execEdgePct == null
              ? null
              : Number(lastSample.execEdgePct.toFixed(2)),
          vol24hSbd:
            lastSample.vol24hSbd == null ? null : Number(lastSample.vol24hSbd.toFixed(2)),
          feed: Number(lastSample.feed.toFixed(6)),
          ask: Number(lastSample.ask.toFixed(6)),
          open: lastSample.open,
          sampledAt: lastSample.createdAt.toISOString(),
          // stale = the newest row is older than TTL (live scan just failed)
          stale:
            Date.now() - lastSample.createdAt.getTime() > WATCH_TTL_MIN * 60_000,
        }
      : null;

    return NextResponse.json({
      ok: true,
      key: WINDOW_KEY,
      openThresholdPct: WINDOW_OPEN_THRESHOLD_PCT,
      ttlMinutes: WATCH_TTL_MIN,
      sampledNow: result.sampled,
      scanError: !lastSample
        ? "הדגימה החיה נכשלה ואין היסטוריה"
        : undefined,
      current,
      stats: {
        samplesTotal: totalAll,
        samples7d: samples7d.length,
        maxEdge7d: edges7d.length ? Number(Math.max(...edges7d).toFixed(2)) : null,
        minEdge7d: edges7d.length ? Number(Math.min(...edges7d).toFixed(2)) : null,
        openSince:
          current?.open && openSinceAlert && !closedAfterOpen
            ? openSinceAlert.createdAt.toISOString()
            : null,
        lastFlipAt: lastFlip?.createdAt.toISOString() ?? null,
        lastFlipType: lastFlip?.type ?? null,
      },
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        edgePct: a.edgePct,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
      })),
      samples: samples.map((s) => ({
        t: s.createdAt.toISOString(),
        edgePct: s.edgePct,
        open: s.open,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת ניטור" },
      { status: 502 },
    );
  }
}
