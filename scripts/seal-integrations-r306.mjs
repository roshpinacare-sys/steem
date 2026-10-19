/**
 * seal-integrations-r306.mjs — R306 · THE OPERATOR-DROP SEAL (איטום-הטלות-המפעיל).
 *
 * Operator order 2026-10-10 (verbatim distilled): "בחן גם את זה ודאג שיהיה
 * בכספת אטום לשימוש האוטונומיה הריבונית". Two drops arrived in upload/:
 *
 *  1. איפאי.txt — search/AI capability keys (Tavily ×2 + MCP endpoint, Jina AI,
 *     one honestly-unidentified id/secret pair) + the operator's dev-map
 *     (vllm · Skyvern · browser-use · langsearch · free-web-search).
 *     → sealed as a NEW vault class: agent/vault/INTEGRATIONS-SEAL-*.zip.enc,
 *       own random pass living in meta.integrationsVault (system-custody
 *       doctrine — the private repo IS the vault, the pass travels with the
 *       meta, exactly like keysZipPass).
 *  2. apiii.txt — sovereign toolbelt rotation minted 07:01-07:27Z today
 *     (gitlab glpat / supabase sbp / render rnd / vck) — AFTER the R301-b
 *     04:48Z seal. → merged into toolbelt.json and re-sealed to
 *       agent/vault/TOOLBELT-SEAL-*.zip.enc with the ONE live keysZipPass
 *       (R301-b passRef law). This directly feeds scripts/sovereign-mirror.sh
 *       (SB6), which reads .secrets/toolbelt.json at run time.
 *
 * LAWS:
 *  - ZERO secret material in stdout, logs, or git — fingerprints only
 *    (first6…last4 + length). Uploads stay gitignored (G2).
 *  - The ONE formula: openssl AES-256-CBC · pbkdf2 · iter 300000; inner zip;
 *    sha256-pinned outer+inner; meta carries pins+pass.
 *  - Honesty law: unidentified material keeps the label "unidentified" —
 *    never fabricated, never probed blind.
 *  - Idempotent: identical fingerprints → honest SKIP, no re-seal churn.
 *  - Post-seal roundtrip verification from the sealed bytes on disk, before
 *    the meta is touched for the new pins... (pins are written only after a
 *    successful roundtrip; the meta is the LAST thing updated).
 *
 * Usage: node scripts/seal-integrations-r306.mjs [--force]
 * (re-seals even when fingerprints match — for pass rotation; default skips)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { envPassFor, pushClassPass } from "./actions-custody.mjs";

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

function readUpload(name) {
  try { return fs.readFileSync(path.join(UPLOAD, name), "utf8").replace(/\r/g, ""); }
  catch (e) { die(`upload ${name} unreadable: ${String(e?.message ?? e).slice(0, 80)}`); }
}

function tokensInLine(line) {
  const out = []; let m; const re = /[A-Za-z0-9_-]{20,}/g;
  while ((m = re.exec(line))) out.push(m[0]);
  return out;
}

/* ---------- parse drop 1: איפאי.txt (chat-drop shape: [ts] Head Corner: …) ---------- */
const ipaiLines = readUpload("איפאי.txt").split("\n").map((l) => l.trim()).filter(Boolean);
if (ipaiLines.length < 6) die(`איפאי.txt unexpected shape (${ipaiLines.length} lines, expected ≥6)`);
const iToks = ipaiLines.map(tokensInLine);

const tavily1 = iToks[0]?.find((t) => t.startsWith("tvly-")) ?? null;
const tavily2 = iToks[1]?.find((t) => t.startsWith("tvly-")) ?? null;
const mcpUrl = ipaiLines[2]?.match(/https:\/\/\S+/)?.[0] ?? null;
const jina = iToks[3]?.find((t) => t.startsWith("jina_")) ?? null;
const pairToks = iToks[4] ?? [];
const unkId = pairToks.find((t) => /^[0-9a-f]{32}$/i.test(t)) ?? null;
const unkSec = pairToks.find((t) => t !== unkId && t.length >= 20 && t.length <= 32 && !/^[0-9a-f]{32}$/i.test(t)) ?? null;
if (!tavily1 || !tavily2 || !mcpUrl || !jina || !unkId || !unkSec) {
  die(`איפאי.txt parse gap — tavily1:${!!tavily1} tavily2:${!!tavily2} mcp:${!!mcpUrl} jina:${!!jina} pair:${!!unkId && !!unkSec}`);
}
/* honesty guard: the MCP URL must embed one of the two keys we already hold */
if (!mcpUrl.includes("tavilyApiKey=")) die("mcp URL without tavilyApiKey param — unexpected shape");

