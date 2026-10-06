const STEEM = "https://api.steemit.com";
const SOLDIER_RE = /(soldier|ynet|powerspan)/i;
async function rpc(method, params) {
  const r = await fetch(STEEM, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150));
  return j.result;
}
async function walk(account) {
  console.log(`\n=== STEEM ${account} ===`);
  let from = -1; let total = 0; const outT = []; const outD = [];
  for (let pass = 0; pass < 30; pass++) {
    const lim = pass === 0 ? 100 : Math.min(1000, from - 1);
    if (lim <= 0) break;
    let batch;
    try { batch = await rpc("condenser_api.get_account_history", [account, from, lim]); } catch (e) { console.log("stop:", e.message.slice(0,80)); break; }
    if (!batch || batch.length === 0) break;
    for (const [, e] of batch) {
      total++;
      const [t, o] = e.op;
      if (t === "transfer" && o.from === account) outT.push({ ts: e.timestamp, to: o.to, amount: o.amount, memo: (o.memo||"").slice(0,50) });
      if (t === "transfer_to_vesting" && o.from === account) outT.push({ ts: e.timestamp, to: o.to || "(power-up)", amount: o.amount });
      if (t === "delegate_vesting_shares" && o.delegator === account) outD.push({ ts: e.timestamp, to: o.delegatee, amount: o.vesting_shares });
    }
    const nextFrom = batch[0][0] - 1;
    if (nextFrom < 1) break;
    from = nextFrom;
  }
  console.log(`ops_scanned=${total} transfers_out=${outT.length} delegations_out=${outD.length}`);
  const soldierT = outT.filter(t => SOLDIER_RE.test(t.to));
  const soldierD = outD.filter(d => SOLDIER_RE.test(d.to));
  console.log(`-- soldier-transfers=${soldierT.length}`);
  for (const t of soldierT.slice(-20)) console.log(`   ${t.ts} -> ${t.to} ${t.amount} "${t.memo}"`);
  console.log(`-- soldier-delegations=${soldierD.length}`);
  for (const d of soldierD.slice(-20)) console.log(`   ${d.ts} -> ${d.to} ${d.amount}`);
  const lastD = {};
  for (const d of outD) lastD[d.to] = d;
  console.log(`-- last-delegation-state per target:`);
  for (const [to, d] of Object.entries(lastD)) console.log(`   ${to}: ${d.amount} @ ${d.ts}`);
  console.log(`-- last-10-transfers:`);
  for (const t of outT.slice(-10)) console.log(`   ${t.ts} -> ${t.to} ${t.amount} "${t.memo||""}"`);
}
for (const a of ["eadcorner", "cashmachine"]) { try { await walk(a); } catch (e) { console.log(a, "ERR", e.message); } }
