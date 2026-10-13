/**
 * r255-profile-sync.mjs — one-shot R255 ops runner (real file, per the bun -e law).
 * Boots the git-vault army custody (fail-closed adoption), then runs the
 * persona profile sync (account_update2, chain-truth idempotent).
 * RUN: bun r255-profile-sync.mjs [--roster a,b,c]
 */
import { reviveArmyCustody, ARMY_ROSTER_VAULT } from "./vault-revival.mjs";
import { runProfiles } from "./army-social.mjs";

const rosterArg = process.argv.find((a) => a.startsWith("--roster="));
const roster = rosterArg ? rosterArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : ["headcorner", ...ARMY_ROSTER_VAULT];

console.log("custody revival…");
const rev = await reviveArmyCustody();
console.log(`revival: ${rev.verdict} (${rev.after?.verified ?? "?"}/${rev.after?.total ?? "?"})`);

console.log("profile sync…");
const out = await runProfiles({ now: new Date().toISOString(), roster });
console.log(JSON.stringify(out, null, 2));
