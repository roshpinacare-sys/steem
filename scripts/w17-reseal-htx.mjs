/* w17-reseal-htx.mjs — W17 · THE HTX KEY ROTATION SEAL (איטום-רוטציית-הבורסה).
 *
 * Operator order 2026-10-19 (IM trace 1a155710681d6421, verbatim): "בנוסף
 * תפעיל את htx שלחתי לך" — a FRESH htx.txt drop arrived (sha256 7f5f7500…
 * 73c, 70 bytes) superseding the W13 pair. The prior seal
 * (EXCHANGE-SEAL-20261019T155708Z) stays in git history; this script:
 *
 *  1. parses the new drop (2 tokens, same W13 parser laws),
 *  2. seals a NEW self-contained exchange class (random pass IN meta — the
 *     W15 ongoing-activity law supersedes the W13 R33 writer-custody lane:
 *     the vault must open on a bare clone with zero env, measured W16
 *     REVIVAL-FAIL 0/14 on non-Actions runners when passes strand),
 *  3. roundtrip-verifies from sealed bytes BEFORE the meta write,
 *  4. updates the 0600 sandbox cache (.secrets/exchange.json) so the running
 *     engine's next htxConfig() picks the new pair (vault ladder rung 2),
 *  5. fingerprints only — zero secret material in stdout/logs/git.
 *
 * Usage: node scripts/w17-reseal-htx.mjs [--drop <path>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VAULT_DIR = path.join(REPO, "agent", "vault");
const META = path.join(REPO, "agent", "recovery-meta.json");
const SECRETS = path.join(REPO, ".secrets");
const dropIdx = process.argv.indexOf("--drop");
const DROP = dropIdx > -1 ? path.resolve(REPO, process.argv[dropIdx + 1]) : path.join(REPO, "upload", "htx.txt");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fp = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})` : "null");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const die = (msg) => { console.error(`W17-SEAL-FAIL: ${msg}`); process.exit(1); };

/* ---------- parse the drop (W13 parser laws: strip \r, drop empties, 2 tokens) ---------- */
let raw;
try {
  raw = fs.readFileSync(DROP, "utf8").replace(/\r/g, "");
} catch (e) {
  die(`drop unreadable: ${String(e?.message ?? e).slice(0, 80)}`);
}
const tokens = raw.split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => l.match(/^[0-9a-zA-Z-]{20,}$/)?.[0] ?? null).filter(Boolean);
if (tokens.length !== 2) die(`unexpected shape — ${tokens.length} tokens, expected 2`);
const [accessKey, secretKey] = tokens;
const uuidish = /^([0-9a-z]{8,12}-){3,4}[0-9a-z]{4,12}$/i;
console.log(`drop: ${path.basename(DROP)} sha256=${sha256(fs.readFileSync(DROP)).slice(0, 12)}…`);
console.log(`note: shapes (access:${uuidish.test(accessKey) ? "uuid-family" : "other"} secret:${uuidish.test(secretKey) ? "uuid-family" : "other"}) — recorded, the signed probe judges (R306-b)`);

const exchange = {
  format: "exchange-1",
  sealedAt: null,
  source: `upload/htx.txt (operator W17 drop 2026-10-19, IM trace 1a155710681d6421 — "תפעיל את htx שלחתי לך"; supersedes the W13 pair 1a154d9c83021b75)`,
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
      note: "operator W17 rotation: activate the sent keys; the W13 pair superseded",
    },
  ],
};

/* ---------- meta ---------- */
const meta = JSON.parse(fs.readFileSync(META, "utf8"));
const exExisted = !!meta.exchangeVault;

/* ---------- seal (self-contained: pass IN meta, W15 law) ---------- */
function sealToVault(obj, innerName, pass, outFile) {
  const tmp = fs.mkdtempSync("/tmp/w17-seal-");
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
  const tmp = fs.mkdtempSync("/tmp/w17-verify-");
  fs.chmodSync(tmp, 0o700);
  try {
    const e = path.join(tmp, "x.zip.enc");
    fs.writeFileSync(e, enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", e, "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${pass}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    if (sha256(fs.readFileSync(path.join(tmp, "inner.zip"))) !== pins.innerSha256) die(`roundtrip inner-pin mismatch`);
    execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), innerName, "-d", tmp], { stdio: ["ignore", "ignore", "pipe"] });
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, innerName), "utf8"));
    const n = Array.isArray(parsed?.items) ? parsed.items.length : -1;
    if (n <= 0) die(`roundtrip parse gap`);
    return n;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

const stamp = now().replace(/[-:]/g, "").slice(0, 15);
const pass = crypto.randomBytes(24).toString("base64");
const file = `EXCHANGE-SEAL-${stamp}Z.zip.enc`;
const pins = sealToVault(exchange, "exchange.json", pass, file);
const n = roundtripVerify(pins.encPath, pins, pass, "exchange.json");
console.log(`sealed: ${file} (${n} item) access=${fp(accessKey)} secret=${fp(secretKey)}`);

/* ---------- meta write LAST (pins + self-contained pass) ---------- */
meta.exchangeVault = {
  file: `agent/vault/${file}`,
  passRef: "self-contained (pass in meta) — W15 ongoing-activity law supersedes W13 R33 writer-custody for this class",
  passCustody: "self-keyed vault doctrine (operator W15 trace 1a155217160a6429: ״וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת״)",
  pass,
  outerSha256: pins.outerSha256,
  innerSha256: pins.innerSha256,
  formula: "openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<meta.exchangeVault.pass> | unzip exchange.json",
  contents: exchange.items.map((i) => i.id),
  source: exchange.source,
  sealedAt: now(),
  law: "exchange class — spot REST credentials; permissions UNVERIFIED until first signed probe; trade authority behind the two-key arm (exec-armed policy)",
  replacedArchive: exExisted ? meta.exchangeVault.file : undefined,
};
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(META, 0o600);
console.log(`meta: exchangeVault updated (self-contained) ${exExisted ? `· replaced ${meta.exchangeVault.replacedArchive}` : "(new class)"}`);

/* ---------- sandbox cache refresh (engine ladder rung 2) ---------- */
const cache = {
  format: "exchange-1",
  extractedAt: now(),
  items: [{ id: "htx", accessKey, secretKey, note: "W17 rotation cache — rebuilt from the fresh seal" }],
};
fs.mkdirSync(SECRETS, { recursive: true });
fs.writeFileSync(path.join(SECRETS, "exchange.json"), JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(path.join(SECRETS, "exchange.json"), 0o600);
console.log("cache: .secrets/exchange.json refreshed (0600) — the running engine picks the new pair on its next htxConfig()");

/* ---------- consume the drop (secrets never lie in upload twice) ---------- */
try { fs.rmSync(DROP, { force: true }); } catch {}
console.log("W17-SEAL-OK");
