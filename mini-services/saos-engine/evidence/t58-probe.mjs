/* T-58 surface probe — the curation half of the income instrument.
   Reuses the engine's own sticky rpcCall (no new deps, same leash). */
import { rpcCall } from "../measure.mjs";

const ACC = "headcorner";
const out = {};

// 1) recent curation_reward + author_reward ops (last 1000 history rows)
try {
  const r = await rpcCall("condenser_api.get_account_history", [ACC, -1, 1000]);
  const rows = r?.result ?? r ?? [];
  const cur = [], aut = [], votes = [];
  for (const row of rows) {
    const op = row?.[1]?.op;
    if (!op) continue;
    const [name, body] = op;
    if (name === "curation_reward") cur.push({ ts: row[1].timestamp, reward: body.reward, permlink: body.comment_permlink, author: body.comment_author });
    if (name === "author_reward") aut.push({ ts: row[1].timestamp, sbd: body.sbd_payout, steem: body.steem_payout, vests: body.vesting_payout, permlink: body.permlink });
    if (name === "vote") votes.push({ ts: row[1].timestamp, author: body.author, permlink: body.permlink, weight: body.weight });
  }
  console.log("historyRows:", Array.isArray(rows) ? rows.length : "FAIL");
  console.log("curationOps:", cur.length);
  for (const c of cur.slice(-8)) console.log("  CUR", c.ts, c.reward, (c.author || "") + "/" + (c.permlink || "").slice(0, 50));
  console.log("authorOps:", aut.length);
  for (const a of aut.slice(-4)) console.log("  AUT", a.ts, a.sbd, a.steem, a.vests);
  console.log("voteOps:", votes.length);
  for (const v of votes.slice(-6)) console.log("  VOTE", v.ts, v.weight, (v.author || "") + "/" + (v.permlink || "").slice(0, 50));
  out.historyOk = Array.isArray(rows);
} catch (e) { console.log("history FAIL:", String(e).slice(0, 200)); }

// 2) does database_api.list_votes exist on Steem? (voter-indexed pending-curation surface)
try {
  const r = await rpcCall("database_api.list_votes", [{ start: { voter: ACC, author: "", permlink: "" }, limit: 10, order: "by_voter_comment" }]);
  const rows = r?.result?.votes ?? r?.votes ?? null;
  console.log("list_votes:", Array.isArray(rows) ? `OK rows=${rows.length}` : JSON.stringify(r).slice(0, 160));
  if (Array.isArray(rows)) for (const v of rows.slice(0, 5)) console.log("  LV", v.author + "/" + (v.permlink || "").slice(0, 44), "rshares=" + v.rshares, "weight=" + v.weight);
} catch (e) { console.log("list_votes FAIL:", String(e).slice(0, 200)); }

// 3) feed price for USD pricing (single-pricer law keeps pricing upstream, probe only)
try {
  const r = await rpcCall("condenser_api.get_current_price_feed", []);
  const pf = r?.result ?? r;
  console.log("price_feed:", JSON.stringify(pf));
} catch (e) { console.log("price_feed FAIL:", String(e).slice(0, 160)); }

// 4) recent votes by us on others' content — the curation-in-flight tranches
try {
  const r = await rpcCall("condenser_api.get_discussions_by_feed", [{ tag: ACC, limit: 5 }]);
  console.log("feed probe:", Array.isArray(r?.result) ? r.result.length : JSON.stringify(r).slice(0, 120));
} catch (e) { /* non-load-bearing */ }

process.exit(0);
