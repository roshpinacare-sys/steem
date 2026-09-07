#!/usr/bin/env node
const https=require('https');
function rpc(u,b){const p=JSON.stringify(b);return new Promise((res,rej)=>{const uu=new URL(u);const q=https.request({hostname:uu.hostname,path:uu.pathname+(uu.search||''),method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:15000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error(JSON.stringify(j.error).slice(0,200))):res(j.result)}catch(e){rej(new Error('bad:'+d.slice(0,80)))}})});q.on('error',rej);q.write(p);q.end()})}
async function main(){
  const rc=await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'rc_api.find_rc_accounts',params:{accounts:['headcorner']},id:1});
  const r=rc.rc_accounts[0];
  const max=Number(r.max_rc),stored=Number(r.rc_manabar.current_mana),lu=Number(r.rc_manabar.last_update_time);
  const now=Math.floor(Date.now()/1000);
  const cur=Math.min(max,stored+Math.floor(((now-lu)*max)/(5*86400)));
  console.log('Hive RC: cur='+(cur/1e6).toFixed(1)+'M / max='+(max/1e6).toFixed(1)+'M ('+((cur/max)*100).toFixed(2)+'%)');
  const his=await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'condenser_api.get_account_history',params:['headcorner',-1,5],id:1});
  for(const [idx,op] of his){const o=op.op[0];console.log('hist',idx,op.op[1].timestamp||'',o,JSON.stringify(op.op[1]).slice(0,120))}
  const he=await rpc('https://api.hive-engine.com/rpc/contracts',{jsonrpc:'2.0',method:'find',params:{contract:'tokens',table:'balances',query:{account:'headcorner',symbol:'SWAP.HIVE'},limit:1},id:1});
  console.log('SWAP.HIVE now:',he&&he[0]?he[0].balance:'0');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)});
