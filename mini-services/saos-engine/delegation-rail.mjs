/**
 * delegation-rail.mjs — R314 · THE DELEGATION RAIL (operator standing order,
 * 2026-10-11, verbatim: "אני רוצה להאציל sp לכלל החשבונות כדי לחלק את כוח
 * העבודה וההצבעה ופוסטים בצורה נכונה" + "יש לך אישור להכל").
 *
 * WHAT: tops every ACTIVE publisher up to its work floor from the treasury
 * (headcorner), so the fleet's RC, votes and posting power match its
 * workload — the idle 80% of treasury SP becomes the fleet's working capital.
 *
 * GATE ORDER (fail-closed at every step; a refusal is a verdict):
 *   1. ARMED     — env CI_DELEGATION_ARMED must be "1" (the operator's order
 *                  travels as a repo secret, same contract as CI_SOCIAL_ARMED).
 *   2. DAILY     — one run per UTC day (state/delegation-last.json).
 *   3. CUSTODY   — army-custody.json must read FLEET-CUSTODY-ALIVE, full.
 *   4. CREDENTIAL— VAULT-FIRST (R314b, 2026-10-11): the custody step of THIS
 *                  beat already chain-adopted the master's ACTIVE wif from the
 *                  git vault (adoptedWifFor — verified.ok, wif-direct).
 *                  Fallback: env CI_ADOPT_WIF_ACTIVE (measured 2026-10-11:
 *                  its wif does NOT match headcorner's live active authority
 *                  — verdict ADOPT-REFUSED @14:00:12Z). Either way the wif is
 *                  chain-judged AGAIN via adoptVerifiedWifIdentity. Key bytes
 *                  never print.
 *   5. MEASURED  — every number comes from the live chain (dgpo ratios +
 *                  get_accounts), never from books or estimates.
 *   6. CAPPED    — hard law: per-account floor top-up only, ≤ MAX_RUN_SP per
 *                  run, treasury must keep ≥ TREASURY_KEEP_SP net after the
 *                  run, MIN_DELTA_SP dust-refusal. Delegation moves NO
 *                  ownership and is reversible (7-day undelegation).
 *   7. SIGNED    — tx built + self-verified against the LIVE on-chain ACTIVE
 *                  authority before broadcast (social-streamer pattern).
 *   8. LEDGERED  — every op row lands in state/delegation-ledger.jsonl with
 *                  its txid; verdict written to state/delegation-last.json.
 *
 * IDEMPOTENT: an account measured at/above its floor is a named SKIP;
 * re-running cannot double-delegate (the chain measurement is the truth).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildTx, pubkeyBytes, STEEM_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import { masterAccount, adoptedWifFor } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");

/* ── THE LAW (hard caps; a cap without a number is value theft, R309) ────── */
export const DELEGATION_LAW = {
  publishers: ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"],
  soldiers: ["hcsoldier4", "hcsoldier5", "hcsoldier6"],
  floorSp: { publisher: 100, soldier: 20 },
  maxRunSp: 1200,        /* hard ceiling per run */
  treasuryKeepSp: 2800,  /* headcorner must retain ≥ this net SP after the run */
  minDeltaSp: 5,         /* dust refusal — no pointless 0.1 SP ops */
};

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── pure (selftest-locked): chain ratios & conversions ──────────────────── */
export function spmFromGlobals(g) {
  const tvf = parseFloat(String(g?.total_vesting_fund_steem ?? ""));
  const tvs = parseFloat(String(g?.total_vesting_shares ?? ""));
  if (!Number.isFinite(tvf) || !Number.isFinite(tvs) || tvs <= 0) return null;
  return (tvf / tvs) * 1e6;
}
export function spFromVests(vestsStr, spm) {
  const v = parseFloat(String(vestsStr ?? ""));
  if (!Number.isFinite(v) || !Number.isFinite(spm) || spm <= 0) return null;
  return (v / 1e6) * spm;
}
/* net effective SP = own − delegated_out + received (measured, no books) */
export function netSpOf(account, spm) {
  const own = spFromVests(account?.vesting_shares, spm);
  const out = spFromVests(account?.delegated_vesting_shares, spm);
  const recv = spFromVests(account?.received_vesting_shares, spm);
  if (own === null || out === null || recv === null) return null;
  return own - out + recv;
}
export function vestsFromSp(sp, spm) {
  if (!Number.isFinite(sp) || !Number.isFinite(spm) || spm <= 0) return null;
  return ((sp / spm) * 1e6).toFixed(6) + " VESTS";
}

