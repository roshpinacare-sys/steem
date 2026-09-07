import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saos/token — the SAOS-1 virtual-token ledger (Task 28).
 *
 * The token is anchored on Steem custom_json ops with id "saos"
 * (protocol saos/v1): ping (no effect) · mint {to,amount,reason} ·
 * transfer {from,to,amount} · burn {from,amount}. The canonical ledger is a
 * DETERMINISTIC REPLAY of the issuer's account history — signatures are
 * verified by the chain itself (an op only appears in the account history of
 * an authority that signed it), so a balance here is chain-provable.
 * Server read-only, never throws, paginates backward ≤5 pages of 100.
 */

const RPC_URL = "https://api.steemit.com";
const USERNAME_RE = /^[a-z0-9\-.]{3,16}$/i;
const MAX_PAGES = 5;

let rpcId = 9500;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
  if (json.result === undefined) throw new Error(`${method}: empty result`);
  return json.result;
}

export interface SaosOpRow {
  idx: number
  block: number
  trxid: string
  action: string
  payload: Record<string, unknown> | null
  /** Hebrew effect line; null = ignored/malformed. */
  effect: string | null
}

export interface SaosTokenResponse {
  ok: boolean
  error?: string
  issuer: string
  fetchedAt: string
  genesis: { trxid: string; block: number; time: string } | null
  supply: number
  balances: { account: string; amount: number }[]
  ops: SaosOpRow[]
  pagesScanned: number
  malformed: number
}

type HistEntry = {
  block: number
  timestamp: string
  trx_id?: string
  op: [string, Record<string, unknown>]
}

function isSaosJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* malformed json — counted, skipped */
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const issuer = (url.searchParams.get("username") ?? "headcorner").toLowerCase();
  if (!USERNAME_RE.test(issuer)) {
    return NextResponse.json({ ok: false, error: "bad username" }, { status: 200 });
  }

  const balances = new Map<string, number>();
  const ops: SaosOpRow[] = [];
  let malformed = 0;
  let pages = 0;
  let genesis: SaosTokenResponse["genesis"] = null;
  let lowest = -1;

  const credit = (acct: string, amt: number) =>
    balances.set(acct, round3((balances.get(acct) ?? 0) + amt));
  const debit = (acct: string, amt: number) =>
    balances.set(acct, round3((balances.get(acct) ?? 0) - amt));

  try {
    let start: number | string = -1;
    for (let p = 0; p < MAX_PAGES; p++) {
      const raw = await rpc<[number, HistEntry][]>("condenser_api.get_account_history", [
        issuer,
        start,
        100,
      ]);
      if (!Array.isArray(raw) || raw.length === 0) break;
      pages++;
      const entries = raw.slice().reverse(); // newest → oldest within page
      for (const [idx, entry] of entries) {
        lowest = lowest < 0 ? idx : Math.min(lowest, idx);
        const [type, value] = entry.op;
        if (type !== "custom_json" || value?.id !== "saos") continue;
        const payload = isSaosJson(value.json);
        if (!payload || payload.protocol !== "saos/v1") {
          malformed++;
          continue;
        }
        const action = String(payload.action ?? "");
        const amount = round3(Number(payload.amount ?? 0));
        const to = typeof payload.to === "string" ? payload.to : "";
        const from = typeof payload.from === "string" ? payload.from : issuer;
        let effect: string | null = null;
        if (action === "mint" && to && amount > 0 && Number.isFinite(amount)) {
          credit(to, amount);
          effect = `מינט ${amount} SAOS-1 ל-${to}`;
        } else if (action === "burn" && amount > 0 && Number.isFinite(amount)) {
          debit(from, amount);
          effect = `שריפת ${amount} SAOS-1 מ-${from}`;
        } else if (action === "transfer" && to && amount > 0 && Number.isFinite(amount)) {
          debit(from, amount);
          credit(to, amount);
          effect = `העברת ${amount} SAOS-1 מ-${from} ל-${to}`;
        } else if (action === "ping" && genesis === null) {
          genesis = {
            trxid: entry.trx_id ?? "",
            block: entry.block,
            time: entry.timestamp,
          };
          effect = "פעימת גנזיס — הרשמת הפרוטוקול";
        } else {
          effect = null;
        }
        ops.push({
          idx,
          block: entry.block,
          trxid: entry.trx_id ?? "",
          action,
          payload,
          effect,
        });
      }
      if (genesis) break; // full scan back to genesis done
      if (lowest <= 0) break;
      start = lowest - 1;
    }

    const supply = round3([...balances.values()].reduce((a, b) => a + b, 0));
    const body: SaosTokenResponse = {
      ok: true,
      issuer,
      fetchedAt: new Date().toISOString(),
      genesis,
      supply,
      balances: [...balances.entries()]
        .map(([account, amount]) => ({ account, amount }))
        .sort((a, b) => b.amount - a.amount),
      ops: ops.sort((a, b) => a.idx - b.idx),
      pagesScanned: pages,
      malformed,
    };
    return NextResponse.json(body);
  } catch (e) {
    const errBody: SaosTokenResponse = {
      ok: false,
      error: String(e).slice(0, 200),
      issuer,
      fetchedAt: new Date().toISOString(),
      genesis,
      supply: 0,
      balances: [],
      ops,
      pagesScanned: pages,
      malformed,
    };
    return NextResponse.json(errBody, { status: 200 });
  }
}
