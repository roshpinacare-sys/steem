// g13-unseal-master.mjs — recover recovery-3 era passes from PRE-R-VAULTPASS-1
// git history (recovery-meta itself documents: "material persists in pre-migration
// git history"), open the pinned MASTER bundle, and census its WIF slots.
// Zero secret material on stdout — verdicts only.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

const STEEM = "/home/z/audit/repos/steem";
const log = (o) => console.log(JSON.stringify(o));

function sh(cmd) {
  return execSync(cmd, { cwd: STEEM, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// 1) pull pre-removal metas into memory (never printed)
const oldRecovery = JSON.parse(sh("git show 609166c62^:agent/recovery-meta.json"));
const oldGen1 = (() => { try { return JSON.parse(sh("git show 609166c62^:agent/vault/GEN-1-ERA-META.json")); } catch { return {}; } })();

const eras = {};
for (const [k, v] of Object.entries(oldRecovery)) {
  if (/pass/i.test(k) && typeof v === "string" && v.length >= 8) eras[k] = v;
}
for (const [k, v] of Object.entries(oldGen1)) {
  if (/pass/i.test(k) && typeof v === "string" && v.length >= 8) eras["gen1." + k] = v;
}
log({ step: "passes-recovered", count: Object.keys(eras).length, eras: Object.keys(eras) });

// 2) candidate bundles
const meta = JSON.parse(fs.readFileSync(path.join(STEEM, "agent/recovery-meta.json"), "utf8"));
const candidates = [
  { file: meta.keysZipFile, wantOuter: meta.keysZipSha256, wantInner: meta.keysZipInnerSha256, label: "MASTER-1012" },
  { file: "agent/vault/KEYS-ZIP-2026-10-08-ROT4.zip.enc", label: "ROT4-1008" },
  { file: "agent/vault/KEYS-ZIP-2026-10-08.zip.enc", label: "GEN2-1008" },
  { file: meta.seedVaultFile, wantOuter: meta.seedVaultSha256, wantInner: meta.seedVaultInnerSha256, label: "SEED-1004" },
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "g13unseal-"));
fs.chmodSync(work, 0o700);
const results = [];

for (const c of candidates) {
  const encPath = path.join(STEEM, c.file);
  if (!fs.existsSync(encPath)) { results.push({ label: c.label, verdict: "file-missing" }); continue; }
  const outer = crypto.createHash("sha256").update(fs.readFileSync(encPath)).digest("hex");
  if (c.wantOuter && outer !== c.wantOuter) { results.push({ label: c.label, verdict: "outer-sha-DRIFT" }); continue; }
  let opened = null;
  for (const [era, pass] of Object.entries(eras)) {
    const tmpZip = path.join(work, "u.zip");
    try {
      execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "${encPath}" -out "${tmpZip}" -pass env:VP`, { env: { ...process.env, VP: pass }, stdio: "pipe" });
      const inner = crypto.createHash("sha256").update(fs.readFileSync(tmpZip)).digest("hex");
      if (c.wantInner && inner !== c.wantInner) { results.push({ label: c.label, era, verdict: "inner-sha-MISMATCH" }); continue; }
      opened = { era, inner };
      break;
    } catch { /* wrong pass — next */ }
  }
  if (!opened) { results.push({ label: c.label, verdict: "no-era-pass-opens" }); continue; }

  const pass = eras[opened.era];
  const tag = c.label.replace(/[^A-Z0-9]/g, "");
  const zipPath = path.join(work, "u-" + tag + ".zip");
  const outDir = path.join(work, "open-" + tag);
  execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "${encPath}" -out "${zipPath}" -pass env:VP`, { env: { ...process.env, VP: pass }, stdio: "pipe" });
  execSync(`unzip -q -o "${zipPath}" -d "${outDir}"`, { stdio: "pipe" });
  fs.rmSync(zipPath, { force: true });
  const files = [];
  (function walk(x) { for (const e of fs.readdirSync(x)) { const p = path.join(x, e); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(outDir, p)); } })(outDir);
  results.push({ label: c.label, verdict: "OPENED", era: opened.era, innerSha: opened.inner.slice(0, 12), files: files.slice(0, 10) });
  c._outDir = outDir;
}

// 3) census WIF slots inside opened bundles (paths+shapes only, no values)
const census = [];
for (const c of candidates) {
  if (!c._outDir) continue;
  const found = [];
  (function walk(x, rel) {
    for (const e of fs.readdirSync(x)) {
      const p = path.join(x, e);
      const rp = rel ? rel + "/" + e : e;
      if (fs.statSync(p).isDirectory()) walk(p, rp);
      else if (/\.json$/i.test(e)) {
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          const slots = [];
          (function scan(v, pth) {
            if (slots.length > 60 || !v || typeof v !== "object") return;
            for (const [k, vv] of Object.entries(v)) {
              const np = pth ? pth + "." + k : k;
              if (typeof vv === "string" && vv.length >= 50 && /^[5-9]/.test(vv)) {
                slots.push({ path: np, kind: /posting/i.test(np) ? "posting" : /active/i.test(np) ? "active" : /owner/i.test(np) ? "owner" : /memo/i.test(np) ? "memo" : "other", len: vv.length });
              } else if (vv && typeof vv === "object") scan(vv, np);
            }
          })(j, "");
          if (slots.length) found.push({ file: rp, slots: slots.slice(0, 60) });
        } catch { /* non-JSON */ }
      }
    }
  })(c._outDir, "");
  census.push({ bundle: c.label, jsonFilesWithSlots: found });
}

fs.rmSync(work, { recursive: true, force: true });
log({ step: "done", results, census });
