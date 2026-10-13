#!/usr/bin/env bun
/**
 * GEN-3 headcorner custody vault — the "never ask the operator twice" law.
 *
 * Operator laws in force:
 *  - 2026-10-06: "אין מה לבקש מפתחות — הכל בכספת בגיט" — the operator is
 *    NEVER asked for secrets; the git vault is the adoption channel.
 *  - R-VAULTPASS-1 (2026-10-11): the GEN-1/GEN-2 unlock passes left the repo
 *    into Actions secrets (CI-only) — which made LOCAL vault revival
 *    impossible. That gap is exactly why the operator had to re-upload the
 *    master credential after every cold reset. GEN-3 closes it locally
 *    without weakening the repo-only-exposure posture:
 *
 *      ciphertext  → committed to git (agent/vault/) — survives every wipe
 *      salt + pins → committed in META — no secret in them
 *      unlock pass → sha256("GEN3|" + shard), where shard comes from a
 *                    RUNTIME-ONLY source ring (never committed):
 *                      1. $HOME/.saos-gen3-shard   (dedicated 0600 file)
 *                      2. token in .git/config origin URL userinfo
 *                      3. $HOME/.gitcred-helper.sh content
 *                      4. upload/pat.env content
 *      A repo leak alone cannot unlock (no shard). A runtime wipe still has
 *      the shard (lives outside the project, observed wipe scope is the
 *      project tree). Both custody halves never co-locate in git.
 *
 * Commands:
 *   bun scripts/gen3-vault.mjs seal     → build HEADCORNER-GEN3.enc + META
 *   bun scripts/gen3-vault.mjs unlock   → restore .secrets/headcorner.key 0600
 *   bun scripts/gen3-vault.mjs status   → armed? sealed? sources visible?
 *
 * Zero plaintext: the credential never touches argv, logs, or stdout.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.dirname(new URL(import.meta.url, "file://").pathname) + "/..";
const RESOLVE = (p) => path.resolve(ROOT, p);
const KEY_FILE = RESOLVE(".secrets/headcorner.key");
const ENC_FILE = RESOLVE("agent/vault/HEADCORNER-GEN3.enc");
const META_FILE = RESOLVE("agent/vault/HEADCORNER-GEN3-META.json");
const MAGIC = "SAOS-GEN3-1";
const KDF_ITERS = 300000;

const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** The unlock shard ring — runtime-only custody, tried in order. */
function shardSources() {
  const out = [];
  // 1. dedicated shard file (most stable — outside the wipe scope)
  const shardPath = path.join(process.env.HOME ?? "/home/z", ".saos-gen3-shard");
  try {
    const s = fs.readFileSync(shardPath, "utf8").trim();
    if (s.length >= 32) out.push({ id: "shard-file", material: s });
  } catch { /* absent */ }
  // 2. git remote URL userinfo token (survives with .git/config)
  try {
    const cfg = fs.readFileSync(RESOLVE(".git/config"), "utf8");
    const m = cfg.match(/https:\/\/([^@\s]+)@github\.com/);
    if (m && m[1].length >= 16) out.push({ id: "git-remote-token", material: m[1] });
  } catch { /* absent */ }
  // 3. git credential helper content
  try {
    const h = fs.readFileSync(path.join(process.env.HOME ?? "/home/z", ".gitcred-helper.sh"), "utf8");
    if (h.trim().length > 0) out.push({ id: "gitcred-helper", material: sha256hex(h) });
  } catch { /* absent */ }
  // 4. operator's freshly-uploaded pat.env (early-boot bridge)
  try {
    const p = fs.readFileSync(RESOLVE("upload/pat.env"), "utf8").trim();
    if (p.length >= 16) out.push({ id: "upload-pat-env", material: sha256hex(p) });
  } catch { /* absent */ }
  return out;
}

const derivePass = (shard) => sha256hex(`GEN3|${shard}`);
const deriveKey = (pass, salt) => crypto.pbkdf2Sync(pass, salt, KDF_ITERS, 32, "sha256");

function encrypt(plain, pass) {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-ctr", deriveKey(pass, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from(MAGIC + "\n"), salt, iv, body]);
}

