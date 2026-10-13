// R316 · שחזור-שיוך התביעות — זרימה ל-JSONL, כל-חשבון נשמר מיד, נתוני-ציבור בלבד
import * as fs from "node:fs";
const UA = { "content-type": "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" };
const RPCS = {
  steem: ["https://steemapi.boylikegirl.club", "https://api.deathwing.me", "https://api.justyy.com", "https://api.steemit.com"],
  hive: ["https://api.hive.blog", "https://api.openhive.network"],
  blurt: ["https://blurt-rpc.saboin.com", "https://rpc.blurt.blog"],
};
const FLEET = {
  steem: ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"],
  hive: ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"],
  blurt: ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"],
};
const OUT = process.argv[2] ?? "/tmp/claims-r316.jsonl";
const MAXPAGES = Number(process.argv[3] ?? 400);
const stream = fs.createWriteStream(OUT, { flags: "w" });
const emit = (o) => stream.write(JSON.stringify(o) + "\n");

async function rpc(chain, body) {
  let lastErr;
  for (const url of RPCS[chain]) {
    try {
      const r = await fetch(url, { method: "POST", headers: UA, body: JSON.stringify(body), signal: AbortSignal.timeout(22000) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message ?? "rpc-err").slice(0, 70));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("rpc-unreachable");
}
async function vestRatio(chain) {
  for (let i = 0; i < 3; i++) {
    try {
      const p = await rpc(chain, { jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 });
      const tvf = parseFloat(p.total_vesting_fund_steem ?? p.total_vesting_fund_hive ?? p.total_vesting_fund_blurt ?? p.total_vesting_fund_shares);
      const tvs = parseFloat(p.total_vesting_shares);
      if (Number.isFinite(tvf) && Number.isFinite(tvs) && tvs > 0) return tvf / tvs;
      throw new Error("props-shape");
    } catch (e) { console.error(`ratio try${i} ${chain}: ${e.message}`); }
  }
  return null;
}
async function* historyPages(chain, account) {
  let start = -1, pages = 0;
  while (pages < MAXPAGES) {
    let preferred = start === -1 ? 10000 : 10000;
    let lim = start >= 0 ? Math.min(preferred, start) : preferred;
    if (start >= 0 && lim <= 0) return;
    let page = null;
    while (lim >= 100) {
      try { page = await rpc(chain, { jsonrpc: "2.0", method: "condenser_api.get_account_history", params: [account, start, lim], id: 2 }); break; }
      catch (e) { lim = Math.floor(lim / 2); if (start >= 0) lim = Math.min(lim, start); if (lim < 100) return; }
    }
    if (!page || !page.length) return;
    pages++;
    yield page;
    const firstIdx = page[0][0];
    if (firstIdx === 0) return;
    start = firstIdx - 1;
  }
}

const chains = process.argv[4] ? process.argv[4].split(",") : Object.keys(FLEET);
const onlyAcc = process.argv[5] ? process.argv[5].split(",") : null;
for (const chain of chains) {
  const ratio = await vestRatio(chain);
  emit({ kind: "meta", chain, vestRatio: ratio, at: new Date().toISOString() });
  console.error(`${chain} ratio=${ratio}`);
  const roster = onlyAcc ? FLEET[chain].filter((a) => onlyAcc.includes(a)) : FLEET[chain];
  for (const acc of roster) {
    let ops = 0, found = 0;
    try {
      for await (const page of historyPages(chain, acc)) {
        ops += page.length;
        for (const [, e] of page) {
          // פורמט-קונדנסר: op=["claim_reward_balance",{account,reward_steem,reward_sbd,reward_vests}]
          // פורמט-appbase: op={type:"claim_reward_balance_operation",value:{...}}
          let opName = null, val = null;
          if (Array.isArray(e?.op)) { opName = e.op[0]; val = e.op[1] ?? {}; }
          else if (e?.op?.type) { opName = String(e.op.type).replace(/_operation$/, ""); val = e.op.value ?? {}; }
          if (opName !== "claim_reward_balance") continue;
          const vests = parseFloat(String(val.reward_vests ?? val.vesting_shares ?? "0").split(" ")[0]);
          const liq = parseFloat(String(val.reward_steem ?? val.reward_hive ?? val.reward_blurt ?? "0").split(" ")[0]);
          const debt = parseFloat(String(val.reward_sbd ?? val.reward_hbd ?? "0").split(" ")[0]);
          emit({ kind: "claim", chain, account: acc, tx: e.trx_id, at: e.timestamp, block: e.block, vests: +vests.toFixed(6), liq: +liq.toFixed(3), debt: +debt.toFixed(3) });
          found++;
        }
      }
      emit({ kind: "done", chain, account: acc, opsScanned: ops, claims: found, at: new Date().toISOString() });
      console.error(`${chain}/${acc}: ${ops} ops, ${found} claims`);
    } catch (err) {
      emit({ kind: "fail", chain, account: acc, error: err.message, at: new Date().toISOString() });
      console.error(`${chain}/${acc}: FAIL ${err.message}`);
    }
  }
}
stream.end();
console.error("STREAM-COMPLETE");
