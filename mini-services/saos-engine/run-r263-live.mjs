/**
 * run-r263-live.mjs — R263 LIVE PASSES (chain-judged, receipts journaled).
 * Order: Steem profile sweep (macrame FIRST — the operator called it out;
 * cap 4/run, idempotent, so we run it until convergence or three passes) →
 * Hive profile sync (cashmachine/haran crossed the RC meta floor) → content
 * force (bridge + retry) → Hive rail pass (staggered windows) → Hive social
 * pass (persona-voiced lanes). Verdicts only printed.
 */
import { runProfiles } from "./army-social.mjs";
import { runHiveProfiles } from "./hive-profiles.mjs";
import { runContent } from "./content.mjs";
import { runHiveRail } from "./hive.mjs";
import { runHiveSocial } from "./hive-social.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
import * as fs from "node:fs";

const STEEM_ROSTER = ["macrame", "lsa", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6", "cashmachine", "haran", "israelnews", "headcorner"];
const now = () => new Date().toISOString();
const out = { at: now(), passes: {} };

/* 0 · custody revival IN THIS PROCESS (the engine holds its own memory;
 * a standalone driver must revive the vault fleet itself) */
try { const rev = await reviveArmyCustody({ now: now() }); out.passes.custodyRevival = { verdict: rev.verdict, verified: rev.after?.verified ?? null }; }
catch (e) { out.passes.custodyRevival = { error: String(e?.message ?? e).slice(0, 160) }; }

/* 1 · Steem profiles — three capped passes, macrame first each time */
out.passes.steemProfiles = [];
for (let i = 0; i < 3; i++) {
  try {
    const r = await runProfiles({ now: now(), roster: STEEM_ROSTER });
    out.passes.steemProfiles.push({ pass: i + 1, updated: r.updated, skipped: r.skipped.length, deferred: r.deferred });
    if (r.updated.length === 0) break; // converged (or custody gate)
  } catch (e) { out.passes.steemProfiles.push({ pass: i + 1, error: String(e?.message ?? e).slice(0, 160) }); break; }
}

/* 2 · Hive profiles — the idempotent pass (custody-gated, RC-gated) */
try { out.passes.hiveProfiles = await runHiveProfiles({ now: now() }); }
catch (e) { out.passes.hiveProfiles = { error: String(e?.message ?? e).slice(0, 160) }; }

/* 3 · content force — the writers' room with the 429 retry */
try { out.passes.content = await runContent({ now: now(), force: true }); }
catch (e) { out.passes.content = { error: String(e?.message ?? e).slice(0, 160) }; }

/* 4 · Hive rail — staggered windows verdicts */
try { out.passes.hiveRail = await runHiveRail({ now: now(), limit: 2 }); }
catch (e) { out.passes.hiveRail = { error: String(e?.message ?? e).slice(0, 160) }; }

/* 5 · Hive social — persona-voiced lanes */
try { out.passes.hiveSocial = await runHiveSocial({ now: now() }); }
catch (e) { out.passes.hiveSocial = { error: String(e?.message ?? e).slice(0, 160) }; }

out.doneAt = now();
fs.writeFileSync(new URL("./state/r263-live.json", import.meta.url).pathname, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