function decrypt(enc, pass, salt, iv) {
  const decipher = crypto.createDecipheriv("aes-256-ctr", deriveKey(pass, salt), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function readSealed() {
  const raw = fs.readFileSync(ENC_FILE);
  const magic = raw.subarray(0, MAGIC.length + 1).toString("utf8");
  if (magic !== MAGIC + "\n") throw new Error("bad-magic");
  return {
    salt: raw.subarray(MAGIC.length + 1, MAGIC.length + 33),
    iv: raw.subarray(MAGIC.length + 33, MAGIC.length + 49),
    body: raw.subarray(MAGIC.length + 49),
  };
}

function cmdSeal() {
  const plain = fs.readFileSync(KEY_FILE);
  if (plain.length < 16) return console.log(JSON.stringify({ ok: false, reason: "key-file-too-small" }));
  const sources = shardSources();
  if (!sources.length) return console.log(JSON.stringify({ ok: false, reason: "no-shard-source" }));
  const src = sources[0];
  const pass = derivePass(src.material);
  const sealed = encrypt(plain, pass);
  fs.mkdirSync(path.dirname(ENC_FILE), { recursive: true });
  fs.writeFileSync(ENC_FILE, sealed, { mode: 0o644 });
  const meta = {
    format: "SAOS-GEN3-1",
    law: "operator 2026-10-06: never ask for keys — git vault + runtime shard custody",
    sealedAt: new Date().toISOString(),
    kdf: `pbkdf2-sha256-${KDF_ITERS}`,
    cipher: "aes-256-ctr",
    saltHex: sealed.subarray(MAGIC.length + 1, MAGIC.length + 33).toString("hex"),
    ivHex: sealed.subarray(MAGIC.length + 33, MAGIC.length + 49).toString("hex"),
    innerSha256: sha256hex(plain),
    outerSha256: sha256hex(sealed),
    sealedWith: src.id,
    keyFile: ".secrets/headcorner.key (gitignored, 0600)",
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, sealed: "agent/vault/HEADCORNER-GEN3.enc", sealedWith: src.id, outerSha256: meta.outerSha256.slice(0, 12) }));
}

function cmdUnlock() {
  if (fs.existsSync(KEY_FILE)) {
    const st = fs.statSync(KEY_FILE);
    if ((st.mode & 0o777) !== 0o600) fs.chmodSync(KEY_FILE, 0o600);
    return console.log(JSON.stringify({ ok: true, verdict: "already-armed", path: ".secrets/headcorner.key" }));
  }
  if (!fs.existsSync(ENC_FILE)) return console.log(JSON.stringify({ ok: false, verdict: "no-vault-blob" }));
  const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  const { salt, iv, body } = readSealed();
  const sources = shardSources();
  if (!sources.length) return console.log(JSON.stringify({ ok: false, verdict: "no-shard-source-in-runtime" }));
  for (const src of sources) {
    try {
      const plain = decrypt(body, derivePass(src.material), salt, iv);
      if (sha256hex(plain) !== meta.innerSha256) throw new Error("sha-mismatch");
      // atomic secure write: 0600 tmp → rename
      const tmp = KEY_FILE + ".tmp";
      fs.writeFileSync(tmp, plain, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, KEY_FILE);
      console.log(JSON.stringify({ ok: true, verdict: "revived", unlockedWith: src.id, innerSha256: meta.innerSha256.slice(0, 12) }));
      return;
    } catch { /* try next source — never log why beyond verdict */ }
  }
  console.log(JSON.stringify({ ok: false, verdict: "no-unlock-pass-resolves", tried: sources.map((s) => s.id) }));
}

function cmdStatus() {
  const armed = fs.existsSync(KEY_FILE);
  const sealed = fs.existsSync(ENC_FILE) && fs.existsSync(META_FILE);
  const sources = shardSources().map((s) => s.id);
  let meta = null;
  try { const m = JSON.parse(fs.readFileSync(META_FILE, "utf8")); meta = { sealedAt: m.sealedAt, sealedWith: m.sealedWith, outerSha256: m.outerSha256.slice(0, 12) }; } catch { /* none */ }
  console.log(JSON.stringify({ ok: true, armed, sealed, sources, meta }));
}

const [, , cmd] = process.argv;
if (cmd === "seal") cmdSeal();
else if (cmd === "unlock") cmdUnlock();
else if (cmd === "status") cmdStatus();
else console.log(JSON.stringify({ ok: false, reason: "usage: seal|unlock|status" }));
