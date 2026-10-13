/** verify-downvotes-r262.mjs — independent negative-vote scan on BOTH chains,
 * posts created in the trial era (>= 2026-10-07). Read-only. */
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";
import { rpcCall } from "./measure.mjs";

const SINCE = "2026-10-06T00:00:00Z";
const STEEM_ROSTER = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const out = { since: SINCE, steem: [], hive: [], summary: { steemPosts: 0, steemNegs: 0, hivePosts: 0, hiveNegs: 0 } };

for (const a of STEEM_ROSTER) {
  const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: a, limit: 8 }], 12000).catch(() => null);
  const posts = (r?.result ?? []).filter((p) => p.author === a && String(p.created) >= SINCE);
  for (const p of posts) {
    out.summary.steemPosts++;
    const neg = (p.active_votes ?? []).filter((v) => Number(v.percent) < 0);
    if (neg.length) { out.summary.steemNegs++; out.steem.push({ account: a, permlink: `${a}/${p.permlink}`, created: p.created, downvoters: neg.map((v) => `${v.voter}:${v.percent}`) }); }
  }
}
for (const a of HIVE_ROSTER) {
  const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: a, limit: 8 }]);
  const posts = (r?.result ?? []).filter((p) => p.author === a && String(p.created) >= SINCE);
  for (const p of posts) {
    out.summary.hivePosts++;
    const neg = (p.active_votes ?? []).filter((v) => Number(v.percent) < 0);
    if (neg.length) { out.summary.hiveNegs++; out.hive.push({ account: a, permlink: `${a}/${p.permlink}`, created: p.created, downvoters: neg.map((v) => `${v.voter}:${v.percent}`) }); }
  }
}
console.log(JSON.stringify(out, null, 1));
