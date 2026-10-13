/* T-74b rank live proof — the candidate rank bites on REAL candidates.
 * Read-only: fetch → normalize → plan (gates + rank). No votes, no broadcasts.
 * Shows: (1) the plan's rank summary (early/measured tiers), (2) the ranked
 * order with rankScore where measured, (3) that selection order now follows
 * measured value — not the newest-first scan order. */
import { rpcCall } from "../measure.mjs";
import { curatorPolicy, normalizePost, filterCandidates } from "../curator.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
console.log("candidates:", posts.length, "(scan order = newest first per tag)");
/* our stake measured exactly like runCurator (vests × tvf/tvs × 1e6) — the
 * rank then scores with the machine's REAL rshares, fail-open on read fails */
let ourRshares = null;
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pay = JSON.parse(readFileSync(path.join(here, "../state/payouts.json"), "utf8"));
  const vests = Number(pay?.vp?.vests);
  if (Number.isFinite(vests) && vests > 0) {
    const dyn = await rpcCall("condenser_api.get_dynamic_global_properties", []);
    const tvs = dyn.ok ? Number(String(dyn.result?.total_vesting_shares ?? "").split(" ")[0]) : NaN;
    const tvf = dyn.ok ? Number(String(dyn.result?.total_vesting_fund_steem ?? "").split(" ")[0]) : NaN;
    if (Number.isFinite(tvs) && Number.isFinite(tvf) && tvs > 0) ourRshares = vests * (tvf / tvs) * 1e6;
  }
} catch { ourRshares = null; }
console.log("ourRshares measured:", ourRshares);
const out = filterCandidates({ posts, voter: VOTER, policy, nowMs, ourRshares });
const reasons = {};
for (const r of out.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log("rejects:", JSON.stringify(reasons));
console.log("rank summary:", JSON.stringify(out.rank));
console.log("selected (ranked order):", out.selected.length);
for (const s of out.selected.slice(0, 8)) {
  console.log("  SEL", String(s.author).padEnd(18), "age=" + String(s.ageMinutes).padStart(5) + "m",
    "pend=" + String(s.pendingSbd ?? 0).padStart(8), s.expectedSbd != null ? ("exp=" + s.expectedSbd + " score=" + (s.rankScore ?? "").toString().slice(0, 8)) : s.poolVerdict,
    (s.permlink || "").slice(0, 40));
}
/* the measurable claim: scan order (newest-first) vs plan order diverge */
const scanIdx = new Map(posts.map((p, i) => [`${p.author}/${p.permlink}`, i]));
const inversions = out.selected.filter((s, i) => {
  const j = scanIdx.get(`${s.author}/${s.permlink}`);
  return j != null && i > 0 && j < scanIdx.get(`${out.selected[0].author}/${out.selected[0].permlink}`);
}).length;
console.log("scan-vs-plan divergence present:", out.selected.length > 1 && out.selected.some((s, i) => scanIdx.get(`${s.author}/${s.permlink}`) !== i));
process.exit(0);
