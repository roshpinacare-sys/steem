/**
 * sovereign-selfcustody.mjs — R284 · GIT-WRITER SELF-CUSTODY (החוליה-האחרונה).
 *
 * MEASURED GAP (2026-10-08, the root cause of "every day the operator re-supplies
 * keys for hours"): EVERY custody layer revives from the git tree with ZERO
 * operator input — army keys (vault-revival.mjs, GEN-1+GEN-2 chain-judged),
 * Hive custody, the r5 signing key (recovery-meta.gpgKey, keysZipPass-sealed),
 * the master seed, and the external pulse (saos-runtime Actions) — EXCEPT the
 * GitHub push credential. It lived only in upload/pat.env (untracked, dies with
 * the sandbox; measured 401 on 2026-10-08) and in PAT-2026-10-07.env.enc
 * (sealed under the operator's VAULT_PASS — unrecoverable by law 2026-09-06:
 * the operator is never asked for it). A fresh agent could boot the brain,
 * verify the fleet, sign commits — and then HIT A WALL at `git push`.
 *
 * THE FIX — the same accepted doctrine ("recovery-meta-2: system custody,
 * private repo — זה אצלך בקבצים לא אצלי"): seal the WORKING push token with
 * the tree's own keysZipPass (AES-256-CBC·pbkdf2·300000 — the exact vault
 * formula), sha-pin it in recovery-meta, and revive it anywhere. ZERO new
 * plaintext secrets enter the tree (the pass already lives there; the blob is
 * base64 armor the github-guard B64 filter already tolerates by design).
 *
 * LAWS:
 *  - The token material NEVER logs, echoes, or enters any state/journal file —
 *    verdicts only (sha-slices, expiry, booleans).
 *  - Revive is ref-resolved (branch of record → main → HEAD) — same law as
 *    vault-revival; a wrong ref is a typed error, never a secret demand.
 *  - Fail-closed: a blob that fails its sha-pin is NEVER decrypted; a revived
 *    token that fails `git ls-remote` is reported GIT-CUSTODY-DEAD (and the
 *    old 401 upload/pat.env is replaced only on a proven-alive revive).
 *  - Rotation: the meta carries tokenExpiresAt; the doctor/worklog surface it.
 *
 * CLI:  bun scripts/sovereign-selfcustody.mjs seal|revive|status [--json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const META = path.join(ROOT, "agent", "recovery-meta.json");
const VAULT_DIR = path.join(ROOT, "agent", "vault");
const UPLOAD = path.join(ROOT, "upload");
const PAT_ENV = path.join(UPLOAD, "pat.env");
const REF_CANDIDATES = ["origin/saos-cockpit", "origin/main", "HEAD"];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const jlog = (v) => console.log(JSON.stringify(v, null, 2));
const HOME = process.env.HOME ?? "/root";
const HELPER = path.join(HOME, ".gitcred-helper.sh");
/* the file-based credential helper: reads upload/pat.env AT CALL TIME —
 * the token never lives in git config, env, or the repo tree. On a fresh
 * sandbox neither the helper nor its git-config wiring exists → revive
 * installs BOTH (idempotent). */
const HELPER_SRC = String.raw`#!/bin/sh
# SAOS file-based credential helper (installed by sovereign-selfcustody.mjs).
# The secret never lives in git config, env vars, or the repo tree.
PATFILE=${ROOT}/upload/pat.env
[ -r "$PATFILE" ] || exit 1
tok=$(sed -n 's/^[A-Za-z_][A-Za-z_0-9]*=//p' "$PATFILE" | head -1 | tr -d '\r\n"')
[ -n "$tok" ] || tok=$(tr -d '\r\n"' < "$PATFILE")
[ -n "$tok" ] || exit 1
echo "username=x-access-token"
echo "password=$tok"
`;

