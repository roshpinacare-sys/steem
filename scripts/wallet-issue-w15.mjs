/**
 * wallet-issue-w15.mjs — W15 · THE ESTATE WALLET MINT (טביעת-ארנקי-המשפחה).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim): "אפשר לפתוח טוקנים וארנקים על הרשת
 * לחיילים ולסוכנים ולכל האוטונומיה" + this wave's "וודא כספת שיהיה מפתח
 * לפעילות שוטפת של המערכת" — the wallets ARE vault-borne: ONE master seed,
 * sealed as the WALLETS-SEAL self-contained class (EXCHANGE-SEAL precedent,
 * pass in meta.walletsVault), drives every address deterministically.
 *
 * WHAT IS MINTED (honest roster — only identities the repo can enumerate):
 *   treasury:hct-1, bridge:steem-usdt, master:headcorner,
 *   soldier:hcsoldier1..6, agent:2, reserve:hcsoldier7..9 (mint-lane holds)
 *   → 13 TRON addresses. The remaining fleet names live inside the
 *     R-VAULTPASS-1 master bundle — they are issued when that roster is
 *     reachable (nextRosterPull), never guessed here.
 *
 * LAWS:
 *  - R306 ONE formula (openssl AES-256-CBC · pbkdf2 · iter 300000; inner zip;
 *    sha256 outer+inner pins; roundtrip verified BEFORE meta write; meta LAST).
 *  - ZERO secret material in stdout/logs/git — addresses + fingerprints only.
 *  - .secrets/wallets.json (0600, gitignored) = runtime cache with keys;
 *    state/wallet-ledger.json (committed) = ADDRESSES ONLY.
 *  - Honesty: every address is UNFUNDED-UNVERIFIED until the chain shows an
 *    inbound transfer (R306-b); the ledger says so.
 *  - Idempotent: same seed + same roster → identical addresses (SKIP churn).
 *
 * Usage: node scripts/wallet-issue-w15.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { newMasterSeed, deriveWallets, privkeyFor, wifEncode, steemPublicFromPriv } from "../mini-services/saos-engine/wallets.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VAULT_DIR = path.join(REPO, "agent", "vault");
const META = path.join(REPO, "agent", "recovery-meta.json");
const SECRETS = path.join(REPO, ".secrets");
const LEDGER = path.join(REPO, "mini-services", "saos-engine", "state", "wallet-ledger.json");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fp = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})` : "null");
const now = () => new Date().toISOString();

const ROSTER = [
  { label: "treasury:hct-1", role: "treasury — the estate's on-chain reserve (HCT-1 future rail)" },
  { label: "bridge:steem-usdt", role: "bridge — the STEEM→USDT conversion rail's TRON leg" },
  { label: "master:headcorner", role: "the master body's on-chain presence" },
  { label: "soldier:hcsoldier1", role: "fleet soldier wallet" },
  { label: "soldier:hcsoldier2", role: "fleet soldier wallet" },
  { label: "soldier:hcsoldier3", role: "fleet soldier wallet" },
  { label: "soldier:hcsoldier4", role: "fleet soldier wallet" },
  { label: "soldier:hcsoldier5", role: "fleet soldier wallet" },
  { label: "soldier:hcsoldier6", role: "fleet soldier wallet" },
  { label: "agent:2", role: "sibling agent-2 wallet" },
  { label: "reserve:hcsoldier7", role: "mint-lane reservation (W14 gate pending)" },
  { label: "reserve:hcsoldier8", role: "mint-lane reservation (W14 gate pending)" },
  { label: "reserve:hcsoldier9", role: "mint-lane reservation (W14 gate pending)" },
];

function die(msg) { console.error(`WALLET-MINT-FAIL: ${msg}`); process.exit(1); }

const meta = JSON.parse(fs.readFileSync(META, "utf8"));

/* ---------- seed: unseal the existing class or mint a fresh one ---------- */
let seed;
let seedAction;
if (meta.walletsVault?.file && meta.walletsVault?.pass) {
  const encPath = path.join(REPO, meta.walletsVault.file);
  const tmp = fs.mkdtempSync("/tmp/wallet-seed-"); fs.chmodSync(tmp, 0o700);
  try {
    if (sha256(fs.readFileSync(encPath)) !== meta.walletsVault.outerSha256) {
      die(`outer pin mismatch on existing ${meta.walletsVault.file} — tamper or drift; refusing to derive on a wrong root`);
    }
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", encPath, "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${meta.walletsVault.pass}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    if (sha256(fs.readFileSync(path.join(tmp, "inner.zip"))) !== meta.walletsVault.innerSha256) {
      die("inner pin mismatch on the wallets seed bundle — refusing");
    }
    execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), "wallets-seed.json", "-d", tmp],
      { stdio: ["ignore", "ignore", "pipe"] });
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, "wallets-seed.json"), "utf8"));
    seed = Buffer.from(parsed.seedB64, "base64");
    seedAction = "UNSEALED (existing vault class)";
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
} else {
  seed = newMasterSeed();
  seedAction = "MINTED (new 64B master seed)";
}

