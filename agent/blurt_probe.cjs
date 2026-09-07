#!/usr/bin/env node
/** blurt_probe.cjs — third-chain same-key probe: headcorner on Blurt (balance/keys/RC) */
const https=require('https');
function rpc(host,path,body){return new Promise((res,rej)=>{const p=JSON.stringify(body);const r=https.request({hostname:host,path:path,method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:15000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error(JSON.stringify(j.error).slice(0,160))):res(j.result)}catch(e){rej(new Error('bad:'+d.slice(0,60)))}})});r.on('error',rej);r.on('timeout',()=>r.destroy(new Error('to')));r.write(p);r.end()})}
const NODES=[['blurt-rpc.saboin.com','/'],['rpc.blurt.world','/'],['blurt.latency-noia.com','/'],['rpc.blurtblock.com','/']];
async function main(){
  for(const [h,p] of NODES){
    try{
      const a=await rpc(h,p,{jsonrpc:'2.0',method:'condenser_api.get_accounts',params:[['headcorner']],id:1});
      const acc=(a||[])[0];
      if(!acc){console.log(h+': node OK, headcorner NOT registered');continue}
      console.log(h+': EXISTS · blurt='+acc.balance+' · hp='+acc.vesting_shares+' · delegIn='+acc.delegated_vesting_shares+' · sbd='+acc.sbd_balance);
      const rc=await rpc(h,p,{jsonrpc:'2.0',method:'rc_api.find_rc_accounts',params:{accounts:['headcorner']},id:1}).catch(e=>null);
      if(rc&&rc.rc_accounts&&rc.rc_accounts[0]){const r=rc.rc_accounts[0];console.log('  RC max='+r.max_rc+' mana='+r.rc_manabar.current_mana)}
      const dyn=await rpc(h,p,{jsonrpc:'2.0',method:'condenser_api.get_dynamic_global_properties',params:[],id:1}).catch(()=>null);
      if(dyn)console.log('  head_block='+dyn.head_block_number+' · '+dyn.time);
      return;
    }catch(e){console.log(h+': FAIL '+e.message.slice(0,80))}
  }
  console.log('ALL BLURT NODES UNREACHABLE');
}
main();
