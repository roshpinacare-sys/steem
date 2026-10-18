// g13-build-army-cache.mjs — open the pinned MASTER bundle (era pass from
// pre-migration git history, env-only), chain-judge EVERY posting WIF against
// the LIVE authorities, and write the engine's army cache (0600).
// Verdicts only on stdout — zero material.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { wifDecode, pubkeyFromSeed } from "/home/z/audit/repos/steem/mini-services/saos-engine/steemtx.mjs";

const STEEM = "/home/z/audit/repos/steem";
const log = (o) => console.log(JSON.stringify(o));
const sh = (cmd, env = {}) => execSync(cmd, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).toString();

const oldRecovery = JSON.parse(sh("git -C " + STEEM + " show 609166c62^:agent/recovery-meta.json"));
const pass = oldRecovery.keysZipPass;
if (!pass || pass.length < 8) { log({ ok: false, verdict: "pass-recovery-failed" }); process.exit(1); }

const meta = JSON.parse(fs.readFileSync(path.join(STEEM, "agent/recovery-meta.json"), "utf8"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "g13army-"));
fs.chmodSync(work, 0o700);
const zipPath = path.join(work, "m.zip");
const outDir = path.join(work, "open");
execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "${STEEM}/${meta.keysZipFile}" -out "${zipPath}" -pass env:VP`, { env: { ...process.env, VP: pass }, stdio: "pipe" });
const inner = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
if (inner !== meta.keysZipInnerSha256) { log({ ok: false, verdict: "inner-sha-DRIFT" }); process.exit(1); }
execSync(`unzip -q -o "${zipPath}" -d "${outDir}"`, { stdio: "pipe" });
fs.rmSync(zipPath, { force: true });

const vault = JSON.parse(fs.readFileSync(path.join(outDir, "agent/keys/vault.json"), "utf8"));
const accs = vault.accounts ?? [];
log({ step: "vault-opened", pinnedSha: "MATCH", accounts: accs.length });

// chain-judge: every account, every role (schema: username + keys.{role}.wif)
const names = accs.map((a) => a.username ?? a.name).filter(Boolean);
const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [names], id: 1 }) }).then((x) => x.json());
const live = new Map((r.result ?? []).map((a) => [a.name, {
  posting: (a.posting?.key_auths ?? []).map((k) => k[0]),
  active: (a.active?.key_auths ?? []).map((k) => k[0]),
  owner: (a.owner?.key_auths ?? []).map((k) => k[0]),
}]));

const cacheAccounts = [];
const judged = [];
for (const a of accs) {
  const L = live.get(a.username ?? a.name);
  if (!L) { judged.push({ name: a.username ?? a.name, verdict: "not-on-chain" }); continue; }
  const gens = [];
  const roles = a.keys ?? {};
  for (const role of ["posting", "active", "owner", "memo"]) {
    const wif = roles[role]?.wif;
    if (!wif) continue;
    let pub = null;
    try { pub = pubkeyFromSeed(wifDecode(wif)); } catch { judged.push({ name: a.username ?? a.name, role, verdict: "bad-wif" }); continue; }
    const ok = (L[role] ?? []).includes(pub);
    judged.push({ name: a.username ?? a.name, role, verdict: ok ? "LIVE-MATCH" : "stale" });
    if (ok && role === "posting") gens.push({ role, wif });
  }
  if (gens.length) cacheAccounts.push({ name: a.username ?? a.name, chain: "steem", gens });
}

// merge with master-derived soldiers (posting? no — only owner matched; excluded honestly)
// final cache
process.umask(0o077);
fs.mkdirSync(path.join(STEEM, ".secrets"), { recursive: true });
const cache = {
  format: "army-keys-2",
  source: "KEYS-ZIP-2026-10-12-MASTER.zip.enc (inner-sha pin MATCH 89d58fd30523) via recovery-3 era pass (pre-migration git history, per recovery-meta custody note)",
  restoredAt: new Date().toISOString(),
  purpose: "posting-only social rails (R308 standing order + owner G13 order)",
  accounts: cacheAccounts,
};
fs.writeFileSync(path.join(STEEM, ".secrets/army-keys.json"), JSON.stringify(cache, null, 1));
fs.chmodSync(path.join(STEEM, ".secrets/army-keys.json"), 0o600);
fs.rmSync(work, { recursive: true, force: true });
log({
  ok: true,
  judged: judged.length,
  liveMatches: judged.filter((j) => j.verdict === "LIVE-MATCH").reduce((m, j) => (m[j.role] = (m[j.role] ?? 0) + 1, m), {}),
  stale: judged.filter((j) => j.verdict === "stale").length,
  cacheAccounts: cacheAccounts.map((a) => a.name),
});
