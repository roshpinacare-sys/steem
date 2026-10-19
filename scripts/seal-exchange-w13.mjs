/**
 * seal-exchange-w13.mjs — W13 · THE EXCHANGE-DROP SEAL (איטום-מפתחות-הבורסה).
 *
 * Operator order 2026-10-19 (verbatim distilled): "בוא ננסה להתחבר גם לצמדים
 * בבורסה ... הקפד לאטום מפתחות בכספת שלא ימות עם הסנדבוקס שיהיה בגיט לשימוש
 * מקיף של הארכיטקטורה האוטונומית". One drop arrived in upload/:
 *
 *  htx.txt — HTX (ex-Huobi) spot REST API keypair:
 *    line 1: AccessKey (uuid-ish), line 3: SecretKey (uuid-ish).
 *    → sealed as a NEW vault class: agent/vault/EXCHANGE-SEAL-*.zip.enc,
 *      own random pass living in meta.exchangeVault (system-custody doctrine —
 *      the private repo IS the vault, the pass travels with the meta, exactly
 *      like integrationsVault.pass, R306 precedent).
 *
 * LAWS (inherited R306):
 *  - ZERO secret material in stdout, logs, or git — fingerprints only
 *    (first6…last4 + length). Uploads stay gitignored (G2).
 *  - The ONE formula: openssl AES-256-CBC · pbkdf2 · iter 300000; inner zip;
 *    sha256-pinned outer+inner; meta carries pins+pass.
 *  - Honesty law: key PERMISSIONS are UNVERIFIED until the first signed probe
 *    (the API judges, never the shape — R306-b law). Labeled as such in the
 *    sealed truth itself.
 *  - Idempotent: identical fingerprints → honest SKIP, no re-seal churn.
 *  - Post-seal roundtrip verification from the sealed bytes on disk; the meta
 *    is written LAST (pins only after a successful roundtrip).
 *
 * Usage: node scripts/seal-exchange-w13.mjs [--force]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const UPLOAD = path.join(REPO, "upload");
const VAULT_DIR = path.join(REPO, "agent", "vault");
const META = path.join(REPO, "agent", "recovery-meta.json");
const SECRETS = path.join(REPO, ".secrets");
const FORCE = process.argv.includes("--force");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fp = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})` : "null");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function die(msg) { console.error(`SEAL-FAIL: ${msg}`); process.exit(1); }

/* ---------- parse the drop: htx.txt (two uuid-ish tokens on lines 1 and 3) ---------- */
let raw;
try {
  raw = fs.readFileSync(path.join(UPLOAD, "htx.txt"), "utf8").replace(/\r/g, "");
} catch (e) {
  die(`upload htx.txt unreadable: ${String(e?.message ?? e).slice(0, 80)}`);
}
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
/* HTX key tokens: dash-grouped alphanumeric (uuid-ish family, but groups are
 * lowercase base32-ish — e.g. access `aaaaaaaa-bbbbbbbb-cccccccccc-ddddd` is
 * 4 groups, secret `11112222-33334444-55556666-77777` is 4 shorter groups).
 * REDACTION NOTE (W15, SEC-2026-10-19-5): this comment originally embedded the
 * REAL tokens as "examples" — caught by the 57.8b exposure guard on its first
 * run; redacted in-tree, history keeps the blob (FF-only law), measured inert
 * (the pair is server-rejected, api-code-3011).
 * Honesty law: the shape gates NOTHING — the signed probe judges (R306-b). */
const tokens = lines.map((l) => l.match(/^[0-9a-zA-Z-]{20,}$/)?.[0] ?? null).filter(Boolean);
if (tokens.length !== 2) {
  die(`htx.txt unexpected shape — found ${tokens.length} key tokens, expected exactly 2 (access, secret)`);
}
const [accessKey, secretKey] = tokens;
const uuidish = /^([0-9a-z]{8,12}-){3,4}[0-9a-z]{4,12}$/i;
const accessShape = uuidish.test(accessKey);
const secretShape = uuidish.test(secretKey);
/* honesty: shape notes, not shape judgments — the API is the judge (R306-b) */
console.log(`note: shapes (access:${accessShape ? "uuid-family" : "other"} secret:${secretShape ? "uuid-family" : "other"}) — recorded, the signed probe will judge`);

const exchange = {
  format: "exchange-1",
  sealedAt: null, /* filled at seal */
  source: "upload/htx.txt (operator drop 2026-10-19, IM trace 1a154d9c83021b75)",
  items: [
    {
      id: "htx",
      name: "HTX (formerly Huobi)",
      accessKey,
      secretKey,
      apiBase: "https://api.htx.com",
      apiNote: "spot REST v1/v2; signature HmacSHA256 SignatureVersion=2 (sorted query, UTC timestamp, base64)",
      envAccess: "SAOS_HTX_ACCESS_KEY",
      envSecret: "SAOS_HTX_SECRET_KEY",
      permissions: "UNVERIFIED-UNTIL-FIRST-SIGNED-PROBE (read/trade/withdraw unknown — honesty law)",
      addedAt: now(),
      note: "operator W13 order: connect pairs, fee-aware economics first, market diversification",
    },
  ],
};

/* ---------- load meta (self-contained new class — own pass, R306 integrationsVault precedent; master passes left the repo R-VAULTPASS-1) ---------- */
const meta = JSON.parse(fs.readFileSync(META, "utf8"));
if (meta.format !== "SAOS-RECOVERY-3" && !meta.sealedAt) {
  console.log(`note: meta.format=${meta.format ?? "null"} — proceeding (new class is self-contained)`);
}

