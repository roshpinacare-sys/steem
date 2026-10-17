/* DIRECTIVE-NOW · one-shot operator directive broadcast (agent-9 wave-4).
 *
 * PURPOSE: the operator-plane law (bus.mjs R243) defines type "directive"
 * (operator-plane → agents, from headcorner only). This tool broadcasts ONE
 * such directive on saos-bus-v1 so the hostless consumer (roshpinacare-sys/
 * Autonomy engine/directive-bus.mjs, cron every 30 min) executes the named
 * task and commits a receipt. Chain = the queue; git = the state; keys = here only.
 *
 * LAWS CARRIED (verbatim from anchor-now-t38.mjs / signer.mjs — no new ones):
 *  · posting role only; custom_json only; nothing here can move funds
 *  · thinkGate verdict must be ALLOW — refusals are final and typed
 *  · custody fail-closed: revive → verifyRoles → adoptAccountPostingWif
 *    (chain judges every WIF; nothing logged but fingerprints/txids)
 *  · body ≤512B enforced by buildBusMessage; rate: exactly ONE op per run
 * USAGE: bun directive-now.mjs [task=health-probe] [runId]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { thinkGate, executeAs, custodyOf, verifyRoles } from "./signer.mjs";
import { reviveWriterIdentity } from "../../scripts/sovereign-selfcustody.mjs";
import { adoptAccountPostingWif } from "./vault-revival.mjs";
import { buildBusMessage, busOp } from "./bus.mjs";

const ACCOUNT = "headcorner";
const DIR = path.dirname(new URL(import.meta.url).pathname);

/* CI rail first (daily.mjs law, R-runner-wif): role-scoped posting WIF from
 * repo secrets, chain-judged at adoption; absent env = zero change. */
const ciPosting = (process.env.CI_ADOPT_WIF_POSTING ?? "").trim();
if (ciPosting) {
  try {
    const bare = ciPosting.startsWith("P") && ciPosting.length >= 51 ? ciPosting.slice(1) : ciPosting;
    const { adoptVerifiedWifIdentity, masterAccount } = await import("./signer.mjs");
    const r = await adoptVerifiedWifIdentity(masterAccount(), bare, { role: "posting" });
    console.error(`ci posting adopt: ${r?.ok ? "VERIFIED-VS-CHAIN" : String(r?.reason ?? "refused").slice(0, 80)}`);
  } catch (e) { console.error(`ci posting adopt error: ${String(e?.message ?? e).slice(0, 80)}`); }
}

const task = String(process.argv[2] ?? "health-probe").replace(/[^a-z0-9._-]/g, "").slice(0, 48) || "health-probe";
const runId = String(process.argv[3] ?? `d-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);

const co0 = custodyOf(ACCOUNT);
if (co0 !== "master-verified") {
  const rev = await Promise.resolve(reviveWriterIdentity()).catch((e) => ({ verdict: `ERROR:${String(e?.message ?? e).slice(0, 80)}` }));
  console.error(`identity revival: ${rev?.verdict ?? "?"}`);
}
const co = custodyOf(ACCOUNT);
console.error(`custody precheck: ${co} — chain-proving via verifyRoles`);
const vr = await Promise.resolve(verifyRoles(ACCOUNT)).catch((e) => ({ verdict: `ERROR:${String(e?.message ?? e).slice(0, 100)}` }));
console.error(`verifyRoles: ${JSON.stringify(vr?.verdict ?? vr).slice(0, 120)}`);
if (custodyOf(ACCOUNT) !== "master-verified") {
  const adopt = await Promise.resolve(adoptAccountPostingWif(ACCOUNT)).catch((e) => ({ ok: false, reason: String(e?.message ?? e).slice(0, 100) }));
  console.error(`vault adoption: ${adopt?.ok ? String(adopt.gen ?? "ok") : String(adopt?.reason ?? "refused").slice(0, 100)}`);
  await Promise.resolve(verifyRoles(ACCOUNT)).catch(() => null);
  if (custodyOf(ACCOUNT) !== "master-verified") {
    console.log(JSON.stringify({ ok: false, verdict: `CUSTODY-REFUSED:${custodyOf(ACCOUNT)}` }));
    process.exit(1);
  }
}

const msg = buildBusMessage({ from: ACCOUNT, to: "*", type: "directive", seq: 1, body: { task, runId } });
const ops = busOp(ACCOUNT, msg);
const gate = thinkGate(ACCOUNT, ops, { source: "agent9-directive" });
if (gate?.verdict !== "ALLOW") {
  console.log(JSON.stringify({ ok: false, verdict: `GATE:${(gate?.reasons ?? []).join(";").slice(0, 140)}` }));
  process.exit(1);
}
const r = await executeAs(ACCOUNT, ops, { tag: "agent9-directive", role: "posting" });
if (r?.ok) {
  console.log(JSON.stringify({ ok: true, verdict: "DIRECTIVE-BROADCAST", txid: r.txid ?? null, task, runId, at: new Date().toISOString() }));
} else {
  console.log(JSON.stringify({ ok: false, verdict: `BROADCAST-FAIL:${String(r?.verdict ?? r?.error ?? "?").slice(0, 120)}` }));
  process.exit(1);
}