/* ── pure (selftest-locked): the plan — floors, caps, skips, budget ──────── */
export function planDelegation({ masterNetSp, targets, maxRunSp = DELEGATION_LAW.maxRunSp, treasuryKeepSp = DELEGATION_LAW.treasuryKeepSp, minDeltaSp = DELEGATION_LAW.minDeltaSp, spm }) {
  const ops = [], skipped = [];
  if (!Number.isFinite(masterNetSp) || !Number.isFinite(spm) || spm <= 0) return { ops, skipped: [{ account: "*", reason: "MEASUREMENT-REFUSED" }], totalSp: 0 };
  let budget = Math.min(maxRunSp, masterNetSp - treasuryKeepSp);
  if (budget < minDeltaSp) return { ops, skipped: [{ account: "*", reason: "TREASURY-FLOOR" }], totalSp: 0 };
  let totalSp = 0;
  /* biggest deficit first — the starving accounts eat before the full ones */
  const ordered = [...targets].sort((a, b) => (b.floor - b.netSp) - (a.floor - a.netSp));
  for (const t of ordered) {
    const delta = t.floor - t.netSp;
    if (delta < minDeltaSp) { skipped.push({ account: t.account, reason: "AT-OR-ABOVE-FLOOR" }); continue; }
    const give = Math.min(delta, budget);
    if (give < minDeltaSp) { skipped.push({ account: t.account, reason: "BUDGET-EXHAUSTED" }); continue; }
    budget -= give;
    totalSp += give;
    ops.push({ account: t.account, sp: give, vests: vestsFromSp(give, spm) });
  }
  return { ops, skipped, totalSp: Math.round(totalSp * 1000) / 1000 };
}

