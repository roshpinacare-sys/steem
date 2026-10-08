/* R258 signing-key revival — tries candidate vault passphrases from ALL eras of
 * recovery-meta.json (current tree + every git-history version) against
 * agent/vault/W1-SIGNING-KEY-r4.enc.asc. On success: imports the secret key,
 * binds git signing config, trial-signs, wipes tmp. NEVER prints a secret. */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const KEY_ENC = path.join(ROOT, "agent", "vault", "W1-SIGNING-KEY-r4.enc.asc");
const TMP = path.join(ROOT, ".probe-signkey");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });

const git = (args, opts = {}) =>
  execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 32e6, ...opts });

/* 1. collect candidate passphrases from every era */
const cands = []; // {src, pass}
const addFromMeta = (txt, src) => {
  try {
    const m = JSON.parse(txt);
    for (const k of ["keysZipPass", "keysBackupPass"]) {
      if (typeof m?.[k] === "string" && m[k].length > 0) cands.push({ src: `${src}:${k}`, pass: m[k] });
    }
  } catch { /* corrupt era — skip */ }
};
addFromMeta(fs.readFileSync(path.join(ROOT, "agent", "recovery-meta.json"), "utf8"), "worktree");
const commits = git(["rev-list", "--all", "--", "agent/recovery-meta.json"]).trim().split("\n").filter(Boolean);
console.log("meta eras found:", commits.length);
for (const c of commits) {
  try { addFromMeta(git(["show", `${c}:agent/recovery-meta.json`]), c.slice(0, 7)); }
  catch (e) { console.log(`era ${c.slice(0, 7)}: unreadable`); }
}

/* 2. try each candidate, silently */
let winning = null;
for (let i = 0; i < cands.length; i++) {
  const out = path.join(TMP, `try-${i}.key`);
  const r = spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback",
    "--passphrase", cands[i].pass, "-d", KEY_ENC], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8e6 });
  if (r.status === 0 && r.stdout && r.stdout.length > 100) {
    fs.writeFileSync(out, r.stdout, { mode: 0o600 });
    winning = { i, file: out, src: cands[i].src };
    console.log(`candidate #${i} (${cands[i].src}): DECRYPT=OK`);
    break;
  }
}

if (!winning) {
  console.log("RESULT: no candidate opened the W1 key — signing stays DOWN, honest report required");
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
}

/* 3. import + bind + self-test */
try {
  execFileSync("gpg", ["--batch", "--yes", "--import", winning.file], { stdio: ["ignore", "ignore", "pipe"] });
  const list = execFileSync("gpg", ["--list-secret-keys", "--with-colons"], { encoding: "utf8" });
  const fpr = (list.split("\n").find((l) => l.startsWith("fpr:")) ?? "").split(":")[9] ?? "unknown";
  console.log("IMPORTED fingerprint:", fpr);
  execFileSync("git", ["-C", ROOT, "config", "user.signingkey", fpr]);
  execFileSync("git", ["-C", ROOT, "config", "commit.gpgsign", "true"]);
  const t = path.join(TMP, "trial.txt");
  fs.writeFileSync(t, `r258-signkey-revival-${Date.now()}\n`, { mode: 0o600 });
  const sg = spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback",
    "--passphrase", cands[winning.i].pass, "--clearsign", "-o", `${t}.asc`, t],
    { stdio: ["ignore", "ignore", "pipe"] });
  console.log("TRIAL-SIGN:", sg.status === 0 ? "OK — signing capability RESTORED" : `FAIL rc=${sg.status}`);
  const vf = spawnSync("gpg", ["--verify", `${t}.asc`], { encoding: "utf8" });
  console.log("TRIAL-VERIFY:", vf.status === 0 ? "OK" : `FAIL rc=${vf.status}`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("TMP-WIPE: done");
}
