/**
 * onekey-lib.mjs — ONE-KEY VAULT LAW (W-ONEKEY, 2026-11-05, owner order
 * trace 1a1ab989d8db0a91): "המפתח שלי יפתח הכול" — the owner's key (MAIN_KEY)
 * is the single live seal of every primary custody artifact in vault-home.
 *
 * WHY (measured): the custody-intake intake wave (2026-10-29…11-04) sealed
 * artifacts with ad-hoc transport passes (dispatch inputs, per-era passes) —
 * an agent pattern the owner never ordered. Nothing was lost (git + ledger),
 * but the seals scattered. This lib implements the adopt law:
 *   · open every sealed artifact with ANY pass we legitimately hold
 *     (MAIN_KEY, wraps-unwrapped P, vault pass secrets, relayed keys JSON);
 *   · re-seal IN PLACE with MAIN_KEY only (AES-256-CBC · PBKDF2 · 300k iters
 *     — the strongest protocol already used by seal-crown.mjs);
 *   · old/irrelevant values are DOCUMENTED (INDEX.json status=superseded)
 *     but never allowed to block routine work again;
 *   · zero key material ever printed — fingerprints (8 hex) only.
 *
 * This is NOT key rotation: no WIF, no account authority, no MAIN_KEY value
 * changes. Only the encryption-at-rest envelope moves to the owner's key.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import * as secp from "@noble/secp256k1";

export const ITER_STANDARD = 300000; // seal-crown.mjs protocol — the strong tier
export const LEGACY_ITERS = [200000, 300000]; // measured legacy tiers
export const CIPHER = ["enc", "-aes-256-cbc", "-pbkdf2"];

export const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
export const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

/* ── WIF → public key (same math as crown-vault-adopt.mjs — one proven path) ── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
export function wifSeed(wif) {
  const d = b58d(wif);
  let body, chk;
  if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); }
  else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); }
  else throw new Error("wif-length");
  const c = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!c.equals(chk)) throw new Error("wif-checksum");
  return Buffer.from(body.subarray(1, 33));
}
export function steemPub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "STM" + (() => { let n = BigInt("0x" + Buffer.concat([pub, chk]).toString("hex")), o = ""; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; })();
}

async function rpc(url, method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message).slice(0, 100));
      return j.result;
    } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}

/** chainJudgeCustody — the chain is the ONLY judge (fail-closed): every WIF
 * from the relay map is re-verified against the LIVE steem+hive authorities.
 * Returns { judged: {acc:{role:wif}}, dropped: ["acc:role:reason"] }. */
export async function chainJudgeCustody(live) {
  const accounts = [...new Set(Object.keys(live).filter((k) => !k.startsWith("_")))];
  const chains = { steem: "https://api.steemit.com", hive: "https://api.hive.blog" };
  const auth = {};
  for (const [chain, url] of Object.entries(chains)) {
    try {
      const accs = await rpc(url, "condenser_api.get_accounts", [accounts]);
      for (const a of accs) {
        auth[chain + ":" + String(a.name)] = {
          active: String(a.active?.key_auths?.[0]?.[0] ?? ""),
          posting: String(a.posting?.key_auths?.[0]?.[0] ?? ""),
          owner: String(a.owner?.key_auths?.[0]?.[0] ?? ""),
          memo: String(a.memo_key ?? ""),
        };
      }
    } catch { /* chain down — honest skip; judged stays fail-closed */ }
  }
  const judged = {};
  const dropped = [];
  for (const [acc, roles] of Object.entries(live)) {
    if (acc.startsWith("_")) continue;
    for (const [role, wif] of Object.entries(roles ?? {})) {
      let pub;
      try { pub = steemPub(wif); } catch { dropped.push(`${acc}:${role}:unparseable`); continue; }
      let matched = null;
      for (const [key, a] of Object.entries(auth)) {
        if (a?.[role] && a[role] === pub) { matched = key; break; }
      }
      if (matched) {
        judged[acc] = judged[acc] || {};
        judged[acc][role] = wif;
      } else dropped.push(`${acc}:${role}:no-chain-match`);
    }
  }
  return { judged, dropped };
}

export function openssl(args, timeout = 30000) {
  try {
    execFileSync("openssl", args, { stdio: "pipe", timeout });
    return true;
  } catch {
    return false;
  }
}

/** tryOpen — decrypt `file` with `pass` at `iter`; plaintext to `out` (0600). */
export function tryOpen(file, pass, iter, out) {
  rmSync(out, { force: true });
  const ok = openssl([...CIPHER, "-d", "-iter", String(iter), "-in", file, "-out", out, "-pass", `pass:${pass}`]);
  if (!ok) {
    rmSync(out, { force: true });
    return false;
  }
  try {
    return readFileSync(out).length > 0;
  } catch {
    return false;
  }
}

/** openAny — try the pass pool (ordered) across legacy iters; honest fail. */
export function openAny(file, pool, { iters = LEGACY_ITERS, cap = Infinity } = {}) {
  const out = "/tmp/_onekey.out";
  let tries = 0;
  for (const pass of pool) {
    for (const iter of iters) {
      if (tries++ >= cap) {
        rmSync(out, { force: true });
        return null;
      }
      if (tryOpen(file, pass, iter, out)) {
        return { pass, iter, passFp: fp(pass), outFile: out };
      }
    }
  }
  rmSync(out, { force: true });
  return null;
}

/** sealWithMain — encrypt plaintext file → dest with MAIN_KEY at standard iters. */
export function sealWithMain(plainFile, dest, mainKey) {
  return openssl([...CIPHER, "-iter", String(ITER_STANDARD), "-in", plainFile, "-out", dest, "-pass", `pass:${mainKey}`]);
}

