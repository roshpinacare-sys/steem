import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EnterpriseIdentityRegistryV33_20,
  EnterpriseIdentityVerifierV33_20,
  SqliteDurableLeaseAuthorityV33_20,
  SqliteMonotonicWitnessV33_20,
  createEnterpriseDurableLeaseAuthorityServerV33_20,
  probeExternalAuthorityInfrastructureV33_20,
  renderSupervisordConfigurationV33_20,
  sendEnterpriseDurableLeaseCommandV33_20,
  type DurableAuthorityTrustV33_20,
  type EnterpriseIdentityTrustV33_20,
} from '../src/app/external-durable-authority-v33_20.js';
import { issueDistributedLeaseCommandV33_18, issueOutboxAcknowledgementV33_18 } from '../src/app/distributed-lease-authority-v33_18.js';
import { KeyRegistry, generateSigningIdentity, type SigningIdentity } from '../src/contracts/crypto.js';

const pki = generatePki();
after(() => rmSync(pki.root, { recursive: true, force: true }));

function registry(...identities: SigningIdentity[]): KeyRegistry { const result = new KeyRegistry(); for (const identity of identities) result.register(identity.keyId, identity.publicKey); return result; }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'v33.20-test-'));
  const suffix = root.split('-').at(-1)!;
  const now = new Date();
  const ids = {
    controllerA: generateSigningIdentity(`controller-a-${suffix}`), controllerB: generateSigningIdentity(`controller-b-${suffix}`), attacker: generateSigningIdentity(`attacker-${suffix}`),
    authority: generateSigningIdentity(`authority-${suffix}`), witness: generateSigningIdentity(`witness-${suffix}`), delivery: generateSigningIdentity(`delivery-${suffix}`),
    identityIssuer: generateSigningIdentity(`identity-issuer-${suffix}`), identityStore: generateSigningIdentity(`identity-store-${suffix}`),
  };
  const trust: DurableAuthorityTrustV33_20 = {
    controllerRegistry: registry(ids.controllerA, ids.controllerB), trustedControllerSignerIds: [ids.controllerA.keyId, ids.controllerB.keyId],
    authorityRegistry: registry(ids.authority), trustedAuthoritySignerIds: [ids.authority.keyId],
    witnessRegistry: registry(ids.witness), trustedWitnessSignerIds: [ids.witness.keyId],
    deliveryRegistry: registry(ids.delivery), trustedDeliverySignerIds: [ids.delivery.keyId],
  };
  const identityTrust: EnterpriseIdentityTrustV33_20 = {
    issuerRegistry: registry(ids.identityIssuer), trustedIssuerSignerIds: [ids.identityIssuer.keyId],
    storeRegistry: registry(ids.identityStore), trustedStoreSignerIds: [ids.identityStore.keyId],
  };
  const identityPath = join(root, 'identities.json');
  const identityRegistry = new EnterpriseIdentityRegistryV33_20({ path: identityPath, issuerIdentity: ids.identityIssuer, storeIdentity: ids.identityStore, trust: identityTrust, now });
  const identityA = identityRegistry.issue({ controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', trustDomain: 'enterprise.test', certificatePem: readFileSync(pki.clientACert), now });
  const identityB = identityRegistry.issue({ controllerId: 'controller-b', tenantId: 'tenant-a', serviceId: 'adaptive-control', trustDomain: 'enterprise.test', certificatePem: readFileSync(pki.clientBCert), now });
  const witnessPath = join(root, 'witness.db');
  const authorityPath = join(root, 'authority.db');
  const createWitness = () => new SqliteMonotonicWitnessV33_20({ path: witnessPath, witnessId: 'witness-main', identity: ids.witness, registry: trust.witnessRegistry, trustedSignerIds: trust.trustedWitnessSignerIds });
  const createStore = (witness = createWitness()) => new SqliteDurableLeaseAuthorityV33_20({ path: authorityPath, authorityId: 'authority-main', authorityIdentity: ids.authority, trust, witness, now });
  const witness = createWitness();
  const store = createStore(witness);
  return { root, now, ids, trust, identityTrust, identityPath, identityRegistry, identityA, identityB, witnessPath, authorityPath, witness, store, createWitness, createStore };
}
function cleanup(f: ReturnType<typeof fixture>): void { try { f.store.close(); } catch {} try { f.witness.close(); } catch {} rmSync(f.root, { recursive: true, force: true }); }
function command(f: ReturnType<typeof fixture>, input: { signer?: SigningIdentity; controllerId?: string; operation?: 'ACQUIRE'|'RENEW'|'ASSERT_FENCE'; now?: Date; ttl?: number; fence?: number; digest?: string; id?: string; tenant?: string; service?: string } = {}) {
  const operation = input.operation ?? 'ACQUIRE';
  return issueDistributedLeaseCommandV33_18({ authorityId: 'authority-main', tenantId: input.tenant ?? 'tenant-a', serviceId: input.service ?? 'adaptive-control', controllerId: input.controllerId ?? 'controller-a', operation, signer: input.signer ?? f.ids.controllerA, ...((operation === 'ACQUIRE' || operation === 'RENEW') ? { requestedTtlMs: input.ttl ?? 1000 } : {}), ...(input.fence === undefined ? {} : { expectedFenceToken: input.fence }), ...(input.digest === undefined ? {} : { expectedLeaseDigest: input.digest }), ...(input.id === undefined ? {} : { commandId: input.id }), now: input.now ?? f.now });
}
async function startServer(f: ReturnType<typeof fixture>, clock: { now: Date }) {
  const verifier = new EnterpriseIdentityVerifierV33_20({ path: f.identityPath, trust: f.identityTrust });
  const server = createEnterpriseDurableLeaseAuthorityServerV33_20({ store: f.store, identityVerifier: verifier, tls: { key: readFileSync(pki.serverKey), cert: readFileSync(pki.serverCert), ca: readFileSync(pki.caCert) }, now: () => clock.now });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('server_address_invalid');
  return { server, endpoint: `https://127.0.0.1:${address.port}` };
}
async function closeServer(server: import('node:https').Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
function client(endpoint: string, envelope: ReturnType<typeof command>, cert = pki.clientACert, key = pki.clientAKey) { return sendEnterpriseDurableLeaseCommandV33_20({ endpoint, envelope, ca: readFileSync(pki.caCert), cert: readFileSync(cert), key: readFileSync(key), servername: 'localhost', timeoutMs: 2500 }); }

test('issues enterprise workload identity only when URI SAN matches', () => { const f=fixture(); try { assert.equal(f.identityA.payload.workloadUri,'spiffe://enterprise.test/controller/controller-a'); assert.equal(f.identityA.payload.status,'ACTIVE'); assert.equal(f.identityA.payload.productionAuthority,'NONE'); } finally { cleanup(f); } });
test('rejects a certificate without the required workload URI', () => { const f=fixture(); try { assert.throws(()=>f.identityRegistry.issue({controllerId:'controller-x',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.wrongCert),now:f.now}),/uri_san_missing/); } finally { cleanup(f); } });
test('rotation revokes the prior enterprise identity atomically', () => { const f=fixture(); try { const next=f.identityRegistry.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientA2Cert),previousIdentityId:f.identityA.payload.identityId,now:new Date(f.now.getTime()+1)}); const snapshot=f.identityRegistry.snapshot(); assert.equal(next.payload.generation,2); assert.equal(snapshot.identities.find((x)=>x.payload.identityId===f.identityA.payload.identityId)?.payload.status,'REVOKED'); } finally { cleanup(f); } });
test('prevents one certificate fingerprint from binding to another controller', () => { const f=fixture(); try { assert.throws(()=>f.identityRegistry.issue({controllerId:'controller-a',tenantId:'tenant-b',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientACert),now:f.now}),/fingerprint_already_bound/); } finally { cleanup(f); } });
test('detects enterprise identity store tampering', () => { const f=fixture(); try { const data=JSON.parse(readFileSync(f.identityPath,'utf8')); data.payload.identities[0].payload.controllerId='attacker'; writeFileSync(f.identityPath,JSON.stringify(data)); assert.throws(()=>new EnterpriseIdentityVerifierV33_20({path:f.identityPath,trust:f.identityTrust}),/signature|digest/); } finally { cleanup(f); } });
test('grants the first durable lease with fence one', () => { const f=fixture(); try { const decision=f.store.processCommand(command(f),f.now); assert.equal(decision.payload.accepted,true); assert.equal(decision.payload.currentFenceToken,1); assert.equal(f.store.verifyIntegrity(),true); } finally { cleanup(f); } });
test('rejects a competing controller while lease is active', () => { const f=fixture(); try { f.store.processCommand(command(f),f.now); const now=new Date(f.now.getTime()+1); const result=f.store.processCommand(command(f,{signer:f.ids.controllerB,controllerId:'controller-b',now}),now); assert.equal(result.payload.reason,'LEASE_BUSY'); } finally { cleanup(f); } });
test('takes over after expiry and increments the durable witness', () => { const f=fixture(); try { f.store.processCommand(command(f,{ttl:10}),f.now); const now=new Date(f.now.getTime()+11); const result=f.store.processCommand(command(f,{signer:f.ids.controllerB,controllerId:'controller-b',now}),now); assert.equal(result.payload.currentFenceToken,2); assert.equal(f.witness.highest('tenant-a\u0000adaptive-control'),2); assert.ok(f.store.snapshot().outbox.some((x)=>x.payload.eventType==='FALLBACK_REQUIRED')); } finally { cleanup(f); } });
test('rejects stale fencing after takeover', () => { const f=fixture(); try { const first=f.store.processCommand(command(f,{ttl:10}),f.now).payload.grant!; const takeoverAt=new Date(f.now.getTime()+11); f.store.processCommand(command(f,{signer:f.ids.controllerB,controllerId:'controller-b',now:takeoverAt}),takeoverAt); const now=new Date(takeoverAt.getTime()+1); const stale=f.store.processCommand(command(f,{operation:'ASSERT_FENCE',fence:first.fenceToken,digest:first.leaseDigest,now}),now); assert.equal(stale.payload.reason,'STALE_FENCE'); } finally { cleanup(f); } });
test('returns exact prior decision for idempotent command', () => { const f=fixture(); try { const c=command(f,{id:'same'}); const one=f.store.processCommand(c,f.now); const two=f.store.processCommand(c,f.now); assert.deepEqual(two,one); assert.equal(f.store.snapshot().decisions.length,1); } finally { cleanup(f); } });
test('rejects command id reuse with different digest', () => { const f=fixture(); try { f.store.processCommand(command(f,{id:'same',ttl:100}),f.now); assert.throws(()=>f.store.processCommand(command(f,{id:'same',ttl:200}),f.now),/command_id_conflict/); } finally { cleanup(f); } });
test('two SQLite connections observe the same winning lease', () => { const f=fixture(); let witness2:SqliteMonotonicWitnessV33_20|undefined; let store2:SqliteDurableLeaseAuthorityV33_20|undefined; try { witness2=f.createWitness(); store2=f.createStore(witness2); const first=f.store.processCommand(command(f),f.now); const now=new Date(f.now.getTime()+1); const second=store2.processCommand(command(f,{signer:f.ids.controllerB,controllerId:'controller-b',now}),now); assert.equal(first.payload.accepted,true); assert.equal(second.payload.reason,'LEASE_BUSY'); assert.equal(store2.snapshot().fenceCounter,1); } finally { try{store2?.close();}catch{} try{witness2?.close();}catch{} cleanup(f); } });
test('restart preserves the fence and decisions', () => { const f=fixture(); try { f.store.processCommand(command(f,{ttl:10}),f.now); f.store.close(); f.witness.close(); const witness=f.createWitness(); const store=f.createStore(witness); const now=new Date(f.now.getTime()+11); const result=store.processCommand(command(f,{signer:f.ids.controllerB,controllerId:'controller-b',now}),now); assert.equal(result.payload.currentFenceToken,2); store.close(); witness.close(); } finally { rmSync(f.root,{recursive:true,force:true}); } });
test('separate durable witness detects rollback of authority database', () => { const f=fixture(); try { f.store.close(); copyFileSync(f.authorityPath,join(f.root,'old-authority.db')); f.store=f.createStore(f.witness) as never; f.store.processCommand(command(f),f.now); f.store.close(); f.witness.close(); copyFileSync(join(f.root,'old-authority.db'),f.authorityPath); const witness=f.createWitness(); assert.throws(()=>f.createStore(witness),/rollback_detected/); witness.close(); } finally { rmSync(f.root,{recursive:true,force:true}); } });
test('durable outbox acknowledgement is idempotent without changing event digest', () => { const f=fixture(); try { f.store.processCommand(command(f),f.now); const event=f.store.snapshot().outbox[0]!; const ack=issueOutboxAcknowledgementV33_18({event,deliveryWorkerId:'delivery-a',signer:f.ids.delivery,now:new Date(f.now.getTime()+1)}); const one=f.store.acknowledgeOutbox(ack,new Date(f.now.getTime()+1)); const two=f.store.acknowledgeOutbox(ack,new Date(f.now.getTime()+1)); assert.equal(one.payload.eventDigest,event.payload.eventDigest); assert.deepEqual(two,one); assert.equal(f.store.verifyIntegrity(),true); } finally { cleanup(f); } });
test('integrity check rejects a modified durable decision row', () => { const f=fixture(); try { f.store.processCommand(command(f),f.now); f.store.close(); const db=new DatabaseSync(f.authorityPath); const row=db.prepare('SELECT command_id,envelope_json FROM decisions LIMIT 1').get() as {command_id:string;envelope_json:string}; const envelope=JSON.parse(row.envelope_json); envelope.payload.accepted=false; db.prepare('UPDATE decisions SET envelope_json=? WHERE command_id=?').run(JSON.stringify(envelope),row.command_id); db.close(); const store=f.createStore(f.witness); assert.equal(store.verifyIntegrity(),false); store.close(); } finally { try{f.witness.close();}catch{} rmSync(f.root,{recursive:true,force:true}); } });
test('mTLS plus workload identity accepts a correctly bound controller', async () => { const f=fixture(); const clock={now:f.now}; const {server,endpoint}=await startServer(f,clock); try { const result=await client(endpoint,command(f)); assert.equal(result.payload.accepted,true); } finally { await closeServer(server); cleanup(f); } });
test('live rotation rejects old certificate and accepts new workload identity', async () => { const f=fixture(); const clock={now:f.now}; const {server,endpoint}=await startServer(f,clock); try { f.identityRegistry.issue({controllerId:'controller-a',tenantId:'tenant-a',serviceId:'adaptive-control',trustDomain:'enterprise.test',certificatePem:readFileSync(pki.clientA2Cert),previousIdentityId:f.identityA.payload.identityId,now:new Date(f.now.getTime()+1)}); clock.now=new Date(f.now.getTime()+2); await assert.rejects(()=>client(endpoint,command(f,{now:clock.now}),pki.clientACert,pki.clientAKey),/identity_revoked/); const result=await client(endpoint,command(f,{now:clock.now,id:'rotated'}),pki.clientA2Cert,pki.clientA2Key); assert.equal(result.payload.accepted,true); } finally { await closeServer(server); cleanup(f); } });
test('certificate URI cannot impersonate another controller even with trusted CA', async () => { const f=fixture(); const clock={now:f.now}; const {server,endpoint}=await startServer(f,clock); try { await assert.rejects(()=>client(endpoint,command(f,{controllerId:'controller-a'}),pki.clientBCert,pki.clientBKey),/identity_binding_mismatch|not_registered/); } finally { await closeServer(server); cleanup(f); } });
test('infrastructure probes qualify only local SQLite and supervisord references', () => { const probes=probeExternalAuthorityInfrastructureV33_20({executables:{nodeSqlite:process.execPath,supervisord:'/usr/bin/supervisord',systemctl:'/usr/bin/systemctl',tc:'/usr/sbin/tc'},systemdActive:false,netemUsable:false,now:new Date('2026-07-21T00:00:00Z')}); assert.equal(probes.find((x)=>x.component==='SQLITE_WAL')?.status,'LOCAL_REFERENCE_QUALIFIED'); assert.equal(probes.find((x)=>x.component==='SUPERVISORD')?.status,'LOCAL_REFERENCE_QUALIFIED'); assert.equal(probes.find((x)=>x.component==='POSTGRESQL')?.status,'UNAVAILABLE_FAIL_CLOSED'); assert.equal(probes.find((x)=>x.component==='SPIFFE_SPIRE')?.status,'UNAVAILABLE_FAIL_CLOSED'); });
test('supervisord configuration requires two managed daemon programs and process-group cleanup', () => { const config=renderSupervisordConfigurationV33_20({socketPath:'/tmp/v.sock',pidFile:'/tmp/v.pid',logFile:'/tmp/v.log',programs:[{name:'a',nodeExecutable:'/node',daemonScript:'/daemon.js',configPath:'/a.json',stdoutLog:'/a.out',stderrLog:'/a.err'},{name:'b',nodeExecutable:'/node',daemonScript:'/daemon.js',configPath:'/b.json',stdoutLog:'/b.out',stderrLog:'/b.err'}]}); assert.match(config,/\[program:a\]/); assert.match(config,/\[program:b\]/); assert.match(config,/autorestart=true/); assert.match(config,/stopasgroup=true/); assert.match(config,/killasgroup=true/); });
test('all durable authority artifacts remain effect-free and production-blocked', () => { const f=fixture(); try { f.store.processCommand(command(f),f.now); const snapshot=f.store.snapshot(); assert.equal(snapshot.productionAuthority,'NONE'); assert.equal(snapshot.externalEffectsExecuted,0); assert.equal(snapshot.decisions.every((x)=>x.payload.externalEffectsExecuted===0&&x.payload.authorityExpanded===false),true); assert.equal(snapshot.outbox.every((x)=>x.payload.externalEffectsExecuted===0),true); } finally { cleanup(f); } });

