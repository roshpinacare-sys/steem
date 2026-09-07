import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../src/contracts/crypto.js';
import {
  evaluateTournamentTransportV32_16,
  signTournamentTransportObservationV32_16,
  type TournamentInvocationV32_16,
  type TournamentTransportObservationV32_16,
  type TournamentTransportTrustV32_16,
} from '../src/benchmark/external-tournament-transport-v32_16.js';
import {
  qualifyWasmRuntimeV32_16,
  type WasmRuntimeQualificationPolicyV32_16,
} from '../src/isolation/wasm-runtime-qualification-v32_16.js';
import { runLocalProcessFailoverLabV32_16 } from '../src/qualification/local-process-failover-lab-v32_16.js';

const here = dirname(fileURLToPath(import.meta.url));
const allowed = readFileSync(join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts', 'allowed.wasm'));
const trapping = Buffer.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,5,3,1,0,1,7,16,2,3,114,117,110,0,0,6,109,101,109,111,114,121,2,0,10,5,1,3,0,0,11]);

function wasmPolicy(overrides: Partial<WasmRuntimeQualificationPolicyV32_16> = {}): WasmRuntimeQualificationPolicyV32_16 {
  return {
    policyDigest: sha256('v32.16-branch-policy'),
    maximumModuleBytes: 1024 * 1024,
    maximumMemoryBytes: 131072,
    maximumExecutionMs: 500,
    requiredRunExport: 'run',
    requiredMemoryExport: 'memory',
    allowedImports: ['cap.emit', 'cap.read_byte'],
    ...overrides,
  };
}

function transportFixture() {
  const observer = generateSigningIdentity('branch-observer-key');
  const registry = new KeyRegistry();
  registry.register(observer.keyId, observer.publicKey);
  const invocation: TournamentInvocationV32_16 = {
    schemaVersion: '32.16', runId: 'branch-run', taskId: 'branch-task', blindLabel: 'blind-branch', providerId: 'provider-a',
    requestDigest: sha256('branch-request'), responseDigest: sha256('branch-response'), nonce: 'branch-nonce',
    startedAt: '2026-07-20T10:00:00.000Z', completedAt: '2026-07-20T10:00:01.000Z', externalResponseId: 'branch-response-id', synthetic: false,
  };
  const observation: TournamentTransportObservationV32_16 = {
    invocationDigest: sha256(invocation), observerId: 'observer-a', observerOrganizationId: 'observer-org', providerId: 'provider-a', providerOrganizationId: 'provider-org',
    transport: 'HTTPS', observedAt: '2026-07-20T10:00:02.000Z', externalResponseId: invocation.externalResponseId,
    requestDigest: invocation.requestDigest, responseDigest: invocation.responseDigest, synthetic: false,
  };
  const trust: TournamentTransportTrustV32_16 = {
    policyDigest: sha256('branch-transport-policy'),
    observerAuthorizations: [{ observerId: observation.observerId, organizationId: observation.observerOrganizationId, keyId: observer.keyId, keyFingerprint: registry.fingerprint(observer.keyId)!, authority: 'EXTERNAL_PINNED' }],
  };
  return { observer, registry, invocation, observation, trust };
}

test('WASM preflight rejects size, input, import duplication and export mismatches before execution', async () => {
  const oversized = await qualifyWasmRuntimeV32_16({
    bytes: Buffer.alloc(65),
    input: [-1, 256, 1.5],
    policy: wasmPolicy({ maximumModuleBytes: 64 }),
  });
  assert.deepEqual(oversized.findings, ['wasm-runtime-module-size-exceeded', 'wasm-runtime-input-invalid']);
  assert.equal(oversized.output, null);
  assert.equal(oversized.memoryBytes, null);

  const contractMismatch = await qualifyWasmRuntimeV32_16({
    bytes: allowed,
    input: [],
    policy: wasmPolicy({ requiredRunExport: 'missing-run', requiredMemoryExport: 'missing-memory', allowedImports: ['cap.emit', 'cap.emit'] }),
  });
  assert.equal(contractMismatch.findings.includes('wasm-runtime-policy-import-duplicate'), true);
  assert.equal(contractMismatch.findings.includes('wasm-runtime-import-contract-mismatch'), true);
  assert.equal(contractMismatch.findings.includes('wasm-runtime-run-export-invalid'), true);
  assert.equal(contractMismatch.findings.includes('wasm-runtime-memory-export-invalid'), true);
});

test('WASM execution traps are classified deterministically and sanitized', async () => {
  const report = await qualifyWasmRuntimeV32_16({ bytes: trapping, input: [], policy: wasmPolicy({ allowedImports: [], maximumMemoryBytes: 65536 }) });
  assert.equal(report.state, 'FAILED');
  assert.deepEqual(report.findings, ['wasm-runtime-execution-failed:unreachable']);
  assert.equal(report.output, null);
  assert.equal(report.memoryBytes, null);
});

