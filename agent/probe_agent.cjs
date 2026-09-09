#!/usr/bin/env node
/** probe_agent.cjs — prove a minted agent ACTS: votes a hot post with its own key. */
const fs = require('fs'); const path = require('path'); const https = require('https'); const steem = require('steem');
const RPCS = ['https://api.steemit.com','https://api.steem.fans','https://api.justyy.com','https://steem.61bts.com'];
const argOf=(n,d)=>{const i=process.argv.indexOf(n);return i>-1&&process.argv[i+1]?process.argv[i+1]:d;};
const NAME = argOf('--name','hcnova1');
const keyPath = path.join(__dirname,'keys',NAME+'.json');
if(!fs.existsSync(keyPath)) { console.error('no keys for '+NAME); process.exit(1); }
const keys = JSON.parse(fs.readFileSync(keyPath,'utf8'));
const POSTING_WIF = keys.keys.posting.wif;
const log=m=>console.log('['+new Date().toISOString()+'] probe:'+m);
function rpcV4(url,body){const u=new URL(url);const p=JSON.stringify(body);return new Promise((res,rej)=>{const q=https.request({hostname:u.hostname,path:u.pathname||'/',method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)},timeout:20000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);j.error?rej(new Error(j.error.message)):res(j.result)}catch(_){rej(new Error('bad rpc'))}})});q.on('timeout',()=>q.destroy(new Error('timeout')));q.on('error',rej);q.write(p);q.end()});}
async function raceRpc(body){const rs=await Promise.allSettled(RPCS.map(u=>rpcV4(u,body).catch(()=>null)));for(const r of rs)if(r.status==='fulfilled'&&r.value)return r.value;throw new Error('all rpcs failed');}
(async()=>{
  const hot = await raceRpc({jsonrpc:'2.0',method:'condenser_api.get_discussions_by_hot',params:[{tag:'life',limit:20}],id:1});
  const target = (hot||[]).find(p=>p.author!==NAME);
  if(!target) return log('no target found');
  log('voting @'+target.author+'/'+target.permlink.slice(0,30)+'… weight 100% (50 SP effective)');
  const dgp = await raceRpc({jsonrpc:'2.0',method:'condenser_api.get_dynamic_global_properties',params:[],id:2});
  const tx={ref_block_num:dgp.head_block_number&0xffff,ref_block_prefix:Buffer.from(dgp.head_block_id,'hex').readUInt32LE(4),expiration:new Date(new Date(dgp.time+'Z').getTime()+60000).toISOString().slice(0,19),operations:[['vote',{voter:NAME,author:target.author,permlink:target.permlink,weight:10000}]],extensions:[]};
  const signed=steem.auth.signTransaction(tx,[POSTING_WIF]);
  await rpcV4('https://api.steemit.com',{jsonrpc:'2.0',method:'condenser_api.broadcast_transaction',params:[signed],id:3});
  log('VOTED ✓ — agent acts independently (own key, own RC)');
  await new Promise(r=>setTimeout(r,4000));
  const [a]=await raceRpc({jsonrpc:'2.0',method:'condenser_api.get_accounts',params:[[NAME]],id:4});
  log('VERIFY: last_vote='+ (a?a.last_vote_time:'?') +' · voting_manabar full='+a&&(a.voting_manabar?JSON.stringify(a.voting_manabar.current_mana):'?'));
})().catch(e=>{log('fatal: '+String(e.message||e).slice(0,200));process.exit(1);});
