/* T-58 selector live proof — the floor laws bite on REAL candidates.
 * Read-only: fetch → normalize → filter. No votes, no broadcasts. */
import { rpcCall } from "../measure.mjs";
import { curatorPolicy, normalizePost, filterCandidates } from "../curator.mjs";

const VOTER = "headcorner";
const policy = curatorPolicy();
const nowMs = Date.now();
const posts = [];
for (const tag of policy.tags) {
  try {
    const r = await rpcCall("condenser_api.get_discussions_by_created", [{ tag, limit: 12 }]);
    for (const raw of r?.result ?? []) {
      const n = normalizePost(raw, tag, VOTER, nowMs);
      if (n) posts.push(n);
    }
  } catch { /* tag read fail → skip honestly */ }
}
console.log("candidates:", posts.length);
const out = filterCandidates({ posts, voter: VOTER, policy, nowMs });
const reasons = {};
for (const r of out.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log("rejects:", JSON.stringify(reasons));
console.log("selected:", out.selected.length);
for (const s of out.selected.slice(0, 4)) console.log("  SEL", s.author, (s.permlink || "").slice(0, 44), "age=" + s.ageMinutes + "m");
// show a few dead-post / diluted-pool examples (the measured classes)
const dead = out.rejected.filter((r) => r.reason === "dead-post").slice(0, 3);
const dil = out.rejected.filter((r) => r.reason === "diluted-pool").slice(0, 3);
for (const d of dead) console.log("  DEAD", d.key.slice(0, 70));
for (const d of dil) console.log("  DIL", d.key.slice(0, 70));
process.exit(0);
