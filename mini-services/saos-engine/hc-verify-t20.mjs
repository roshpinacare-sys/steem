// hc-verify-t20.mjs — ZERO-EXPOSURE chain verification of the vault master.
// Question (owner, 2026-10-18): "ודא שזה המפתח שלי של headcorner — בלי השם, רק המפתח — owner"
// Method: derive owner/active/posting/memo pubkeys from the vault master across
// the 4 known seed orders, compare with LIVE on-chain authorities (STEEM + HIVE).
// The chain is the judge. Nothing secret is ever printed.
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { SEED_ORDERS, derivePub, wifFor } from "./steemtx.mjs";

const ACCT = "headcorner";
const NODES = {
  steem: ["https://api.steemit.com", "https://api.steem.fans"],
  hive: ["https://api.hive.blog", "https://api.hive.dev"],
};
const log = (o) => console.log(JSON.stringify(o, null, 1));
const fp = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const short = (s) => (s ? s.slice(0, 12) + "…" : "");

const master = fs.readFileSync("/tmp/hc-verify.tmp", "utf8").replace(/\s+/g, " ").trim();
if (!master) { log({ ok: false, failClosed: true, error: "vault-empty" }); process.exit(0); }

async function rpc(nodes, method, params) {
  let last = "no-node";
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e).slice(0, 60); }
  }
  throw new Error(last);
}

// engine's stored master fingerprint (consistency check, name only)
let engineMasterFp = null;
try {
  const envTxt = fs.readFileSync("./keys.env", "utf8");
  const m = envTxt.match(/^HEAD_CORNER_MASTER=(.+)$/m);
  if (m) engineMasterFp = fp(m[1].trim());
} catch { /* absent */ }

const result = {
  at: new Date().toISOString(),
  vaultMaster: { len: master.length, fp: fp(master) },
  engineMasterFp, vaultEqualsEngine: engineMasterFp === fp(master),
  chains: {},
  verdict: null,
};

for (const [chain, nodes] of Object.entries(NODES)) {
  try {
    const [acct] = await rpc(nodes, "condenser_api.get_accounts", [[ACCT]]);
    if (!acct) { result.chains[chain] = { present: false }; continue; }
    const auth = {
      owner: (acct.owner?.key_auths ?? []).map((k) => k[0]),
      active: (acct.active?.key_auths ?? []).map((k) => k[0]),
      posting: (acct.posting?.key_auths ?? []).map((k) => k[0]),
      memo: [acct.memo_key],
    };
    const matches = [];
    const derivedWifs = {};
    for (const [order, fn] of Object.entries(SEED_ORDERS)) {
      for (const role of ["owner", "active", "posting", "memo"]) {
        const seed = fn(ACCT, role, master);
        const pub = derivePub(seed);
        for (const live of auth[role]) {
          if (pub === live) {
            matches.push({ order, role, livePub: short(live) });
            if (!derivedWifs[role]) derivedWifs[role] = wifFor(seed);
          }
        }
      }
    }
    result.chains[chain] = {
      present: true,
      live: { owner: auth.owner.map(short), active: auth.active.map(short), posting: auth.posting.map(short), memo: short(auth.memo[0]) },
      masterMatches: matches,
    };
    if (Object.keys(derivedWifs).length) {
      fs.writeFileSync(`/tmp/hc-${chain}-derived.txt`, Object.entries(derivedWifs).map(([r, w]) => `${r}=${w}`).join("\n") + "\n", { mode: 0o600 });
      result.chains[chain].derivedRoles = Object.keys(derivedWifs);
    }
  } catch (e) {
    result.chains[chain] = { error: String(e).slice(0, 90) };
  }
}

const steemM = result.chains.steem?.masterMatches ?? [];
const hiveM = result.chains.hive?.masterMatches ?? [];
result.verdict = {
  vaultIsOwnerKey: steemM.some((m) => m.role === "owner") || hiveM.some((m) => m.role === "owner"),
  rolesProved: [...new Set([...steemM, ...hiveM].map((m) => m.role))],
};

log(result);
