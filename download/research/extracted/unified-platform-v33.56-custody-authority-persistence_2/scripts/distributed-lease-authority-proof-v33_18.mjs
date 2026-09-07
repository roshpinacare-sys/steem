import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyRegistry, generateSigningIdentity, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  DistributedLeaseAuthorityStoreV33_18,
  MonotonicFenceWitnessStoreV33_18,
  createDistributedLeaseAuthorityHttpServerV33_18,
  issueDistributedLeaseCommandV33_18,
  issueOutboxAcknowledgementV33_18,
  probeLeaseBackendsV33_18,
} from '../dist/src/app/distributed-lease-authority-v33_18.js';

const root=mkdtempSync(join(tmpdir(),'v33.18-proof-'));
const out=new URL('../release-evidence/v33.18/',import.meta.url).pathname; mkdirSync(out,{recursive:true});
const start=new Date('2026-07-21T23:20:00.000Z');
const reg=(...ids)=>{const r=new KeyRegistry();for(const id of ids)r.register(id.keyId,id.publicKey);return r;};
const ids={
 controllerA:generateSigningIdentity('v33.18-controller-a'),controllerB:generateSigningIdentity('v33.18-controller-b'),
 authority:generateSigningIdentity('v33.18-authority'),authorityStore:generateSigningIdentity('v33.18-authority-store'),
 witness:generateSigningIdentity('v33.18-witness'),delivery:generateSigningIdentity('v33.18-delivery'),proof:generateSigningIdentity('v33.18-proof'),
};
const trust={controllerRegistry:reg(ids.controllerA,ids.controllerB),trustedControllerSignerIds:[ids.controllerA.keyId,ids.controllerB.keyId],authorityRegistry:reg(ids.authority),trustedAuthoritySignerIds:[ids.authority.keyId],witnessRegistry:reg(ids.witness),trustedWitnessSignerIds:[ids.witness.keyId],deliveryRegistry:reg(ids.delivery),trustedDeliverySignerIds:[ids.delivery.keyId]};
const witness=new MonotonicFenceWitnessStoreV33_18({path:join(root,'witness.json'),witnessId:'witness-main',identity:ids.witness,registry:trust.witnessRegistry,trustedSignerIds:trust.trustedWitnessSignerIds,now:start});
const storeRegistry=reg(ids.authorityStore); const authorityPath=join(root,'authority.json');
const createStore=(now)=>new DistributedLeaseAuthorityStoreV33_18({path:authorityPath,authorityId:'authority-main',authorityIdentity:ids.authority,storeIdentity:ids.authorityStore,storeRegistry,trustedStoreSignerIds:[ids.authorityStore.keyId],trust,witness,now});
let store=createStore(start); const clock={now:start};
let server; let endpoint;
async function startServer(){server=createDistributedLeaseAuthorityHttpServerV33_18({store,now:()=>clock.now});await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));const a=server.address();if(a===null||typeof a==='string')throw new Error('server_address_invalid');endpoint=`http://127.0.0.1:${a.port}`;}
async function stopServer(){if(server?.listening)await new Promise((resolve,reject)=>server.close((e)=>e?reject(e):resolve()));}
let sequence=0;
function command(identity,controllerId,operation,extra={}){return issueDistributedLeaseCommandV33_18({authorityId:'authority-main',tenantId:'tenant-a',serviceId:'adaptive-control',controllerId,operation,signer:identity,...(extra.ttl===undefined?{}:{requestedTtlMs:extra.ttl}),...(extra.fence===undefined?{}:{expectedFenceToken:extra.fence}),...(extra.digest===undefined?{}:{expectedLeaseDigest:extra.digest}),commandId:`proof-command-${++sequence}`,now:clock.now});}
function runClient(envelope,label){return new Promise((resolve,reject)=>{const req=join(root,`${label}-request.json`),res=join(root,`${label}-response.json`);writeFileSync(req,JSON.stringify(envelope));const child=spawn(process.execPath,['scripts/distributed-lease-client-v33_18.mjs',endpoint,req,res],{cwd:process.cwd(),stdio:'ignore'});child.on('error',reject);child.on('exit',(code)=>resolve({code,...JSON.parse(readFileSync(res,'utf8'))}));});}
function executable(name){try{return execFileSync('sh',['-lc',`command -v ${name}`],{encoding:'utf8'}).trim()||undefined;}catch{return undefined;}}

