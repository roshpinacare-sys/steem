/* T-58 probe 3 — curation stop-date precision + mid-era voted posts' fate */
import { rpcCall } from "../measure.mjs";

const ACC = "headcorner";

// 1) all 43 curation ops: timestamps + total
const r = await rpcCall("condenser_api.get_account_history", [ACC, -1, 10000]);
const rows = r?.result ?? r ?? [];
const cur = rows.filter(x => x?.[1]?.op?.[0] === "curation_reward");
let total = 0;
const byDay = {};
for (const c of cur) {
  const ts = c[1].timestamp;
  const v = parseFloat(c[1].op[1].reward || "0");
  total += v;
  const d = ts.slice(0, 10);
  byDay[d] = (byDay[d] || 0) + v;
}
console.log("curation total VESTS:", total.toFixed(6), "days:", JSON.stringify(byDay));
console.log("newest curation op:", cur.length ? cur[cur.length - 1][1].timestamp : "none");

// 2) mid-era votes (09-12..09-28) — sample 5, fetch their posts now
const votes = rows.filter(x => x?.[1]?.op?.[0] === "vote" && x[1].timestamp >= "2026-09-12" && x[1].timestamp <= "2026-09-28");
console.log("mid-era votes:", votes.length);
const sample = [];
for (let i = 0; i < votes.length; i += Math.max(1, Math.floor(votes.length / 5))) {
  const v = votes[i]?.[1]?.op?.[1];
  if (v) sample.push({ author: v.author, permlink: v.permlink });
  if (sample.length >= 5) break;
}
for (const t of sample) {
  try {
    const c = (await rpcCall("condenser_api.get_content", [t.author, t.permlink]))?.result;
    if (!c || !c.author) { console.log("  MISS", t.author.slice(0, 14), (t.permlink || "").slice(0, 40)); continue; }
    const ours = (c.active_votes || []).find(v => v.voter === ACC);
    const created = new Date((c.created || "").endsWith("Z") ? c.created : (c.created || "") + "Z");
    const votedAt = ours ? new Date(ours.time.endsWith("Z") ? ours.time : ours.time + "Z") : null;
    const ageMin = votedAt && created ? Math.round((votedAt - created) / 60000) : null;
    console.log("  POST", t.author.slice(0, 14), "cashout=" + (c.cashout_time || ""), "paid=" + c.pending_payout_value,
      "poolRshares=" + (c.active_votes || []).reduce((s, v) => s + Number(v.rshares || 0), 0),
      "ourVote=" + (ours ? `rshares=${ours.rshares} age=${ageMin}m` : "GONE"));
  } catch (e) { console.log("  FAIL", t.author, String(e).slice(0, 100)); }
}

// 3) reward fund + vests-per-steem for honest arithmetic context
try {
  const rf = (await rpcCall("condenser_api.get_reward_fund", ["steem"]))?.result;
  console.log("reward_fund:", JSON.stringify(rf));
  const dgp = (await rpcCall("condenser_api.get_dynamic_global_properties", []))?.result;
  console.log("total_vesting_shares:", dgp?.total_vesting_shares, "total_vesting_fund_steem:", dgp?.total_vesting_fund_steem);
} catch (e) { console.log("fund FAIL", String(e).slice(0, 120)); }

process.exit(0);