test('WASM policy validates every cryptographic, resource, export and import boundary', async () => {
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: wasmPolicy({ policyDigest: 'A'.repeat(64) }) }), /wasm_runtime_policy_digest_invalid/);
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: wasmPolicy({ maximumModuleBytes: 1.1 }) }), /wasm_runtime_policy_limits_invalid/);
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: wasmPolicy({ maximumModuleBytes: 33 * 1024 * 1024 }) }), /wasm_runtime_policy_limits_unbounded/);
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: wasmPolicy({ requiredRunExport: ' ' }) }), /wasm_runtime_policy_export_invalid/);
  await assert.rejects(qualifyWasmRuntimeV32_16({ bytes: allowed, input: [], policy: wasmPolicy({ allowedImports: ['cap.emit', ' '] }) }), /wasm_runtime_policy_import_invalid/);
});

test('transport boundaries reject malformed invocation, trust, clock and authorization shapes', () => {
  const f = transportFixture();
  const signed = signTournamentTransportObservationV32_16(f.observation, f.observer);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('invalid') }), /tournament_transport_time_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, invocation: { ...f.invocation, runId: ' ' }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_invocation_identity_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, invocation: { ...f.invocation, requestDigest: 'bad' }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_invocation_digest_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, invocation: { ...f.invocation, completedAt: '2026-07-20T09:59:59Z' }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_invocation_time_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, trust: { ...f.trust, policyDigest: 'bad' }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_trust_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, trust: { ...f.trust, observerAuthorizations: [f.trust.observerAuthorizations[0]!, f.trust.observerAuthorizations[0]!] }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_trust_invalid/);
  assert.throws(() => evaluateTournamentTransportV32_16({ ...f, trust: { ...f.trust, observerAuthorizations: [{ ...f.trust.observerAuthorizations[0]!, observerId: ' ' }] }, observation: signed, mode: 'EXTERNAL_OBSERVED', now: new Date('2026-07-20T10:00:03Z') }), /tournament_transport_authorization_invalid/);
});

test('transport evaluator accumulates malformed observation, authorization, lineage and time findings', () => {
  const f = transportFixture();
  const valid = signTournamentTransportObservationV32_16(f.observation, f.observer);
  const malformed = {
    ...valid,
    payload: {
      ...valid.payload,
      observerId: '',
      observerOrganizationId: 'other-org',
      providerId: 'other-provider',
      invocationDigest: sha256('other-invocation'),
      externalResponseId: 'other-response',
      requestDigest: sha256('other-request'),
      responseDigest: sha256('other-response-body'),
      observedAt: '2026-07-20T09:59:00.000Z',
    },
  };
  const report = evaluateTournamentTransportV32_16({
    invocation: f.invocation,
    observation: malformed,
    registry: f.registry,
    trust: { ...f.trust, observerAuthorizations: [{ ...f.trust.observerAuthorizations[0]!, keyFingerprint: sha256('wrong-key') }] },
    mode: 'EXTERNAL_OBSERVED',
    now: new Date('2026-07-20T10:00:03Z'),
  });
  assert.equal(report.state, 'FAILED');
  assert.equal(report.findings.includes('transport-observation-shape-invalid'), true);
  assert.equal(report.findings.includes('transport-observation-signature-invalid'), true);
  assert.equal(report.findings.includes('transport-observer-authorization-mismatch'), true);
  assert.equal(report.findings.includes('transport-lineage-mismatch'), true);
  assert.equal(report.findings.includes('transport-observation-time-invalid'), true);
  assert.equal(report.findings.includes('transport-external-evidence-insufficient'), true);
});

test('local failover policy rejects non-integers and every bounded-limit violation', async () => {
  await assert.rejects(runLocalProcessFailoverLabV32_16({ requestCount: 2.5, failAfterRequest: 1, maximumRtoMs: 100, maximumRpoWrites: 0, requestTimeoutMs: 500 }), /local_failover_policy_integer_invalid/);
  await assert.rejects(runLocalProcessFailoverLabV32_16({ requestCount: 10001, failAfterRequest: 1, maximumRtoMs: 100, maximumRpoWrites: 0, requestTimeoutMs: 500 }), /local_failover_policy_request_invalid/);
  await assert.rejects(runLocalProcessFailoverLabV32_16({ requestCount: 2, failAfterRequest: 1, maximumRtoMs: 100, maximumRpoWrites: -1, requestTimeoutMs: 500 }), /local_failover_policy_limit_invalid/);
  await assert.rejects(runLocalProcessFailoverLabV32_16({ requestCount: 2, failAfterRequest: 1, maximumRtoMs: 100, maximumRpoWrites: 0, requestTimeoutMs: 30001 }), /local_failover_policy_limit_invalid/);
});