/* ---------- idempotency: same fingerprints in the sealed truth → SKIP ---------- */
const exExisted = !!meta.exchangeVault;
const exchangeChanged = FORCE || !exExisted || (() => {
  try {
    const enc = fs.readFileSync(path.join(REPO, meta.exchangeVault.file));
    if (sha256(enc) !== meta.exchangeVault.outerSha256) return true;
    const tmp = fs.mkdtempSync("/tmp/seal-ex-"); fs.chmodSync(tmp, 0o700);
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", path.join(REPO, meta.exchangeVault.file), "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${meta.exchangeVault.pass}`],
        { stdio: ["ignore", "ignore", "pipe"] });
      execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), "exchange.json", "-d", tmp], { stdio: ["ignore", "ignore", "pipe"] });
      const cur = JSON.parse(fs.readFileSync(path.join(tmp, "exchange.json"), "utf8"));
      const byId = new Map((cur.items ?? []).map((i) => [i.id, i]));
      return exchange.items.some((i) => {
        const prev = byId.get(i.id);
        return !prev || prev.accessKey !== i.accessKey || prev.secretKey !== i.secretKey;
      });
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  } catch { return true; }
})();

function sealToVault(obj, innerName, pass, outFile) {
  const tmp = fs.mkdtempSync("/tmp/seal-zip-");
  fs.chmodSync(tmp, 0o700);
  try {
    fs.writeFileSync(path.join(tmp, innerName), JSON.stringify(obj, null, 2), { mode: 0o600 });
    execFileSync("zip", ["-q", "-j", path.join(tmp, "inner.zip"), path.join(tmp, innerName)], { stdio: ["ignore", "ignore", "pipe"] });
    const innerBuf = fs.readFileSync(path.join(tmp, "inner.zip"));
    const encPath = path.join(VAULT_DIR, outFile);
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(tmp, "inner.zip"), "-out", encPath, "-pass", `pass:${pass}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    fs.chmodSync(encPath, 0o600);
    return { outerSha256: sha256(fs.readFileSync(encPath)), innerSha256: sha256(innerBuf), encPath };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

function roundtripVerify(encPath, pins, pass, innerName) {
  const enc = fs.readFileSync(encPath);
  if (sha256(enc) !== pins.outerSha256) die(`roundtrip outer-pin mismatch for ${encPath}`);
  const tmp = fs.mkdtempSync("/tmp/seal-verify-"); fs.chmodSync(tmp, 0o700);
  try {
    const e = path.join(tmp, "x.zip.enc");
    fs.writeFileSync(e, enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", e, "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
    if (sha256(fs.readFileSync(path.join(tmp, "inner.zip"))) !== pins.innerSha256) die(`roundtrip inner-pin mismatch for ${encPath}`);
    execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), innerName, "-d", tmp], { stdio: ["ignore", "ignore", "pipe"] });
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, innerName), "utf8"));
    const n = Array.isArray(parsed?.items) ? parsed.items.length : -1;
    if (n <= 0) die(`roundtrip parse gap for ${encPath}`);
    return n;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

const stamp = now().replace(/[-:]/g, "").slice(0, 15); /* 20261019T1549 */
let out = [];

if (exchangeChanged) {
  const pass = crypto.randomBytes(24).toString("base64");
  const file = `EXCHANGE-SEAL-${stamp}Z.zip.enc`;
  const pins = sealToVault(exchange, "exchange.json", pass, file);
  const n = roundtripVerify(pins.encPath, pins, pass, "exchange.json");
  meta.exchangeVault = {
    file: `agent/vault/${file}`,
    passRef: "exchangeVault.pass (this same meta)",
    pass,
    outerSha256: pins.outerSha256,
    innerSha256: pins.innerSha256,
    formula: "openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<exchangeVault.pass> | unzip (exchange.json)",
    contents: exchange.items.map((i) => i.id),
    source: exchange.source,
    sealedAt: now(),
    law: "exchange class — spot REST credentials for market-making/diversification rails; permissions UNVERIFIED until first signed probe; trade authority stays behind the two-key arm doctrine",
    replacedArchive: exExisted ? meta.exchangeVault.file : undefined,
  };
  out.push(`exchange: SEALED ${file} (${n} item${n === 1 ? "" : "s"}) ${exExisted ? "(re-seal)" : "(new class)"}`);
} else {
  out.push("exchange: SKIP — sealed fingerprints identical");
}

/* ---------- write meta LAST (pins only after verified roundtrips) ---------- */
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o664 });

/* ---------- refresh the 0600 cache the autonomy consumes at run time ---------- */
fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
const cacheEx = { format: "exchange-1", extractedAt: now(), items: exchange.items };
fs.writeFileSync(path.join(SECRETS, "exchange.json"), JSON.stringify(cacheEx, null, 2), { mode: 0o600 });

/* ---------- verdict: fingerprints only ---------- */
console.log("SEAL-OK (W13) — the exchange drop is vault-borne:");
for (const l of out) console.log(`  ${l}`);
for (const i of exchange.items) {
  console.log(`  ${i.id}: access=${fp(i.accessKey)} secret=${fp(i.secretKey)}`);
}
console.log(`  cache: .secrets/exchange.json (0600, gitignored)`);
console.log(`  meta: agent/recovery-meta.json exchangeVault updated (pins last, after verified roundtrip)`);