/* ---------- derive the roster (deterministic; same seed → same addresses forever) ---------- */
const wallets = deriveWallets(seed, ROSTER.map((r) => r.label));
const addressMap = new Map(wallets.map((w) => [w.label, w.address]));

/* ---------- idempotence vs committed ledger ---------- */
let prior = null;
try { prior = JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch {}
const unchanged = prior?.schema === "wallet-ledger-v1" &&
  (prior.wallets ?? []).every((w) => addressMap.get(w.label) === w.address) &&
  prior.wallets?.length === wallets.length;

if (unchanged && !process.argv.includes("--force")) {
  console.log("WALLET-MINT: SKIP — ledger addresses already match the sealed seed derivation (idempotent)");
  process.exit(0);
}

/* ---------- seal the seed as WALLETS-SEAL (roundtrip BEFORE meta write) ---------- */
let metaOut = null;
if (!meta.walletsVault?.file || !meta.walletsVault?.pass) {
  const pass = crypto.randomBytes(24).toString("base64");
  const stamp = now().replace(/[-:]/g, "").slice(0, 15);
  const file = `WALLETS-SEAL-${stamp}Z.zip.enc`;
  const inner = {
    format: "wallets-seed-1",
    sealedAt: now(),
    seedB64: seed.toString("base64"),
    note: "SAOS-WALLET-v1 master seed — HMAC-SHA512(seed, 'SAOS-WALLET-v1|'+label) → secp256k1; ONE seed backs every estate address; lose the seed = lose nothing on chain IF addresses are empty (they are, until funded)",
    law: "self-contained class (pass in meta.walletsVault) — the EXCHANGE-SEAL precedent",
  };
  const tmp = fs.mkdtempSync("/tmp/wallet-seal-"); fs.chmodSync(tmp, 0o700);
  try {
    fs.writeFileSync(path.join(tmp, "wallets-seed.json"), JSON.stringify(inner, null, 2), { mode: 0o600 });
    execFileSync("zip", ["-q", "-j", path.join(tmp, "inner.zip"), path.join(tmp, "wallets-seed.json")], { stdio: ["ignore", "ignore", "pipe"] });
    const innerBuf = fs.readFileSync(path.join(tmp, "inner.zip"));
    const encPath = path.join(VAULT_DIR, file);
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(tmp, "inner.zip"), "-out", encPath, "-pass", `pass:${pass}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    fs.chmodSync(encPath, 0o600);
    const outerSha256 = sha256(fs.readFileSync(encPath));
    const innerSha256 = sha256(innerBuf);
    /* ROUNDTRIP VERIFY from the sealed bytes on disk — before any meta write */
    const vtmp = fs.mkdtempSync("/tmp/wallet-verify-"); fs.chmodSync(vtmp, 0o700);
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", encPath, "-out", path.join(vtmp, "v.zip"), "-pass", `pass:${pass}`],
        { stdio: ["ignore", "ignore", "pipe"] });
      if (sha256(fs.readFileSync(path.join(vtmp, "v.zip"))) !== innerSha256) die("roundtrip inner pin mismatch");
      execFileSync("unzip", ["-o", "-q", path.join(vtmp, "v.zip"), "wallets-seed.json", "-d", vtmp], { stdio: ["ignore", "ignore", "pipe"] });
      const back = JSON.parse(fs.readFileSync(path.join(vtmp, "wallets-seed.json"), "utf8"));
      if (Buffer.from(back.seedB64, "base64").toString("hex") !== seed.toString("hex")) die("roundtrip seed mismatch");
    } finally { try { fs.rmSync(vtmp, { recursive: true, force: true }); } catch {} }
    meta.walletsVault = {
      file: `agent/vault/${file}`,
      passRef: "walletsVault.pass (this same meta)",
      pass,
      outerSha256,
      innerSha256,
      formula: "openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<walletsVault.pass> | unzip (wallets-seed.json)",
      contents: ["wallets-seed"],
      source: "W15 estate wallet mint (operator order 2026-10-19, IM trace 1a155217160a6429)",
      sealedAt: now(),
      law: "wallets class — ONE deterministic seed behind every soldier/agent/estate on-chain address; derivation lives in mini-services/saos-engine/wallets.mjs (selftest-pinned)",
    };
    fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o664 });
    metaOut = meta.walletsVault.file;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

/* ---------- runtime cache 0600 (keys INCLUDED — sandbox-local, gitignored) ---------- */
fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
const cacheItems = ROSTER.map((r) => {
  const priv = privkeyFor(seed, r.label);
  return {
    id: r.label,
    role: r.role,
    address: addressMap.get(r.label),
    privkeyHex: priv.toString("hex"),
    wif: wifEncode(priv),
    steemPublic: steemPublicFromPriv(priv),
    note: "TRON address is the primary; WIF/STM shapes are derivation siblings kept for future account keys",
  };
});
fs.writeFileSync(path.join(SECRETS, "wallets.json"),
  JSON.stringify({ format: "wallets-1", extractedAt: now(), items: cacheItems }, null, 2), { mode: 0o600 });

/* ---------- committed ledger (ADDRESSES ONLY) ---------- */
const ledger = {
  schema: "wallet-ledger-v1",
  at: now(),
  chain: "TRON (mainnet)",
  derivation: "HMAC-SHA512(seed, 'SAOS-WALLET-v1|'+label) → secp256k1 → 0x41‖keccak256(pub[1:])[-20:] → base58check",
  seedClass: "WALLETS-SEAL (meta.walletsVault, self-contained pass — git-borne, survives sandbox death)",
  status: "UNFUNDED-UNVERIFIED (R306-b: a wallet exists on chain only once its first inbound transfer is observed)",
  wallets: ROSTER.map((r) => ({
    label: r.label,
    role: r.role,
    address: addressMap.get(r.label),
    fingerprint: wallets.find((w) => w.label === r.label).fingerprint,
    balance: null,
    note: "balance measured at first funded check, never guessed",
  })),
  nextRosterPull: "the 8 remaining fleet names live in the R-VAULTPASS-1 master bundle — issued when that roster is reachable",
  law: "this ledger carries ADDRESSES ONLY; private keys live in the vault + the 0600 runtime cache",
};
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

/* ---------- verdict (fingerprints only) ---------- */
console.log(`WALLET-MINT-OK (W15) — seed: ${seedAction}`);
if (metaOut) console.log(`  vault: ${metaOut} (roundtrip verified, meta written last)`);
for (const r of ROSTER) {
  console.log(`  ${r.label.padEnd(20)} ${addressMap.get(r.label)}`);
}
console.log(`  cache: .secrets/wallets.json (0600, gitignored) · ledger: state/wallet-ledger.json (addresses only)`);
