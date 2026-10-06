const RPC = ["https://api.steemit.com", "https://api.justyy.com"];
async function call(method, params) {
  for (const url of RPC) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      const j = await res.json();
      if (j?.result !== undefined && Array.isArray(j.result)) return { url, result: j.result };
    } catch (e) { /* צומת הבא */ }
  }
  return null;
}
const acct = "cashmachine";
// חלון אחרון רחב: 250 אחרונות
const hist = await call("condenser_api.get_account_history", [acct, -1, 250]);
if (!hist) { console.log("אף צומת לא ענתה"); process.exit(1); }
console.log("צומת:", hist.url, "| פעולות בחלון:", hist.result.length);
for (const row of hist.result) {
  const ev = row?.[1];
  const o = ev?.op;
  if (!o) continue;
  const type = o[0];
  const d = o[1];
  const ts = (ev.timestamp || "").slice(5, 19);
  if (type === "limit_order_create") {
    console.log(ts, "CREATE", d.orderid, "sell", d.amount_to_sell, "recv", d.min_to_receive, "fok", d.fill_or_kill, "exp", (d.expiration||"").slice(11,16));
  } else if (type === "limit_order_cancel") {
    console.log(ts, "CANCEL", d.orderid, "by", d.owner);
  } else if (type === "fill_order") {
    console.log(ts, "FILL", JSON.stringify(d).slice(0, 120));
  } else if (type === "transfer") {
    console.log(ts, "TRANSFER", d.amount, "→", d.to, "memo:", String(d.memo).slice(0, 30));
  }
}
