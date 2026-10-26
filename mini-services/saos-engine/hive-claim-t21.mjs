// hive-claim-t21.mjs — HIVE FLEET CLAIM LANE (T21 autonomy · owner order 2026-10-19:
// "הארכיטקטורה תפעל הכל כבעלים · יש את כל המפתחות · ודא שהיא יודעת להשתמש בהכל").
// The architecture claims the fleet's own pending HIVE rewards from EXISTING custody
// (ROT2_FLEET_KEYS bundle — measured 2026-10-19: 5 roster refs hold live HIVE
// active+posting via ESTATE-CENSUS on the runner).
//
// LAW: chain-is-the-judge — every WIF is matched to its account BY the live
// posting authority (bit-exact), never by labels. Idempotent: zero pending → SKIP.
// ZERO EXPOSURE: refs, txids, verdicts only. Key material never leaves env/memory.
//
// Run (Domain runner): bun mini-services/saos-engine/hive-claim-t21.mjs
// Env: ROT2_FLEET_KEYS (bundle) · FLEET_ROSTER_MAP (pseudonym law) · DRY=1 (gates only)
import { readFileSync } from "node:fs";
import { buildTx, HIVE_CHAIN_ID, wifDecode, pubkeyFromSeed } from "./steemtx.mjs";

const NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://hived.emre.sh"];
const DRY = process.env.DRY === "1";
const WIF_RE = /[5JK][1-9A-HJ-NP-Za-km-z]{50}/g;

