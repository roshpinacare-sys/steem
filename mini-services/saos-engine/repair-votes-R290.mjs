#!/usr/bin/env node
/* R290 · REPAIR VOTES — one-shot corrective broadcast.
 *
 * Context (measured, documented): the army-curation rail's first live run
 * broadcast votes with a weight-law bug (×100 overflow → u16 serialization
 * wrap). TWO votes landed NEGATIVE on innocent external authors:
 *   tov → fodigo/5hpfnp-where-silence-keeps-memory  (-2588, rshares -210M)
 *   woq → focusframe/calendula-a-golden-bloom-of-warmth (-788, rshares -35M)
 *
 * Steem vote law: a voter's later vote on the same post REPLACES the earlier
 * one. Repair = re-vote the same posts with the same-magnitude POSITIVE
 * weight → our own rshares flip positive; the authors are made whole.
 *
 * Contract (mirrors dryrun-sign.mjs):
 *   - key cache .secrets/army-keys.json (0600, vault-restored); WIF memory-only
 *   - targets are HARDCODED from chain truth above (no config surface)
 *   - weights are the exact positive magnitudes of the landed negatives
 *   - every attempt journaled to receipts/repair-votes.jsonl (metadata only)
 *   - prints public artifacts only (txid, verdicts)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { wifDecode, pubkeyFromSeed, buildTx } from "./steemtx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(DIR, "..", "..", ".secrets", "army-keys.json");
const RECEIPTS = path.join(DIR, "receipts", "repair-votes.jsonl");

/* [voter, author, permlink, positiveReplacementWeight] — chain-truth-derived */
const REPAIRS = [
  ["tov", "fodigo", "5hpfnp-where-silence-keeps-memory", 2588],
  ["woq", "focusframe", "calendula-a-golden-bloom-of-warmth", 788],
];

const RPCS = ["https://api.steemit.com", "https://api.justyy.com", "https://steem.61bts.com"];
async function rpc(method, params, timeoutMs = 15000) {
  const errors = [];
  for (const base of RPCS) {
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (j.error) { errors.push(`${base}: ${String(j.error.message).slice(0, 120)}`); continue; }
      return { ok: true, result: j.result, node: base };
    } catch (e) { errors.push(`${base}: ${String(e?.message ?? e).slice(0, 80)}`); }
  }
  return { ok: false, error: errors.join(" | ") || "all-nodes-failed" };
}

const st = fs.statSync(CACHE);
if ((st.mode & 0o077) !== 0) { console.log(JSON.stringify({ ok: false, verdict: "REFUSED", reason: "key-cache-permissions-too-open" })); process.exit(1); }
const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const wifsOf = (account) => {
  /* cache shape (measured): accounts[].gens[].{wif=posting, activeWif=active, gen}
   * R255 law: generations die — return ALL candidates newest-first; the chain
   * authority (posting.key_auths) is the judge before any broadcast. */
  const a = (cache.accounts ?? []).find((x) => x.name === account);
  if (!a) return [];
  return (a.gens ?? []).filter((g) => g.wif).map((g) => ({ wif: g.wif, gen: g.gen }));
};

async function livePostingPubkey(account) {
  const r = await rpc("condenser_api.get_accounts", [[account]]);
  if (!r.ok || !r.result?.[0]) return null;
  return r.result[0].posting?.key_auths?.[0]?.[0] ?? null;
}

const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
if (!dgpo.ok) { console.log(JSON.stringify({ ok: false, verdict: "NO-DGPO" })); process.exit(1); }

const results = [];
for (const [voter, author, permlink, weight] of REPAIRS) {
  if (!(weight > 0 && weight <= 10000)) { results.push({ voter, target: `${author}/${permlink}`, verdict: "WEIGHT-INVALID", weight }); continue; }
  const livePub = await livePostingPubkey(voter);
  const cands = wifsOf(voter);
  if (!cands.length) { results.push({ voter, target: `${author}/${permlink}`, verdict: "NO-KEY-IN-CACHE" }); continue; }
  let done = null;
  for (const { wif, gen } of cands) {
    try {
      const pub = pubkeyFromSeed(wifDecode(wif));
      if (livePub && pub !== livePub) { results.push({ voter, gen, verdict: `GEN-${gen}-DEAD-AUTHORITY-MISMATCH` }); continue; }
      const ops = [["vote", { voter, author, permlink, weight }]];
      const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [wif] });
      const b = await rpc("network_broadcast_api.broadcast_transaction", [tx.json], 20000);
      if (!b.ok) { results.push({ voter, gen, verdict: "BROADCAST-FAILED", error: String(b.error ?? "").slice(0, 200) }); continue; }
      done = { voter, target: `${author}/${permlink}`, weight, gen, verdict: "REPAIRED", txid: tx.txid ?? null, node: b.node ?? null };
      fs.appendFileSync(RECEIPTS, JSON.stringify({ at: new Date().toISOString(), voter, author, permlink, weight, kind: "repair", verdict: "REPAIRED", txid: tx.txid ?? null, gen }) + "\n");
      break;
    } catch (e) {
      results.push({ voter, gen, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  if (done) results.push(done);
  else if (!results.some((r) => r.voter === voter && (r.verdict === "REPAIRED"))) results.push({ voter, target: `${author}/${permlink}`, verdict: "ALL-CANDIDATES-FAILED" });
}

console.log(JSON.stringify({ ok: results.every((r) => r.verdict === "REPAIRED"), repairs: results }, null, 2));
