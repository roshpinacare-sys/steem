import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  EnterpriseIdentityRegistryV33_20,
  SqliteDurableLeaseAuthorityV33_20,
  SqliteMonotonicWitnessV33_20,
  probeExternalAuthorityInfrastructureV33_20,
  renderSupervisordConfigurationV33_20,
  sendEnterpriseDurableLeaseCommandV33_20,
} from '../dist/src/app/external-durable-authority-v33_20.js';
import { issueDistributedLeaseCommandV33_18 } from '../dist/src/app/distributed-lease-authority-v33_18.js';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';

const out=resolve('release-evidence/v33.20');mkdirSync(out,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'v33.20-proof-'));
let now=new Date();
const ids={
 controllerA:generateSigningIdentity('v33.20-controller-a'),controllerB:generateSigningIdentity('v33.20-controller-b'),
 authority:generateSigningIdentity('v33.20-authority'),witness:generateSigningIdentity('v33.20-witness'),delivery:generateSigningIdentity('v33.20-delivery'),
 identityIssuer:generateSigningIdentity('v33.20-identity-issuer'),identityStore:generateSigningIdentity('v33.20-identity-store'),
 proof:generateSigningIdentity('v33.20-proof'),supervisorObserver:generateSigningIdentity('v33.20-supervisor-observer'),
};
const reg=(...values)=>{const r=new KeyRegistry();for(const value of values)r.register(value.keyId,value.publicKey);return r;};
const publicRecord=(identity)=>{const r=reg(identity);return r.exportPublicKey(identity.keyId);};
const serialize=(identity)=>({keyId:identity.keyId,privateKeyPem:identity.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
const pki=generatePki(root);
now=new Date();
const identityPath=join(root,'enterprise-identities.json');
const identityTrust={issuerRegistry:reg(ids.identityIssuer),trustedIssuerSignerIds:[ids.identityIssuer.keyId],storeRegistry:reg(ids.identityStore),trustedStoreSignerIds:[ids.identityStore.keyId]};
const identities=new EnterpriseIdentityRegistryV33_20({path:identityPath,issuerIdentity:ids.identityIssuer,storeIdentity:ids.identityStore,trust:identityTrust,now});
const identityA=identities.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientACert),now});
const identityB=identities.issue({controllerId:'controller-b',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientBCert),now});
const authorityDbPath=join(root,'authority.db');
const witnessDbPath=join(root,'witness.db');
const ports=[await freePort(),await freePort()];
const readyPaths=[join(root,'daemon-a.ready.json'),join(root,'daemon-b.ready.json')];
const daemonConfigs=ports.map((port,index)=>{
 const path=join(root,`daemon-${index}.json`);
 writeFileSync(path,JSON.stringify({
  version:'33.20',daemonId:`authority-daemon-${index}`,authorityId:'authority-main',authorityDbPath,witnessDbPath,listenHost:'127.0.0.1',listenPort:port,readyPath:readyPaths[index],
  tls:{keyPath:pki.serverKey,certPath:pki.serverCert,caPath:pki.caCert},authorityIdentity:serialize(ids.authority),witnessIdentity:serialize(ids.witness),
  controllerKeys:[publicRecord(ids.controllerA),publicRecord(ids.controllerB)],deliveryKeys:[publicRecord(ids.delivery)],enterpriseIdentityStorePath:identityPath,
  identityIssuerKeys:[publicRecord(ids.identityIssuer)],identityStoreKeys:[publicRecord(ids.identityStore)],trustedIdentityIssuerSignerIds:[ids.identityIssuer.keyId],trustedIdentityStoreSignerIds:[ids.identityStore.keyId],
 },null,2));
 return path;
});
const supervisorConfigPath=join(root,'supervisord.conf');
const supervisorSocket=join(root,'supervisor.sock');
writeFileSync(supervisorConfigPath,renderSupervisordConfigurationV33_20({socketPath:supervisorSocket,pidFile:join(root,'supervisord.pid'),logFile:join(root,'supervisord.log'),programs:daemonConfigs.map((configPath,index)=>({name:`authority_${index}`,nodeExecutable:process.execPath,daemonScript:resolve('dist/src/cli/durable-lease-authority-daemon-v33_20.js'),configPath,stdoutLog:join(root,`authority-${index}.out.log`),stderrLog:join(root,`authority-${index}.err.log`)}))}));
const supervisor=spawn('/usr/bin/supervisord',['-c',supervisorConfigPath],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
const supervisorStdout=[];const supervisorStderr=[];supervisor.stdout.on('data',(chunk)=>supervisorStdout.push(Buffer.from(chunk)));supervisor.stderr.on('data',(chunk)=>supervisorStderr.push(Buffer.from(chunk)));
const lifecycle=[];
const observe=(event,details)=>{const material={version:'33.20',event,details,observedAt:new Date().toISOString(),serviceManager:'SUPERVISORD_LOCAL_REFERENCE',productionAuthority:'NONE',externalEffectsExecuted:0};const envelope=signEnvelope({...material,receiptDigest:sha256(material)},ids.supervisorObserver);lifecycle.push(envelope);};
let endpoints=[];let winner;let loser;let firstGrant;let takeoverGrant;let oldIdentityRejected=false;let restartedProgram='';
try{
 await waitFor(()=>readyPaths.every((path)=>existsSync(path)),12000,'daemon_ready_timeout');
 endpoints=readyPaths.map((path)=>JSON.parse(readFileSync(path,'utf8')).endpoint);
 const initialStatus=supervisorStatus(supervisorConfigPath);observe('SERVICES_STARTED',{status:initialStatus,endpoints});
 const command=(identity,controllerId,operation,at,extra={})=>issueDistributedLeaseCommandV33_18({authorityId:'authority-main',tenantId:'tenant-a',serviceId:'adaptive-control',controllerId,operation,signer:identity,...((operation==='ACQUIRE'||operation==='RENEW')?{requestedTtlMs:extra.ttl??300}:{}),...(extra.fence===undefined?{}:{expectedFenceToken:extra.fence}),...(extra.digest===undefined?{}:{expectedLeaseDigest:extra.digest}),commandId:extra.id??`v33.20-${controllerId}-${operation}-${at.getTime()}`,now:at});
 const send=(endpoint,envelope,cert,key)=>sendEnterpriseDurableLeaseCommandV33_20({endpoint,envelope,ca:readFileSync(pki.caCert),cert:readFileSync(cert),key:readFileSync(key),servername:'localhost',timeoutMs:4000});
 const raceAt=new Date();
 const race=await Promise.all([
  send(endpoints[0],command(ids.controllerA,'controller-a','ACQUIRE',raceAt,{ttl:250,id:'race-a'}),pki.clientACert,pki.clientAKey),
  send(endpoints[1],command(ids.controllerB,'controller-b','ACQUIRE',raceAt,{ttl:250,id:'race-b'}),pki.clientBCert,pki.clientBKey),
 ]);
 const accepted=race.filter((decision)=>decision.payload.accepted); if(accepted.length!==1)throw new Error('single_winner_not_proven');
 firstGrant=accepted[0].payload.grant;winner=firstGrant.controllerId;loser=winner==='controller-a'?'controller-b':'controller-a';
 observe('MULTI_DAEMON_SINGLE_WINNER',{winner,loser,fenceToken:firstGrant.fenceToken,decisionDigests:race.map((item)=>item.payload.decisionDigest)});
 restartedProgram=winner==='controller-a'?'authority_0':'authority_1';
 execFileSync('/usr/bin/supervisorctl',['-c',supervisorConfigPath,'restart',restartedProgram],{stdio:'ignore'});
 await waitFor(()=>new RegExp(`^${restartedProgram}\\s+RUNNING`, 'm').test(supervisorStatus(supervisorConfigPath)),12000,'supervisor_restart_timeout');
 observe('SUPERVISORD_RESTART',{program:restartedProgram,status:supervisorStatus(supervisorConfigPath)});
 await sleep(320);
 const takeoverAt=new Date();
 const loserEndpoint=loser==='controller-a'?endpoints[0]:endpoints[1];
 const loserIdentity=loser==='controller-a'?ids.controllerA:ids.controllerB;
 const loserCert=loser==='controller-a'?pki.clientACert:pki.clientBCert;
 const loserKey=loser==='controller-a'?pki.clientAKey:pki.clientBKey;
 const takeover=await send(loserEndpoint,command(loserIdentity,loser,'ACQUIRE',takeoverAt,{ttl:500,id:'takeover'}),loserCert,loserKey);
 if(!takeover.payload.accepted||takeover.payload.currentFenceToken!==2)throw new Error('takeover_after_restart_failed');
 takeoverGrant=takeover.payload.grant;observe('DURABLE_TAKEOVER_AFTER_RESTART',{controllerId:loser,fenceToken:takeoverGrant.fenceToken,decisionDigest:takeover.payload.decisionDigest});
 const rotatedAt=new Date(takeoverAt.getTime()+1);
 const nextIdentity=identities.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientA2Cert),previousIdentityId:identityA.payload.identityId,now:rotatedAt});
 try{await send(endpoints[0],command(ids.controllerA,'controller-a','ACQUIRE',new Date(rotatedAt.getTime()+1),{ttl:100,id:'old-cert'}),pki.clientACert,pki.clientAKey);}catch(error){oldIdentityRejected=error instanceof Error&&/enterprise_identity_revoked/.test(error.message);}
 if(!oldIdentityRejected)throw new Error('old_enterprise_identity_not_rejected');
 observe('ENTERPRISE_IDENTITY_ROTATION',{oldIdentityId:identityA.payload.identityId,newIdentityId:nextIdentity.payload.identityId,oldIdentityRejected});
}finally{
 try{execFileSync('/usr/bin/supervisorctl',['-c',supervisorConfigPath,'shutdown'],{stdio:'ignore'});}catch{}
 await Promise.race([new Promise((resolvePromise)=>supervisor.once('exit',resolvePromise)),sleep(5000)]);
 if(supervisor.exitCode===null)supervisor.kill('SIGKILL');
 observe('SERVICES_STOPPED',{exitCode:supervisor.exitCode});
}
const trust={controllerRegistry:reg(ids.controllerA,ids.controllerB),trustedControllerSignerIds:[ids.controllerA.keyId,ids.controllerB.keyId],authorityRegistry:reg(ids.authority),trustedAuthoritySignerIds:[ids.authority.keyId],witnessRegistry:reg(ids.witness),trustedWitnessSignerIds:[ids.witness.keyId],deliveryRegistry:reg(ids.delivery),trustedDeliverySignerIds:[ids.delivery.keyId]};
const witness=new SqliteMonotonicWitnessV33_20({path:witnessDbPath,witnessId:'authority-main-witness',identity:ids.witness,registry:trust.witnessRegistry,trustedSignerIds:trust.trustedWitnessSignerIds});
const store=new SqliteDurableLeaseAuthorityV33_20({path:authorityDbPath,authorityId:'authority-main',authorityIdentity:ids.authority,trust,witness});
const snapshot=store.snapshot();const integrity=store.verifyIntegrity();store.close();witness.close();
const executable=(name)=>{try{return execFileSync('sh',['-lc',`command -v ${name}`],{encoding:'utf8'}).trim()||undefined;}catch{return undefined;}};
let systemdActive=false;try{systemdActive=execFileSync('systemctl',['is-system-running'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='running';}catch{}
let netemUsable=false;try{execFileSync('tc',['qdisc','show'],{stdio:'ignore'});netemUsable=true;}catch{}
const probes=probeExternalAuthorityInfrastructureV33_20({executables:{nodeSqlite:process.execPath,supervisord:executable('supervisord'),systemctl:executable('systemctl'),tc:executable('tc'),postgres:executable('postgres')??executable('psql'),etcd:executable('etcd')??executable('etcdctl'),consul:executable('consul'),spire:executable('spire-server')??executable('spire-agent')},systemdActive,netemUsable,now:new Date()});
const challengeMaterial={version:'33.20',challengeId:'v33.20-external-durable-authority-qualification',requiredIndependentHosts:2,requiredExternalBackends:['POSTGRESQL'],requiredEnterpriseIdentity:['SPIFFE_SPIRE'],requiredServiceManager:['SYSTEMD_OR_EQUIVALENT'],requiredNetworkPartitionEvidence:true,requiredExternalWitness:true,syntheticOrSingleHostEvidenceAccepted:false,productionAuthority:'NONE',externalEffectsExecuted:0,issuedAt:new Date().toISOString()};
const challenge={...challengeMaterial,challengeDigest:sha256(challengeMaterial)};
const traceMaterial={version:'33.20',evidenceClass:'LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE',observerPublicKey:publicRecord(ids.supervisorObserver),events:lifecycle,supervisorStdoutDigest:sha256(Buffer.concat(supervisorStdout).toString('utf8')),supervisorStderrDigest:sha256(Buffer.concat(supervisorStderr).toString('utf8')),authoritySnapshotDigest:snapshot.snapshotDigest,enterpriseIdentityDigests:identities.snapshot().identities.map((item)=>item.payload.identityDigest),traceDigest:''};
{const{traceDigest,...material}=traceMaterial;traceMaterial.traceDigest=sha256(material);}
const proofMaterial={version:'33.20',status:'EXTERNAL_DURABLE_AUTHORITY_REFERENCE_PROVEN_LOCALLY',evidenceClass:'LOCAL_SUPERVISORD_TWO_DAEMON_SQLITE_WAL_REFERENCE',managedAuthorityDaemonCount:2,serviceManager:'SUPERVISORD',serviceManagerRestartProven:true,sharedDurableBackend:'SQLITE_WAL',separateDurableWitness:'SEPARATE_SQLITE_WAL_REFERENCE',controllerRaceSingleWinner:true,fenceBeforeRestart:firstGrant?.fenceToken,fenceAfterRestart:takeoverGrant?.fenceToken,enterpriseIdentityProvider:'LOCAL_ENTERPRISE_PKI_REFERENCE',workloadUriSanRequired:true,enterpriseIdentityRotationCount:1,oldIdentityRejectedAfterRotation:oldIdentityRejected,authorityIntegrityVerified:integrity,decisionCount:snapshot.decisions.length,outboxEventCount:snapshot.outbox.length,witnessReceiptCount:snapshot.witnessReceipts.length,infrastructureProbes:probes,externalQualificationChallengeDigest:challenge.challengeDigest,externalQualificationAccepted:false,externalEffectsExecuted:0,productionAuthority:'NONE',limitations:['SINGLE_HOST_ONLY','SQLITE_WAL_NOT_POSTGRESQL_ETCD_OR_CONSUL','LOCAL_ENTERPRISE_PKI_NOT_SPIFFE_SPIRE','SUPERVISORD_LOCAL_REFERENCE_NOT_EXTERNAL_SERVICE_MANAGER_QUALIFICATION','NO_REAL_NETWORK_PARTITION_OR_NETEM','WITNESS_SEPARATE_DATABASE_BUT_SAME_HOST','NODE_SQLITE_EXPERIMENTAL_API','NO_KMS_HSM_OR_PRODUCTION_AUTHORITY'],productionPromotion:'blocked',proofDigest:''};
{const{proofDigest,...material}=proofMaterial;proofMaterial.proofDigest=sha256(material);}
const signedProof=signEnvelope(proofMaterial,ids.proof);const proofRegistry=reg(ids.proof);
writeFileSync(join(out,'V33_20_EXTERNAL_DURABLE_AUTHORITY_PROOF.json'),JSON.stringify({...proofMaterial,proofEnvelope:{signedProof,publicKey:proofRegistry.exportPublicKey(ids.proof.keyId)}},null,2)+'\n');
writeFileSync(join(out,'V33_20_DURABLE_AUTHORITY_TRACE.json'),JSON.stringify(traceMaterial,null,2)+'\n');
writeFileSync(join(out,'V33_20_DURABLE_AUTHORITY_SNAPSHOT.json'),JSON.stringify(snapshot,null,2)+'\n');
writeFileSync(join(out,'V33_20_ENTERPRISE_IDENTITY_SNAPSHOT.json'),JSON.stringify(identities.snapshot(),null,2)+'\n');
writeFileSync(join(out,'V33_20_INFRASTRUCTURE_PROBES.json'),JSON.stringify(probes,null,2)+'\n');
writeFileSync(join(out,'V33_20_EXTERNAL_QUALIFICATION_CHALLENGE.json'),JSON.stringify(challenge,null,2)+'\n');
console.log(JSON.stringify(proofMaterial,null,2));
rmSync(root,{recursive:true,force:true});
if(!integrity||firstGrant?.fenceToken!==1||takeoverGrant?.fenceToken!==2||!oldIdentityRejected)process.exit(1);

function supervisorStatus(configPath){return execFileSync('/usr/bin/supervisorctl',['-c',configPath,'status'],{encoding:'utf8'});}
async function freePort(){return await new Promise((resolvePromise,rejectPromise)=>{const server=createServer();server.once('error',rejectPromise);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(address===null||typeof address==='string'){rejectPromise(new Error('port_address_invalid'));return;}const port=address.port;server.close((error)=>error?rejectPromise(error):resolvePromise(port));});});}
async function waitFor(predicate,timeoutMs,error){const started=Date.now();while(Date.now()-started<timeoutMs){try{if(predicate())return;}catch{}await sleep(100);}throw new Error(error);}
function sleep(ms){return new Promise((resolvePromise)=>setTimeout(resolvePromise,ms));}
function generatePki(root){
 const dir=join(root,'pki');mkdirSync(dir,{recursive:true});const run=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
 run('req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','3','-subj','/CN=V33.20 Local Enterprise Root','-keyout','ca.key','-out','ca.crt');
 writeFileSync(join(dir,'server.ext'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');run('req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=localhost','-keyout','server.key','-out','server.csr');run('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile','server.ext','-out','server.crt');
 const client=(name,cn,uri)=>{writeFileSync(join(dir,`${name}.ext`),`subjectAltName=URI:${uri}\nextendedKeyUsage=clientAuth\n`);run('req','-newkey','rsa:2048','-sha256','-nodes','-subj',`/CN=${cn}`,'-keyout',`${name}.key`,'-out',`${name}.csr`);run('x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile',`${name}.ext`,'-out',`${name}.crt`);};
 client('client-a','controller-a','spiffe://enterprise.test/controller/controller-a');client('client-a2','controller-a-rotated','spiffe://enterprise.test/controller/controller-a');client('client-b','controller-b','spiffe://enterprise.test/controller/controller-b');
 return{caCert:join(dir,'ca.crt'),serverKey:join(dir,'server.key'),serverCert:join(dir,'server.crt'),clientAKey:join(dir,'client-a.key'),clientACert:join(dir,'client-a.crt'),clientA2Key:join(dir,'client-a2.key'),clientA2Cert:join(dir,'client-a2.crt'),clientBKey:join(dir,'client-b.key'),clientBCert:join(dir,'client-b.crt')};
}
