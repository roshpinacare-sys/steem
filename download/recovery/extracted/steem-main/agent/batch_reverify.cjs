#!/usr/bin/env node
const fs=require('fs'),path=require('path'),https=require('https');
function rpcV4(u,b){const p=JSON.stringify(b);return new Promise((res,rej)=>{const q=https.request({hostname:new URL(u).hostname,path:'/',method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:15000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error('rpc')):res(j.result)}catch(e){rej(new Error('bad'))}})});q.on('error',rej);q.write(p);q.end()})}
async function main(){
  const res=JSON.parse(fs.readFileSync(path.join(__dirname,'rc_sovereign_result.json'),'utf8'));
  const b=res.batch;
  const dgp=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_dynamic_global_properties',params:[],id:1});
  const head=dgp.head_block_number;
  for(let i=head;i>head-120;i--){
    const blk=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_block',params:[i],id:1});
    const hit=(blk.transactions||[]).find(x=>x.transaction_id===b.txid);
    if(hit){
      b.block=i;b.opsInTx=hit.operations.length;b.verified=hit.operations.length===b.expectedOps;
      console.log('FOUND block='+i+' ops='+hit.operations.length+' verified='+b.verified);
      fs.writeFileSync(path.join(__dirname,'rc_sovereign_result.json'),JSON.stringify(res,null,2)+'\n');
      return;
    }
  }
  console.log('not found in last 120 blocks — tx may still be indexing');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)});
