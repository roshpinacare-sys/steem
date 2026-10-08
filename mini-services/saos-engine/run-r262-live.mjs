/** run-r262-live.mjs — live execution pass for R262 (run manually, then the engine owns it). */
import { runRcPool } from "./rc-pool.mjs";
import { runHiveProfiles } from "./hive-profiles.mjs";

const which = process.argv[2] ?? "profiles";
const now = new Date().toISOString();
if (which === "rcpool-dry") {
  console.log(JSON.stringify(await runRcPool({ now, dryRun: true }), null, 1));
} else if (which === "rcpool") {
  console.log(JSON.stringify(await runRcPool({ now, dryRun: false }), null, 1));
} else if (which === "profiles") {
  console.log(JSON.stringify(await runHiveProfiles({ now }), null, 1));
} else {
  console.error("unknown pass");
  process.exit(1);
}
