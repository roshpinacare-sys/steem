/**
 * probe-delegation-broadcast.mjs — REVISIT-R314c diagnostic (2026-11-01).
 * Rebuilds the EXACT rail plan (same law, same measurement) and probes the
 * broadcast endpoint error VERBATIM per node — the ladder was swallowing the
 * real rejection as "all-nodes-failed". Broadcasts only the plan the rail
 * already approved (sig-verified); on success it LEDGERS like the rail does.
 */
process.env.CI_DELEGATION_ARMED = "1";
import * as fs from "node:fs";
import * as path from "node:path";
import * as secp from "@noble/secp256k1";
import { runAdopt } from "./crown-vault-adopt.mjs";
import { masterAccount, adoptedWifFor } from "./signer.mjs";
import { buildTx, pubkeyBytes, STEEM_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import { spmFromGlobals, netSpOf, DELEGATION_LAW, planDelegation } from "./delegation-rail.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const NODES = ["https://api.steemit.com", "https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://steem.61bts.com", "https://api.steemitdev.com"];

const raw = async (node, method, params, timeoutMs = 20000) => {
  const r = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => null);
  return j;
};

const main = async () => {
  const adopt = await runAdopt({});
  console.log(`adopt: ${adopt.verdict} ${adopt.verified}/${adopt.total}`);
  if (!adopt.ok) process.exit(2);
  const master = masterAccount();
  const wif = adoptedWifFor(master, "active");
  if (!wif) { console.log("no-active-wif-adopted"); process.exit(2); }
  const bare = wif.startsWith("P") && wif.length >= 51 ? wif.slice(1) : wif;

  const dgpo = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  const spm = spmFromGlobals(dgpo.result);
  const names = [...DELEGATION_LAW.publishers, ...DELEGATION_LAW.soldiers];
  const accs = await rpcCall("condenser_api.get_accounts", [[master, ...names]]);
  const byName = new Map(accs.result.map((a) => [String(a.name), a]));
  const masterNet = netSpOf(byName.get(master), spm);
  const targets = names.map((n) => {
    const a = byName.get(n);
    const floor = DELEGATION_LAW.soldiers.includes(n) ? DELEGATION_LAW.floorSp.soldier : DELEGATION_LAW.floorSp.publisher;
    return { account: n, netSp: a ? (netSpOf(a, spm) ?? -Infinity) : -Infinity, floor };
  });
  const plan = planDelegation({ masterNetSp: masterNet, targets, spm });
  console.log(`plan: ops=${plan.ops.length} totalSp=${plan.totalSp} skipped=${plan.skipped.length}`);
  if (!plan.ops.length) { console.log("NO-OPS"); process.exit(0); }
  const ops = plan.ops.map((o) => ["delegate_vesting_shares", { delegator: master, delegatee: o.account, vesting_shares: o.vests }]);
  const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [bare], chainId: STEEM_CHAIN_ID });
  console.log(`tx: expiration=${tx.json.expiration} sigs=${tx.json.signatures.length} ops=${tx.json.operations.length}`);

  for (const node of NODES) {
    for (const [label, params] of [
      ["network_broadcast_api", [tx.json]],
      ["condenser_api", [tx.json]],
    ]) {
      try {
        const j = await raw(node, `${label}.broadcast_transaction`, params);
        if (j?.error) console.log(`${node} ${label}: ERROR ${String(j.error.message).slice(0, 110)}`);
        else if (j?.result !== undefined) { console.log(`${node} ${label}: ACCEPTED result=${JSON.stringify(j.result).slice(0, 80)}`); process.exit(0); }
        else console.log(`${node} ${label}: odd-shape ${JSON.stringify(j).slice(0, 110)}`);
      } catch (e) { console.log(`${node} ${label}: TRANSPORT ${String(e?.message ?? e).slice(0, 90)}`); }
    }
  }
  console.log("ALL-ENDPOINTS-REJECTED");
};
main();
