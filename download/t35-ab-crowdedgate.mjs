#!/usr/bin/env node
/* T-35 · A/B DRY-RUN — prove the crowded-pool gate changes REAL selections
 * on the LIVE candidate stream (no keys, no broadcast): same fetched pool,
 * old law (no vote cap) vs T-35 law (maxPostVotes=100). Pure read-only. */

import { curatorPolicy, fetchCandidates, filterCandidates, normalizePost } from "../mini-services/saos-engine/curator.mjs";
import { armyCuratorPolicy } from "../mini-services/saos-engine/army-curation.mjs";

const nowMs = Date.now();
const fetched = await fetchCandidates(curatorPolicy(), "headcorner", nowMs);
if (!fetched.ok) { console.log("FETCH-FAILED — honest abort, no numbers invented"); process.exit(4); }
console.log("live pool (normalized):", fetched.posts.length);

const old = { ...curatorPolicy(), maxPostVotes: Infinity, maxVotesPerCycle: 99 };
const neu = { ...curatorPolicy(), maxVotesPerCycle: 99 }; // ISOLATE the crowded gate — maxVotesPerCycle identical in both arms
const armyOld = { ...armyCuratorPolicy(), maxPostVotes: Infinity, maxVotesPerCycle: 99 };
const armyNew = { ...armyCuratorPolicy(), maxVotesPerCycle: 99 };

const voteDist = fetched.posts.map((p) => p.voteCount ?? 0).sort((a, b) => a - b);
const q = (p) => voteDist[Math.floor(p * (voteDist.length - 1))] ?? 0;
console.log("voteCount dist: min=" + voteDist[0], "p25=" + q(0.25), "med=" + q(0.5), "p75=" + q(0.75), "max=" + voteDist.at(-1));

for (const [label, po, pn] of [["master", old, neu], ["army", armyOld, armyNew]]) {
  const so = filterCandidates({ posts: fetched.posts, voter: label === "master" ? "headcorner" : "cashmachine", policy: po, nowMs });
  const sn = filterCandidates({ posts: fetched.posts, voter: label === "master" ? "headcorner" : "cashmachine", policy: pn, nowMs });
  const dropped = so.selected.filter((v) => !sn.selected.some((n) => n.author === v.author && n.permlink === v.permlink));
  console.log(`\n${label}: old-law selected=${so.selected.length}  T35-law selected=${sn.selected.length}  crowded-dropped=${dropped.length}`);
  for (const d of dropped) console.log("  dropped:", d.author, d.permlink.slice(0, 38), "weight", d.weight);
  const crowded = sn.rejected.filter((r) => r.reason === "crowded");
  console.log("  crowded rejections:", crowded.length, crowded.slice(0, 5).map((c) => c.key.split("/")[0]).join(","));
}
