const S = "https://api.steemit.com"; const H = "https://api.hive.blog";
async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json(); if (j.error) return { err: JSON.stringify(j.error).slice(0,120) }; return j.result;
}
for (const [name, url, accs] of [["STEEM", S, ["eadcorner","cashmachine","hcsoldier4","hcsoldier5","hcsoldier6","ynet","powerspan"]], ["HIVE", H, ["cashmachine","eadcorner","hcsoldier4","hcsoldier5","hcsoldier6","ynet"]]]) {
  console.log(`\n### ${name}`);
  for (const a of accs) {
    const out = await rpc(url, "condenser_api.get_vesting_delegations", [a, "", 100]);
    const acc = await rpc(url, "condenser_api.get_accounts", [[a]]);
    if (!acc || !acc[0]) { console.log(`${a}: ACCOUNT-NOT-FOUND`); continue; }
    const x = acc[0];
    console.log(`${a}: sp delegs-out=${Array.isArray(out) ? out.length : JSON.stringify(out).slice(0,60)} vesting=${x.vesting_shares} bal=${x.balance} sbd=${x.sbd_balance||x.hbd_balance}`);
    if (Array.isArray(out)) for (const d of out) console.log(`   -> ${d.delegatee} ${d.vesting_shares}`);
  }
}