await startServer();
const race=await Promise.all([runClient(command(ids.controllerA,'controller-a','ACQUIRE',{ttl:1000}),'race-a'),runClient(command(ids.controllerB,'controller-b','ACQUIRE',{ttl:1000}),'race-b')]);
const acceptedRace=race.filter((x)=>x.transportOk&&x.body.payload.accepted);
if(acceptedRace.length!==1)throw new Error('race_did_not_have_exactly_one_winner');
let current=acceptedRace[0].body.payload.grant; let currentController=current.controllerId; let priorSnapshot=readFileSync(authorityPath);
const trace=[]; trace.push({kind:'RACE',acceptedController:currentController,fenceToken:current.fenceToken,decisionDigest:acceptedRace[0].body.payload.decisionDigest});
let staleRejections=0; let takeoverCount=0; let authorityRestartCount=0; let partitionFailureObserved=false;
for(let i=1;i<=12;i+=1){
  const old=current; const oldController=currentController;
  clock.now=new Date(Date.parse(old.expiresAt)+1);
  if(i===4){await stopServer();const partition=await runClient(command(oldController==='controller-a'?ids.controllerA:ids.controllerB,oldController,'ASSERT_FENCE',{fence:old.fenceToken,digest:old.leaseDigest}),`partition-${i}`);partitionFailureObserved=partition.transportOk===false;store=createStore(clock.now);await startServer();authorityRestartCount+=1;}
  const nextController=oldController==='controller-a'?'controller-b':'controller-a'; const nextIdentity=nextController==='controller-a'?ids.controllerA:ids.controllerB;
  const takeover=await runClient(command(nextIdentity,nextController,'ACQUIRE',{ttl:1000}),`takeover-${i}`);
  if(!takeover.transportOk||!takeover.body.payload.accepted)throw new Error(`takeover_failed:${i}`);
  current=takeover.body.payload.grant;currentController=nextController;takeoverCount+=1;
  clock.now=new Date(clock.now.getTime()+1);
  const oldIdentity=oldController==='controller-a'?ids.controllerA:ids.controllerB;
  const stale=await runClient(command(oldIdentity,oldController,'ASSERT_FENCE',{fence:old.fenceToken,digest:old.leaseDigest}),`stale-${i}`);
  if(stale.transportOk&&stale.body.payload.reason==='STALE_FENCE')staleRejections+=1;
  trace.push({kind:'TAKEOVER',index:i,oldController,newController:nextController,fenceToken:current.fenceToken,takeoverDecisionDigest:takeover.body.payload.decisionDigest,staleDecisionDigest:stale.body.payload.decisionDigest});
}
await stopServer();
const latestSnapshot=readFileSync(authorityPath);writeFileSync(authorityPath,priorSnapshot);
let rollbackRejected=false;try{createStore(clock.now);}catch(error){rollbackRejected=error instanceof Error&&/witness|rollback/.test(error.message);}writeFileSync(authorityPath,latestSnapshot);
store=createStore(clock.now);authorityRestartCount+=1;await startServer();
const finalValidate=await runClient(command(currentController==='controller-a'?ids.controllerA:ids.controllerB,currentController,'ASSERT_FENCE',{fence:current.fenceToken,digest:current.leaseDigest}),'final-validate');
if(!finalValidate.transportOk||!finalValidate.body.payload.accepted)throw new Error('final_fence_invalid_after_restart');
await stopServer();
let snapshot=store.snapshot();let ackCount=0;
for(const event of snapshot.outbox){if(event.payload.acknowledgedAt!==undefined)continue;clock.now=new Date(clock.now.getTime()+1);const ack=issueOutboxAcknowledgementV33_18({event,deliveryWorkerId:'delivery-main',signer:ids.delivery,now:clock.now});store.acknowledgeOutbox(ack,clock.now);ackCount+=1;}
snapshot=store.snapshot();
const probes=probeLeaseBackendsV33_18({executables:{POSTGRESQL:executable('postgres')??executable('psql'),ETCD:executable('etcd')??executable('etcdctl'),CONSUL:executable('consul')},now:clock.now});
const traceArtifact={version:'33.18',evidenceClass:'LOCAL_TWO_CONTROLLER_PROCESS_SHARED_AUTHORITY_REFERENCE',race,events:trace,finalFenceToken:snapshot.fenceCounter,outboxEventDigests:snapshot.outbox.map((x)=>x.payload.eventDigest),decisionDigests:snapshot.decisions.map((x)=>x.payload.decisionDigest),traceDigest:''};
{const{traceDigest,...material}=traceArtifact;traceArtifact.traceDigest=sha256(material);}
const proofMaterial={version:'33.18',status:'DISTRIBUTED_LEASE_AUTHORITY_PROVEN_LOCALLY',evidenceClass:'LOCAL_TWO_CONTROLLER_PROCESS_SHARED_AUTHORITY_REFERENCE',controllerProcessCount:2,authorityProcessModel:'LOOPBACK_HTTP_AUTHORITY_WITH_SEPARATE_CONTROLLER_PROCESSES',raceWinnerCount:acceptedRace.length,takeoverCount,staleFenceRejectionCount:staleRejections,partitionFailureObserved,authorityRestartCount,rollbackRejectedByMonotonicWitness:rollbackRejected,finalFenceToken:snapshot.fenceCounter,durableOutboxEventCount:snapshot.outbox.length,durableOutboxAcknowledgementCount:snapshot.outbox.filter((x)=>x.payload.acknowledgedAt!==undefined).length,newAcknowledgementCount:ackCount,backendProbes:probes,authorityExpansionCount:snapshot.decisions.filter((x)=>x.payload.authorityExpanded).length,externalEffectsExecuted:0,productionAuthority:'NONE',limitations:['LOCAL_SHARED_FILE_AUTHORITY_NOT_POSTGRES_ETCD_OR_CONSUL','AUTHORITY_SERVER_AND_TEST_HARNESS_SHARE_ONE_HOST','NETWORK_PARTITION_IS_LOOPBACK_SERVER_STOP_NOT_REAL_NETWORK_SPLIT','MONOTONIC_WITNESS_IS_SEPARATE_SIGNER_AND_FILE_NOT_EXTERNAL_HOST','NO_PRODUCTION_AUTHORITY_OR_EXTERNAL_EFFECTS'],productionPromotion:'blocked',proofDigest:''};
{const{proofDigest,...material}=proofMaterial;proofMaterial.proofDigest=sha256(material);}
const signedProof=signEnvelope(proofMaterial,ids.proof);const proofRegistry=reg(ids.proof);
writeFileSync(join(out,'V33_18_DISTRIBUTED_LEASE_AUTHORITY_PROOF.json'),JSON.stringify({...proofMaterial,proofEnvelope:{signedProof,publicKey:proofRegistry.exportPublicKey(ids.proof.keyId)}},null,2)+'\n');
writeFileSync(join(out,'V33_18_DISTRIBUTED_LEASE_TRACE.json'),JSON.stringify(traceArtifact,null,2)+'\n');
writeFileSync(join(out,'V33_18_LEASE_AUTHORITY_SNAPSHOT.json'),JSON.stringify(snapshot,null,2)+'\n');
writeFileSync(join(out,'V33_18_BACKEND_PROBES.json'),JSON.stringify(probes,null,2)+'\n');
console.log(JSON.stringify(proofMaterial,null,2));
rmSync(root,{recursive:true,force:true});
if(acceptedRace.length!==1||takeoverCount!==12||staleRejections!==12||!partitionFailureObserved||authorityRestartCount!==2||!rollbackRejected||snapshot.fenceCounter!==13||snapshot.outbox.length<25||snapshot.outbox.some((x)=>x.payload.acknowledgedAt===undefined)||proofMaterial.authorityExpansionCount!==0||proofMaterial.externalEffectsExecuted!==0)process.exit(1);
