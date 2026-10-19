/**
 * reseal-exchange-w17.mjs — W17 · THE EXCHANGE ROTATION RE-SEAL (איטום-מחדש-אחרי-רוטציה).
 *
 * Operator drop 2026-10-19 (IM trace 1a1556c780544431): the owner rotated the
 * HTX keypair in the console and re-uploaded upload/htx.txt ("עשיתי לו כבר
 * סיבוב והחלפתי לזה תוודא לא לחשוף אותו"). Server truth already measured the
 * history-exposed pair DEAD (exchange-custody.json w15Recheck · api-code-3011,
 * SEC-2026-10-19-4 CONTAINED-MEASURED) — this script seals the NEW pair.
 *
 * WHY A SIBLING OF seal-exchange-w13.mjs: the W13 script's pass custody lane
 * is the Actions-secret PUT (pushClassPass — fail-closed without a token with
 * Actions-secret scope on this host). W16-a (agent-zai) superseded that for
 * the self-contained vault classes: "the vault self-keyed — the passes are
 * permanent in git history since their sealing commits"; the CURRENT
 * meta.exchangeVault already carries its pass (self-contained, passRef
 * "exchangeVault.pass (this same meta)"). This re-seal follows the LIVE
 * doctrine: same crypto recipe (openssl AES-256-CBC · pbkdf2 · iter 300000 ·
 * inner zip · sha256 outer+inner pins), pass written INTO the meta (private
 * repo), Actions PUT skipped honestly. Zero secret material in stdout/logs —
 * fingerprints only (first6…last4 + length). Uploads stay gitignored (G2).
 *
 * Honesty laws (inherited): shape gates NOTHING — the signed probe judges
 * (R306-b); idempotent (identical fingerprints → honest SKIP, no churn);
 * post-seal roundtrip from the sealed bytes on disk; meta written LAST.
 *
 * Usage: node scripts/reseal-exchange-w17.mjs [--force]
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

function die(msg) { console.error(`RESEAL-FAIL: ${msg}`); process.exit(1); }

/* ---------- parse the drop: upload/htx.txt (token lines 1 and 3, W13 shape law) ---------- */
let raw;
try {
  raw = fs.readFileSync(path.join(UPLOAD, "htx.txt"), "utf8").replace(/\r/g, "");
} catch (e) {
  die(`upload htx.txt unreadable: ${String(e?.message ?? e).slice(0, 80)}`);
}
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
const tokens = lines.map((l) => l.match(/^[0-9a-zA-Z-]{20,}$/)?.[0] ?? null).filter(Boolean);
if (tokens.length !== 2) {
  die(`htx.txt unexpected shape — found ${tokens.length} key tokens, expected exactly 2 (access, secret)`);
}
const [accessKey, secretKey] = tokens;

const exchange = {
  format: "exchange-1",
  sealedAt: null,
  source: "upload/htx.txt (operator ROTATION drop 2026-10-19, IM trace 1a1556c780544431 — re-seal after the history-exposed pair measured DEAD server-side, exchange-custody.json w15Recheck + SEC-2026-10-19-4)",
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
      note: "owner order (trace 1a1556c780544431): STEEM/SBD activity first — withdrawal-fee-cheap coins only until measured otherwise; verify zero exposure of the new pair",
    },
  ],
};

/* ---------- meta must already be self-contained (W16-a law) ---------- */
const meta = JSON.parse(fs.readFileSync(META, "utf8"));
if (!meta.exchangeVault?.pass || typeof meta.exchangeVault.pass !== "string") {
  die("meta.exchangeVault.pass absent — this host only re-seals SELF-CONTAINED classes (W16-a law); use seal-exchange-w13.mjs with an Actions-custody token instead");
}
const exExisted = !!meta.exchangeVault.file;

/* ---------- idempotency: same fingerprints in the sealed truth → SKIP ---------- */
const exchangeChanged = FORCE || !exExisted || (() => {
  try {
    const enc = fs.readFileSync(path.join(REPO, meta.exchangeVault.file));
    if (sha256(enc) !== meta.exchangeVault.outerSha256) return true;
    const tmp = fs.mkdtempSync("/tmp/reseal-ex-"); fs.chmodSync(tmp, 0o700);
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
  const tmp = fs.mkdtempSync("/tmp/reseal-zip-");
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
  const tmp = fs.mkdtempSync("/tmp/reseal-verify-"); fs.chmodSync(tmp, 0o700);
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

const stamp = now().replace(/[-:]/g, "").slice(0, 15);
let out = [];

if (exchangeChanged) {
  const pass = crypto.randomBytes(24).toString("base64");
  const file = `EXCHANGE-SEAL-${stamp}Z.zip.enc`;
  const pins = sealToVault(exchange, "exchange.json", pass, file);
  const n = roundtripVerify(pins.encPath, pins, pass, "exchange.json");
  /* W16-a self-contained law: the pass lives IN the meta (private repo IS the
   * vault) — the Actions-PUT lane of W13 is superseded for this class (the
   * meta already carried the exchange pass before this re-seal). */
  meta.exchangeVault = {
    file: `agent/vault/${file}`,
    pass,
    passRef: "exchangeVault.pass (this same meta) — self-contained (W16-a law)",
    passCustody: "self-contained vault class — bare-clone operational (owner standing order: הכספת בגיט לפעילות שוטפת)",
    outerSha256: pins.outerSha256,
    innerSha256: pins.innerSha256,
    formula: "openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<exchangeVault.pass> | unzip (exchange.json)",
    contents: exchange.items.map((i) => i.id),
    source: exchange.source,
    sealedAt: now(),
    law: "exchange class — spot REST credentials; permissions UNVERIFIED until first signed probe; trade authority stays behind the two-key arm doctrine; STEEM/SBD-only transfer scope per operator trace 1a1556c780544431",
    replacedArchive: exExisted ? meta.exchangeVault.file : undefined,
  };
  out.push(`exchange: RE-SEALED ${file} (${n} item${n === 1 ? "" : "s"}) — rotation sealed (previous archive: ${meta.exchangeVault.replacedArchive ?? "none"})`);
} else {
  out.push("exchange: SKIP — sealed fingerprints identical (no churn)");
}

/* ---------- write meta LAST (pins only after verified roundtrips) ---------- */
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o664 });

/* ---------- refresh the 0600 cache the runtime consumes ---------- */
fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
const cacheEx = { format: "exchange-1", extractedAt: now(), items: exchange.items };
fs.writeFileSync(path.join(SECRETS, "exchange.json"), JSON.stringify(cacheEx, null, 2), { mode: 0o600 });

/* ---------- verdict: fingerprints only ---------- */
console.log("RESEAL-OK (W17) — the rotation drop is vault-borne:");
for (const l of out) console.log(`  ${l}`);
for (const i of exchange.items) {
  console.log(`  ${i.id}: access=${fp(i.accessKey)} secret=${fp(i.secretKey)}`);
}
console.log(`  cache: .secrets/exchange.json (0600, gitignored)`);
console.log(`  meta: agent/recovery-meta.json exchangeVault updated (self-contained, pass-in-meta, W16-a law)`);
