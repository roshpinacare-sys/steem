import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/value53 — סיבוב 53: מנוע-ערך ריבוני.
 *
 * ההוכחות החיות של "איך מייצרים ערך מכל התזוזות — נועלים אותו בבריכות
 * שלנו, מייצרים נזילות, וכל פעולה אצלנו מגררת פעולות בשאר השרשראות":
 *
 *  1. valueLock — נעילת-ערך: pool_add + pool_lock 100% (LP נעול-לצמיתות,
 *     מרוויח עמלות ולא ניתן לשליפה) — מנגנון-חוזה שהשרשרת לא ידעה.
 *  2. por — הוכחת-עתודה: checkpoint של מצב הדקס נוסע על מפתח-חייל על Hive
 *     (ראוטר-הצי עוקף את ה-RC-החנוק של האוצר).
 *  3. cascade — ממסר-מפל: החלטה-מקומית אחת → 3 חתימות מקבילות על 2 שרשראות,
 *     כל רגל מאומתת מהשרשרת שלה (בלוק/txid).
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

export async function GET() {
  try {
    const [vlState, vlResult, cascade, bridge, loopStatus] = await Promise.all([
      readAgentJson("value_lock_state.json"),
      readAgentJson("value_lock_result.json"),
      readAgentJson("cascade_result.json"),
      readAgentJson("bridge_state.json"),
      readAgentJson("agent-status.json"),
    ]);

    // live pool state from the replay engine (same origin)
    let pool: { saos: number; steem: number; lpSupply: number; locked: number; swaps: number; feesSaos: number; feesSteem: number } | null = null;
    try {
      const res = await fetch("http://localhost:3000/api/ops/saos/dex?username=headcorner", {
        signal: AbortSignal.timeout(30000),
      });
      const dex = (await res.json()) as { ok?: boolean; pools?: { pair: string; saos: number; steem: number; lpSupply: number; locked?: number; swaps: number; feesSaos: number; feesSteem: number }[] };
      const p = (dex.pools ?? []).find((x) => x.pair === "SAOS:STEEM");
      if (p) {
        pool = {
          saos: p.saos,
          steem: p.steem,
          lpSupply: p.lpSupply,
          locked: p.locked ?? 0,
          swaps: p.swaps,
          feesSaos: p.feesSaos,
          feesSteem: p.feesSteem,
        };
      }
    } catch {
      /* engine snapshot optional — file state still answers */
    }

    const loopsRoot = (loopStatus?.loops as AgentJson | undefined) ?? {};
    const bridgeLoop = (loopsRoot.bridge as AgentJson | undefined) ?? {};
    const bridgeDetail = String(bridgeLoop.detail ?? "");

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      valueLock: {
        seq: typeof vlState?.seq === "number" ? vlState.seq : null,
        lockedLp: typeof vlState?.lockedLp === "number" ? vlState.lockedLp : null,
        lockedSaosCum: typeof vlState?.lockedSaosCum === "number" ? vlState.lockedSaosCum : null,
        lastAt: vlState?.lastAt ?? null,
        lastTxid: vlState?.lastTxid ?? null,
        lastHiveTxid: vlState?.lastHiveTxid ?? null,
        lastHiveVia: vlState?.lastHiveVia ?? null,
        depthBefore: vlState?.depthBefore ?? null,
        depthAfter: vlState?.depthAfter ?? null,
        lastResult: vlResult
          ? {
              at: vlResult.at ?? null,
              mode: vlResult.mode ?? null,
              txid: vlResult.txid ?? null,
              lockedLp: vlResult.lockedLp ?? null,
              hiveVia: vlResult.hiveVia ?? null,
            }
          : null,
      },
      por: {
        checkpoints: typeof bridge?.checkpoints === "number" ? bridge.checkpoints : null,
        anchoredTotal: typeof bridge?.anchoredTotal === "number" ? bridge.anchoredTotal : null,
        lastCheckpointAt: bridge?.lastCheckpointAt ?? null,
        lastTxid: bridge?.lastTxid ?? null,
        routedDetail: bridgeDetail || null,
      },
      cascade: {
        at: cascade?.at ?? null,
        mode: cascade?.mode ?? null,
        digest: cascade?.digest ?? null,
        allVerified: cascade?.allVerified === true,
        legs: (Array.isArray(cascade?.legs) ? cascade.legs : []).map((l) => {
          const leg = l as AgentJson;
          return {
            leg: leg.leg ?? null,
            chain: leg.chain ?? null,
            signer: leg.signer ?? null,
            txid: leg.txid ?? null,
            block: leg.block ?? null,
            acceptedMs: leg.acceptedMs ?? null,
            visibleMs: leg.visibleMs ?? null,
          };
        }),
        verify: (Array.isArray(cascade?.verify) ? cascade.verify : []).map((v) => {
          const vr = v as AgentJson;
          return { leg: vr.leg ?? null, pass: vr.pass === true, block: vr.block ?? null, witness: vr.witness ?? null };
        }),
      },
      pool,
      loop: {
        valueLock: (loopsRoot.valueLock as AgentJson | undefined) ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: true, at: new Date().toISOString(), error: String((e as Error).message || e).slice(0, 200) },
      { status: 200 }
    );
  }
}
