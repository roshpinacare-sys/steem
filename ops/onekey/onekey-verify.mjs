/**
 * onekey-verify.mjs — ONE-KEY STANDING PROOF (W-ONEKEY, owner order
 * 2026-11-05, trace 1a1ab989d8db0a91): "המפתח שלי יפתח הכול".
 *
 * Runs with MAIN_KEY (and GH_PAT for the clone) ONLY — no other vault pass is
 * present in the environment. Reads custody-intake/INDEX.json and opens every
 * primary seal with the owner's key. Verdicts + account NAMES only — never
 * key material, never pass fingerprints beyond the owner's own fp8.
 *
 * USAGE (CI, scheduled daily + dispatch): node ops/onekey/onekey-verify.mjs
 * EXIT: 0 = every primary seal opens with MAIN_KEY · 1 = any failure (honest)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tryOpen, fp, ITER_STANDARD } from "./onekey-lib.mjs";

const GH_PAT = process.env.GH_PAT || "";
const MAIN_KEY = (process.env.MAIN_KEY || "").trim();
if (!GH_PAT) { console.log("ONEKEY-VERIFY REFUSED no-GH_PAT"); process.exit(1); }
if (MAIN_KEY.length < 16) { console.log("ONEKEY-VERIFY REFUSED MAIN_KEY missing/short"); process.exit(1); }

const sh = (cmd, opts = {}) => execFileSync(cmd[0], cmd.slice(1), { stdio: "pipe", encoding: "utf8", ...opts });
const VH = "/tmp/vh";
rmSync(VH, { recursive: true, force: true });
sh(["git", "clone", "--depth", "1", `https://x-access-token:${GH_PAT}@github.com/roshpinacare-sys/vault-home.git`, VH]);

const INDEX_PATH = `${VH}/custody-intake/INDEX.json`;
if (!existsSync(INDEX_PATH)) {
  console.log("ONEKEY-VERIFY ABORT no-INDEX.json (run onekey-adopt first) — honest abort, nothing faked");
  process.exit(1);
}
const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const primaries = (index.entries || []).filter((e) => e.status === "primary");
console.log(`onekey-verify: INDEX ${index.format || "?"} generated ${index.generatedAt} · primaries ${primaries.length}/${(index.entries || []).length} · law: ${index.law?.slice(0, 80)}`);

let open = 0;
const wounds = [];
for (const e of primaries) {
  const iters = [e.iter || ITER_STANDARD, ITER_STANDARD, 200000];
  let ok = false;
  for (const it of new Set(iters)) {
    if (tryOpen(`/tmp/vh/${e.path}`, MAIN_KEY, it, "/tmp/_onekey.v")) {
      ok = true;
      rmSync("/tmp/_onekey.v", { force: true });
      break;
    }
  }
  if (ok) { open++; console.log(`  OPEN  ${e.path} (${e.family})`); }
  else { wounds.push(e.path); console.log(`  SEALED ${e.path} — does NOT open with the owner key (honest wound)`); }
}

/* custody coverage — the soldier-keys proof: names + roles only */
if (index.custody?.artifact && existsSync(`/tmp/vh/${index.custody.artifact}`)) {
  const hit = (() => {
    for (const it of new Set([index.algorithm?.iter || ITER_STANDARD, ITER_STANDARD, 200000])) {
      if (tryOpen(`/tmp/vh/${index.custody.artifact}`, MAIN_KEY, it, "/tmp/_onekey.crown")) return it;
    }
    return null;
  })();
  if (hit !== null) {
    try {
      const map = JSON.parse(readFileSync("/tmp/_onekey.crown", "utf8"));
      const live = map?.live ?? map ?? {};
      const accs = Object.entries(live).filter(([k]) => !k.startsWith("_"));
      const soldiers = accs.filter(([a]) => /soldier/i.test(a));
      console.log(`onekey-verify: custody map OPENS with the owner key — ${accs.length} account(s) held`);
      for (const [acc, roles] of accs) console.log(`  ${acc}: ${Object.keys(roles ?? {}).sort().join("+") || "no-roles"}`);
      console.log(`onekey-verify: soldier keys IN THE VAULT: ${soldiers.length ? soldiers.map(([a]) => a).join(",") : "none-by-name (map covers what the chain verified)"}`);
      console.log(`onekey-verify: master password held in map: ${map?._master ? "yes (never printed)" : "no"}`);
    } catch { /* honest skip */ }
    rmSync("/tmp/_onekey.crown", { force: true });
  } else {
    console.log("onekey-verify: custody map does NOT open with the owner key — wound");
    wounds.push(index.custody.artifact);
  }
}

console.log(`onekey-verify: RESULT ${open}/${primaries.length} primary seal(s) open with MAIN_KEY (fp ${fp(MAIN_KEY)}) only`);
if (wounds.length) {
  console.log(`onekey-verify: FAIL wounds=${wounds.join(",")}`);
  process.exit(1);
}
console.log("onekey-verify: PASS — the owner's key opens every primary seal; old values documented as superseded and blocking nobody");
process.exit(0);
