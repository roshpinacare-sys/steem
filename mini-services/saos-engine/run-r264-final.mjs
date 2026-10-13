import { runProfiles } from "./army-social.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
const now = () => new Date().toISOString();
await reviveArmyCustody({ now: now() });
const r = await runProfiles({ now: now() });
console.log(JSON.stringify({ updated: r.updated, skipped: r.skipped.length, deferred: r.deferred.filter((d) => !String(d.reason).includes("run-cap")) }));