async function rpc(node, method, params) {
  const res = await fetch(node, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": "saos-hive-claim-t21/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(("rpc: " + JSON.stringify(j.error)).slice(0, 160));
  return j.result;
}
async function rpcAny(method, params) {
  let lastErr = null;
  for (const node of NODES) {
    try { return { r: await rpc(node, method, params), node }; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all-hive-nodes-failed");
}

function collectWifs(node, out) {
  out = out || [];
  if (typeof node === "string") {
    const t = node.trim();
    const m = t.match(WIF_RE);
    if (m) { out.push(...m); return out; }
    try {
      const dec = Buffer.from(t, "base64").toString("utf8");
      if (dec && dec !== t) {
        try { collectWifs(JSON.parse(dec), out); } catch (_) { const m2 = dec.match(WIF_RE); if (m2) out.push(...m2); }
      }
    } catch (_) {}
  } else if (Array.isArray(node)) node.forEach((x) => collectWifs(x, out));
  else if (node && typeof node === "object") Object.values(node).forEach((x) => collectWifs(x, out));
  return out;
}
function privPub(w) {
  try { return pubkeyFromSeed(wifDecode(w)); } catch { return null; }
}
const pubBody = (p) => String(p).slice(3);

const REF2NAME = (() => {
  try {
    const m = JSON.parse(process.env.FLEET_ROSTER_MAP || "");
    const f = {};
    if (m && m.refs) Object.assign(f, m.refs);
    if (m && m.names) Object.assign(f, m.names);
    for (const [k, v] of Object.entries(m || {})) if (typeof v === "string") f[k] = v;
    const out = {};
    for (const [k, v] of Object.entries(f)) { if (k.startsWith("acct-")) out[k] = v; else out[v] = k; }
    return out;
  } catch { return {}; }
})();

const bundleRaw = (process.env.ROT2_FLEET_KEYS || "").trim();
const BUNDLE = collectWifs(bundleRaw);
console.log(JSON.stringify({ lane: "hive-claim-t21", dry: DRY, bundle_wifs: BUNDLE.length, refs_mapped: Object.keys(REF2NAME).length }));
if (!BUNDLE.length) { console.log(JSON.stringify({ verdict: "NO-BUNDLE", reason: "ROT2_FLEET_KEYS absent or WIF-free" })); process.exit(0); }

const tot = { claimed: 0, skipped: 0, failed: 0, dry_ok: 0 };
for (let i = 0; i < 20; i++) {
  const ref = "acct-" + String(i).padStart(2, "0");
  const name = REF2NAME[ref];
  if (!name) continue;
  try {
    const { r: accs } = await rpcAny("condenser_api.get_accounts", [[name]]);
    const acc = (accs || [])[0];
    if (!acc) { console.log(`${ref}: absent-on-chain`); continue; }
    const pending = {
      hive: String(acc.reward_hive_balance ?? "0.000 HIVE").trim(),
      hbd: String(acc.reward_hbd_balance ?? "0.000 HBD").trim(),
      vests: String(acc.reward_vesting_balance ?? "0.000000 VESTS").trim(),
    };
    const hasPending = [pending.hive, pending.hbd, pending.vests].some((s) => parseFloat(s) > 0);
    if (!hasPending) { console.log(`${ref}: SKIP-NO-PENDING`); tot.skipped++; continue; }
    const postingPubs = (acc.posting?.key_auths || []).map((x) => x[0]);
    const activePubs = (acc.active?.key_auths || []).map((x) => x[0]);
    const wif = BUNDLE.find((w) => {
      const p = privPub(w);
      return p && (postingPubs.some((k) => pubBody(k) === pubBody(p)) || activePubs.some((k) => pubBody(k) === pubBody(p)));
    });
    if (!wif) { console.log(`${ref}: SKIP-NO-KEY (pending=${pending.hive},${pending.hbd},${pending.vests})`); tot.skipped++; continue; }
    if (DRY) { console.log(`${ref}: DRY-OK would-claim ${pending.hive} ${pending.hbd} ${pending.vests}`); tot.dry_ok++; continue; }
    const { r: gp } = await rpcAny("condenser_api.get_dynamic_global_properties", []);
    const tx = buildTx({
      ops: [["claim_reward_balance", { account: name, reward_steem: pending.hive, reward_sbd: pending.hbd, reward_vests: pending.vests }]],
      dgpo: gp, wifs: [wif], chainId: HIVE_CHAIN_ID,
    });
    const { r: bc } = await rpcAny("condenser_api.broadcast_transaction_synchronous", [tx.json]);
    await new Promise((r) => setTimeout(r, 3000));
    const { r: accs2 } = await rpcAny("condenser_api.get_accounts", [[name]]);
    const a2 = (accs2 || [])[0];
    const cleared = ["reward_hive_balance", "reward_hbd_balance", "reward_vesting_balance"].every((f) => parseFloat(String(a2?.[f] ?? "0")) === 0);
    console.log(`${ref}: ${cleared ? "CLAIMED-VERIFIED" : "BROADCASTED-READBACK-UNCLEAR"} txid=${bc?.id ?? "?"} block=${bc?.block_num ?? "?"} (${pending.hive} ${pending.hbd} ${pending.vests})`);
    cleared ? tot.claimed++ : tot.failed++;
  } catch (e) {
    console.log(`${ref}: FAIL ${String(e.message || e).slice(0, 120)}`);
    tot.failed++;
  }
}
console.log(JSON.stringify({ verdict: DRY ? "DRY-CENSUS-DONE" : "HIVE-CLAIM-DONE", ...tot }));

// ── HIVE CURATION LANE (CURATE=1): posting-authority value operation ──
// The custody accounts vote on fresh trending content in the estate's domains —
// curation rewards accrue → the claim lane above harvests them on later beats.
// Gates: no self-vote · fresh content (<36h) · modest weight · dupe → chain
// rejects (fail-closed, harmless, receipted) · txid evidence only.
const CURATE = process.env.CURATE === "1";
const CURATE_WEIGHT = Math.max(100, Math.min(10000, parseInt(process.env.CURATE_WEIGHT || "2000", 10)));
const TAGS = (process.env.CURATE_TAGS || "software,technology,programming,finance,cryptocurrency,life").split(",").map((s) => s.trim()).filter(Boolean);
if (CURATE && !DRY) {
  console.log(JSON.stringify({ lane: "hive-curation-t21", weight: CURATE_WEIGHT, tags: TAGS.length }));
  let votes = 0, vfail = 0;
  let ti = 0;
  for (let i = 0; i < 20; i++) {
    const ref = "acct-" + String(i).padStart(2, "0");
    const name = REF2NAME[ref];
    if (!name) continue;
    try {
      const { r: accs } = await rpcAny("condenser_api.get_accounts", [[name]]);
      const acc = (accs || [])[0];
      if (!acc) continue;
      const postingPubs = (acc.posting?.key_auths || []).map((x) => x[0]);
      const wif = BUNDLE.find((w) => {
        const p = privPub(w);
        return p && postingPubs.some((k) => pubBody(k) === pubBody(p));
      });
      if (!wif) continue;
      const tag = TAGS[ti++ % TAGS.length];
      const { r: disc } = await rpcAny("condenser_api.get_discussions_by_trending", [{ tag, limit: 12 }]);
      const fresh = (disc || []).filter((d) => {
        const ageH = (Date.now() - new Date(d.created + "Z").getTime()) / 3.6e6;
        return ageH > 0.6 && ageH < 36 && d.author !== name;
      });
      if (!fresh.length) { console.log(`${ref}: CURATE-SKIP no-fresh-${tag}`); continue; }
      const pick = fresh[Math.floor(Date.now() / 60000) % Math.min(fresh.length, 5)];
      const { r: gp } = await rpcAny("condenser_api.get_dynamic_global_properties", []);
      const tx = buildTx({
        ops: [["vote", { voter: name, author: pick.author, permlink: pick.permlink, weight: CURATE_WEIGHT }]],
        dgpo: gp, wifs: [wif], chainId: HIVE_CHAIN_ID,
      });
      const { r: bc } = await rpcAny("condenser_api.broadcast_transaction_synchronous", [tx.json]);
      console.log(`${ref}: VOTED txid=${bc?.id ?? "?"} on @${pick.author.slice(0, 3)}*** /${String(pick.permlink).slice(0, 40)} tag=${tag} w=${CURATE_WEIGHT}`);
      votes++;
    } catch (e) {
      console.log(`${ref}: CURATE-FAIL ${String(e.message || e).slice(0, 100)}`);
      vfail++;
    }
  }
  console.log(JSON.stringify({ verdict: "HIVE-CURATION-DONE", votes, vfail }));
}
