// ─────────────────────────────────────────────────────────────────────
// /api/live/overview — התמונה החיה מהענן: ספר + עד שרשרת + רישום סוכנים.
// מקור: המראה הציבורית (Console repo) — נגזרת אמת ללא סודות.
//
// לקח-R53 (נמדד חי ביומן): polling של ה-store אכל 200–420ms בכל פעם
// כי פקיעת המטמונים הפנימיים (60 שניות) חפפה לקצב ה-refresh.
// מעתה SWR: תשובה מיידית תמיד אחרי הראשונה — טריה או בשלה+רענון-רקע
// single-flight; כנות מלאה בגוף (cached/stale/cacheAgeSec/refreshing).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import {
  getMirror,
  getChainStatus,
  getAgentsRegistry,
  getAgentState,
  getAgentRequests,
  getVerifyResults,
  computeVitalityFromMirror,
} from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

const SWR_KEY = "api:live-overview";
const SWR_TTL_MS = 45_000;

export async function GET() {
  try {
    const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeOverview);
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
  } catch (err) {
    // כישלון קור-אמיתי בלבד (אין שום עותק בזיכרון והענן לא ענה) — 502 כנה.
    // אם יש עותק ישן הוא כבר הוגש למעלה (stale:true) — בלי 502 מזייף.
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `הענן לא נענה: ${err.message}`
            : "הענן לא נענה — נסה שוב",
      },
      { status: 502 },
    );
  }
}

async function composeOverview() {
  const [mirror, chain, registry, agentState, agentRequests, verify] =
    await Promise.all([
      getMirror(),
      getChainStatus().catch(() => null),
      getAgentsRegistry().catch(() => null),
      getAgentState().catch(() => null),
      getAgentRequests().catch(() => null),
      getVerifyResults().catch(() => null),
    ]);
  const vitality = computeVitalityFromMirror(mirror);

  // servedAt נשאר זמן-החישוב האמיתי של העותק — כך גיל הנתון גלוי
  // לצרכן גם כשהוא מוגש מהמטמון (cacheAgeSec משלים אותו).
  return {
    ok: true,
    live: {
      source: "cloud-mirror",
      mirrorGeneratedAt: mirror.generatedAt,
      stats: mirror.stats,
      vitality,
      freshness: chain?.freshness ?? null,
      witness: chain?.witness ?? null,
      brain: mirror.brain,
      anchorLines: {
        steem: mirror.anchorLines.steem?.length ?? 0,
        zero: mirror.anchorLines.zero?.length ?? 0,
      },
      marketEvents: mirror.market.slice(0, 10),
      agents: mirror.agents,
      recentAttestations: mirror.attestations.slice(0, 8),
      lastCheckpoint: mirror.checkpoints[0] ?? null,
      loop: {
        coverage: registry
          ? {
              withAgents: registry.reposWithAgents.length,
              total: registry.reposTotal,
              idle: registry.reposIdle.length,
              agents: registry.agents.length,
              // r140 · אמת-מדידה ברמת-הסוכן: "אין רדומים" ברמת-ריפו היתה מטעה —
              // ריפו יכול להיות מכוסה וסוכנים בודדים בתוכו מדורדים/דורמים.
              // החלוקה הרשמית של agents-watch (live/degraded/dormant) נחשפת כעת.
              byState: {
                live: registry.agents.filter((a) => a.state === "live").length,
                degraded: registry.agents.filter((a) => a.state === "degraded").length,
                dormant: registry.agents.filter((a) => a.state === "dormant").length,
              },
            }
          : null,
        requests: agentRequests
          ? {
              delivered: agentRequests.requests.filter((r) =>
                String(r.status ?? "").startsWith("delivered")
              ).length,
              total: agentRequests.requests.length,
            }
          : null,
        standingOrders: agentState ? agentState.standingOrders.length : null,
        verify: verify ? verify.summary : null,
        checkpoints: mirror.stats.checkpoints,
      },
    },
    registry: registry
      ? {
          generatedAt: registry.generatedAt,
          reposTotal: registry.reposTotal,
          reposWithAgents: registry.reposWithAgents,
          reposIdle: registry.reposIdle,
          agents: registry.agents,
        }
      : null,
    servedAt: new Date().toISOString(),
  };
}
