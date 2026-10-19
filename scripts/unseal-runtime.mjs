/**
 * unseal-runtime.mjs — W15 · THE BARE-CLONE BOOTSTRAP (חיבור-ראשון-מהקלון).
 *
 * Owner order 2026-10-19: "וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת".
 * Any fresh runner (or human) lands here with nothing but a git clone:
 *
 *     git clone <repo> && node scripts/unseal-runtime.mjs
 *     → every self-contained vault class verified (pins) + cached (0600)
 *     → honest strand register for owner-pass classes (never guessed)
 *
 * Fingerprints only. The chain/API judges usability (R306-b).
 *
 * Usage: node scripts/unseal-runtime.mjs [--quiet]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrappableVerdict, unsealVaultClass, SELF_CONTAINED_CLASSES } from "../mini-services/saos-engine/vault-unseal.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUIET = process.argv.includes("--quiet");
const CACHE_BY_CLASS = {
  exchangeVault: "exchange.json",
  integrationsVault: "integrations.json",
  agentsVault: "agents.json",
};

const meta = JSON.parse(fs.readFileSync(path.join(REPO, "agent", "recovery-meta.json"), "utf8"));
const verdict = bootstrappableVerdict(REPO);

console.log(`UNSEAL-RUNTIME (W15) — the ongoing-activity key: ${verdict.verdict}`);
let unsealed = 0;
for (const name of SELF_CONTAINED_CLASSES) {
  const cls = meta[name];
  if (!cls) continue;
  try {
    unsealVaultClass(REPO, meta, name);
    unsealed++;
    if (!QUIET) console.log(`  ${name}: UNSEALED → .secrets/${CACHE_BY_CLASS[name]} (0600, pins verified)`);
  } catch (e) {
    console.log(`  ${name}: ${e.code === "VAULT-PASS-ABSENT" ? "STRANDED-OWNER-PASS (R-VAULTPASS-1 — honest)" : `${e.code} — ${String(e.message).slice(0, 80)}`}`);
  }
}
if (!QUIET) {
  for (const c of verdict.classes) {
    console.log(`  census ${c.name}: ${c.custody}${c.outerPinOk ? " · outer-pin OK" : " · outer-pin MISMATCH"}`);
  }
}
console.log(`verdict: ${unsealed} class${unsealed === 1 ? "" : "es"} restored from git alone — ${verdict.verdict}`);
process.exit(verdict.verdict === "ONGOING-ACTIVITY-KEY-OK" || unsealed > 0 ? 0 : 1);