function generatePki() {
  const root=mkdtempSync(join(tmpdir(),'v33.20-pki-')); const run=(...args:string[])=>execFileSync('openssl',args,{cwd:root,stdio:'ignore'});
  run('req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','3','-subj','/CN=V33.20 Enterprise Root','-keyout','ca.key','-out','ca.crt');
  writeFileSync(join(root,'server.ext'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run('req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=localhost','-keyout','server.key','-out','server.csr'); run('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile','server.ext','-out','server.crt');
  const client=(name:string,cn:string,uri:string)=>{writeFileSync(join(root,`${name}.ext`),`subjectAltName=URI:${uri}\nextendedKeyUsage=clientAuth\n`);run('req','-newkey','rsa:2048','-sha256','-nodes','-subj',`/CN=${cn}`,'-keyout',`${name}.key`,'-out',`${name}.csr`);run('x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','3','-sha256','-extfile',`${name}.ext`,'-out',`${name}.crt`);};
  client('client-a','controller-a','spiffe://enterprise.test/controller/controller-a'); client('client-a2','controller-a-rotated','spiffe://enterprise.test/controller/controller-a'); client('client-b','controller-b','spiffe://enterprise.test/controller/controller-b'); client('wrong','wrong','spiffe://wrong.test/controller/wrong');
  return {root,caCert:join(root,'ca.crt'),serverKey:join(root,'server.key'),serverCert:join(root,'server.crt'),clientAKey:join(root,'client-a.key'),clientACert:join(root,'client-a.crt'),clientA2Key:join(root,'client-a2.key'),clientA2Cert:join(root,'client-a2.crt'),clientBKey:join(root,'client-b.key'),clientBCert:join(root,'client-b.crt'),wrongCert:join(root,'wrong.crt')};
}
