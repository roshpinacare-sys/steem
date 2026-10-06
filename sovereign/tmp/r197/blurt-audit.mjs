const B = "https://api.blurt.world";
async function rpc(method, params) {
  const r = await fetch(B, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json(); if (j.error) return { err: JSON.stringify(j.error).slice(0,100) }; return j.result;
}
for (const a of ["ynet", "headcorner", "eadcorner", "cashmachine"]) {
  const acc = await rpc("condenser_api.get_accounts", [[a]]);
  if (!acc || !acc[0]) { console.log(`${a}: NOT-FOUND`); continue; }
  const x = acc[0];
  console.log(`${a}: BLURT=${x.balance} BLURT-P=${x.vesting_shares}`);
  const outs = await rpc("condenser_api.get_vesting_delegations", [a, "", 100]);
  if (Array.isArray(outs)) for (const d of outs) console.log(`   DELEG-OUT -> ${d.delegatee} ${d.vesting_shares}`);
  // last 100 ops
  const hist = await rpc("condenser_api.get_account_history", [a, -1, 100]);
  if (Array.isArray(hist)) {
    let t = 0, d = 0;
    for (const [, e] of hist) {
      const [op, o] = e.op;
      if (op === "transfer" && o.from === a) { t++; console.log(`   TX ${e.timestamp} -> ${o.to} ${o.amount}`); }
      if (op === "delegate_vesting_shares" && o.delegator === a) { d++; console.log(`   DELEG ${e.timestamp} -> ${o.delegatee} ${o.vesting_shares}`); }
    }
    console.log(`   (last-100: transfers_out=${t} delegations_out=${d})`);
  }
}