const DEV_MAP = [
  "https://github.com/vllm-project/vllm",
  "https://github.com/Skyvern-AI/Skyvern",
  "https://github.com/browser-use/browser-use",
  "https://github.com/langsearch-ai/langsearch",
  "https://github.com/topics/free-web-search",
];

const integrations = {
  format: "integrations-1",
  sealedAt: null, /* filled at seal */
  source: "upload/איפאי.txt (operator drop 2026-10-10 12:42-13:20)",
  devMap: DEV_MAP, /* the operator's growth pointers, carried with the keys */
  items: [
    { id: "tavily", env: "SAOS_TAVILY_TOKEN", token: tavily1, note: "Tavily web-search API key (primary)" },
    { id: "tavily-2", env: "SAOS_TAVILY_TOKEN_2", token: tavily2, note: "Tavily web-search API key (second — rotation/backup)" },
    { id: "tavily-mcp-endpoint", env: "SAOS_TAVILY_MCP_URL", token: mcpUrl, note: "Tavily MCP endpoint (embeds the primary tavilyApiKey)" },
    { id: "jina", env: "SAOS_JINA_TOKEN", token: jina, note: "Jina AI — reader/search/embeddings" },
    { id: "unknown-id", env: "SAOS_UNKNOWN_ID", token: unkId, note: "UNIDENTIFIED service — 32-hex id (honesty law: label awaits the operator; never probed blind)" },
    { id: "unknown-secret", env: "SAOS_UNKNOWN_SECRET", token: unkSec, note: "UNIDENTIFIED service — secret of the pair above (honesty law)" },
  ],
};

/* ---------- parse drop 2: apiii.txt (sovereign toolbelt rotation) ---------- */
const apiiiLines = readUpload("apiii.txt").split("\n").map((l) => l.trim()).filter(Boolean);
const aToks = apiiiLines.map(tokensInLine);
/* R306-b CORRECTION (measured live 11:07Z): the gitlab token's dot-segment
 * suffix (.01.########) is PART OF THE TOKEN — the 62-char form authenticates
 * (API 200, account roshpinacare) while the "clean" 49-char cut fails 401.
 * Token regex for gitlab therefore spans dots; the other services stay
 * dot-free classes. Honesty law: the chain/API judges, never the shape. */
const aToksGitlab = apiiiLines.map((l) => (l.match(/glpat-[A-Za-z0-9_.-]+/g) ?? []));
const rot = {
  gitlab: aToksGitlab[0]?.find((t) => t.startsWith("glpat-")) ?? null,
  supabase: aToks[1]?.find((t) => t.startsWith("sbp_")) ?? null,
  vck: aToks[2]?.find((t) => t.startsWith("vck_")) ?? null,
  render: aToks[3]?.find((t) => t.startsWith("rnd_")) ?? null,
};
const rotRawNote = apiiiLines[0]?.slice(-14) ?? ""; /* trailing fragment of the gitlab line, fingerprinted in the note */
if (!rot.gitlab || !rot.supabase || !rot.vck || !rot.render) {
  die(`apiii.txt parse gap — gitlab:${!!rot.gitlab} supabase:${!!rot.supabase} vck:${!!rot.vck} render:${!!rot.render}`);
}

