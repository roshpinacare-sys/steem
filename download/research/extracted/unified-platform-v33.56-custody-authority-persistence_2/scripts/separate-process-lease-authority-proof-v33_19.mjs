import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  MutualTlsCredentialStoreV33_19,
  LocalLeaseAuthorityProcessSupervisorV33_19,
  probeExternalLeaseBackendsAndServiceManagersV33_19,
  sendMutualTlsLeaseCommandV33_19,
} from '../dist/src/app/separate-process-lease-authority-v33_19.js';
import { issueDistributedLeaseCommandV33_18 } from '../dist/src/app/distributed-lease-authority-v33_18.js';

const root=mkdtempSync(join(tmpdir(),'v33.19-proof-'));
const out=new URL('../release-evidence/v33.19/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
const pki=generatePki(root);
const reg=(...ids)=>{const r=new KeyRegistry();for(const id of ids)r.register(id.keyId,id.publicKey);return r;};
const publicRecord=(id)=>{const r=reg(id);return r.exportPublicKey(id.keyId);};
const ids={
 controllerA:generateSigningIdentity('v33.19-controller-a'),controllerB:generateSigningIdentity('v33.19-controller-b'),
 authority:generateSigningIdentity('v33.19-authority'),authorityStore:generateSigningIdentity('v33.19-authority-store'),witness:generateSigningIdentity('v33.19-witness'),
 credentialIssuer:generateSigningIdentity('v33.19-credential-issuer'),credentialStore:generateSigningIdentity('v33.19-credential-store'),
 supervisor:generateSigningIdentity('v33.19-supervisor'),proof:generateSigningIdentity('v33.19-proof'),
};
const credentialTrust={issuerRegistry:reg(ids.credentialIssuer),trustedIssuerSignerIds:[ids.credentialIssuer.keyId],storeRegistry:reg(ids.credentialStore),trustedStoreSignerIds:[ids.credentialStore.keyId]};
const credentialPath=join(root,'credentials.json');
const credentials=new MutualTlsCredentialStoreV33_19({path:credentialPath,issuerIdentity:ids.credentialIssuer,storeIdentity:ids.credentialStore,trust:credentialTrust});
const issuedAt=new Date();
const credentialA=credentials.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',certificatePem:readFileSync(pki.clientACert),now:issuedAt});
const credentialB=credentials.issue({controllerId:'controller-b',tenantId:'tenant-a',serviceId:'adaptive-control',certificatePem:readFileSync(pki.clientBCert),now:issuedAt});
const configPath=join(root,'daemon-config.json');
writeFileSync(configPath,JSON.stringify({
 version:'33.19',daemonId:'daemon-main',authorityId:'authority-main',stateDir:join(root,'daemon-state'),listenHost:'127.0.0.1',listenPort:0,
 tls:{keyPath:pki.serverKey,certPath:pki.serverCert,caPath:pki.caCert},
 authorityIdentity:serialize(ids.authority),authorityStoreIdentity:serialize(ids.authorityStore),witnessIdentity:serialize(ids.witness),
 controllerKeys:[publicRecord(ids.controllerA),publicRecord(ids.controllerB)],credentialStorePath:credentialPath,
 credentialIssuerKeys:[publicRecord(ids.credentialIssuer)],credentialStoreKeys:[publicRecord(ids.credentialStore)],
 trustedCredentialIssuerSignerIds:[ids.credentialIssuer.keyId],trustedCredentialStoreSignerIds:[ids.credentialStore.keyId],
},null,2));
const supervisor=new LocalLeaseAuthorityProcessSupervisorV33_19({supervisorId:'supervisor-main',daemonId:'daemon-main',statePath:join(root,'supervisor.json'),identity:ids.supervisor,registry:reg(ids.supervisor),trustedSignerIds:[ids.supervisor.keyId]});
const trace=[];
const send=(endpoint,envelope,cert,key)=>sendMutualTlsLeaseCommandV33_19({endpoint,envelope,ca:readFileSync(pki.caCert),cert:readFileSync(cert),key:readFileSync(key),servername:'localhost',timeoutMs:2500});
const command=(identity,controllerId,operation,now,extra={})=>issueDistributedLeaseCommandV33_18({authorityId:'authority-main',tenantId:'tenant-a',serviceId:'adaptive-control',controllerId,operation,signer:identity,...(extra.ttl===undefined?{}:{requestedTtlMs:extra.ttl}),...(extra.fence===undefined?{}:{expectedFenceToken:extra.fence}),...(extra.digest===undefined?{}:{expectedLeaseDigest:extra.digest}),commandId:extra.commandId??`proof-${operation}-${controllerId}-${now.getTime()}`,now});
let endpoint;let firstGrant;let secondGrant;let oldCredentialRejected=false;let revokedCredentialRejected=false;
try{
 const first=await supervisor.start({command:process.execPath,args:['dist/src/cli/lease-authority-daemon-v33_19.js'],cwd:process.cwd(),env:{V33_19_DAEMON_CONFIG:configPath}});endpoint=first.endpoint;
 const acquireAt=new Date();
 const acquire=await send(endpoint,command(ids.controllerA,'controller-a','ACQUIRE',acquireAt,{ttl:250}),pki.clientACert,pki.clientAKey);firstGrant=acquire.payload.grant;if(!firstGrant)throw new Error('first_grant_missing');
 trace.push({event:'MTLS_ACQUIRE',controllerId:'controller-a',fenceToken:firstGrant.fenceToken,decisionDigest:acquire.payload.decisionDigest,restartGeneration:first.restartGeneration});
 const rotateAt=new Date(acquireAt.getTime()+1);
 const credentialA2=credentials.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',certificatePem:readFileSync(pki.clientA2Cert),previousCredentialId:credentialA.payload.credentialId,now:rotateAt});
 try{await send(endpoint,command(ids.controllerA,'controller-a','ASSERT_FENCE',new Date(rotateAt.getTime()+1),{fence:firstGrant.fenceToken,digest:firstGrant.leaseDigest}),pki.clientACert,pki.clientAKey);}catch(error){oldCredentialRejected=error instanceof Error&&/credential_revoked/.test(error.message);}
 const rotatedAssert=await send(endpoint,command(ids.controllerA,'controller-a','ASSERT_FENCE',new Date(rotateAt.getTime()+2),{fence:firstGrant.fenceToken,digest:firstGrant.leaseDigest}),pki.clientA2Cert,pki.clientA2Key);
 trace.push({event:'CREDENTIAL_ROTATION',oldCredentialId:credentialA.payload.credentialId,newCredentialId:credentialA2.payload.credentialId,oldCredentialRejected,assertDecisionDigest:rotatedAssert.payload.decisionDigest});
 await supervisor.crash(new Date());
 await new Promise((resolve)=>setTimeout(resolve,300));
 const second=await supervisor.start({command:process.execPath,args:['dist/src/cli/lease-authority-daemon-v33_19.js'],cwd:process.cwd(),env:{V33_19_DAEMON_CONFIG:configPath}});endpoint=second.endpoint;
 const takeoverAt=new Date();
 const takeover=await send(endpoint,command(ids.controllerB,'controller-b','ACQUIRE',takeoverAt,{ttl:1000}),pki.clientBCert,pki.clientBKey);secondGrant=takeover.payload.grant;if(!secondGrant)throw new Error('second_grant_missing');
 trace.push({event:'DAEMON_RESTART_TAKEOVER',controllerId:'controller-b',fenceToken:secondGrant.fenceToken,decisionDigest:takeover.payload.decisionDigest,restartGeneration:second.restartGeneration});
 credentials.revoke({credentialId:credentialB.payload.credentialId,reason:'COMPROMISED',now:new Date(takeoverAt.getTime()+1)});
 try{await send(endpoint,command(ids.controllerB,'controller-b','ASSERT_FENCE',new Date(takeoverAt.getTime()+2),{fence:secondGrant.fenceToken,digest:secondGrant.leaseDigest}),pki.clientBCert,pki.clientBKey);}catch(error){revokedCredentialRejected=error instanceof Error&&/credential_revoked/.test(error.message);}
 trace.push({event:'LIVE_REVOCATION',credentialId:credentialB.payload.credentialId,rejectedWithoutRestart:revokedCredentialRejected});
}finally{await supervisor.stop();}
const executable=(name)=>{try{return execFileSync('sh',['-lc',`command -v ${name}`],{encoding:'utf8'}).trim()||undefined;}catch{return undefined;}};
let systemdActive=false;try{systemdActive=execFileSync('systemctl',['is-system-running'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='running';}catch{}
const probes=probeExternalLeaseBackendsAndServiceManagersV33_19({executables:{POSTGRESQL:executable('postgres')??executable('psql'),ETCD:executable('etcd')??executable('etcdctl'),CONSUL:executable('consul'),SYSTEMD:executable('systemctl')},systemdActive,now:new Date()});
const supervisorSnapshot=supervisor.snapshot();
const credentialSnapshot=credentials.snapshot();
const traceArtifact={version:'33.19',evidenceClass:'LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE',events:trace,supervisorReceiptDigests:supervisorSnapshot.receipts.map((x)=>x.payload.receiptDigest),credentialDigests:credentialSnapshot.credentials.map((x)=>x.payload.credentialDigest),traceDigest:''};
{const{traceDigest,...material}=traceArtifact;traceArtifact.traceDigest=sha256(material);}
const proofMaterial={version:'33.19',status:'SEPARATE_PROCESS_MTLS_AUTHORITY_PROVEN_LOCALLY',evidenceClass:'LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE',authorityDaemonProcessCount:1,controllerProcessBoundary:'CLIENT_PROCESS_TO_SEPARATE_AUTHORITY_DAEMON',transport:'MUTUAL_TLS_1_3',applicationCommandSignatureRequired:true,credentialRotationCount:1,oldCredentialRejectedAfterRotation:oldCredentialRejected,liveRevocationCount:1,revokedCredentialRejectedWithoutRestart:revokedCredentialRejected,daemonCrashCount:1,daemonRestartCount:1,supervisorLifecycleReceiptCount:supervisorSnapshot.receipts.length,supervisorReceiptChainValid:supervisor.verify(),fenceBeforeRestart:firstGrant?.fenceToken,fenceAfterRestart:secondGrant?.fenceToken,backendProbes:probes.backends,serviceManagerProbes:probes.serviceManagers,externalEffectsExecuted:0,productionAuthority:'NONE',limitations:['SINGLE_HOST_LOOPBACK_MTLS_REFERENCE','LOCAL_PROCESS_SUPERVISOR_NOT_SYSTEMD_QUALIFICATION','POSTGRESQL_ETCD_CONSUL_UNAVAILABLE_FAIL_CLOSED','TEMPORARY_TEST_CA_NOT_ENTERPRISE_PKI','NO_KMS_HSM_OR_EXTERNAL_WITNESS','NO_PRODUCTION_AUTHORITY_OR_EXTERNAL_EFFECTS'],productionPromotion:'blocked',proofDigest:''};
{const{proofDigest,...material}=proofMaterial;proofMaterial.proofDigest=sha256(material);}
const signedProof=signEnvelope(proofMaterial,ids.proof);const proofRegistry=reg(ids.proof);
writeFileSync(join(out,'V33_19_SEPARATE_PROCESS_MTLS_AUTHORITY_PROOF.json'),JSON.stringify({...proofMaterial,proofEnvelope:{signedProof,publicKey:proofRegistry.exportPublicKey(ids.proof.keyId)}},null,2)+'\n');
writeFileSync(join(out,'V33_19_MTLS_AUTHORITY_TRACE.json'),JSON.stringify(traceArtifact,null,2)+'\n');
writeFileSync(join(out,'V33_19_CREDENTIAL_SNAPSHOT.json'),JSON.stringify(credentialSnapshot,null,2)+'\n');
writeFileSync(join(out,'V33_19_SUPERVISOR_SNAPSHOT.json'),JSON.stringify(supervisorSnapshot,null,2)+'\n');
writeFileSync(join(out,'V33_19_BACKEND_SERVICE_MANAGER_PROBES.json'),JSON.stringify(probes,null,2)+'\n');
console.log(JSON.stringify(proofMaterial,null,2));
rmSync(root,{recursive:true,force:true});
if(!oldCredentialRejected||!revokedCredentialRejected||secondGrant?.fenceToken!==2||!supervisor.verify())process.exit(1);

function serialize(identity){return{keyId:identity.keyId,privateKeyPem:identity.privateKey.export({type:'pkcs8',format:'pem'}).toString()};}
function generatePki(root){
 const dir=join(root,'pki');mkdirSync(dir,{recursive:true});const run=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
 run('req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','3','-subj','/CN=V33.19 Proof CA','-keyout','ca.key','-out','ca.crt');
 writeFileSync(join(dir,'server.ext'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
 run('req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=localhost','-keyout','server.key','-out','server.csr');
 run('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile','server.ext','-out','server.crt');
 const client=(name,cn)=>{writeFileSync(join(dir,`${name}.ext`),'extendedKeyUsage=clientAuth\n');run('req','-newkey','rsa:2048','-sha256','-nodes','-subj',`/CN=${cn}`,'-keyout',`${name}.key`,'-out',`${name}.csr`);run('x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile',`${name}.ext`,'-out',`${name}.crt`);};
 client('client-a','controller-a');client('client-a2','controller-a-rotated');client('client-b','controller-b');
 return{caCert:join(dir,'ca.crt'),serverKey:join(dir,'server.key'),serverCert:join(dir,'server.crt'),clientAKey:join(dir,'client-a.key'),clientACert:join(dir,'client-a.crt'),clientA2Key:join(dir,'client-a2.key'),clientA2Cert:join(dir,'client-a2.crt'),clientBKey:join(dir,'client-b.key'),clientBCert:join(dir,'client-b.crt')};
}
