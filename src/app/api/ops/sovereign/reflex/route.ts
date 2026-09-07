import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/reflex — Task 54: מנוע-רפלקס-בלוק.
 *
 * ההוכחה החיה של "תגובות בבלוק בלי עלות-אנרגיה דרך ריבונות":
 *
 *  1. טריגר-אוצר נוחת בבלוק N → כל-החיילים מגיבים בבלוק N+1/N+2
 *     (החתימות מוכנות לפני-הטריגר — pre-signed sovereign swarm).
 *  2. latencyBlocks מדוד-מהשרשרת (סריקת-בלוק — בלי get_transaction).
 *  3. עלות-נזילה = 0 לפי-בנייה: custom_json בלי-כמויות; הדלק RC-ריבוני
 *     (מהאצלות) ומתחדש — mana-delta מדוד לכל-חייל.
 *  4. digest המטח נעוגן-על-Hive דרך-החייל-הבריא — רפלקס דו-שרשרתי.
 *
 * לעולם לא 500 — תמיד 200 עם ok:true.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

interface AgentJson {
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJson | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJson;
  } catch {
    return null;
  }
}

interface ReflexRound {
  round: number;
  trigger?: { block: number; txid: string; detectionMs: number };
  responses?: Record<string, { block: number; latencyBlocks: number; txid: string } | null>;
  maxLatencyBlocks?: number | null;
  avgLatencyBlocks?: number | null;
  swarm?: string[];
}