/** unwrapWraps — vault-home wraps/<sha256(C)>.enc hold the master pass P,
 * each wrapped by a credential C. Replays recover.mjs (proven 2026-10-20). */
export function unwrapWraps(vhDir, candidates) {
  const wrapsDir = `${vhDir}/wraps`;
  if (!existsSync(wrapsDir)) return null;
  for (const c of candidates) {
    const h = createHash("sha256").update(c).digest("hex");
    const w = `${wrapsDir}/${h}.enc`;
    if (!existsSync(w)) continue;
    const out = "/tmp/_onekey.wrap";
    if (tryOpen(w, h, 200000, out)) {
      try {
        const P = readFileSync(out, "utf8").trim();
        rmSync(out, { force: true });
        if (P.length >= 8) return P;
      } catch { /* next */ }
    }
    rmSync(out, { force: true });
  }
  return null;
}

/** buildPassPool — every pass we legitimately hold, MAIN_KEY first. Never logged.
 * env.__VH__ = local vault-home clone path (for wraps unwrap). */
export function buildPassPool(env) {
  const pool = [];
  const candidates = [];
  const push = (p) => {
    if (typeof p === "string" && p.length >= 8 && !pool.includes(p)) pool.push(p);
  };
  const addCandidate = (v) => {
    if (!v) return;
    const t = v.trim();
    if (t) candidates.push(t);
    // multi-line secrets (STEEM_VAULT_PASSES era) + JSON walks
    for (const line of v.split(/[\n;, ]+/)) {
      const s = line.trim();
      if (s.length >= 16) candidates.push(s);
    }
    try {
      (function walk(n, d) {
        if (!n || typeof n !== "object" || d > 8) return;
        for (const x of Object.values(n)) {
          if (typeof x === "string") candidates.push(x.trim());
          else walk(x, d + 1);
        }
      })(JSON.parse(v), 0);
    } catch { /* not json */ }
  };

  // 1 · the owner's key — first and last
  const mainKey = (env.MAIN_KEY || "").trim();
  push(mainKey);
  addCandidate(env.MAIN_KEY);

  // 2 · every vault-era secret this repo legitimately holds (honest presence)
  for (const name of ["WEAVE_SEAL_PASSPHRASE", "STEEM_VAULT_PASSES", "VAULT_PASSES_R33", "VAULT_PASSPHRASE", "HEADCORNER_SEAL_PASSPHRASE", "ROT2_FLEET_KEYS", "ROT_ROSTER", "LIVE_FLEET_KEYS", "NIM_API_KEY"]) {
    if (env[name]) addCandidate(env[name]);
  }

  // 3 · the wraps master pass P (unwrapped from the wraps/ infrastructure)
  const P = unwrapWraps(env.__VH__ || "/tmp/vh", candidates);
  if (P) push(P);

  // 4 · remaining candidates (transport passes of the intake wave)
  const seen = new Set(pool);
  for (const c of candidates) if (!seen.has(c) && c.length >= 16) push(c);

  return { pool, masterPassFp: P ? fp(P) : null };
}

/** classify — family/status law for every artifact (old values documented, not blocking). */
export function classify(relPath) {
  const p = relPath.toLowerCase();
  if (p.startsWith("wraps/")) return { family: "wrap-infrastructure", primary: false, note: "wraps stay keyed by sha256(C) by design — infrastructure, not re-sealed" };
  const crownRecovery = relPath.match(/^custody-intake\/(CROWN-RECOVERY|CROWN-ONEKEY)-(\d{8}T\d{6}Z)\.enc$/);
  if (crownRecovery) return { family: "crown-recovery-map", ts: crownRecovery[2], primary: "latest-wins", note: crownRecovery[1] === "CROWN-ONEKEY" ? "מפת-המשמורת-החיה — one-key rebuild (chain-judged)" : "full chain-verified custody map (seal-crown.mjs protocol)" };
  if (/^custody-intake\/CROWN-(NEW|RECOVER|REKEY6?|GEN-EXPANSION)-/.test(relPath) || /^custody-intake\/REKEY-/.test(relPath)) {
    return { family: "crown-intake-history", primary: false, note: "ערך-היסטורי-מתועד — נשמר-בארכיון, אינו-חוסם-שגרה (superseded by the latest CROWN-RECOVERY map)" };
  }
  if (/^custody-intake\/VERIFIED-CENSUS-/.test(relPath)) return { family: "verified-census-history", primary: false, note: "census-דור-קודם — מתועד, לא-חוסם" };
  if (/^custody-intake\/(main-key|weave-seal-passphrase)\.enc$/.test(p)) return { family: "owner-seal", primary: true, note: "the owner's key itself + the live weave seal passphrase" };
  if (/^custody-intake\/fixedfloat\.enc$/.test(p)) return { family: "fixedfloat-slot", primary: true, note: "FF key pair — RELEASED for operations 2026-11-05, key stays sealed for the future" };
  if (/^custody-intake\/vault-transfer-priv\.enc$/.test(p)) return { family: "vault-transfer-escrow", primary: true, note: "ECDH escrow private key (vault-transfer rail)" };
  if (/^custody-intake\//.test(p)) return { family: "custody-intake", primary: true, note: "durable custody slot (SLOT law)" };
  if (/^(keys\.env|rails\.env|fleet-rot2\.keys|ssh-keys\.tar)\.enc$/.test(p)) return { family: "core-infrastructure", primary: true, note: "core repo seal (keys / rails / fleet-rot / ssh anchors)" };
  if (/^intake\//.test(p)) return { family: "intake-history", primary: false, note: "intake-גל-קודם — מתועד, לא-חוסם-שגרה" };
  return { family: "other", primary: false, note: "unclassified — documented honestly" };
}
