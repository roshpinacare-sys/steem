import { NextRequest, NextResponse } from "next/server";
import { fetchWrappedSnapshot, readWrappedDaemonState } from "@/lib/steem/wrapped";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saos/wrapped?username=headcorner — the WRAPPED layer snapshot
 * (Task 63). Deterministic replay of the issuer's account history for the
 * saos.wrap/v1 protocol on the free saos bus + native saos:xlock memo rails:
 *
 *   WSBD-1  — SBD-backed wrapped token (replay-verified backing from locks)
 *   PHIVE-1 — cross-chain HIVE wrap (Hive-side lock, Steem-side mint ref)
 *   fee capture — 30bps pool fees accrued on every swap ("value from orders")
 *
 * Plus the daemon's live ops mirror (wrapped_state.json — non-secret state).
 * Server read-only, never throws, always 200.
 *
 * 104-ייעול: מדידת-ה-RPC-החי לוקחת ~8s בכל-בקשה (מרוץ-צמתים + הליכת-היסטוריה).
 * מטמון-TTL קצר (90s) עם fetchedAt מוצהר — הדף כבר מציג גיל-נתונים בכנות,
 * אז-האמת נשמרת והעומס-על-הצמתים וההמתנה יורדים ×~50. in-flight dedup מונע
 * הצפת-מרוץ-צמתים כשהדף פותח-כמה-פאנלים במקביל.
 */

type CacheEntry = { at: number; username: string; data: Record<string, unknown> };
const TTL_MS = 90_000;
// 117p8-R11: stale-while-revalidate — כל-בקשה מוחזרת-מהר; אם-הנתון-ישן-מ-10-דקות
// מרעננים-ברקע. הפאנל כבר-מציג cacheAgeSec בכנות, אז-האמת-נשמרת וההמתנה-נעלמת.
const STALE_MAX_MS = 600_000;

const g = globalThis as unknown as {
  __wrappedCache?: CacheEntry;
  __wrappedInflight?: Promise<Record<string, unknown>>;
};

function startRefresh(username: string): Promise<Record<string, unknown>> {
  if (g.__wrappedInflight) return g.__wrappedInflight;
  g.__wrappedInflight = fetchWrappedSnapshot(username)
    .then((snap) => {
      const entry: CacheEntry = { at: Date.now(), username, data: { ...(snap as unknown as Record<string, unknown>) } };
      g.__wrappedCache = entry;
      return entry.data;
    })
    .finally(() => {
      g.__wrappedInflight = undefined;
    });
  return g.__wrappedInflight;
}

async function snapshotCached(username: string): Promise<Record<string, unknown>> {
  const c = g.__wrappedCache;
  const fresh = c && c.username === username && Date.now() - c.at < TTL_MS;
  if (fresh) return c.data;
  const stale = c && c.username === username && Date.now() - c.at < STALE_MAX_MS;
  if (stale) {
    // מוחזרים-מיד-מהמטמון-הישן; הרענון-רץ-ברקע (שגיאות-רקע-לא-מפילות-בקשה)
    void startRefresh(username).catch(() => {});
    return c.data;
  }
  return startRefresh(username);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") ?? "headcorner").toLowerCase();
  const [snap, daemon] = await Promise.all([
    snapshotCached(username),
    Promise.resolve(readWrappedDaemonState()),
  ]);
  const c = g.__wrappedCache;
  const cacheAgeSec = c ? Math.round((Date.now() - c.at) / 1000) : null;
  return NextResponse.json({ ...snap, cacheAgeSec, daemon }, { status: 200 });
}
