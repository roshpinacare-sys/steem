// T-65 probe-5 — REAL totals with the measured op shapes (READ-ONLY)
const NODES = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
const NAI = { "@@000000013": "SBD", "@@000000021": "STEEM", "@@000000037": "VESTS" };
async function rpc(method, params) {
  for (const node of NODES) {
    try {
      const r = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue; const d = await r.json(); if (d.error) continue;
      return { result: d.result, node };
    } catch {}
  } return null;
}
const ACC = "headcorner";
const naiVal = (a) => {
  if (a == null) return 0;
  if (typeof a === "string") { const [v] = a.split(" "); return Number(v) || 0; }
  if (typeof a === "object") {
    const p = 10 ** (a.precision ?? 3);
    return (Number(a.amount ?? 0) || 0) / p;
  }
  return 0;
};
const opTypeName = (op) => {
  if (op == null) return "";
  if (typeof op === "string") return op;
  if (Array.isArray(op)) return String(op[0] ?? "").replace("_operation", "");
  return String(op.type ?? "").replace("_operation", "");
};
const body = (e) => (Array.isArray(e.op) ? e.op[1] ?? {} : e.op?.value ?? {});
const SEL = ["author_reward", "curation_reward", "claim_reward_balance", "comment_benefactor_reward"];
const isVal = (t) => t === "author_reward" || t === "curation_reward" || t === "claim_reward_balance" || t === "comment_benefactor_reward";
let rows = [], start = -1, pages = 0, oldestIdx = null;
while (pages++ < 10) {
  const r = await rpc("account_history_api.get_account_history", { account: ACC, start, limit: 10000, select_ops: SEL });
  const hist = r?.result?.history ?? [];
  if (!hist.length) break;
  for (const [i, e] of hist) if (isVal(opTypeName(e?.op))) rows.push([i, e]);
  const old = hist[0][0];
  if (oldestIdx === null) oldestIdx = old;
  else oldestIdx = Math.min(oldestIdx, old);
  if (old <= 0) break;
  start = old - 1;
}
rows.sort((a, b) => b[0] - a[0]);
const tot = { author_sbd: 0, author_steem: 0, author_vests: 0, author_ops: 0, curation_vests: 0, curation_ops: 0, benefactor_vests: 0, claim_sbd: 0, claim_steem: 0, claim_vests: 0, claim_ops: 0 };
const newest = [];
for (const [i, e] of rows) {
  const t = opTypeName(e?.op), b = body(e);
  if (t === "author_reward") {
    tot.author_sbd += naiVal(b.sbd_payout); tot.author_steem += naiVal(b.steem_payout); tot.author_vests += naiVal(b.vesting_payout); tot.author_ops++;
    if (newest.filter((x) => x.t === "author").length < 3) newest.push({ t: "author", i, block: e.block, at: e.timestamp, sbd: naiVal(b.sbd_payout), steem: naiVal(b.steem_payout), vests: naiVal(b.vesting_payout), permlink: b.permlink });
  } else if (t === "curation_reward") {
    tot.curation_vests += naiVal(b.reward); tot.curation_ops++;
  } else if (t === "comment_benefactor_reward") {
    tot.benefactor_vests += naiVal(b.reward);
  } else if (t === "claim_reward_balance") {
    tot.claim_sbd += naiVal(b.reward_sbd); tot.claim_steem += naiVal(b.reward_steem); tot.claim_vests += naiVal(b.reward_vests); tot.claim_ops++;
  }
}
console.log(JSON.stringify({ pages, oldestIdx, reachedGenesis: oldestIdx === 0, valOps: rows.length, tot, newest }, null, 2));
