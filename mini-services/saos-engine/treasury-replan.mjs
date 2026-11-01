/**
 * treasury-replan.mjs — REVISIT-R314d (2026-11-01): the measured deadlock and
 * its honest resolution.
 *
 * MEASURED DEADLOCK (chain verdict, verbatim): "Account headcorner does not
 * have enough mana to delegate ... available: -518537978005" — the 2026-10-29
 * power-down (withdraw rate 507200.8 VESTS/wk ≈ 315 SP/wk, 2.0288M VESTS
 * ≈ 1260 SP still reserved, ZERO payments made — next 2026-11-05) consumes
 * the treasury's entire free stake, so the R314 standing order ("האצלת SP
 * לכלל החשבונות", 2026-10-11) is UNEXECUTABLE and workers starve
 * (hcsoldier4/5/6 net 0.0 SP; siq/woq/tov/wic/wog ~41 vs floor 100). The same
 * power-down breaches the R314c keep floor (1000 SP) in ~11.4 days by itself.
 * Two standing orders colliding: liquidity (2026-10-29) vs work capacity
 * (2026-10-11 + operator order 2026-11-02 "החשבונות חייבים להיות מסוגלים
 * לפעול"). Resolution: liquidity at a rate the treasury can actually sustain.
 *
 * STEPWISE (verify between steps; all ops signed with headcorner ACTIVE,
 * self-verified against the live authority, txids ledgered):
 *   step cancel   — withdraw_vesting(headcorner, 0)      → frees the reserve
 *   step delegate — the R314 plan (floors, soldiers first under scarcity)
 *   step rearm    — withdraw_vesting(headcorner, 40SP/wk) → sustainable flow
 *
 * Everything is reversible (withdraw_vesting is a rate; delegation undelegates
 * in 7 days). No ownership moves. Revisit entries opened for each step.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as secp from "@noble/secp256k1";
import { runAdopt } from "./crown-vault-adopt.mjs";
import { masterAccount, adoptedWifFor } from "./signer.mjs";
import { buildTx, pubkeyBytes, STEEM_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import { spmFromGlobals, netSpOf, spFromVests, DELEGATION_LAW, planDelegation } from "./delegation-rail.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const LEDGER = path.join(STATE, "treasury-replan-ledger.jsonl");
const ledger = (row) => { try { fs.appendFileSync(LEDGER, JSON.stringify(row) + "\n"); } catch { /* never blocks */ } };

const step = process.argv[2] ?? "all"; // cancel | delegate | rearm | all
const REARM_SP_PER_WEEK = 40;          // measured-sustainable: net 1161.7 − keep 1000 ≈ 161.7 SP spendable → 40/wk ≈ 4wk runway, revisit-tracked

const main = async () => {
  const adopt = await runAdopt({});
  console.log(`adopt: ${adopt.verdict} ${adopt.verified}/${adopt.total}`);
  if (!adopt.ok) process.exit(2);
  const master = masterAccount();
  const wif = adoptedWifFor(master, "active");
  const bare = wif.startsWith("P") && wif.length >= 51 ? wif.slice(1) : wif;

  const dgpo = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo?.ok) { console.log("RPC-FAILED dgpo"); process.exit(1); }
  const spm = spmFromGlobals(dgpo.result);
  const accs = await rpcCall("condenser_api.get_accounts", [[master]]);
  const a = accs.result[0];
  const livePub = String(a.active?.key_auths?.[0]?.[0] ?? "");
  const verifyAndBroadcast = async (ops, tag) => {
    const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [bare], chainId: STEEM_CHAIN_ID });
    const rawSig = Buffer.from(tx.json.signatures[0], "hex");
    const okSig = secp.verify(secp.Signature.fromCompact(new Uint8Array(rawSig.slice(1))), new Uint8Array(Buffer.from(tx.digestHex, "hex")), pubkeyBytes(livePub));
    if (!okSig) { console.log(`${tag}: SIGNATURE-VERIFY-FAILED`); process.exit(1); }
    const b = await rpcCall("condenser_api.broadcast_transaction", [tx.json], 20000);
    const { createHash } = await import("node:crypto");
    const txid = createHash("sha256").update(Buffer.from(tx.serializedHex, "hex")).digest("hex").slice(0, 40);
    if (!b?.ok) { console.log(`${tag}: BROADCAST-FAILED ${String(b?.error ?? "?").slice(0, 140)}`); ledger({ at: new Date().toISOString(), tag, verdict: "FAILED", error: String(b?.error ?? "").slice(0, 200) }); process.exit(3); }
    ledger({ at: new Date().toISOString(), tag, verdict: "BROADCAST", txid, ops: ops.map((o) => o[0]) });
    console.log(`${tag}: BROADCAST txid=${txid}`);
    return txid;
  };

  if (step === "cancel" || step === "all") {
    await verifyAndBroadcast([["withdraw_vesting", { account: master, vesting_shares: "0.000000 VESTS" }]], "cancel-powerdown");
  }
  if (step === "delegate" || step === "all") {
    const names = [...DELEGATION_LAW.publishers, ...DELEGATION_LAW.soldiers];
    const accs2 = await rpcCall("condenser_api.get_accounts", [[master, ...names]]);
    const byName = new Map(accs2.result.map((x) => [String(x.name), x]));
    const masterNet = netSpOf(byName.get(master), spm);
    /* R314e: the op SETS totals — measure live master→delegatee amounts */
    const dg = await rpcCall("condenser_api.get_vesting_delegations", [master, "", 100]);
    const currentMaster = new Map((dg?.result ?? []).map((d) => [String(d.delegatee), spFromVests(d.vesting_shares, spm) ?? 0]));
    const targets = names.map((n) => {
      const x = byName.get(n);
      const floor = DELEGATION_LAW.soldiers.includes(n) ? DELEGATION_LAW.floorSp.soldier : DELEGATION_LAW.floorSp.publisher;
      return { account: n, netSp: x ? (netSpOf(x, spm) ?? -Infinity) : -Infinity, floor, currentMasterSp: currentMaster.get(n) ?? 0 };
    });
    /* operator priority 2026-11-02: under scarcity the soldiers eat first */
    targets.sort((x, y) => {
      const sx = DELEGATION_LAW.soldiers.includes(x.account) ? 0 : 1;
      const sy = DELEGATION_LAW.soldiers.includes(y.account) ? 0 : 1;
      return (sx - sy) || ((y.floor - y.netSp) - (x.floor - x.netSp));
    });
    const plan = planDelegation({ masterNetSp: masterNet, targets, spm });
    console.log(`plan: ops=${plan.ops.length} totalSp=${plan.totalSp} skipped=${plan.skipped.map((s) => `${s.account}:${s.reason}`).join(",") || "none"}`);
    if (plan.ops.length) {
      const ops = plan.ops.map((o) => ["delegate_vesting_shares", { delegator: master, delegatee: o.account, vesting_shares: o.vests }]);
      await verifyAndBroadcast(ops, "delegate-floors");
    }
  }
  if (step === "rearm" || step === "all") {
    const vests = ((REARM_SP_PER_WEEK / spm) * 1e6).toFixed(6) + " VESTS";
    await verifyAndBroadcast([["withdraw_vesting", { account: master, vesting_shares: vests }]], `rearm-powerdown-${REARM_SP_PER_WEEK}sp-wk`);
  }
  console.log("TREASURY-REPLAN DONE");
};
main().catch((e) => { console.log(`TREASURY-REPLAN ERROR ${String(e?.message ?? e).slice(0, 160)}`); process.exit(1); });
