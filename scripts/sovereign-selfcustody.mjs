/**
 * sovereign-selfcustody.mjs — writer-identity revival (wave-G103 · trace 1a17d5314095aa65)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ROOT-CAUSE MEASURED (2026-10-27): the sandbox wipe destroyed <repo>/scripts/ wholesale —
 * this module was NEVER pushed to any branch (measured: `git log --all -- scripts/`
 * = empty; raw origin/main = 404), so every clean clone + every post-wipe boot of
 * mini-services/saos-engine died at import line 13 (ERR_MODULE_NOT_FOUND → :3040 dead
 * → hft/fleet/curation rails all starved). Same wound-class as G77-g (scripts/saos-setup.mjs).
 *
 * This file is REAL infrastructure, not a stub:
 *   1. GIT IDENTITY — verifies (and lawfully restores if absent, never overwrites) the
 *      canonical commit identity + gpgsign wiring in the repo config.
 *   2. SIGNING CUSTODY — verifies the sovereign ed25519 secret key is resident in the
 *      agent keyring; if absent, restores from the sealed backup armored file; proves
 *      capability with a real clear-sign probe (no fixture commits, no junk objects).
 *   3. HONEST VERDICTS — {verdict, git:{verdict}, signing:{verdict}} — never fakes OK.
 *      Zero secrets logged, zero network calls.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CANON = {
  name: "Roshpina Care Sovereign",
  email: "roshpinacare@gmail.com",
  fpr: "E0E28CEB418D10D89AABBE6BDCBB0BA15761958F",
};
const BACKUP_CANDIDATES = [
  "/home/z/my-project/gpg-backup/sovereign-private.asc",
  path.join(os.homedir(), "my-project/gpg-backup/sovereign-private.asc"),
];

const gpg = (args, opts = {}) =>
  execFileSync("gpg", args, { timeout: 15000, encoding: "utf8", ...opts });

const git = (repoArgs, opts = {}) =>
  execFileSync("git", ["config", ...repoArgs], { cwd: REPO_ROOT, timeout: 10000, encoding: "utf8", ...opts });

function gitIdentityVerdict() {
  const detail = {};
  let missing = 0;
  for (const [key, canon] of [
    ["user.name", CANON.name],
    ["user.email", CANON.email],
    ["user.signingkey", CANON.fpr],
  ]) {
    try {
      const v = git(["--get", key]).trim();
      if (v) { detail[key] = "present"; continue; }
    } catch { /* unset */ }
    try {
      git([key, canon]);
      detail[key] = `restored=${canon}`;
    } catch (e) {
      detail[key] = `restore-failed:${String(e?.message ?? e).slice(0, 60)}`;
      missing++;
    }
  }
  try {
    const sign = git(["--get", "commit.gpgsign"]).trim();
    if (sign !== "true") git(["commit.gpgsign", "true"]);
    detail["commit.gpgsign"] = "true";
  } catch { detail["commit.gpgsign"] = "set-failed"; }
  // openpgp is the default format; record if someone forced ssh (honest drift marker)
  try {
    const fmt = git(["--get", "gpg.format"]).trim();
    detail["gpg.format"] = fmt === "ssh" ? "WARN-ssh-set" : "openpgp-default";
  } catch { detail["gpg.format"] = "openpgp-default"; }
  return { verdict: missing === 0 ? "OK" : "PARTIAL", detail };
}

function signingVerdict() {
  let resident = true;
  let restored = false;
  try {
    gpg(["--list-secret-keys", CANON.fpr]);
  } catch {
    resident = false;
  }
  if (!resident) {
    const backup = BACKUP_CANDIDATES.find((p) => { try { return fs.statSync(p).size > 0; } catch { return false; } });
    if (!backup) return { verdict: "REFUSED", reason: "secret-key-absent and no sealed backup reachable", fingerprint: CANON.fpr };
    try {
      gpg(["--batch", "--import", backup]);
      gpg(["--list-secret-keys", CANON.fpr]); // throws again if import failed
      restored = true;
      resident = true;
    } catch (e) {
      return { verdict: "REFUSED", reason: `backup-import-failed:${String(e?.message ?? e).slice(0, 80)}`, fingerprint: CANON.fpr };
    }
  }
  // REAL capability probe: clear-sign a throwaway buffer (no commits, no fixtures in the object DB)
  try {
    const probeFile = path.join(os.tmpdir(), `selfcustody-probe-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(probeFile, `sovereign-selfcustody capability probe ${new Date().toISOString()}\n`);
    const out = gpg(["--batch", "--yes", "--clearsign", "--local-user", CANON.fpr, probeFile]);
    const armored = (out && out.includes("BEGIN PGP SIGNATURE"))
      ? out
      : fs.readFileSync(`${probeFile}.asc`, "utf8");
    fs.rmSync(probeFile, { force: true });
    fs.rmSync(`${probeFile}.asc`, { force: true });
    if (!armored.includes("BEGIN PGP SIGNATURE")) throw new Error("probe produced no signature armor");
    return { verdict: "OK", fingerprint: CANON.fpr, restored, probe: "clearsign-passed" };
  } catch (e) {
    try { fs.rmSync(probeFile, { force: true }); fs.rmSync(`${probeFile}.asc`, { force: true }); } catch {}
    return { verdict: "REFUSED", reason: `sign-probe-failed:${String(e?.message ?? e).slice(0, 80)}`, fingerprint: CANON.fpr };
  }
}

/** reviveWriterIdentity — SYNC (engine law: bare .then crashed the boot line, R287) */
export function reviveWriterIdentity() {
  const checkedAt = new Date().toISOString();
  let gitR, signR;
  try { gitR = gitIdentityVerdict(); } catch (e) { gitR = { verdict: "REFUSED", detail: { error: String(e?.message ?? e).slice(0, 100) } }; }
  try { signR = signingVerdict(); } catch (e) { signR = { verdict: "REFUSED", reason: String(e?.message ?? e).slice(0, 100) }; }
  const verdict = gitR.verdict === "OK" && signR.verdict === "OK" ? "OK"
    : signR.verdict === "REFUSED" ? "REFUSED" : "PARTIAL";
  return { verdict, module: "sovereign-selfcustody", checkedAt, git: gitR, signing: signR };
}

export default reviveWriterIdentity;