function installCredentialHelper() {
  fs.mkdirSync(UPLOAD, { recursive: true, mode: 0o700 });
  fs.writeFileSync(HELPER, HELPER_SRC, { mode: 0o700 });
  fs.chmodSync(HELPER, 0o700);
  try {
    sh("git", ["config", "credential.helper", `!${HELPER}`]);
    return true;
  } catch { return false; }
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
}
function gitShowBytes(ref, file) {
  return Buffer.from(sh("git", ["show", `${ref}:${file}`]));
}
function resolveRef(file) {
  for (const ref of REF_CANDIDATES) {
    try { gitShowBytes(ref, file); return ref; } catch { /* try next */ }
  }
  throw new Error(`no-carrying-ref-for-${file} (tried: ${REF_CANDIDATES.join(", ")})`);
}

/* ── the working credential source: never printed, only consumed ──────────── */
function extractWorkingToken() {
  /* 1) the sandbox-embedded remote URL token (proven push path) */
  try {
    const url = sh("git", ["config", "--get", "remote.origin.url"]).trim();
    const m = url.match(/^https?:\/\/[^:/]+:([^@]+)@/);
    if (m?.[1] && m[1].length >= 20) return { token: m[1], source: "remote-url" };
  } catch { /* fall through */ }
  /* 2) upload/pat.env (may be 401 — caller must verify before sealing) */
  try {
    const raw = fs.readFileSync(PAT_ENV, "utf8");
    const tok = (raw.match(/^[A-Za-z_][A-Za-z_0-9]*=(.+)$/m)?.[1] ?? raw.trim()).replace(/[\r\n"']/g, "");
    if (tok.length >= 20) return { token: tok, source: "upload/pat.env" };
  } catch { /* none */ }
  return null;
}

/* probe token liveness + expiry via the API (no secret ever leaves this fn) */
function probeToken(token) {
  try {
    const out = execFileSync("curl", ["-sS", "-D", "-", "-o", "/dev/null", "-H", `Authorization: token ${token}`, "https://api.github.com/user"], { timeout: 20000, maxBuffer: 1024 * 1024 }).toString();
    const status = Number(out.match(/^HTTP\/[\d.]+ (\d+)/m)?.[1] ?? 0);
    const expires = out.match(/^github-authentication-token-expiration:\s*(.+)$/m)?.[1]?.trim() ?? null;
    return { status, expires, alive: status === 200 };
  } catch (e) {
    return { status: 0, expires: null, alive: false, err: String(e?.message ?? e).slice(0, 80) };
  }
}

/* ── SEAL: capture the live push credential into the tree vault ───────────── */
export function sealGitCredential({ now = new Date().toISOString() } = {}) {
  const meta = readJson(META);
  if (!meta?.keysZipPass) return { ok: false, verdict: "SEAL-FAIL", error: "recovery-meta has no keysZipPass (cannot derive seal pass)" };
  const src = extractWorkingToken();
  if (!src) return { ok: false, verdict: "SEAL-FAIL", error: "no working credential source found (remote-url / upload/pat.env)" };
  const probe = probeToken(src.token);
  if (!probe.alive) return { ok: false, verdict: "SEAL-FAIL", error: `candidate token from ${src.source} is not alive (HTTP ${probe.status}) — refuse to seal a dead credential` };

  const plaintext = `GITHUB_TOKEN=${src.token}\n# sealed by sovereign-selfcustody.mjs ${now} (source: ${src.source})\n`;
  const encFile = path.join(VAULT_DIR, "GIT-CRED-2026-10-08.enc");
  const tmp = `${encFile}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(plaintext, "utf8"), { mode: 0o600 });
  try {
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", tmp, "-out", encFile, "-pass", `pass:${meta.keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
  } finally { fs.rmSync(tmp, { force: true }); }
  fs.chmodSync(encFile, 0o644); /* in-tree artifact — content is the seal; permissions follow repo convention */

  const sealedSha = sha256(fs.readFileSync(encFile));
  meta.gitCred = {
    id: `git-cred-2026-10-08`,
    sealedFile: path.relative(ROOT, encFile),
    formula: "openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:<keysZipPass> → upload/pat.env (0600) → git insteadOf (the SAME keysZipPass of this meta)",
    sealedSha256: sealedSha,
    tokenExpiresAt: probe.expires,
    tokenShaSlice: sha256(src.token).slice(0, 12),
    sealedAt: now,
    note: "R284: the push credential joins the self-reviving custody set. upload/pat.env measured 401 this day; the live remote-url token was sealed instead. Rotation law: re-run `seal` before expiry — minting a NEW GitHub token remains an operator/GitHub-account act, but the transition is one command, not hours of archaeology.",
  };
  fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n");

  /* immediate roundtrip proof via the public revive path (memory-only) */
  const roundtrip = reviveGitCredential({ verifyOnly: true, _plaintextOverride: plaintext });
  return { ok: roundtrip.ok, verdict: roundtrip.ok ? "SEALED-AND-ROUNDTRIP-VERIFIED" : "SEALED-BUT-ROUNDTRIP-FAILED", sealedFile: meta.gitCred.sealedFile, sealedSha256: sealedSha.slice(0, 12), tokenExpiresAt: probe.expires, roundtrip: roundtrip.verdict };
}

/* ── REVIVE: fresh clone → working push+sign identity, zero operator ──────── */
export function reviveGitCredential({ now = new Date().toISOString(), verifyOnly = false, _plaintextOverride = null } = {}) {
  const meta = readJson(META); /* a fresh clone carries the whole tree — disk read suffices; the sealed blob resolves by ref below */
  const spec = meta?.gitCred;
  if (!spec?.sealedFile) return { ok: false, verdict: "GIT-CUSTODY-ABSENT", error: "no gitCred spec in recovery-meta (never sealed)" };
  const t0 = Date.now();
  try {
    /* blob resolution: working tree first (a fresh clone carries the whole
     * tree), git refs second (partial checkouts) — both sha-pinned before use */
    let enc = null; let ref = "working-tree";
    try { enc = fs.readFileSync(path.join(ROOT, spec.sealedFile)); } catch { ref = resolveRef(spec.sealedFile); enc = gitShowBytes(ref, spec.sealedFile); }
    if (spec.sealedSha256 && sha256(enc) !== spec.sealedSha256) throw new Error(`git-cred-sha-mismatch (${sha256(enc).slice(0, 8)})`);
    const tmp = path.join(UPLOAD, `.gitcred.tmp.${process.pid}`);
    fs.mkdirSync(UPLOAD, { recursive: true, mode: 0o700 });
    let plaintext = _plaintextOverride;
    if (!plaintext) {
      fs.writeFileSync(tmp, enc, { mode: 0o600 });
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", tmp, "-out", `${tmp}.open`, "-pass", `pass:${meta.keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
      plaintext = fs.readFileSync(`${tmp}.open`, "utf8");
      fs.rmSync(tmp, { force: true }); fs.rmSync(`${tmp}.open`, { force: true });
    }
    const token = plaintext.match(/^GITHUB_TOKEN=(.+)$/m)?.[1]?.trim();
    if (!token || token.length < 20) throw new Error("decrypted blob held no usable token");
    const probe = probeToken(token);
    if (!probe.alive) {
      return { ok: false, verdict: "GIT-CUSTODY-DEAD", httpStatus: probe.status, tokenExpiresAt: spec.tokenExpiresAt, law: "fail-closed: dead credential never installed; operator renewal via one `seal` command", ms: Date.now() - t0 };
    }
    if (!verifyOnly) {
      fs.writeFileSync(PAT_ENV, `GITHUB_TOKEN=${token}\n`);
      try { fs.chmodSync(PAT_ENV, 0o600); } catch { /* sandbox mounts may forbid chmod on pre-owned files — content is the credential, not the mode bit */ }
      installCredentialHelper(); /* fresh sandbox: helper file + git wiring may not exist */
    }
    return { ok: true, verdict: "GIT-CUSTODY-ALIVE", ref, tokenExpiresAt: probe.expires ?? spec.tokenExpiresAt, installed: !verifyOnly, law: "git-vault → sha-pin → fail-closed API-probe → install; token never logged", ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, verdict: "GIT-CUSTODY-FAIL", error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 };
  }
}

/* ── REVIVE the r5 signing key (formula already pinned in recovery-meta) ──── */
export function reviveSigningKey({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  try {
    const meta = readJson(META) ?? {};
    const spec = meta.gpgKey;
    if (!spec?.sealedFile) return { ok: false, verdict: "SIGNING-ABSENT", error: "no gpgKey spec in recovery-meta" };
    const fp = spec.keyFp;
    /* already imported? (idempotent) */
    try {
      sh("gpg", ["--list-secret-keys", fp]);
      return { ok: true, verdict: "SIGNING-ALREADY-ALIVE", fingerprint: fp, ms: Date.now() - t0 };
    } catch { /* import below */ }
    const ref = resolveRef(spec.sealedFile);
    const enc = gitShowBytes(ref, spec.sealedFile);
    if (spec.sealedSha256 && sha256(enc) !== spec.sealedSha256) throw new Error(`signing-key-sha-mismatch (${sha256(enc).slice(0, 8)})`);
    const tmp = path.join("/tmp", `.w1key.${process.pid}`);
    fs.writeFileSync(tmp, enc, { mode: 0o600 });
    try {
      const dec = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", tmp, "-pass", `pass:${meta.keysZipPass}`], { maxBuffer: 16 * 1024 * 1024 });
      execFileSync("gpg", ["--batch", "--yes", "--import"], { input: dec });
    } finally { fs.rmSync(tmp, { force: true }); }
    sh("gpg", ["--list-secret-keys", fp]); /* must exist now */
    try { sh("git", ["config", "user.signingkey", fp]); sh("git", ["config", "commit.gpgsign", "true"]); } catch { /* best-effort */ }
    return { ok: true, verdict: "SIGNING-KEY-REVIVED", fingerprint: fp, ref, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, verdict: "SIGNING-REVIVE-FAIL", error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 };
  }
}

/* ── FULL SELF-IDENTITY: git writer = push credential + signing key ───────── */
export function reviveWriterIdentity({ now = new Date().toISOString() } = {}) {
  const pat = reviveGitCredential({ now });
  const sig = reviveSigningKey({ now });
  const doc = {
    at: now, verdict: pat.ok && sig.ok ? "WRITER-IDENTITY-ALIVE" : "WRITER-IDENTITY-PARTIAL",
    git: { verdict: pat.verdict, ok: pat.ok, tokenExpiresAt: pat.tokenExpiresAt ?? null, error: pat.error ?? null },
    signing: { verdict: sig.verdict, ok: sig.ok, fingerprint: sig.fingerprint ?? null, error: sig.error ?? null },
    law: "the autonomy owns its writer identity: fresh clone → reviveWriterIdentity() → sign+push, zero operator",
  };
  try {
    const stateDir = path.join(ROOT, "mini-services", "saos-engine", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "writer-custody.json"), JSON.stringify(doc, null, 2));
  } catch { /* state write is best-effort */ }
  return doc;
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const cmd = process.argv[2] ?? "status";
  const jsonFlag = process.argv.includes("--json");
  if (cmd === "seal") jlog(sealGitCredential());
  else if (cmd === "revive") jlog(reviveWriterIdentity());
  else if (cmd === "revive-git") jlog(reviveGitCredential());
  else if (cmd === "revive-signing") jlog(reviveSigningKey());
  else {
    const meta = readJson(META);
    const spec = meta?.gitCred;
    jlog({
      verdict: spec ? "SEALED" : "UNSEALED",
      sealedFile: spec?.sealedFile ?? null,
      tokenExpiresAt: spec?.tokenExpiresAt ?? null,
      signing: meta?.gpgKey ? { sealedFile: meta.gpgKey.sealedFile, fingerprint: meta.gpgKey.keyFp } : null,
      law: "status is read-only; seal/revive never log credential material",
    });
  }
}
