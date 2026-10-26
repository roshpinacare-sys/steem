import { readFileSync } from "fs";
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json","utf8"));
async function call(m,p){const r=await fetch("https://blurt-rpc.saboin.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:m,params:p,id:1}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result;}
const accounts = GEN2.accounts.map(a => a.username).filter(u => u !== "headcorner");
const accs = await call("condenser_api.get_accounts", [accounts]);
const rows = [];
let full = 0;
for (const a of accs) {
  const k2 = GEN2.accounts.find(x => x.username === a.name).keys;
  const m = {
    active: a.active.key_auths[0][0] === "BLT" + k2.active.pub.slice(3),
    posting: a.posting.key_auths[0][0] === "BLT" + k2.posting.pub.slice(3),
    memo: a.memo_key === "BLT" + k2.memo.pub.slice(3),
  };
  if (m.active && m.posting && m.memo) full++;
  rows.push({ account: a.name, ...m });
}
console.log(JSON.stringify({ at: new Date().toISOString(), chain: "blurt", judge: "on-chain", fullGEN2: full, total: rows.length, rows }, null, 1));