export async function GET() {
  try {
    const [ev, loops, extEv, rot, svEv, empEv, liveEv, hypEv, fwEv] = await Promise.all([
      readAgentJson("reflex_evidence.json"),
      readAgentJson("agent-status.json"),
      readAgentJson("reflex_external_evidence.json"),
      readAgentJson("rotation_evidence.json"),
      readAgentJson("sovereign_59_evidence.json"),
      readAgentJson("empire_60_evidence.json"),
      readAgentJson("sovereign_60_evidence.json"),
      readAgentJson("hypotheses_60.json"),
      readAgentJson("curation_flywheel.json"),
    ]);

    const summary = (ev?.summary ?? null) as
      | {
          rounds: number;
          totalResponses: number;
          swarmSize: number;
          maxLatencyBlocks: number | null;
          avgLatencyBlocks: number | null;
          liquidCost: number;
          distinctSigners: number;
          digest: string;
          hiveAnchor: { account: string; txid: string | null; block: number | null; verified: boolean } | null;
          triggers: { r: number; block: number; txid: string }[];
        }
      | null;

    const rounds = (ev?.rounds ?? []) as ReflexRound[];
    const manaDelta = (ev?.manaDelta ?? {}) as Record<string, number>;
    const loop = ((loops?.loops ?? {}) as Record<string, { status?: string; detail?: string; lastRun?: string }>).reflex ?? null;
    const hiveDrill = ((summary as { hiveDrill?: unknown } | null)?.hiveDrill ?? null) as
      | { triggerBy?: string; trigBlock?: number; totalResponses?: number; maxLatencyBlocks?: number | null; avgLatencyBlocks?: number | null; signers?: string[]; error?: string }
      | null;

    return NextResponse.json({
      ok: true,
      at: (ev?.at as string) ?? null,
      engine: (ev?.engine as string) ?? "block-reflex v54 — pre-signed sovereign swarm",
      summary,
      hiveDrill,
      // Task 55 — external-event reflex (dedicated evidence file)
      external: extEv
        ? {
            at: (extEv.at as string) ?? null,
            source: ((extEv.externalEvent as { source?: string } | undefined)?.source ?? null) as string | null,
            from: ((extEv.externalEvent as { from?: string } | undefined)?.from ?? null) as string | null,
            amount: ((extEv.externalEvent as { amount?: string } | undefined)?.amount ?? null) as string | null,
            block: (((extEv.externalEvent as { block?: number } | undefined)?.block) ?? ((extEv.externalEvent as { ackBlock?: number } | undefined)?.ackBlock) ?? null) as number | null,
            txid: (((extEv.externalEvent as { txid?: string } | undefined)?.txid) ?? ((extEv.externalEvent as { ackTxid?: string } | undefined)?.ackTxid) ?? null) as string | null,
            maxLatencyBlocks: ((extEv.summary as { maxLatencyBlocks?: number | null } | undefined)?.maxLatencyBlocks ?? null) as number | null,
            totalResponses: ((extEv.summary as { totalResponses?: number } | undefined)?.totalResponses ?? null) as number | null,
            distinctSigners: ((extEv.summary as { distinctSigners?: number } | undefined)?.distinctSigners ?? null) as number | null,
            hiveAnchor: ((extEv.summary as { hiveAnchor?: { account?: string; verified?: boolean; block?: number | null } } | undefined)?.hiveAnchor ?? null) as { account?: string; verified?: boolean; block?: number | null } | null,
          }
        : null,
      // Task 55 — Vault v2: deterministic rotation + master-connect admission
      vaultv2: rot
        ? {
            account: (rot.account as string) ?? null,
            chains: Object.entries((rot.chains ?? {}) as Record<string, { rotated?: boolean; verified?: boolean }>).map(([chain, c]) => ({ chain, verified: !!c.verified })),
            scheme: (rot.scheme as string) ?? null,
            at: (rot.at as string) ?? null,
          }
        : null,
      // Task 59 — boundary-breaking batch: recovery · market · savings · witness · energy · routing
      sovereign59: svEv
        ? {
            at: (svEv.updatedAt as string) ?? null,
            recoveryCount: (((svEv.fleetRecovery as { results?: { txid?: string }[] } | undefined)?.results ?? []) as { txid?: string }[]).filter((r) => r.txid).length,
            marketRoundTrip: ((svEv.market as { roundTrip?: boolean } | undefined)?.roundTrip ?? false) as boolean,
            savingsLive: !!(svEv.savings as { depositTxid?: string; withdrawTxid?: string; oursFound?: boolean } | undefined)?.depositTxid,
            witnessSteem: (((svEv.witnessSteem as { results?: unknown[] } | undefined)?.results ?? []).length > 0) as boolean,
            witnessHive: ((svEv.witnessHive as { status?: string } | undefined)?.status === "broadcast-ok") as boolean,
            energyYnetFinal: ((svEv.energyShare as { final?: string } | undefined)?.final ?? null) as string | null,
            routeLive: !!(svEv.withdrawRoute as { txid?: string } | undefined)?.txid,
            delegateRcAbsent: ((svEv.delegateRc as { exists?: boolean } | undefined)?.exists === false) as boolean,
          }
        : null,
      // Task 60 — empire balance sheet + hypothesis engine (live, both chains)
      empire60: empEv
        ? {
            at: (empEv.at as string) ?? null,
            census: (empEv.census as { accounts?: number; steemSp?: number; hiveHp?: number; fleetRcRegenGPerDay?: number | null }) ?? null,
            rates: (empEv.rates as { steemSbdInterestPct?: number; hiveHbdInterestPct?: number }) ?? null,
            market: (empEv.market as { steem?: { mid?: number; spreadPct?: number | null } | null; hive?: { mid?: number; spreadPct?: number | null } | null }) ?? null,
            engine: (empEv.engine as { reachable?: boolean; tokenCount?: number; bee?: { last?: number; lastDay?: number } | null; ourBalances?: number }) ?? null,
            treasury: (empEv.treasury as { steemDaoBalanceSteem?: number; hiveFundHive?: number; hiveFundHbd?: number }) ?? null,
            curation: (empEv.curation as { steem?: { aprPct?: number; pendingPayout?: number } | null; hive?: { aprPct?: number; pendingPayout?: number } | null }) ?? null,
            live: liveEv
              ? {
                  curationVote: ((liveEv.curationVote as { status?: string; txid?: string; author?: string } | undefined) ?? null) as { status?: string; txid?: string; author?: string } | null,
                  dhfBallot: ((liveEv.dhf as { ballot?: { status?: string; signedWith?: string; voter?: string } } | undefined)?.ballot ?? null) as { status?: string; signedWith?: string; voter?: string } | null,
                  dhfFeeWall: ((liveEv.dhf as { feeWallMeasured?: string } | undefined)?.feeWallMeasured ?? null) as string | null,
                  engineBuy: ((liveEv.engineBuy as { status?: string; symbol?: string; quantity?: number; priceSwaphive?: number } | undefined) ?? null) as { status?: string; symbol?: string; quantity?: number; priceSwaphive?: number } | null,
                }
              : null,
            hypotheses: hypEv
              ? {
                  count: ((hypEv.hypotheses as unknown[]) ?? []).length,
                  proven: ((hypEv.hypotheses as { status?: string }[]) ?? []).filter((h) => h.status === "proven-live").length,
                  measured: ((hypEv.hypotheses as { status?: string }[]) ?? []).filter((h) => h.status === "measured").length,
                  open: ((hypEv.hypotheses as { status?: string }[]) ?? []).filter((h) => h.status === "open").length,
                  walls: ((hypEv.hypotheses as { status?: string }[]) ?? []).filter((h) => h.status === "wall").length,
                  top: ((hypEv.verdict as { topValueNext?: { id?: string; why?: string }[] } | undefined)?.topValueNext ?? []) as { id?: string; why?: string }[],
                }
              : null,
          }
        : null,
      // Task 61 — A5 curation flywheel LIVE in the daemon (loop + on-chain verified votes)
      flywheel61: fwEv
        ? {
            at: (fwEv.at as string) ?? null,
            loopLive: ((loops?.loops as Record<string, { status?: string }> | undefined)?.curation?.status === "ok") as boolean,
            daemonLive: ((loops?.dryRun as boolean | undefined) === false) as boolean,
            votesToday: (((loops?.loops as Record<string, { counters?: { votesToday?: number } } | undefined>)?.curation?.counters?.votesToday) ?? null) as number | null,
            config: (fwEv.loop as { config?: { minVpPct?: number; maxVotesDay?: number; weightPct?: number } } | undefined)?.config ?? null,
            vpCost: ((fwEv.vpCostMeasured as { costPerFullVotePct?: number; meaning?: string } | undefined)?.costPerFullVotePct ?? null) as number | null,
            batch: (fwEv.batchTotal as { votes?: number; rsharesTotal?: string; verifiedOnChain?: string } | undefined) ?? null,
            lastVote: ((fwEv.firstAutonomousVotes as { author?: string; txid?: string; rshares?: string }[] | undefined)?.[0] ?? null) as { author?: string; txid?: string; rshares?: string } | null,
          }
        : null,
      rounds: rounds.map((r) => ({
        round: r.round,
        triggerBlock: r.trigger?.block ?? null,
        triggerTxid: r.trigger?.txid ?? null,
        detectionMs: r.trigger?.detectionMs ?? null,
        responded: Object.values(r.responses ?? {}).filter(Boolean).length,
        swarmSize: (r.swarm ?? []).length,
        maxLatencyBlocks: r.maxLatencyBlocks ?? null,
        avgLatencyBlocks: r.avgLatencyBlocks ?? null,
        perSoldier: Object.fromEntries(Object.entries(r.responses ?? {}).map(([k, v]) => [k, v ? v.latencyBlocks : null])),
      })),
      manaDelta,
      loop,
    });
  } catch (e) {
    return NextResponse.json({ ok: true, error: String((e as Error).message).slice(0, 140), summary: null, rounds: [], manaDelta: {}, loop: null });
  }
}
