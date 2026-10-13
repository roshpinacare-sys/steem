/* T-58 root-cause probe — WHY zero curation ops despite daily voting */
import { rpcCall } from "../measure.mjs";

const ACC = "headcorner";

// 1) ALL-TIME history depth: curation ops ever?
try {
  const r = await rpcCall("condenser_api.get_account_history", [ACC, -1, 10000]);
  const rows = r?.result ?? r ?? [];
  const first = rows[0]?.[0], last = rows[rows.length - 1]?.[0];
  const cur = rows.filter(x => x?.[1]?.op?.[0] === "curation_reward");
  const aut = rows.filter(x => x?.[1]?.op?.[0] === "author_reward");
  const votes = rows.filter(x => x?.[1]?.op?.[0] === "vote");
  const claims = rows.filter(x => x?.[1]?.op?.[0] === "claim_reward_balance");
  console.log("DEPTH: rows", rows.length, "blockIdx", first, "..", last, "firstTs", rows[0]?.[1]?.timestamp, "lastTs", rows[rows.length-1]?.[1]?.timestamp);
  console.log("ALL-TIME: curation", cur.length, "author", aut.length, "vote", votes.length, "claims", claims.length);
  for (const c of cur.slice(0, 10)) console.log("  CUR", c[1].timestamp, c[1].op[1].reward);
} catch (e) { console.log("history FAIL", String(e).slice(0, 200)); }

// 2) the posts we voted — pending pools + our rshares + vote age
const targets = [
  { author: "sagor1233", permlink: "steem-power-up-day-10-52df5273f7f53" },
  { author: "nhriyad", permlink: "medicine-corner-lalpol" },
  { author: "angelberry", permlink: "how-i-have-gained-55-000-steem-100-profit-within-5" },
];
for (const t of targets) {
  try {
    const r = await rpcCall("condenser_api.get_content", [t.author, t.permlink]);
    const c = r?.result ?? r;
    if (!c || !c.author) { console.log("content MISS", t.author); continue; }
    const ours = (c.active_votes || []).find(v => v.voter === ACC);
    const created = new Date((c.created || "").endsWith("Z") ? c.created : (c.created || "") + "Z");
    const votedAt = ours ? new Date(ours.time.endsWith("Z") ? ours.time : ours.time + "Z") : null;
    const ageMin = votedAt && created ? Math.round((votedAt - created) / 60000) : null;
    const nv = (c.active_votes || []).length;
    const rsharesTotal = (c.active_votes || []).reduce((s, v) => s + Number(v.rshares || 0), 0);
    console.log("POST", t.author.slice(0, 12), "pend=" + c.pending_payout_value, "nvotes=" + nv, "poolRshares=" + rsharesTotal,
      "ourVote=" + (ours ? `w=${ours.weight} rshares=${ours.rshares} age=${ageMin}min` : "MISSING"));
  } catch (e) { console.log("content FAIL", t.author, String(e).slice(0, 120)); }
}

// 3) feed price via dgp (get_current_price_feed disabled on our nodes — measured)
try {
  const r = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  const d = r?.result ?? r;
  console.log("DGP feed_price:", JSON.stringify(d?.feed_price), "sbd_interest", d?.sbd_interest_rate);
} catch (e) { console.log("dgp FAIL", String(e).slice(0, 120)); }

// 4) our exact SP (rshares arithmetic needs it — measured)
try {
  const r = await rpcCall("condenser_api.get_accounts", [[ACC]]);
  const a = r?.result?.[0] ?? r?.[0];
  if (a) console.log("ACCOUNT vests=" + a.vesting_shares, "delegated_out=" + a.delegated_vesting_shares, "received=" + a.received_vesting_shares);
} catch (e) { console.log("accounts FAIL", String(e).slice(0, 120)); }

process.exit(0);
