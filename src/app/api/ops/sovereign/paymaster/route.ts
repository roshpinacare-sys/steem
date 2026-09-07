import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/paymaster — Task 62: "החוזה שלנו משלם גז".
 *
 * הראיות החיות שנאספו (כולן ממוסכות — אפס סודות):
 *  · paymaster_relay.json  — meta-tx חי ×2 שרשראות (חתימת-לקוח → שידור-ממסר,
 *    RC-דלתא נמדדת ללקוח ולממסר, txid+block מהשרשרת)
 *  · paymaster_fuel.json   — תדלוק (האצת VESTS → max_rc Δ)
 *  · memo_biz.json         — מסחר-ממו: הזמנה → תמחור → מילוי → קבלה מוצפנת
 *  · xnet_map.json         — מפת-תקשורת חיה אל 12+ רשתות חכמות (חביון מדוד)
 *  · xfeed_last.json       — ממסר-EVM ללא-גז (ecrecover == לקוח) + Solana
 *  · gas_tank.json         — דלי-גז (הנהלת-חשבון של המימון)
 *  · memo_ledger.json      — פנקס-הזמנות ממו (loop חי)
 *  · agent-status.json     — לולאת paymaster (23)
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

interface ChainRelay {
  relayed?: boolean;
  client?: string;
  anchorSigned?: boolean;
  txid?: string | null;
  block?: number | null;
  signatureCovered?: boolean;
  verifiedOnNode?: boolean;
  clientRcBeforePct?: number | null;
  clientRcAfterPct?: number | null;
  clientRcDeltaPct?: number | null;
  why?: string;
}

export async function GET() {
  try {
    const [relay, fuel, memo, xnet, xfeed, tank, ledger, status] = await Promise.all([
      readAgentJson("paymaster_relay.json"),
      readAgentJson("paymaster_fuel.json"),
      readAgentJson("memo_biz.json"),
      readAgentJson("xnet_map.json"),
      readAgentJson("xfeed_last.json"),
      readAgentJson("gas_tank.json"),
      readAgentJson("memo_ledger.json"),
      readAgentJson("agent-status.json"),
    ]);

    const relayChains = (relay?.chains ?? {}) as Record<string, ChainRelay>;
    const steem = relayChains.steem ?? null;
    const hive = relayChains.hive ?? null;
    const relaysVerified = [steem, hive].filter((c) => c && c.relayed).length;

    const liveNets = ((xnet?.live ?? []) as { net: string; ms: number; tip?: string }[]);
    const deadNets = ((xnet?.dead ?? []) as { net: string; why: string }[]);

    const pmLoop = ((status?.loops ?? {}) as Record<string, { status?: string; detail?: string; lastRun?: string }>).paymaster ?? null;

    const memoSteps = (memo?.steps ?? {}) as {
      order?: { txid?: string; memo?: string; verifiedOnChain?: boolean };
      fill?: { txid?: string; verifiedOnChain?: boolean };
      encryptedReceipt?: { sent?: boolean; decryptedOk?: boolean; txid?: string };
    };

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      relay: {
        steem,
        hive,
        relaysVerified,
        note: "meta-tx: client signs offline → relay broadcasts → RC charged to client (measured)",
      },
      fuel: fuel
        ? {
            payer: fuel.payer ?? null,
            client: fuel.client ?? null,
            vestsPlanned: fuel.vestsPlanned ?? null,
            txid: fuel.txid ?? null,
            verified: fuel.verified ?? null,
            dry: fuel.dry ?? null,
          }
        : null,
      memo: memo
        ? {
            customer: memo.customer ?? null,
            order: memoSteps.order ?? null,
            fill: memoSteps.fill ?? null,
            encryptedReceipt: memoSteps.encryptedReceipt ?? null,
            pricing: memo.pricing ?? null,
          }
        : null,
      xnet: {
        probedAt: xnet?.probedAt ?? null,
        liveCount: liveNets.length,
        deadCount: deadNets.length,
        live: liveNets,
        dead: deadNets,
      },
      xwallet: xfeed
        ? {
            lastMode: xfeed.lastMode ?? null,
            match: xfeed.match ?? null,
            recovered: xfeed.recovered ?? null,
            network: xfeed.network ?? null,
            signature: xfeed.signature ?? null,
            confirmed: xfeed.confirmed ?? null,
            feePayer: xfeed.feePayer ?? null,
            clientPaidLamports: xfeed.clientPaidLamports ?? null,
            relayerGasLamports: xfeed.relayerGasLamports ?? null,
            explorer: xfeed.explorer ?? null,
            why: xfeed.why ?? null,
          }
        : null,
      gasTank: tank ? { policy: tank.policy ?? null, debits: ((tank.debits as unknown[]) ?? []).length, updatedAt: tank.updatedAt ?? null } : null,
      memoLedger: ledger ? { total: ledger.total ?? 0, updatedAt: ledger.updatedAt ?? null, last: ((ledger.intents as unknown[]) ?? []).slice(-3) } : null,
      loop: pmLoop,
    });
  } catch (e) {
    return NextResponse.json({ ok: true, at: new Date().toISOString(), error: String((e as Error)?.message || e).slice(0, 140) });
  }
}
