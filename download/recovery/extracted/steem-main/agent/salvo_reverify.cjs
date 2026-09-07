#!/usr/bin/env node
/** salvo_reverify.cjs — poll get_transaction for salvo txids, fallback account_history */
const fs=require('fs'),path=require('path'),https=require('https');
function rpcV4(urlStr, body) {
  const u = new URL(urlStr); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => { try { const j = JSON.parse(data); j.error ? reject(new Error(typeof j.error==='string'?j.error:(j.error.message||'rpc'))) : resolve(j.result); } catch (_) { reject(new Error('bad rpc')); } });
    }); req.on('timeout', () => req.destroy(new Error('to'))); req.on('error', reject); req.write(payload); req.end();
  });
}
async function main(){
  const res=JSON.parse(fs.readFileSync(path.join(__dirname,'rc_sovereign_result.json'),'utf8'));
  const txs=(res.salvo&&res.salvo.txs)||[];
  const byBlock={};let maxSame=0,maxBlock=null;
  for(const t of txs.filter(x=>x.txid)){
    let block=null,opsInTx=null;
    for(let i=0;i<6&&!block;i++){
      try{const tx=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_transaction',params:[t.txid],id:1});block=tx.block_num;opsInTx=tx.operations.length;}
      catch(e){await new Promise(r=>setTimeout(r,10000))}
    }
    if(!block){
      // fallback: scan account history for the op with matching tx id is not possible (history has no txid); try block scan via head window
      try{const dgp=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_dynamic_global_properties',params:[],id:1});
        for(let b=(dgp.head_block_number-2);b>=(dgp.head_block_number-90)&&!block;b--){
          const blk=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_block',params:[b],id:1});
          const hit=(blk.transactions||[]).find(x=>x.transaction_id===t.txid);
          if(hit){block=b;opsInTx=hit.operations.length;break}
        }
      }catch(e){}
    }
    t.block=block;t.opsInTx=opsInTx;t.verified=!!block;
    console.log(t.soldier, t.txid.slice(0,16)+'…', 'block='+block, 'ops='+opsInTx);
    if(block){byBlock[block]=(byBlock[block]||0)+(opsInTx||0)}
  }
  for(const [b,n] of Object.entries(byBlock)) if(n>maxSame){maxSame=n;maxBlock=Number(b)}
  let evidence=null;
  if(maxBlock){
    try{
      const blk=await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.get_block',params:[maxBlock],id:1});
      const vault=JSON.parse(fs.readFileSync(path.join(__dirname,'keys','vault.json'),'utf8'));
      const names=new Set((vault.accounts||[]).map(a=>String(a.username).toLowerCase()));
      let ourOps=0,total=0;
      for(const x of blk.transactions||[])for(const op of x.operations||[]){
        const nm=Array.isArray(op)?op[0]:op.type;const body=Array.isArray(op)?op[1]:op.value;total++;
        if(nm==='custom_json'&&body&&body.id==='saos'){const a=(body.required_posting_auths||[]).concat(body.required_auths||[]).map(s=>String(s).toLowerCase());if(a.some(s=>names.has(s)))ourOps++}
      }
      evidence={block:maxBlock,ourSaosOpsInBlock:ourOps,totalTxOpsInBlock:total};
    }catch(e){evidence={error:String(e.message).slice(0,120)}}
  }
  res.salvo.byBlock=byBlock;res.salvo.maxSameBlock=maxSame;res.salvo.maxBlock=maxBlock;res.salvo.blockEvidence=evidence;
  res.salvo.crossed=!!(evidence&&evidence.ourSaosOpsInBlock>5);
  fs.writeFileSync(path.join(__dirname,'rc_sovereign_result.json'),JSON.stringify(res,null,2)+'\n');
  console.log('byBlock='+JSON.stringify(byBlock),'maxSame='+maxSame,'evidence='+JSON.stringify(evidence));
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)});
