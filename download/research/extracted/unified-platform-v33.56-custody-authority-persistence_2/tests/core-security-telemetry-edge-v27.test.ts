import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalJson, generateSigningIdentity, KeyRegistry, sha256, sha256Bytes, signEnvelope } from '../src/contracts/crypto.js';
import { TelemetryRegistry } from '../src/operations/telemetry.js';

test('crypto registry rejects identity misuse, substitution, revocation and invalid envelopes while exposing stable fingerprints',()=>{
  assert.throws(()=>generateSigningIdentity(' '),/key_id/);const identity=generateSigningIdentity('key-1'),other=generateSigningIdentity('key-1');const registry=new KeyRegistry();
  assert.throws(()=>registry.register('',identity.publicKey),/key_id/);assert.throws(()=>registry.register('private',identity.privateKey),/public_key/);registry.register(identity.keyId,identity.publicKey);registry.register(identity.keyId,identity.publicKey);assert.throws(()=>registry.register(other.keyId,other.publicKey),/conflict/);
  const signed=signEnvelope({value:1},identity);assert.equal(registry.verify(signed),true);assert.equal(registry.verify({...signed,algorithm:'bad' as 'Ed25519'}),false);assert.equal(new KeyRegistry().verify(signed),false);assert.equal(registry.verify({...signed,payload:{value:2}}),false);assert.equal(registry.isRevoked(identity.keyId),false);assert.equal(registry.fingerprint('missing'),undefined);assert.equal(registry.fingerprint(identity.keyId)?.length,64);assert.throws(()=>registry.revoke('missing'),/not_found/);registry.revoke(identity.keyId);assert.equal(registry.verify(signed),false);assert.equal(registry.isRevoked(identity.keyId),true);
});

test('canonical and binary hashing separate data classes and reject ambiguous values',()=>{
  assert.equal(canonicalJson({b:1,a:-0}),'{"a":0,"b":1}');assert.equal(sha256Bytes(Buffer.from('x')).length,64);assert.equal(sha256Bytes(new Uint8Array([1,2]).buffer).length,64);assert.throws(()=>sha256(Buffer.from('x')),/binary/);
  for(const value of [undefined,1n,Symbol('x'),()=>1,NaN,Infinity])assert.throws(()=>canonicalJson(value));
});

test('telemetry validates limits, metric names, values, duration retention and cardinality',()=>{
  for(const limits of [{maxLogs:0},{maxLogs:1.2},{maxLogs:1_000_001}])assert.throws(()=>new TelemetryRegistry(limits),/limit_invalid/);
  const telemetry=new TelemetryRegistry({maxMetricSeries:2,maxSamplesPerMetric:2,maxLogs:2,maxAttributesPerLog:2,maxAttributeValueLength:8});assert.throws(()=>telemetry.increment('x'),/metric_name/);assert.throws(()=>telemetry.gauge('valid.metric',NaN),/metric_value/);assert.throws(()=>telemetry.observe('valid.duration',-1),/negative/);
  telemetry.increment('valid.counter');telemetry.increment('valid.counter',2);telemetry.observe('valid.duration',3);telemetry.observe('valid.duration',1);telemetry.observe('valid.duration',2);assert.throws(()=>telemetry.gauge('third.metric',1),/cardinality/);const snap=telemetry.snapshot();assert.equal(snap.counters['valid.counter'],3);assert.equal(snap.histograms['valid.duration']?.count,2);assert.equal(snap.dropped.durationSamples,1);
});

test('telemetry logging redacts secrets, bounds logs and attributes, and health readiness is fail closed',()=>{
  const telemetry=new TelemetryRegistry({maxLogs:1,maxAttributesPerLog:4,maxAttributeValueLength:8});
  assert.throws(()=>telemetry.log({timestamp:'bad',level:'INFO',event:'e',traceId:'t'}),/timestamp/);assert.throws(()=>telemetry.log({timestamp:new Date().toISOString(),level:'INFO',event:' ',traceId:'t'}),/identity/);assert.throws(()=>telemetry.log({timestamp:new Date().toISOString(),level:'INFO',event:'e',traceId:'t',attributes:{'bad key':1}}),/invalid_telemetry_attribute/);assert.throws(()=>telemetry.log({timestamp:new Date().toISOString(),level:'INFO',event:'e',traceId:'t',attributes:{a:1,b:2,c:3,d:4,e:5}}),/attribute_count/);
  telemetry.log({timestamp:new Date().toISOString(),level:'WARN',event:'first',traceId:'t1',tenantId:'tenant-1',missionId:'m1',attributes:{password:'secret',text:'very-long-text',flag:true,object:{x:1}}});telemetry.log({timestamp:new Date().toISOString(),level:'INFO',event:'second',traceId:'t2',attributes:{authorization:'Bearer abcdefghijklmnop'}});
  const blocked=telemetry.snapshot([{name:'db',status:'blocked',detail:'down'}]);assert.equal(blocked.readiness,'blocked');assert.equal(blocked.logs.length,1);assert.equal(blocked.dropped.logs,1);assert.equal(blocked.logs[0]?.attributes.authorization,'[REDACTED]');
  assert.equal(telemetry.snapshot([{name:'db',status:'degraded',detail:'slow'}]).readiness,'degraded');assert.equal(telemetry.snapshot([{name:'db',status:'ready',detail:'ok'}]).readiness,'ready');assert.throws(()=>telemetry.snapshot([{name:'',status:'ready',detail:'ok'}]),/dependency_invalid/);assert.throws(()=>telemetry.snapshot([{name:'db',status:'ready',detail:'ok'},{name:'db',status:'ready',detail:'ok'}]),/duplicate/);
});
