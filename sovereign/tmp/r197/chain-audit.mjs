// r197: forensic audit — delegations + transfers to soldiers (keyless read-only)
const STEEM = "https://api.steemit.com";
const HIVE = "https://api.hive.blog";
const MAIN = process.argv[2] || "cashmachine";
const SOLDIER_RE = /(soldier|ynet|powerspan|eadcorner)/i;

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

async function scanChain(name, url, account) {
  console.log(`\n=== ${name} : ${account} ===`);
  const hist = await rpc(url, "condenser_api.get_account_history", [account, -1, 1000, ...[]].length === 4 ? [account, -1, 1000] : [account, -1, 1000]);
  const ops = (hist || []).map(([, e]) => e);
  const hits = [];
  for (const e of ops) {
    const [opType, op] = e.op;
    if (opType === "transfer" || opType === "transfer_to_vesting" || opType === "delegate_vesting_shares" || opType === "delegate_vesting_shares_return") {
      hits.push({ idx: e.block, type: opType, from: op.from, to: op.to, amount: op.amount || op.vesting_shares, memo: (op.memo || "").slice(0, 60), ts: e.timestamp });
    }
  }
  // filter: outgoing transfers/delegations involving soldiers
  for (const h of hits) {
    const toSoldier = h.to && SOLDIER_RE.test(h.to);
    const isDelegate = h.type === "delegate_vesting_shares";
    const outgoing = h.from === account;
    if (outgoing && (toSoldier || isDelegate)) console.log(JSON.stringify(h));
  }
  const outTransfers = hits.filter(h => h.from === account && h.type === "transfer");
  console.log(`SUMMARY ${name}: ops_scanned=${ops.length} transfers_out=${outTransfers.length}`);
  for (const t of outTransfers.slice(-15)) console.log(`  TX ${t.ts} -> ${t.to} ${t.amount} memo="${t.memo}"`);
  const delegs = hits.filter(h => h.type === "delegate_vesting_shares" && h.from === account);
  console.log(`  delegations_out=${delegs.length}`);
  // latest delegation state per target
  const lastDeleg = {};
  for (const d of delegs) lastDeleg[d.to] = d.amount;
  for (const [to, amt] of Object.entries(lastDeleg)) console.log(`  LAST-DELEG -> ${to}: ${amt} (ts ${delegs.filter(x=>x.to===to).slice(-1)[0]?.ts})`);
}

try { await scanChain("STEEM", STEEM, MAIN); } catch (e) { console.log("STEEM ERROR:", e.message); }
try { await scanChain("HIVE", HIVE, MAIN); } catch (e) { console.log("HIVE ERROR:", e.message); }