/* ---------- load current toolbelt from the SEALED truth (fail-closed) ---------- */
const meta = JSON.parse(fs.readFileSync(META, "utf8"));
if (!meta.keysZipPass || !meta.toolbelt?.file || !meta.toolbelt?.outerSha256 || !meta.toolbelt?.innerSha256) {
  die("meta missing keysZipPass/toolbelt pins");
}
/* toolbelt: unlock → parse → merge → decide rotation */
const tbEnc = fs.readFileSync(path.join(REPO, meta.toolbelt.file));
if (sha256(tbEnc) !== meta.toolbelt.outerSha256) die("toolbelt outer-pin mismatch in worktree");
const tbTmp = fs.mkdtempSync("/tmp/seal-tb-"); fs.chmodSync(tbTmp, 0o700);
execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
  "-in", path.join(REPO, meta.toolbelt.file), "-out", path.join(tbTmp, "inner.zip"), "-pass", `pass:${meta.keysZipPass}`],
  { stdio: ["ignore", "ignore", "pipe"] });
if (sha256(fs.readFileSync(path.join(tbTmp, "inner.zip"))) !== meta.toolbelt.innerSha256) die("toolbelt inner-pin mismatch");
execFileSync("unzip", ["-o", "-q", path.join(tbTmp, "inner.zip"), "toolbelt.json", "-d", tbTmp], { stdio: ["ignore", "ignore", "pipe"] });
const toolbelt = JSON.parse(fs.readFileSync(path.join(tbTmp, "toolbelt.json"), "utf8"));
if (!Array.isArray(toolbelt.items) || !toolbelt.items.length) die("sealed toolbelt.json torn");

const rotation = [];
for (const [id, tok] of Object.entries(rot)) {
  if (!tok) continue;
  const it = toolbelt.items.find((x) => x.id === id);
  if (!it) { toolbelt.items.push({ id, token: tok, env: `SAOS_${id.toUpperCase()}_TOKEN`, note: `operator rotation ${now()} (upload/apiii.txt)` }); rotation.push(`${id}: ADDED ${fp(tok)}`); continue; }
  const same = it.token === tok;
  if (same) { rotation.push(`${id}: unchanged ${fp(tok)}`); continue; }
  rotation.push(`${id}: ROTATED ${fp(it.token)} → ${fp(tok)}`);
  it.token = tok;
  it.note = `operator rotation ${now()} via upload/apiii.txt (prev ${fp(it.token)})`;
  it.rotatedAt = now();
}
const toolbeltRotated = rotation.some((r) => r.includes("ROTATED") || r.includes("ADDED"));

/* ---------- seal helpers (the ONE formula) ---------- */
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

const stamp = now().replace(/[-:]/g, "").replace("T", "T").slice(0, 15); /* 20261010T0930 */
let out = [];

/* ---------- SEAL 1: integrations vault (new class) ----------
 * R33 custody: pass may come from legacy meta OR Actions env. When neither is
 * available the compare cannot run — honest SKIP (never re-seal on a dead
 * compare). Only --force re-seals in that state. */
