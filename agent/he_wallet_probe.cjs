#!/usr/bin/env node
const https=require('https');
function rpc(url,body){return new Promise((res,rej)=>{const p=JSON.stringify(body);const u=new URL(url);const r=https.request({hostname:u.hostname,path:u.pathname+(u.search||''),method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:20000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error(JSON.stringify(j.error).slice(0,300))):res(j.result)}catch(e){rej(new Error('bad rpc: '+d.slice(0,100)))}})});r.on('error',rej);r.on('timeout',()=>r.destroy(new Error('to')));r.write(p);r.end()})}
async function main(){
  const a=(await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'condenser_api.get_accounts',params:[['headcorner']],id:1}))[0];
  console.log('HP:',a.vesting_shares,'· HIVE:',a.balance,'· HBD:',a.hbd_balance);
  const he=await rpc('https://api.hive-engine.com/rpc/contracts',{jsonrpc:'2.0',method:'find',params:{contract:'tokens',table:'balances',query:{account:'headcorner'},limit:100},id:1});
  for(const b of he||[])if(parseFloat(b.balance)>0||parseFloat(b.stake)>0)console.log('HE',b.symbol,'bal',b.balance,'stake',b.stake);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)});
