/**
 * integrations-revival.mjs — R306 · INTEGRATIONS VAULT REVIVAL (יכולות-הרשת-החיות מהכספת).
 *
 * OPERATOR DROP 2026-10-10 (upload/איפאי.txt): search/AI capability keys —
 * Tavily ×2 (+ the Tavily MCP endpoint), Jina AI, and one honestly-unidentified
 * id/secret pair — sealed by scripts/seal-integrations-r306.mjs into the git
 * vault with the ONE documented formula (AES-256-CBC·pbkdf2·300k, sha256-pinned
 * outer+inner, own pass living in recovery-meta.integrationsVault — the same
 * system-custody doctrine as keysZipPass).
 *
 * THE OPERATOR'S DEV-MAP attached to the same drop (verbatim pointers):
 *   vllm (self-host inference) · Skyvern + browser-use (browser agents) ·
 *   langsearch + free-web-search (LLM-grade web search) — the keys sealed here
 *   make the FIRST lanes of that map usable by the sovereign autonomy today:
 *   web research for the content pipeline, discovery intel, and any future
 *   browser/search worker.
 *
 * LAWS (identical spine to toolbelt-revival.mjs R301-b):
 *  - ZERO secret ever logged, returned, or committed — fingerprints only.
 *  - cache .secrets/integrations.json is 0600 + gitignored: survives engine
 *    restarts, dies with the sandbox, re-pulls from the vault when missing.
 *  - fail-closed on every pin (outer sha, inner sha, pass, shape).
 *  - honesty law: unidentified material keeps the label "unidentified" until
 *    the operator names it — never fabricated, never probed blind.
 *  - HIVE/BLURT/cross-chain LAW untouched: this module grants NO chain
 *    authority whatsoever — integrations are web capabilities, not keys.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "../..");
const SECRETS_DIR = path.join(REPO, ".secrets");
const OUT_FILE = path.join(SECRETS_DIR, "integrations.json");
const META = path.join(REPO, "agent", "recovery-meta.json");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * PURE unlock — the only place the seal formula is re-implemented outside the
 * seal script, exported FOR THE SELFTEST (R306 vectors: roundtrip + pin
 * fail-closed). Byte-in → verify outer pin → decrypt → verify inner pin →
 * unzip → parse JSON. The plaintext never outlives this function.
 */
export function unlockFromBytes(enc, { outerSha256, innerSha256, pass, innerName }) {
  let tmp = null;
  try {
    if (!Buffer.isBuffer(enc) || enc.length === 0) return { ok: false, reason: "empty-or-not-bytes" };
    if (sha256(enc) !== outerSha256) return { ok: false, reason: "OUTER-PIN-MISMATCH — vault tampered or stale" };
    tmp = fs.mkdtempSync("/tmp/integrations-");
    fs.chmodSync(tmp, 0o700);
    const encPath = path.join(tmp, "inner.zip.enc");
    fs.writeFileSync(encPath, enc, { mode: 0o600 });
    if (!pass) return { ok: false, reason: "pass missing" };
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", encPath, "-out", path.join(tmp, "inner.zip"), "-pass", `pass:${String(pass)}`],
      { stdio: ["ignore", "ignore", "pipe"] });
    const innerBuf = fs.readFileSync(path.join(tmp, "inner.zip"));
    if (innerSha256 && sha256(innerBuf) !== innerSha256) return { ok: false, reason: "INNER-PIN-MISMATCH — decrypted payload not the sealed one" };
    execFileSync("unzip", ["-o", "-q", path.join(tmp, "inner.zip"), innerName, "-d", tmp],
      { stdio: ["ignore", "ignore", "pipe"] });
    const data = JSON.parse(fs.readFileSync(path.join(tmp, innerName), "utf8"));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 140) };
  } finally {
    try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* wiped best-effort */ }
  }
}

/* R301-b SELF-CATCH inherited (honesty law): the pull is a raw Buffer, never
 * transcoded — a utf8 filter corrupts binary bytes and the outer pin can
 * never match. */
function gitShowBytes(ref, file) {
  return execFileSync("git", ["show", `${ref}:${file}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
}

/* revival — idempotent; re-seals nothing; fail-closed on every pin */
export async function reviveIntegrations() {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(META, "utf8"));
  } catch {
    return { ok: false, reason: "recovery-meta unreadable" };
  }
  const iv = meta.integrationsVault;
  if (!iv?.file || !iv?.outerSha256 || !iv?.innerSha256 || !iv?.pass) {
    return { ok: false, reason: "no integrationsVault entry in recovery-meta" };
  }

  if (fs.existsSync(OUT_FILE)) {
    try {
      const cur = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
      if (Array.isArray(cur?.items) && cur.items.length > 0) {
        return { ok: true, verdict: "INTEGRATIONS-CACHE-ALIVE", items: cur.items.map((i) => i.id), cached: true };
      }
    } catch { /* torn cache — re-pull */ }
  }

  try {
    const enc = gitShowBytes("HEAD", iv.file);
    const r = unlockFromBytes(enc, { outerSha256: iv.outerSha256, innerSha256: iv.innerSha256, pass: iv.pass, innerName: "integrations.json" });
    if (!r.ok) return { ok: false, reason: r.reason };
    const parsed = r.data;
    if (!Array.isArray(parsed?.items) || parsed.items.length === 0) {
      return { ok: false, reason: "integrations.json torn (no items)" };
    }
    for (const it of parsed.items) {
      if (!it.token || !it.env) return { ok: false, reason: `item ${it?.id ?? "?"} missing token/env` };
    }
    fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    return { ok: true, verdict: "INTEGRATIONS-ALIVE", items: parsed.items.map((i) => i.id) };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 140) };
  }
}

/* env mapping for autonomy tasks — values only via process env in the SAME
 * process; never returned in full to callers. Callers ask BY ID and get a
 * spawn-ready env fragment. */
export function integrationEnv() {
  let iv;
  try { iv = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); } catch { return { ok: false, reason: "integrations not revived" }; }
  const env = {};
  for (const it of iv.items ?? []) {
    if (it.token && it.env) env[it.env] = it.token;
  }
  return { ok: true, env, count: Object.keys(env).length };
}

/* CLI: node integrations-revival.mjs → verdict + fingerprints only (honesty law) */
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const r = reviveIntegrations();
  const ids = (r.items ?? []).join("+");
  console.log(JSON.stringify({ ok: r.ok, verdict: r.verdict ?? r.reason, items: ids }));
  process.exit(r.ok ? 0 : 1);
}
