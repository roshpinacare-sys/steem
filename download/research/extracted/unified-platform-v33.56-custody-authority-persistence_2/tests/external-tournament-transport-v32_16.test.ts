import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../src/contracts/crypto.js';
import { evaluateTournamentTransportV32_16, signTournamentTransportObservationV32_16, type TournamentInvocationV32_16, type TournamentTransportObservationV32_16, type TournamentTransportTrustV32_16 } from '../src/benchmark/external-tournament-transport-v32_16.js';

function fixture(authority: 'LOCAL_FIXTURE' | 'EXTERNAL_PINNED' = 'LOCAL_FIXTURE', synthetic = true) {
  const observer = generateSigningIdentity('observer-key');
  const registry = new KeyRegistry(); registry.register(observer.keyId, observer.publicKey);
  const invocation: TournamentInvocationV32_16 = {
    schemaVersion:'32.16', runId:'run-1', taskId:'task-1', blindLabel:'blind-a', providerId:'provider-a',
    requestDigest:sha256('request'), responseDigest:sha256('response'), nonce:'nonce-1',
    startedAt:'2026-07-20T10:00:00.000Z', completedAt:'2026-07-20T10:00:01.000Z', externalResponseId:'provider-response-1', synthetic,
  };
  const observation: TournamentTransportObservationV32_16 = {
    invocationDigest:sha256(invocation), observerId:'observer-a', observerOrganizationId:'observer-org', providerId:'provider-a', providerOrganizationId:'provider-org',
    transport:'HTTPS', observedAt:'2026-07-20T10:00:02.000Z', externalResponseId:invocation.externalResponseId,
    requestDigest:invocation.requestDigest, responseDigest:invocation.responseDigest, synthetic,
  };
  const trust: TournamentTransportTrustV32_16 = { policyDigest:sha256('transport-policy'), observerAuthorizations:[{observerId:'observer-a',organizationId:'observer-org',keyId:observer.keyId,keyFingerprint:registry.fingerprint(observer.keyId)!,authority}] };
  return { observer, registry, invocation, observation, trust };
}

test('local tournament transport evidence remains dry-run only', () => {
  const f=fixture();
  const report=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:signTournamentTransportObservationV32_16(f.observation,f.observer),registry:f.registry,trust:f.trust,mode:'LOCAL_DRY_RUN',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(report.state,'DRY_RUN_PASSED'); assert.equal(report.externallyObserved,false);
});

test('externally pinned independent observer can qualify transport evidence', () => {
  const f=fixture('EXTERNAL_PINNED',false);
  const report=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:signTournamentTransportObservationV32_16(f.observation,f.observer),registry:f.registry,trust:f.trust,mode:'EXTERNAL_OBSERVED',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(report.state,'PASSED'); assert.equal(report.externallyObserved,true);
});

test('provider self-attestation is rejected even with a valid signature', () => {
  const f=fixture('EXTERNAL_PINNED',false);
  const bad={...f.observation,observerId:'provider-a',observerOrganizationId:'provider-org'};
  const trust={...f.trust,observerAuthorizations:[{...f.trust.observerAuthorizations[0]!,observerId:'provider-a',organizationId:'provider-org'}]};
  const report=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:signTournamentTransportObservationV32_16(bad,f.observer),registry:f.registry,trust,mode:'EXTERNAL_OBSERVED',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(report.state,'FAILED'); assert.equal(report.findings.includes('transport-self-attestation'),true);
});

test('transport lineage substitution and signature tampering are rejected', () => {
  const f=fixture('EXTERNAL_PINNED',false);
  const signed=signTournamentTransportObservationV32_16({...f.observation,responseDigest:sha256('substitute')},f.observer);
  const report=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:signed,registry:f.registry,trust:f.trust,mode:'EXTERNAL_OBSERVED',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(report.findings.includes('transport-lineage-mismatch'),true);
  const tampered={...signTournamentTransportObservationV32_16(f.observation,f.observer),signature:'AAAA'};
  const rejected=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:tampered,registry:f.registry,trust:f.trust,mode:'EXTERNAL_OBSERVED',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(rejected.findings.includes('transport-observation-signature-invalid'),true);
});

test('synthetic evidence cannot satisfy external transport mode', () => {
  const f=fixture('EXTERNAL_PINNED',true);
  const report=evaluateTournamentTransportV32_16({invocation:f.invocation,observation:signTournamentTransportObservationV32_16(f.observation,f.observer),registry:f.registry,trust:f.trust,mode:'EXTERNAL_OBSERVED',now:new Date('2026-07-20T10:00:03.000Z')});
  assert.equal(report.state,'FAILED'); assert.equal(report.findings.includes('transport-external-evidence-insufficient'),true);
});
