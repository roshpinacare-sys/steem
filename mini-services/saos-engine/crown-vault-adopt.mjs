/**
 * crown-vault-adopt.mjs — CROWN-VAULT CUSTODY REVIVAL (2026-11-01, REVISIT-R314b).
 *
 * WHY THIS EXISTS (measured, honest): the old revival (vault-revival.mjs) pulls
 * army keys from a GIT-VAULT carrier (GEN-1 GEN-1-ERA-META.json / GEN-2
 * KEYS-ZIP-*.zip.enc under agent/vault/ on origin). Measured 2026-11-01:
 * NEITHER carrier exists on any reachable ref (origin/saos-cockpit has only
 * agent/recovery-meta.json) → every revival dies "vault-had-no-army-posting-keys"
 * → army-custody.json reads REVIVAL-FAIL → the delegation rail (R314) refuses
 * at gate 3 FOREVER while workers starve (hcsoldier4/5 net 0.0 SP). Meanwhile
 * THE VAULT OF RECORD — .secrets/custody-vault/ (crown-map.json et al) — holds
 * the fleet's WIFs and is chain-verified 13/13 LIVE by master-judge.mjs on
 * every patrol. The custody evidence EXISTS; only the adoption path was
 * missing. This tool wires the vault of record into the same fail-closed
 * adoption law (R302/R312): every WIF is chain-judged against the LIVE
 * authority before it enters memory; nothing is fabricated; verdicts only.
 *
 * WHAT IT DOES (idempotent, one process so the rail's in-memory credential
 * gate sees the adopted identities):
 *   1. walk .secrets/custody-vault/*.json for WIF candidates (same walk as
 *      master-judge.mjs — WIF_RE, fingerprints only in output)
 *   2. per census account: try every held WIF against every role
 *      (posting → active → owner → memo) via adoptVerifiedWifIdentity —
 *      the chain decides; first live match wins, failures recorded as wounds
 *   3. materializeArmyCacheFromHeld → 0600 cache re-materialization (R312)
 *   4. write state/army-custody.json HONESTLY:
 *      FLEET-CUSTODY-ALIVE iff verified === total > 0, else a refusal that
 *      names the wounded accounts. Never writes ALIVE on partial custody.
 *   5. journal to state/exec-log.jsonl (verdict-only)
 *
 * USAGE:  node crown-vault-adopt.mjs            (adopt + verdict)
 *         node crown-vault-adopt.mjs --verify   (verdict only, no writes)
 * EXIT:   0 = FLEET-CUSTODY-ALIVE (full), 2 = partial/refused, 1 = error.
 * Never prints key material — fingerprints (8 hex) only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as secp from "@noble/secp256k1";
import { createHash } from "node:crypto";
import {
  masterAccount,
  adoptVerifiedWifIdentity,
  armyCustodyState,
  materializeArmyCacheFromHeld,
} from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", ".."); // .../steem
const SECRETS = path.join(REPO, ".secrets");
const VAULT = path.join(SECRETS, "custody-vault");
const CENSUS = path.join(SECRETS, "census-verified.json");
const STATE = path.join(DIR, "state");
const CACHE_FILE = path.join(SECRETS, "army-keys.json");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");
const CUSTODY_FILE = path.join(STATE, "army-custody.json");

const fp = (s) => createHash("sha256").update(String(s)).digest().toString("hex").slice(0, 8);
const WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;

function collectWifs(node, out, p = "") {
  if (!node || typeof node !== "object") {
    if (typeof node === "string" && WIF_RE.test(node.trim())) out.push({ wif: node.trim(), path: p });
    return;
  }
  for (const [k, v] of Object.entries(node)) collectWifs(v, out, p ? `${p}.${k}` : k);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
function wifSeed(wif) {
  const d = b58d(wif);
  let body, chk;
  if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); }
  else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); }
  else throw new Error("wif-length");
  const c = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!c.equals(chk)) throw new Error("wif-checksum");
  return Buffer.from(body.subarray(1, 33));
}
function steemPub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "STM" + (() => { let n = BigInt("0x" + Buffer.concat([pub, chk]).toString("hex")), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; })();
}

async function rpc(method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message).slice(0, 100));
      return j.result;
    } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}

const ROLES = ["posting", "active", "owner", "memo"];

export async function runAdopt({ verifyOnly = false } = {}) {
  const master = masterAccount();

  if (!fs.existsSync(VAULT)) {
    return { ok: false, verdict: "REFUSED", reason: `no-custody-vault at ${VAULT}`, verified: 0, total: 0, results: [], wounds: [] };
  }
  const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"));
  const roster = Object.keys(census).filter((k) => !k.startsWith("_"));
  if (!roster.includes(master)) roster.unshift(master);
  const total = roster.length;

  /* 1 · gather candidates from the vault of record */
  const cands = [];
  for (const f of fs.readdirSync(VAULT)) {
    if (!f.endsWith(".json")) continue;
    try { collectWifs(JSON.parse(fs.readFileSync(path.join(VAULT, f), "utf8")), cands, f); } catch { /* skip unreadable */ }
  }
  const seen = new Set();
  const uniq = cands.filter((c) => (seen.has(c.wif) ? false : (seen.add(c.wif), true)));

  /* 2 · live chain authorities per account */
  const chain = await rpc("condenser_api.get_accounts", [roster]);
  const byName = new Map(chain.map((a) => [String(a.name), a]));

  /* 3 · role-matched adoption — the chain is the only judge */
  const results = [];
  for (const name of roster) {
    const acc = byName.get(name);
    if (!acc) { results.push({ account: name, verdict: "NOT-ON-CHAIN" }); continue; }
    const auths = {
      posting: String(acc.posting?.key_auths?.[0]?.[0] ?? ""),
      active: String(acc.active?.key_auths?.[0]?.[0] ?? ""),
      owner: String(acc.owner?.key_auths?.[0]?.[0] ?? ""),
      memo: String(acc.memo_key ?? ""),
    };
    /* T-594 MULTI-ROLE ADOPTION (2026-11-04, owner activation order): the old
     * first-match break adopted ONE role per account (posting first) — MM
     * hands then fail-closed on every limit_order_create (active role never
     * adopted). R255 identity merge makes multi-role adoption safe (each
     * adopt ADDS a role to the same identity), so adopt EVERY chain-matched
     * role the vault holds. The chain remains the only judge. */
    const adoptedRoles = [];
    for (const role of ROLES) {
      const want = auths[role];
      if (!want) continue;
      for (const c of uniq) {
        let pub;
        try { pub = steemPub(c.wif); } catch { continue; }
        if (pub !== want) continue;
        if (verifyOnly) { adoptedRoles.push({ role, fp: fp(c.wif) }); break; }
        const r = await adoptVerifiedWifIdentity(name, c.wif, { role });
        if (r?.ok) { adoptedRoles.push({ role, fp: fp(c.wif) }); break; }
      }
    }
    results.push(adoptedRoles.length
      ? { account: name, verdict: "VERIFIED-VS-CHAIN", roles: adoptedRoles.map((x) => x.role), fp: adoptedRoles[0].fp }
      : { account: name, verdict: "NO-CHAIN-MATCH", tried: uniq.length });
  }

  const verified = results.filter((r) => r.verdict === "VERIFIED-VS-CHAIN").length;
  const wounds = results.filter((r) => r.verdict !== "VERIFIED-VS-CHAIN");
  const alive = verified === total && total > 0;

  /* 4 · cache re-materialization + honest verdict file */
  if (!verifyOnly && alive) {
    const mat = materializeArmyCacheFromHeld(roster, CACHE_FILE);
    if (!mat?.ok) results.push({ account: "*", verdict: `CACHE-REMAT-REFUSED:${mat?.reason ?? "?"}` });
  }
  const verdictDoc = {
    at: new Date().toISOString(),
    verdict: alive ? "FLEET-CUSTODY-ALIVE" : "CUSTODY-REFUSED",
    source: "crown-vault-adopt (vault of record .secrets/custody-vault — REVISIT-R314b)",
    after: { verified, total },
    accounts: Object.fromEntries(results.map((r) => [r.account, r.verdict])),
    wounds: wounds.map((r) => `${r.account}:${r.verdict}`),
    law: "every WIF chain-judged against the LIVE authority before adoption (fail-closed); partial custody never writes ALIVE",
  };
  if (!verifyOnly) {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(CUSTODY_FILE, JSON.stringify(verdictDoc, null, 2));
    fs.appendFileSync(LOG_FILE, JSON.stringify({ at: verdictDoc.at, tag: "crown-vault-adopt", verified, total, verdict: verdictDoc.verdict }) + "\n");
  }

  return { ok: alive, verdict: verdictDoc.verdict, verified, total, results, wounds: verdictDoc.wounds, doc: verdictDoc };
}

/* direct invocation → run + process exit; imported → caller owns the lifecycle */
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirect) {
  main().catch((e) => { console.log(`CROWN-VAULT-ADOPT ERROR ${String(e?.message ?? e).slice(0, 140)}`); process.exit(1); });
}

async function main() {
  const verifyOnly = process.argv.includes("--verify");
  const out = await runAdopt({ verifyOnly });
  if (out.reason) { console.log(`CROWN-VAULT-ADOPT REFUSED reason=${out.reason}`); process.exit(1); }
  console.log(`CROWN-VAULT-ADOPT ${out.verdict} verified=${out.verified}/${out.total}${out.wounds.length ? ` wounds=[${out.wounds.join(",")}]` : ""}${verifyOnly ? " (verify-only)" : ""}`);
  process.exit(out.ok ? 0 : 2);
}
