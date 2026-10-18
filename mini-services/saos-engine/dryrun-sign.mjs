/**
 * dryrun-sign.mjs — R286 · LOCAL SIGNING DRY RUN (the broadcast-ready proof,
 * minus the broadcast).
 *
 * WHY: the operator asked for a local-signing proof rail. The signing stack
 * already exists (steemtx.mjs + signer.mjs, chain-proven by real claims);
 * this runner wraps it in a ZERO-WRITE, ZERO-BROADCAST dry run:
 *   1. loads the runtime key cache (.secrets/army-keys.json, 0600, gitignored,
 *      restored from the sealed vault by vault-revival.mjs)
 *   2. pulls the LIVE on-chain posting authority of every roster account
 *      (one public batch RPC — public data only, zero secrets transmitted)
 *   3. derives each held WIF's pubkey locally and compares it to the live
 *      authority → a full key↔authority matrix across the fleet
 *   4. picks a matching account, builds a real comment op tx, signs it
 *      LOCALLY (RFC6979, deterministic) and cryptographically VERIFIES the
 *      signature against the on-chain authority pubkey (noble secp verify)
 *   5. prints ONLY public artifacts (pubkeys, txid, byte counts, verdicts)
 *
 * SECURITY CONTRACT (mirrors signer.mjs):
 *   - the WIF lives only in process memory, is NEVER returned/logged/serialized
 *   - nothing is broadcast; the tx expires unused in 45s
 *   - no key material is written to disk anywhere in this flow
 *
 * Run: bun dryrun-sign.mjs [account]
 */
import path from "node:path";
import fs from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import * as secp from "@noble/secp256k1";
import { wifDecode, pubkeyFromSeed, pubkeyBytes, buildTx, fingerprint } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(DIR, "..", "..", ".secrets", "army-keys.json");

const out = (o) => console.log(JSON.stringify(o, null, 2));

async function main() {
  const t0 = Date.now();
  const want = process.argv[2] ?? null;

  /* 1. key cache (0600 enforced, gitignored, vault-restored) */
  const st = fs.statSync(CACHE);
  if ((st.mode & 0o077) !== 0) { out({ ok: false, verdict: "REFUSED", reason: "key-cache-permissions-too-open" }); process.exit(1); }
  const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const roster = (cache.accounts ?? []).filter((a) => (a.gens ?? []).some((g) => g.wif));
  if (!roster.length) { out({ ok: false, verdict: "REFUSED", reason: "no-posting-wif-in-cache" }); process.exit(1); }

  /* 2. LIVE posting authorities (one batched public RPC) */
  const names = roster.map((a) => a.name);
  const chain = await rpcCall("condenser_api.get_accounts", [names]);
  if (!chain.ok || !Array.isArray(chain.result)) { out({ ok: false, verdict: "REFUSED", reason: `rpc-failed:${chain.error ?? "?"}` }); process.exit(1); }
  const authority = new Map();
  for (const a of chain.result ?? []) {
    const pubs = (a?.posting?.key_auths ?? []).map((k) => k?.[0]).filter((p) => typeof p === "string");
    if (pubs.length) authority.set(a.name, pubs); /* multi-key authorities: fleet posting keys may be appended (G13 custody restore) */
  }

  /* 3. key↔authority matrix (public facts only) */
  const matrix = roster.map((a) => ({
    account: a.name,
    onChainAuthority: authority.get(a.name) ?? null,
    genMatches: (a.gens ?? []).filter((g) => g.wif).map((g) => ({
      gen: g.gen ?? null,
      matchesAuthority: (authority.get(a.name) ?? []).includes(pubkeyFromSeed(wifDecode(g.wif))),
    })),
  }));
  const matched = matrix.filter((m) => m.genMatches.some((g) => g.matchesAuthority));
  const chosen = (want && matched.find((m) => m.account === want)) || matched[0] || null;
  if (!chosen) {
    out({ ok: false, verdict: "NO-MATCHING-KEY", matrix, note: "no held posting WIF equals any live on-chain authority — custody gap, reported honestly" });
    process.exit(1);
  }

  const acc = roster.find((a) => a.name === chosen.account);
  const gen = (acc.gens ?? []).find((g) => g.wif && pubkeyFromSeed(wifDecode(g.wif)) === chosen.onChainAuthority);
  const postingAuth = chosen.onChainAuthority;

  /* 4. build + sign a REAL tx locally (never broadcast) */
  const dgpo = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo.ok) { out({ ok: false, verdict: "REFUSED", reason: "dgpo-rpc-failed", matrix }); process.exit(1); }
  const now = new Date();
  const permlink = `saos-dryrun-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const ops = [["comment", {
    parent_author: "",
    parent_permlink: "saos-dryrun",
    author: acc.name,
    permlink,
    title: "SAOS dry-run signature proof (not broadcast)",
    body: `Local-signing dry run ${now.toISOString()} — signed with the account's held posting authority and deliberately never broadcast. Permlink ${permlink}.`,
    json_metadata: JSON.stringify({ app: "saos-dryrun", gen: gen.gen ?? null }),
  }]];
  const tx = buildTx({ ops, dgpo: dgpo.result, wifs: [gen.wif] });

  /* 5. cryptographic verify: the local signature against the LIVE authority */
  const raw = Buffer.from(tx.json.signatures[0], "hex");
  let sigVerified = false;
  try {
    const sigObj = secp.Signature.fromCompact(new Uint8Array(raw.slice(1))); /* strip steem header 31+rec */
    sigVerified = secp.verify(sigObj, new Uint8Array(Buffer.from(tx.digestHex, "hex")), pubkeyBytes(postingAuth));
  } catch { sigVerified = false; }

  const txid = Buffer.from(sha256(Buffer.from(tx.serializedHex, "hex"))).toString("hex").slice(0, 40);

  out({
    ok: sigVerified,
    verdict: sigVerified ? "BROADCAST-READY-NOT-BROADCASTED" : "SIGNATURE-VERIFY-FAILED",
    account: acc.name,
    keyGen: gen.gen ?? null,
    wifFingerprint: fingerprint(gen.wif),
    onChainPostingAuthority: postingAuth,
    fleetKeyAuthorityMatrix: { matched: matched.length, total: matrix.length, perAccount: matrix.map((m) => ({ account: m.account, match: m.genMatches.some((g) => g.matchesAuthority), gen: (m.genMatches.find((g) => g.matchesAuthority) ?? {}).gen ?? null })) },
    signature: { count: tx.json.signatures.length, bytes: raw.length, cryptographicallyVerifiedAgainstLiveAuthority: sigVerified },
    tx: { id: txid, refBlock: tx.json.ref_block_num, expiration: tx.json.expiration, ops: tx.json.operations.map(([n]) => n), serializedBytes: tx.serializedHex.length / 2 },
    broadcast: false,
    zeroKeyExposure: "wif held in memory only; outputs above are public artifacts by contract",
    ms: Date.now() - t0,
  });
}

main().catch((e) => { out({ ok: false, verdict: "DRYRUN-ERROR", reason: String(e).slice(0, 120) }); process.exit(1); });
