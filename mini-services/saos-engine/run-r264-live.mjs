/**
 * run-r264-live.mjs — R264 LIVE FIX PASSES: Steem profile re-sweep (ghost
 * kill) + content self-heal force (corpus pillars should queue even while
 * the breaker is open) + verification.
 */
import { runProfiles } from "./army-social.mjs";
import { runContent } from "./content.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
import * as fs from "node:fs";

const now = () => new Date().toISOString();
const out = { at: now(), passes: {} };

try { const rev = await reviveArmyCustody({ now: now() }); out.passes.custody = { verdict: rev.verdict, verified: rev.after?.verified }; } catch (e) { out.passes.custody = { error: String(e?.message ?? e).slice(0, 140) }; }

/* ghost sweep — three capped passes until convergence */
out.passes.profiles = [];
for (let i = 0; i < 3; i++) {
  try {
    const r = await runProfiles({ now: now() });
    out.passes.profiles.push({ pass: i + 1, updated: r.updated, skipped: r.skipped.length, deferred: r.deferred.filter((d) => !String(d.reason).includes("run-cap")) });
    if (!r.updated.length) break;
  } catch (e) { out.passes.profiles.push({ pass: i + 1, error: String(e?.message ?? e).slice(0, 140) }); break; }
}

/* self-heal content — the corpus pillars must queue even mid-storm */
try { out.passes.content = await runContent({ now: now(), force: true }); }
catch (e) { out.passes.content = { error: String(e?.message ?? e).slice(0, 140) }; }

out.doneAt = now();
fs.writeFileSync(new URL("./state/r264-live.json", import.meta.url).pathname, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
