#!/usr/bin/env node
const https=require('https');
function rpc(u,b){const uu=new URL(u);const p=JSON.stringify(b);return new Promise((res,rej)=>{const q=https.request({hostname:uu.hostname,path:uu.pathname+(uu.search||''),method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:15000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error(JSON.stringify(j.error).slice(0,200))):res(j.result)}catch(e){rej(new Error('bad'))}})});q.on('error',rej);q.write(p);q.end()})}
async function main(){
  const dgp=await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'condenser_api.get_dynamic_global_properties',params:[],id:1});
  const head=dgp.head_block_number;
  let txid=null,blk=null;
  for(let i=head;i>head-100&&!txid;i--){
    try{
      const b=await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'condenser_api.get_block',params:[i],id:1});
      for(const t of b.transactions||[]){
        for(const op of t.operations||[]){
          const nm=Array.isArray(op)?op[0]:op.type;const body=Array.isArray(op)?op[1]:op.value;
          if(nm==='custom_json'&&body&&body.id==='ssc-mainnet-hive'&&String(body.json).includes('hivepegged')&&String(body.json).includes('withdraw')){
            if((body.required_auths||[]).map(String).includes('headcorner')){txid=t.transaction_id;blk=i}
          }
        }
      }
    }catch(e){}
  }
  if(!txid){console.log('not found in 100 blocks');return}
  console.log('txid='+txid+' block='+blk);
  try{
    const vops=await rpc('https://api.hive.blog',{jsonrpc:'2.0',method:'account_history_api.get_virtual_ops_in_block',params:{block_num:blk,include_reversible:false},id:1});
    for(const op of (vops.ops||[])){
      const s=JSON.stringify(op);
      if(s.includes('ssc-mainnet-hive')||s.includes('logs'))console.log('VOP:',s.slice(0,500));
    }
  }catch(e){console.log('vop probe failed: '+e.message.slice(0,120))}
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)});
