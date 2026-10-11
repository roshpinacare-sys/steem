/**
 * probe-headcorner-hive.mjs — R265 THE WHALE KEY (memory-only, NO broadcast).
 *
 * The measured hole: headcorner exists on Hive since 2018-03 with 34,718 HP
 * (a stake ~1000x the whole 9-roster combined) and STILL carries the 2018
 * shopify-CDN identity the operator ordered erased. The r264 profile pass
 * deferred it "custody:master-unverified" — the Steem signer's verdict inside
 * a foreign process. What was NEVER tried: the GEN-1 vault key against
 * headcorner's LIVE Hive authority (the same law that verified 9/9 roster).
 *
 * This probe: sha-pin GEN-1 → openssl → inner zip → extract ONLY
 * headcorner's posting+active WIFs into memory → derive pubkeys → compare
 * against the live chain authority → measure RC/vote-power. Verdicts land in
 * state/r265-headcorner.json. Key bytes never touch disk, logs, or stdout.
 * If both authorities verify, headcorner is the lawful whale donor the RC
 * pool has been missing — and the profile erasure becomes broadcastable.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { rpcHive } from "./hive.mjs";
import { pubkeyFromSeed as pubFromSeed, wifDecode as wifDec } from "./steemtx.mjs";
import { vaultPass } from "./vault-custody.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const GEN1_COMMIT = "1c9f00d0";
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const GEN1_META = "agent/recovery-meta.json";
const TMP = path.join(REPO, ".secrets", "hc-hive-tmp");
const ACCOUNT = "headcorner";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const unwrap = (r) => (Array.isArray(r) ? r : (r?.result ?? []));

async function verifyAuthority(account, wif, role) {
  const acc = await rpcHive("condenser_api.get_accounts", [[account]]);
  const auth = acc.ok ? acc.result?.[0]?.[role]?.key_auths?.[0]?.[0] : null;
  if (!auth) return { ok: false, reason: `no-live-${role}-authority` };
  let derived = null;
  try { derived = pubFromSeed(wifDec(String(wif).trim())); } catch { return { ok: false, reason: "wif-decode-fail" }; }
  if (derived !== auth) return { ok: false, reason: "authority-mismatch" };
  return { ok: true, pubkey: derived };
}

const out = { at: new Date().toISOString(), account: ACCOUNT, verdict: "UNVERIFIED", steps: [] };
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
try {
  const meta = JSON.parse(execFileSync("git", ["show", `${GEN1_COMMIT}:${GEN1_META}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString("utf8"));
  const enc = execFileSync("git", ["show", `${GEN1_COMMIT}:${GEN1_ZIP}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  if (sha256(enc) !== String(meta.keysZipSha256 ?? "")) throw new Error("gen1-outer-sha-mismatch");
  fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
    "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
    "-pass", `pass:${vaultPass(meta.keysZipUnlockRef ?? "gen1.keysZipUnlock")}`], { stdio: ["ignore", "ignore", "pipe"] });
  const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
  if (sha256(inner) !== String(meta.keysZipInnerSha256 ?? "")) throw new Error("gen1-inner-sha-mismatch");
  fs.writeFileSync(path.join(TMP, "inner.zip"), inner, { mode: 0o600 });
  execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "o")]);
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, "o", "agent", "keys", "vault.json"), "utf8"));
  const rec = (vault.accounts ?? []).find((a) => a.username === ACCOUNT);
  if (!rec) { out.steps.push("no-headcorner-in-gen1-vault"); }
  else {
    out.steps.push("gen1-unlocked-sha-pinned");
    /* two vault shapes live: the roster's flat keys.posting/active, and the
     * master record's per-chain keys.hive.posting/active (measured R265). */
    const pwif = rec?.keys?.hive?.posting?.wif ?? rec?.keys?.posting?.wif;
    const awif = rec?.keys?.hive?.active?.wif ?? rec?.keys?.active?.wif;
    out.vaultShape = rec?.keys?.hive ? "per-chain" : "flat";
    const pv = pwif ? await verifyAuthority(ACCOUNT, pwif, "posting") : { ok: false, reason: "no-posting-wif-in-vault" };
    const av = awif ? await verifyAuthority(ACCOUNT, awif, "active") : { ok: false, reason: "no-active-wif-in-vault" };
    out.posting = pv.ok ? "VERIFIED-VS-HIVE-CHAIN" : `REFUSED:${pv.reason}`;
    out.active = av.ok ? "VERIFIED-VS-HIVE-CHAIN" : `REFUSED:${av.reason}`;
    out.verdict = pv.ok && av.ok ? "WHALE-KEY-VERIFIED" : (pv.ok ? "POSTING-ONLY-VERIFIED" : "UNVERIFIED");
  }
  /* chain-side physics regardless of custody: RC + stake (read-only) */
  const rc = await rpcHive("rc_api.find_rc_accounts", { accounts: [ACCOUNT] });
  const a = rc?.result?.rc_accounts?.[0];
  if (a) {
    const max = Number(a.max_rc ?? 0);
    out.rc = { maxB: +(max / 1e9).toFixed(1), maxLiftsAtFloor: Math.floor(max / 1_607_605_799) - 1, delegatedOutB: +(Number(a.delegated_rc ?? 0) / 1e9).toFixed(2) };
  }
  const g = unwrap(await rpcHive("condenser_api.get_accounts", [[ACCOUNT]]))[0];
  if (g) {
    const vests = Number(String(g.vesting_shares ?? "0").replace(" VESTS", ""));
    out.stake = {
      hpVests: +vests.toFixed(1),
      hive: g.balance, hbd: g.hbd_balance,
      votingPowerPct: +(((Number(g.voting_power ?? 0)) / 100)).toFixed(2),
      lastVote: g.last_vote_time, created: g.created,
      followers: g.followers_count ?? null,
    };
  }
} catch (e) {
  out.error = String(e?.message ?? e).slice(0, 140);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
writeFileSync(path.join(DIR, "state", "r265-headcorner.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
