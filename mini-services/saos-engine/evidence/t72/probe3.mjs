/* T-72 probe3 · WHAT MOVED JUST NOW + reward fund via database_api */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
const EP = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
async function rpc(method, params, timeoutMs = 12_000) {
  let lastErr = null;
  for (const base of EP) {
    try {
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`http-${r.status}`);
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message).slice(0, 140));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("exhausted");
}
const opName = (op) => (Array.isArray(op) ? op[0] : op?.type?.replace(/_operation$/, "") ?? op?.type);
const ACC = "headcorner";
const out = {};
try { out.rewardFundDb = await rpc("database_api.find_reward_funds", {}); } catch (e) { out.rewardFundDb = { err: String(e).slice(0, 100) }; }
try { out.rewardFundList = await rpc("database_api.list_reward_funds", { start: null, limit: 10, order: "by_name" }); } catch (e) { out.rewardFundList = { err: String(e).slice(0, 100) }; }
try { out.rewardFundLower = await rpc("condenser_api.get_reward_fund", ["steem"]); } catch (e) { out.rewardFundLower = { err: String(e).slice(0, 100) }; }
const h = await rpc("condenser_api.get_account_history", [ACC, -1, 60]);
out.recentOps = [];
for (const [i, e] of (h?.result ?? []).slice().reverse()) {
  const t = opName(e.op);
  const v = Array.isArray(e.op) ? e.op[1] : e.op.value ?? {};
  let brief = "";
  if (t === "limit_order_create") brief = `${v.orderid} ${v.amount_to_sell} → ${v.min_to_receive}`;
  else if (t === "fill_order") brief = `${v.current_owner} sells ${v.current_pays} for ${v.open_pays}`;
  else if (t === "limit_order_cancel") brief = `orderid ${v.orderid}`;
  else if (t === "transfer") brief = `${v.from}→${v.to} ${v.amount}`;
  else if (t === "transfer_to_vesting") brief = `${v.from} ${v.amount}`;
  else if (t === "convert") brief = `${v.owner} ${v.amount} req=${v.requestid}`;
  else if (t === "claim_reward_balance") brief = `${v.reward_steem ?? ""} ${v.reward_sbd ?? ""} ${v.reward_vests ?? ""}`;
  else if (t === "vote") brief = `${v.voter}→${v.author}/${String(v.permlink).slice(0, 24)} w=${v.weight}`;
  else if (t === "comment") brief = `pp:${String(v.parent_permlink).slice(0, 18)} ${String(v.permlink).slice(0, 30)}`;
  else brief = JSON.stringify(v).slice(0, 100);
  out.recentOps.push({ idx: i, at: e.timestamp, t, brief });
}
console.log(JSON.stringify(out, null, 1));