const ivExisted = !!meta.integrationsVault;
const ivPassAvail = !!(meta.integrationsVault?.pass ?? envPassFor("integrationsVault"));
const ivCompareSkipped = ivExisted && !ivPassAvail && !FORCE;
const integrationsChanged = FORCE || !ivExisted || (ivPassAvail && (() => {
  /* idempotency: compare fingerprints of every item against the sealed truth */
  try {
    const enc = fs.readFileSync(path.join(REPO, meta.integrationsVault.file));
    if (sha256(enc) !== meta.integrationsVault.outerSha256) return true;
    const tmp = fs.mkdtempSync("/tmp/seal-iv-"); fs.chmodSync(tmp, 0o700);
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", path.join(REPO, meta.integrationsVault.file), "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${meta.integrationsVault.pass ?? envPassFor("integrationsVault")}`],
        { stdio: ["ignore", "ignore", "pipe"] });
      execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), "integrations.json", "-d", tmp], { stdio: ["ignore", "ignore", "pipe"] });
      const cur = JSON.parse(fs.readFileSync(path.join(tmp, "integrations.json"), "utf8"));
      const byId = new Map((cur.items ?? []).map((i) => [i.id, i.token]));
      return integrations.items.some((i) => byId.get(i.id) !== i.token);
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  } catch { return true; }
}))();

if (integrationsChanged) {
  const pass = crypto.randomBytes(24).toString("base64");
  const file = `INTEGRATIONS-SEAL-${stamp}Z.zip.enc`;
  const pins = sealToVault(integrations, "integrations.json", pass, file);
  const n = roundtripVerify(pins.encPath, pins, pass, "integrations.json");
  /* R33 writer-custody: the fresh pass goes to Actions custody BEFORE any
   * meta write; a failed push aborts here — the pass can never reach git. */
  try {
    const secret = await pushClassPass("integrationsVault", pass);
    out.push(`custody: integrations pass pushed to Actions secret ${secret} (write-only)`);
  } catch (e) {
    console.error(`SEAL-FAIL: actions-custody push failed — refusing to write meta: ${String(e?.message ?? e).slice(0, 160)}`);
    process.exit(1);
  }
  meta.integrationsVault = {
    file: `agent/vault/${file}`,
    passRef: "actions:VAULT_PASS_INTEGRATIONS (PUT at seal time — never in git)",
    passCustody: "R33 writer-custody law — see scripts/actions-custody.mjs",
    outerSha256: pins.outerSha256,
    innerSha256: pins.innerSha256,
    formula: "openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<VAULT_PASS_INTEGRATIONS> | unzip (integrations.json)",
    contents: integrations.items.map((i) => i.id),
    source: integrations.source,
    devMap: DEV_MAP,
    sealedAt: now(),
    law: "search/AI capability class — web powers only, ZERO chain authority; unidentified items stay labeled until the operator names them",
  };
  out.push(`integrations: SEALED ${file} (${n} items) ${ivExisted ? "(re-seal)" : "(new class)"}`);
} else if (ivCompareSkipped) {
  out.push("integrations: SKIP — seal exists, pass under ACTIONS-CUSTODY (VAULT_PASS_INTEGRATIONS / VAULT_PASSES_R33) not provided; compare-skipped, not re-sealed (R33 custody law)");
} else {
  out.push("integrations: SKIP — sealed fingerprints identical");
}

/* ---------- SEAL 2: toolbelt rotation (ROT5) ---------- */
if (toolbeltRotated || FORCE) {
  toolbelt.rotatedAt = now();
  toolbelt.source = "upload/apiii.txt (operator rotation minted 07:01-07:27Z 2026-10-10)";
  const file = `TOOLBELT-SEAL-${stamp}Z.zip.enc`;
  const pins = sealToVault(toolbelt, "toolbelt.json", meta.keysZipPass, file);
  const n = roundtripVerify(pins.encPath, pins, meta.keysZipPass, "toolbelt.json");
  const prevFile = meta.toolbelt.file;
  meta.toolbelt = {
    ...meta.toolbelt,
    file: `agent/vault/${file}`,
    outerSha256: pins.outerSha256,
    innerSha256: pins.innerSha256,
    sealedAt: now(),
    replacedArchive: prevFile,
    note: `R306 operator rotation: ${rotation.join(" · ")}`,
  };
  out.push(`toolbelt: RE-SEALED ${file} (${n} items) — ${rotation.join(" · ")}`);
} else {
  out.push("toolbelt: SKIP — all four fingerprints identical to the sealed truth");
}

/* ---------- write meta LAST (pins only after verified roundtrips) ---------- */
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n", { mode: 0o664 });

/* ---------- refresh the 0600 caches the autonomy consumes at run time ---------- */
fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
const cacheIv = { extractedAt: now(), items: integrations.items.map(({ token, ...rest }) => ({ ...rest, token })) };
fs.writeFileSync(path.join(SECRETS, "integrations.json"), JSON.stringify(cacheIv, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(SECRETS, "toolbelt.json"), JSON.stringify(toolbelt, null, 2), { mode: 0o600 });
try { fs.rmSync(tbTmp, { recursive: true, force: true }); } catch {}

/* ---------- verdict: fingerprints only ---------- */
console.log("SEAL-OK (R306) — the drops are vault-borne:");
for (const l of out) console.log(`  ${l}`);
console.log(`  integrations items: ${integrations.items.map((i) => `${i.id}=${fp(i.token)}`).join(" · ")}`);
console.log(`  caches: .secrets/integrations.json + .secrets/toolbelt.json (0600, gitignored)`);
console.log(`  meta: agent/recovery-meta.json updated (pins last, after verified roundtrips)`);
