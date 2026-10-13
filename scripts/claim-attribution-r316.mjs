// R316 · שחזור-שיוך התביעות מהיסטוריית-השרשרת — נתוני-ציבור בלבד, אפס-סודות
// חוק: שורה נכנסת רק עם ראיה (tx-id + תאריך + חשבון + סכומים גלויים). אין-המצאות.
const RPCS = {
  steem: ["https://api.steemit.com", "https://api.deathwing.me", "https://api.justyy.com"],
  hive: ["https://api.hive.blog", "https://api.openhive.network"],
};
const FLEET = {
  steem: ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"],
  hive: ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"],
};
const DEPTH = 5000; // עומק-היסטוריה לחשבון — חלון-התביעות האחרונות

async function rpc(chain, body) {
  let lastErr;
  for (const url of RPCS[chain]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("rpc-unreachable");
}

async function globalProps(chain) {
  const method = chain === "steem" ? "condenser_api.get_dynamic_global_properties" : "condenser_api.get_dynamic_global_properties";
  const j = await rpc(chain, { jsonrpc: "2.0", method, params: [], id: 1 });
  const p = j.result;
  return { tvf: parseFloat(p.total_vesting_fund_shares), tvs: parseFloat(p.total_vesting_shares) };
}

async function claimsFor(chain, account) {
  const j = await rpc(chain, {
    jsonrpc: "2.0",
    method: "condenser_api.get_account_history",
    params: [account, -1, DEPTH],
    id: 2,
  });
  const hist = j.result ?? [];
  const rows = [];
  for (const [idx, entry] of hist) {
    const op = entry?.op;
    if (!op || op[0] !== "claim_reward_balance") continue;
    const r = op[1] ?? {};
    const tr = (r.reward?.steem) ?? (r.reward?.hive) ?? "0.000";
    const tbd = (r.reward?.sbd) ?? (r.reward?.hbd) ?? "0.000";
    const vests = (r.reward?.vests) ?? (r.reward?.vesting_shares) ?? "0.000000 VESTS";
    rows.push({
      chain,
      account,
      tx: entry.trx_id,
      at: entry.timestamp,
      block: entry.block,
      steem: parseFloat(tr),
      sbd: parseFloat(tbd),
      vests: parseFloat(vests),
    });
  }
  return rows;
}

const out = { at: new Date().toISOString(), depth: DEPTH, chains: {} };
for (const chain of Object.keys(FLEET)) {
  const props = await globalProps(chain);
  const all = [];
  for (const acc of FLEET[chain]) {
    try {
      const rows = await claimsFor(chain, acc);
      all.push(...rows);
      console.error(`${chain}/${acc}: ${rows.length} claims`);
    } catch (e) {
      console.error(`${chain}/${acc}: FAIL ${e.message}`);
      out.failures = out.failures ?? [];
      out.failures.push({ chain, account: acc, error: e.message });
    }
  }
  all.sort((a, b) => (a.at < b.at ? 1 : -1));
  for (const r of all) r.spNow = +(r.vests * (props.tvf / props.tvs)).toFixed(6);
  out.chains[chain] = { ratio: +(props.tvf / props.tvs).toFixed(10), claims: all, totalClaims: all.length };
  const s = all.reduce((a, r) => ({ v: a.v + r.vests, sp: a.sp + r.spNow, st: a.st + r.steem, sbd: a.sbd + r.sbd }), { v: 0, sp: 0, st: 0, sbd: 0 });
  out.chains[chain].sum = { vests: +s.v.toFixed(6), spNowApprox: +s.sp.toFixed(3), steem: +s.st.toFixed(3), sbd: +s.sbd.toFixed(3) };
}
console.log(JSON.stringify(out, null, 2));
