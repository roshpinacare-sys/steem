/* R258 vault-structure probe — opens each era's KEYS ZIP with ITS OWN era meta
 * (the R265 era-meta law), then prints STRUCTURE ONLY: usernames, field names,
 * chain names. Zero secret values are ever printed. tmp wiped on exit. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const TMP = path.join(ROOT, ".probe-vault2");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
const git = (args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 64e6 });

function unlockEra(commit, label) {
  const meta = JSON.parse(git(["show", `${commit}:agent/recovery-meta.json`]));
  const zipPath = meta.keysZipFile;
  let encBuf;
  try { encBuf = fs.readFileSync(path.join(ROOT, zipPath)); }
  catch { encBuf = execFileSync("git", ["-C", ROOT, "show", `${commit}:${zipPath}`], { maxBuffer: 64e6 }); }
  const outerSha = crypto.createHash("sha256").update(encBuf).digest("hex");
  const outerOk = outerSha === meta.keysZipSha256;
  const zipFile = path.join(TMP, `outer-${label}.enc`);
  fs.writeFileSync(zipFile, encBuf, { mode: 0o600 });
  const dec = spawnSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
    "-in", zipFile, "-out", path.join(TMP, `inner-${label}.zip`), "-pass", `pass:${meta.keysZipPass}`],
    { stdio: ["ignore", "ignore", "pipe"] });
  if (dec.status !== 0) return { label, outerOk, opened: false, why: "openssl-fail" };
  const innerBuf = fs.readFileSync(path.join(TMP, `inner-${label}.zip`));
  const innerSha = crypto.createHash("sha256").update(innerBuf).digest("hex");
  const innerOk = innerSha === meta.keysZipInnerSha256;
  execFileSync("unzip", ["-o", "-q", path.join(TMP, `inner-${label}.zip`), "agent/keys/vault.json", "-d", path.join(TMP, `opened-${label}`)]);
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, `opened-${label}`, "agent", "keys", "vault.json"), "utf8"));
  return { label, outerOk, innerOk, opened: true, vault };
}

function describeVault(v, label) {
  console.log(`--- era ${label}: top-level fields: ${Object.keys(v).join(", ")}`);
  const accounts = v.accounts ?? [];
  console.log(`    accounts: ${accounts.length}`);
  const fieldNames = new Set();
  const chainNames = new Set();
  const usernames = [];
  for (const a of accounts) {
    usernames.push(a.username);
    const walk = (o, prefix) => {
      for (const [k, val] of Object.entries(o ?? {})) {
        if (k === "wif" || k === "seed" || k === "password" || k === "secret") continue; // never print
        if (typeof val === "object" && val !== null) { chainNames.add(k); walk(val, `${prefix}${k}.`); }
        else fieldNames.add(`${prefix}${k}`);
      }
    };
    walk(a, "");
  }
  console.log("    usernames:", usernames.join(","));
  console.log("    chain/key-group names:", [...chainNames].join(",") || "(none)");
  console.log("    leaf field names:", [...fieldNames].join(","));
}

const eras = [
  { commit: "HEAD", label: "HEAD" },
  { commit: "5ee8302", label: "5ee8302" },
  { commit: "f5ba155", label: "f5ba155" },
];
for (const e of eras) {
  try {
    const r = unlockEra(e.commit, e.label);
    if (r.opened) { console.log(`[${r.label}] outer-sha=${r.outerOk ? "MATCH" : "MISMATCH"} inner-sha=${r.innerOk ? "MATCH" : "MISMATCH"} → OPENED`); describeVault(r.vault, r.label); }
    else console.log(`[${r.label}] outer-sha=${r.outerOk ? "MATCH" : "MISMATCH"} → CLOSED (${r.why})`);
  } catch (err) { console.log(`[${e.label}] PROBE-FAIL: ${String(err?.message ?? err).slice(0, 100)}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log("TMP-WIPE: done");