/* ── the run ─────────────────────────────────────────────────────────────── */
export async function runDelegationRail({ now = new Date().toISOString() } = {}) {
  const S = stateDir();
  const base = { at: now, rail: "delegation-r314" };
  const ledger = (row) => { try { appendLine(path.join(S, "delegation-ledger.jsonl"), row); } catch { /* ledger never blocks */ } };

  /* 1 · ARMED gate */
  if (String(process.env.CI_DELEGATION_ARMED ?? "") !== "1") {
    const out = { ...base, verdict: "DELEGATION-DISARMED", reason: "CI_DELEGATION_ARMED secret absent — fail-closed by law" };
    writeJson(path.join(S, "delegation-last.json"), out);
    return out;
  }
  /* 2 · DAILY gate */
  const day = String(now).slice(0, 10);
  const last = readJson(path.join(S, "delegation-last.json"), null);
  if (last?.day === day) {
    const out = { ...base, verdict: "ALREADY-TODAY", day, priorVerdict: last.verdict ?? null };
    writeJson(path.join(S, "delegation-last.json"), out);
    return out;
  }
  /* 3 · CUSTODY gate */
  const custody = readJson(path.join(S, "army-custody.json"), null);
  const verified = Number(custody?.after?.verified ?? 0);
  const total = Number(custody?.after?.total ?? 0);
  if (!custody || custody.verdict !== "FLEET-CUSTODY-ALIVE" || verified !== total || total <= 0) {
    const out = { ...base, verdict: "CUSTODY-GATE-REFUSED", custodyVerdict: custody?.verdict ?? null, verified, total };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  /* 4 · CREDENTIAL gate + chain-judged adoption (R314b: VAULT-FIRST).
   * The custody step of this same beat/process already chain-adopted the
   * master's ACTIVE wif from the git vault (army-custody.json
   * "ACTIVE-VERIFIED" GEN-2 → signer.mem, verified.ok wif-direct). The vault
   * IS the credential delivery (ci-cycle.mjs law: zero key material in CI
   * secrets). Fallback: the CI_ADOPT_WIF_ACTIVE secret — measured
   * 2026-10-11 its wif does NOT match headcorner's live active authority
   * (verdict ADOPT-REFUSED), so it is fallback only. EITHER source is
   * chain-judged again below — a stale or wrong wif still fails closed. */
  const master = masterAccount();
  const vaultWif = adoptedWifFor(master, "active");
  const raw = vaultWif ?? String(process.env.CI_ADOPT_WIF_ACTIVE ?? "").trim();
  if (!raw) {
    const out = { ...base, verdict: "NO-CREDENTIAL", reason: "no vault-adopted master ACTIVE wif; CI_ADOPT_WIF_ACTIVE absent" };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  const bare = raw.startsWith("P") && raw.length >= 51 ? raw.slice(1) : raw;
  try {
    const { adoptVerifiedWifIdentity } = await import("./signer.mjs");
    const r = await adoptVerifiedWifIdentity(master, bare, { role: "active" });
    if (!r?.ok) {
      const out = { ...base, verdict: "ADOPT-REFUSED", reason: String(r?.reason ?? "chain-refused").slice(0, 100) };
      writeJson(path.join(S, "delegation-last.json"), out);
      ledger(out);
      return out;
    }
  } catch (e) {
    const out = { ...base, verdict: "ADOPT-ERROR", reason: String(e?.message ?? e).slice(0, 120) };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  /* 5 · MEASURED — live chain ratios + live account stakes */
  const dgpo = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo?.ok) {
    const out = { ...base, verdict: "RPC-FAILED", reason: "dgpo" };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  const spm = spmFromGlobals(dgpo.result);
  const names = [...DELEGATION_LAW.publishers, ...DELEGATION_LAW.soldiers];
  const accs = await rpcCall("condenser_api.get_accounts", [[master, ...names]]);
  if (!accs?.ok || !Array.isArray(accs.result)) {
    const out = { ...base, verdict: "RPC-FAILED", reason: "get_accounts" };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  const byName = new Map(accs.result.map((a) => [String(a.name), a]));
  const masterNet = netSpOf(byName.get(master), spm);
  const targets = names.map((n) => {
    const a = byName.get(n);
    const floor = DELEGATION_LAW.soldiers.includes(n) ? DELEGATION_LAW.floorSp.soldier : DELEGATION_LAW.floorSp.publisher;
    return { account: n, netSp: a ? (netSpOf(a, spm) ?? -Infinity) : -Infinity, floor };
  });
  const plan = planDelegation({ masterNetSp: masterNet, targets, spm });
  /* 6 · CAPPED — nothing to do is a verdict */
  if (!plan.ops.length) {
    const out = { ...base, verdict: "NO-OPS", day, reason: plan.skipped[0]?.reason ?? "all-at-floor", skipped: plan.skipped.length };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  /* 7 · SIGNED — one batched tx, self-verified against the LIVE authority */
  const ops = plan.ops.map((o) => ["delegate_vesting_shares", {
    delegator: master,
    delegatee: o.account,
    vesting_shares: o.vests,
  }]);
  const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [bare], chainId: STEEM_CHAIN_ID });
  const secp = await import("@noble/secp256k1");
  let sigVerified = false;
  try {
    const livePub = String(byName.get(master)?.active?.key_auths?.[0]?.[0] ?? "");
    const rawSig = Buffer.from(tx.json.signatures[0], "hex");
    const sigObj = secp.Signature.fromCompact(new Uint8Array(rawSig.slice(1)));
    sigVerified = Boolean(livePub) && secp.verify(sigObj, new Uint8Array(Buffer.from(tx.digestHex, "hex")), pubkeyBytes(livePub));
  } catch { sigVerified = false; }
  if (!sigVerified) {
    const out = { ...base, verdict: "SIGNATURE-VERIFY-FAILED", day, opsPlanned: plan.ops.length };
    writeJson(path.join(S, "delegation-last.json"), out);
    ledger(out);
    return out;
  }
  /* 8 · BROADCAST + LEDGER */
  const b = await rpcCall("network_broadcast_api.broadcast_transaction", [tx.json], 20000);
  const { createHash } = await import("node:crypto");
  const txid = createHash("sha256").update(Buffer.from(tx.serializedHex, "hex")).digest("hex").slice(0, 40);
  const out = {
    ...base, verdict: b?.ok ? "DELEGATED" : "BROADCAST-FAILED", day,
    ops: plan.ops.length, totalSp: plan.totalSp, txid: b?.ok ? txid : null,
    skipped: plan.skipped.map((s) => `${s.account}:${s.reason}`),
    treasuryKeepSp: DELEGATION_LAW.treasuryKeepSp, maxRunSp: DELEGATION_LAW.maxRunSp,
    node: b?.node ?? null, error: b?.ok ? undefined : String(b?.error ?? "").slice(0, 140),
    law: "delegation moves no ownership; reversible via 7-day undelegation; floors, caps and treasury keep are hard law",
  };
  writeJson(path.join(S, "delegation-last.json"), out);
  ledger(out);
  if (b?.ok) {
    for (const o of plan.ops) ledger({ at: now, type: "delegate_vesting_shares", delegator: master, delegatee: o.account, vests: o.vests, sp: o.sp });
  }
  return out;
}
