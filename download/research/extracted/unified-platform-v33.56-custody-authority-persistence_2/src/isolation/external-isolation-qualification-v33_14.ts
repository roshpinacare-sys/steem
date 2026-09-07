import { constants, existsSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, type SignedEnvelope, type SigningIdentity, sha256, sha256Bytes, signEnvelope } from '../contracts/crypto.js';
import { qualifyWasmRuntimeV32_16, type WasmRuntimeQualificationPolicyV32_16 } from './wasm-runtime-qualification-v32_16.js';

export type ExecutedControlStateV33_14 = 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'PROBE_FAILED';

export interface ExecutedControlProbeV33_14 {
  readonly control: 'openat2' | 'seccomp_strict' | 'cgroup_v2';
  readonly state: ExecutedControlStateV33_14;
  readonly method: string;
  readonly compiler: string | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly detail: string;
  readonly sourceSha256: string | null;
  readonly probeDigest: string;
}

export interface ExecutedHostControlAttestationV33_14 {
  readonly version: '33.14';
  readonly attestationId: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly hostFingerprint: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly kernelRelease: string;
  readonly openat2: ExecutedControlProbeV33_14;
  readonly seccompStrict: ExecutedControlProbeV33_14;
  readonly cgroupV2: ExecutedControlProbeV33_14;
  readonly externalWitness: 'UNAVAILABLE_FAIL_CLOSED';
  readonly productionPromotion: 'blocked';
  readonly limitations: readonly string[];
  readonly attestationDigest: string;
}

export interface PortableSecondRuntimeEvidenceV33_14 {
  readonly version: '33.14';
  readonly evidenceId: string;
  readonly generatedAt: string;
  readonly runtimeImplementation: 'NODE_WEBASSEMBLY_WORKER';
  readonly scope: 'PORTABLE_WASM_CHALLENGES_ONLY';
  readonly state: 'SPECIALIZED_REFERENCE_QUALIFIED' | 'FAILED';
  readonly moduleDigest: string;
  readonly output: number | null;
  readonly memoryBytes: number | null;
  readonly underlyingReportDigest: string;
  readonly generalRepositoryRuntimeQualified: false;
  readonly productionPromotion: 'blocked';
  readonly limitations: readonly string[];
  readonly evidenceDigest: string;
}

export interface ExternalIsolationQualificationChallengeV33_14 {
  readonly version: '33.14';
  readonly challengeId: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly corpusDigest: string;
  readonly adapterContract: 'ISOLATION_RUNTIME_ADAPTER_V33_13';
  readonly requiredDistinctHosts: 2;
  readonly requiredDistinctOrganizations: 2;
  readonly requiredDistinctRuntimeImplementations: 2;
  readonly requiredControls: readonly ['openat2', 'seccomp', 'cgroup_v2', 'network_isolation', 'filesystem_isolation', 'destruction_verification'];
  readonly externalEffectsAllowed: 0;
  readonly promotionCeiling: 'shadow';
  readonly productionPromotion: 'blocked';
  readonly challengeDigest: string;
}

export interface ExternalIsolationObservationV33_14 {
  readonly version: '33.14';
  readonly observationId: string;
  readonly challengeDigest: string;
  readonly observedAt: string;
  readonly hostId: string;
  readonly organizationId: string;
  readonly runtimeImplementation: string;
  readonly executionSignerId: string;
  readonly evidenceClass: 'EXTERNAL_OBSERVED' | 'SYNTHETIC_CONTRACT_TEST';
  readonly openat2Verified: boolean;
  readonly seccompVerified: boolean;
  readonly cgroupV2Verified: boolean;
  readonly networkIsolationVerified: boolean;
  readonly filesystemIsolationVerified: boolean;
  readonly destructionVerified: boolean;
  readonly externalEffectsExecuted: 0;
  readonly evidenceBundleDigest: string;
  readonly observationDigest: string;
}

export interface ExternalIsolationQualificationVerdictV33_14 {
  readonly version: '33.14';
  readonly verdictId: string;
  readonly evaluatedAt: string;
  readonly challengeDigest: string;
  readonly status: 'EXTERNAL_QUALIFIED' | 'EXTERNAL_QUALIFICATION_REQUIRED' | 'REJECTED';
  readonly acceptedObservationCount: number;
  readonly distinctHostCount: number;
  readonly distinctOrganizationCount: number;
  readonly distinctRuntimeImplementationCount: number;
  readonly syntheticObservationCount: number;
  readonly blockers: readonly string[];
  readonly promotionCeiling: 'research' | 'shadow';
  readonly productionPromotion: 'blocked';
  readonly verdictDigest: string;
}

export function executeHostControlAttestationV33_14(input: {
  readonly attestationId: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly signer: SigningIdentity;
}): SignedEnvelope<ExecutedHostControlAttestationV33_14> {
  const generatedAt = parseIso(input.generatedAt, 'control_attestation_generated_at_invalid');
  const validUntil = parseIso(input.validUntil, 'control_attestation_valid_until_invalid');
  if (validUntil <= generatedAt) throw new Error('control_attestation_window_invalid');
  const openat2 = executeCompiledProbe('openat2', OPENAT2_PROBE_SOURCE);
  const seccompStrict = executeCompiledProbe('seccomp_strict', SECCOMP_PROBE_SOURCE);
  const cgroupV2 = executeCgroupProbe();
  const kernelRelease = release();
  const material = {
    version: '33.14' as const,
    attestationId: required(input.attestationId, 'control_attestation_id_required'),
    generatedAt: new Date(generatedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    hostFingerprint: sha256({ platform: platform(), architecture: arch(), kernelRelease }),
    platform: platform(),
    architecture: arch(),
    kernelRelease,
    openat2,
    seccompStrict,
    cgroupV2,
    externalWitness: 'UNAVAILABLE_FAIL_CLOSED' as const,
    productionPromotion: 'blocked' as const,
    limitations: [
      ...(openat2.state === 'VERIFIED_AVAILABLE' ? [] : ['OPENAT2_NOT_QUALIFIED']),
      ...(seccompStrict.state === 'VERIFIED_AVAILABLE' ? [] : ['SECCOMP_NOT_QUALIFIED']),
      ...(cgroupV2.state === 'VERIFIED_AVAILABLE' ? [] : ['CGROUP_V2_NOT_QUALIFIED']),
      'LOCAL_SINGLE_HOST_EXECUTED_PROBES_ONLY',
      'NO_EXTERNAL_INDEPENDENT_WITNESS',
      'NO_MICROVM_OR_HARDWARE_ISOLATION',
    ],
  };
  return signEnvelope({ ...material, attestationDigest: sha256(material) }, input.signer);
}

export function verifyExecutedHostControlAttestationV33_14(input: {
  readonly envelope: SignedEnvelope<ExecutedHostControlAttestationV33_14>;
  readonly keys: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
  readonly at: string;
}): boolean {
  const at = Date.parse(input.at);
  const payload = input.envelope.payload;
  if (!Number.isFinite(at)
    || !input.trustedSignerIds.includes(input.envelope.issuerKeyId)
    || !input.keys.verifyAt(input.envelope, input.at)
    || payload.version !== '33.14'
    || payload.productionPromotion !== 'blocked'
    || Date.parse(payload.generatedAt) > at
    || Date.parse(payload.validUntil) <= at) return false;
  const { attestationDigest, ...material } = payload;
  return sha256(material) === attestationDigest
    && [payload.openat2, payload.seccompStrict, payload.cgroupV2].every((probe) => verifyProbeDigest(probe));
}

export async function qualifyPortableSecondRuntimeV33_14(input: {
  readonly evidenceId: string;
  readonly generatedAt: string;
  readonly bytes: Buffer;
  readonly challengeInput: readonly number[];
  readonly policy: WasmRuntimeQualificationPolicyV32_16;
  readonly signer: SigningIdentity;
}): Promise<SignedEnvelope<PortableSecondRuntimeEvidenceV33_14>> {
  parseIso(input.generatedAt, 'second_runtime_generated_at_invalid');
  const report = await qualifyWasmRuntimeV32_16({ bytes: input.bytes, input: input.challengeInput, policy: input.policy });
  const material = {
    version: '33.14' as const,
    evidenceId: required(input.evidenceId, 'second_runtime_evidence_id_required'),
    generatedAt: input.generatedAt,
    runtimeImplementation: 'NODE_WEBASSEMBLY_WORKER' as const,
    scope: 'PORTABLE_WASM_CHALLENGES_ONLY' as const,
    state: (report.state === 'DRY_RUN_PASSED' ? 'SPECIALIZED_REFERENCE_QUALIFIED' : 'FAILED') as 'SPECIALIZED_REFERENCE_QUALIFIED' | 'FAILED',
    moduleDigest: report.moduleDigest,
    output: report.output,
    memoryBytes: report.memoryBytes,
    underlyingReportDigest: report.reportDigest,
    generalRepositoryRuntimeQualified: false as const,
    productionPromotion: 'blocked' as const,
    limitations: [
      'PORTABLE_WASM_CHALLENGES_ONLY',
      'NOT_A_GENERAL_REPOSITORY_RUNTIME',
      'NODE_WORKER_NOT_OS_SANDBOXED',
      'NO_WASI_COMPONENT_MODEL',
      'NO_EXTERNAL_SECURITY_REVIEW',
    ],
  };
  return signEnvelope({ ...material, evidenceDigest: sha256(material) }, input.signer);
}

export function verifyPortableSecondRuntimeEvidenceV33_14(input: {
  readonly envelope: SignedEnvelope<PortableSecondRuntimeEvidenceV33_14>;
  readonly keys: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
}): boolean {
  const payload = input.envelope.payload;
  const { evidenceDigest, ...material } = payload;
  return input.trustedSignerIds.includes(input.envelope.issuerKeyId)
    && input.keys.verifyAt(input.envelope, payload.generatedAt)
    && payload.version === '33.14'
    && payload.generalRepositoryRuntimeQualified === false
    && payload.productionPromotion === 'blocked'
    && sha256(material) === evidenceDigest;
}

export function createExternalIsolationQualificationChallengeV33_14(input: {
  readonly challengeId: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly corpusDigest: string;
  readonly signer: SigningIdentity;
}): SignedEnvelope<ExternalIsolationQualificationChallengeV33_14> {
  const issuedAt = parseIso(input.issuedAt, 'external_challenge_issued_at_invalid');
  const validUntil = parseIso(input.validUntil, 'external_challenge_valid_until_invalid');
  if (validUntil <= issuedAt) throw new Error('external_challenge_window_invalid');
  if (!/^[a-f0-9]{64}$/.test(input.corpusDigest)) throw new Error('external_challenge_corpus_digest_invalid');
  const material = {
    version: '33.14' as const,
    challengeId: required(input.challengeId, 'external_challenge_id_required'),
    issuedAt: input.issuedAt,
    validUntil: input.validUntil,
    corpusDigest: input.corpusDigest,
    adapterContract: 'ISOLATION_RUNTIME_ADAPTER_V33_13' as const,
    requiredDistinctHosts: 2 as const,
    requiredDistinctOrganizations: 2 as const,
    requiredDistinctRuntimeImplementations: 2 as const,
    requiredControls: ['openat2', 'seccomp', 'cgroup_v2', 'network_isolation', 'filesystem_isolation', 'destruction_verification'] as const,
    externalEffectsAllowed: 0 as const,
    promotionCeiling: 'shadow' as const,
    productionPromotion: 'blocked' as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.signer);
}

export function createExternalIsolationObservationV33_14(input: {
  readonly observationId: string;
  readonly challenge: SignedEnvelope<ExternalIsolationQualificationChallengeV33_14>;
  readonly observedAt: string;
  readonly hostId: string;
  readonly organizationId: string;
  readonly runtimeImplementation: string;
  readonly executionSignerId: string;
  readonly evidenceClass: ExternalIsolationObservationV33_14['evidenceClass'];
  readonly controls: {
    readonly openat2: boolean;
    readonly seccomp: boolean;
    readonly cgroupV2: boolean;
    readonly networkIsolation: boolean;
    readonly filesystemIsolation: boolean;
    readonly destruction: boolean;
  };
  readonly evidenceBundleDigest: string;
  readonly signer: SigningIdentity;
}): SignedEnvelope<ExternalIsolationObservationV33_14> {
  parseIso(input.observedAt, 'external_observation_time_invalid');
  if (!/^[a-f0-9]{64}$/.test(input.evidenceBundleDigest)) throw new Error('external_observation_evidence_digest_invalid');
  const material = {
    version: '33.14' as const,
    observationId: required(input.observationId, 'external_observation_id_required'),
    challengeDigest: input.challenge.payload.challengeDigest,
    observedAt: input.observedAt,
    hostId: required(input.hostId, 'external_observation_host_required'),
    organizationId: required(input.organizationId, 'external_observation_organization_required'),
    runtimeImplementation: required(input.runtimeImplementation, 'external_observation_runtime_required'),
    executionSignerId: required(input.executionSignerId, 'external_observation_execution_signer_required'),
    evidenceClass: input.evidenceClass,
    openat2Verified: input.controls.openat2,
    seccompVerified: input.controls.seccomp,
    cgroupV2Verified: input.controls.cgroupV2,
    networkIsolationVerified: input.controls.networkIsolation,
    filesystemIsolationVerified: input.controls.filesystemIsolation,
    destructionVerified: input.controls.destruction,
    externalEffectsExecuted: 0 as const,
    evidenceBundleDigest: input.evidenceBundleDigest,
  };
  return signEnvelope({ ...material, observationDigest: sha256(material) }, input.signer);
}

export function evaluateExternalIsolationQualificationV33_14(input: {
  readonly verdictId: string;
  readonly evaluatedAt: string;
  readonly challenge: SignedEnvelope<ExternalIsolationQualificationChallengeV33_14>;
  readonly challengeKeys: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly observations: readonly SignedEnvelope<ExternalIsolationObservationV33_14>[];
  readonly observationKeys: KeyRegistry;
  readonly trustedObservationSignerIds: readonly string[];
  readonly signer: SigningIdentity;
}): SignedEnvelope<ExternalIsolationQualificationVerdictV33_14> {
  const evaluatedAt = parseIso(input.evaluatedAt, 'external_verdict_time_invalid');
  const challenge = input.challenge.payload;
  const challengeValid = input.trustedChallengeSignerIds.includes(input.challenge.issuerKeyId)
    && input.challengeKeys.verifyAt(input.challenge, input.evaluatedAt)
    && Date.parse(challenge.issuedAt) <= evaluatedAt
    && Date.parse(challenge.validUntil) > evaluatedAt
    && challenge.productionPromotion === 'blocked';
  const accepted: ExternalIsolationObservationV33_14[] = [];
  const blockers: string[] = [];
  let syntheticObservationCount = 0;
  if (!challengeValid) blockers.push('CHALLENGE_INVALID_OR_EXPIRED');
  for (const envelope of input.observations) {
    const row = envelope.payload;
    const { observationDigest, ...material } = row;
    const valid = input.trustedObservationSignerIds.includes(envelope.issuerKeyId)
      && input.observationKeys.verifyAt(envelope, row.observedAt)
      && sha256(material) === observationDigest
      && row.challengeDigest === challenge.challengeDigest
      && Date.parse(row.observedAt) >= Date.parse(challenge.issuedAt)
      && Date.parse(row.observedAt) < Date.parse(challenge.validUntil)
      && row.externalEffectsExecuted === 0
      && envelope.issuerKeyId !== row.executionSignerId
      && envelope.issuerKeyId !== input.challenge.issuerKeyId;
    if (!valid) {
      blockers.push(`OBSERVATION_INVALID:${row.observationId}`);
      continue;
    }
    if (row.evidenceClass === 'SYNTHETIC_CONTRACT_TEST') {
      syntheticObservationCount += 1;
      continue;
    }
    if (![row.openat2Verified, row.seccompVerified, row.cgroupV2Verified, row.networkIsolationVerified, row.filesystemIsolationVerified, row.destructionVerified].every(Boolean)) {
      blockers.push(`OBSERVATION_CONTROL_INCOMPLETE:${row.observationId}`);
      continue;
    }
    accepted.push(row);
  }
  const distinctHostCount = new Set(accepted.map((row) => row.hostId)).size;
  const distinctOrganizationCount = new Set(accepted.map((row) => row.organizationId)).size;
  const distinctRuntimeImplementationCount = new Set(accepted.map((row) => row.runtimeImplementation)).size;
  if (distinctHostCount < challenge.requiredDistinctHosts) blockers.push('TWO_DISTINCT_HOSTS_REQUIRED');
  if (distinctOrganizationCount < challenge.requiredDistinctOrganizations) blockers.push('TWO_DISTINCT_ORGANIZATIONS_REQUIRED');
  if (distinctRuntimeImplementationCount < challenge.requiredDistinctRuntimeImplementations) blockers.push('TWO_RUNTIME_IMPLEMENTATIONS_REQUIRED');
  if (syntheticObservationCount > 0) blockers.push('SYNTHETIC_OBSERVATIONS_DO_NOT_QUALIFY_EXTERNAL_GATE');
  const externalQualified = challengeValid
    && blockers.length === 0
    && accepted.length >= 2;
  const status: ExternalIsolationQualificationVerdictV33_14['status'] = !challengeValid
    ? 'REJECTED'
    : externalQualified ? 'EXTERNAL_QUALIFIED' : 'EXTERNAL_QUALIFICATION_REQUIRED';
  const material = {
    version: '33.14' as const,
    verdictId: required(input.verdictId, 'external_verdict_id_required'),
    evaluatedAt: input.evaluatedAt,
    challengeDigest: challenge.challengeDigest,
    status,
    acceptedObservationCount: accepted.length,
    distinctHostCount,
    distinctOrganizationCount,
    distinctRuntimeImplementationCount,
    syntheticObservationCount,
    blockers: [...new Set(blockers)].sort(),
    promotionCeiling: (externalQualified ? 'shadow' : 'research') as 'research' | 'shadow',
    productionPromotion: 'blocked' as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.signer);
}

export function verifyExternalIsolationQualificationVerdictV33_14(input: {
  readonly envelope: SignedEnvelope<ExternalIsolationQualificationVerdictV33_14>;
  readonly keys: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
}): boolean {
  const payload = input.envelope.payload;
  const { verdictDigest, ...material } = payload;
  return input.trustedSignerIds.includes(input.envelope.issuerKeyId)
    && input.keys.verifyAt(input.envelope, payload.evaluatedAt)
    && payload.version === '33.14'
    && payload.productionPromotion === 'blocked'
    && sha256(material) === verdictDigest;
}

function executeCompiledProbe(control: 'openat2' | 'seccomp_strict', source: string): ExecutedControlProbeV33_14 {
  const compiler = compilerPath();
  const sourceSha256 = sha256(source);
  if (compiler === null) return finalizeProbe({ control, state: 'PROBE_FAILED', method: 'COMPILED_KERNEL_PROBE', compiler: null, exitCode: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from('compiler-unavailable'), detail: 'COMPILER_UNAVAILABLE', sourceSha256 });
  const root = mkdtempSync(join(tmpdir(), `v33-14-${control}-`));
  try {
    const sourcePath = join(root, 'probe.c');
    const binaryPath = join(root, 'probe');
    writeFileSync(sourcePath, source);
    const compile = spawnSync(compiler, ['-O2', '-Wall', '-Wextra', '-Werror', '-o', binaryPath, sourcePath], { encoding: 'buffer', timeout: 15_000 });
    if (compile.status !== 0 || !existsSync(binaryPath)) return finalizeProbe({ control, state: 'PROBE_FAILED', method: 'COMPILED_KERNEL_PROBE', compiler, exitCode: compile.status, signal: compile.signal, stdout: toBuffer(compile.stdout), stderr: toBuffer(compile.stderr), detail: 'COMPILE_FAILED', sourceSha256 });
    if (control === 'openat2') writeFileSync(join(root, 'probe.txt'), 'probe\n');
    const run = spawnSync(binaryPath, control === 'openat2' ? [root] : [], { encoding: 'buffer', timeout: 5_000 });
    const stdout = toBuffer(run.stdout);
    const stderr = toBuffer(run.stderr);
    const text = `${stdout.toString('utf8')} ${stderr.toString('utf8')}`;
    const state: ExecutedControlStateV33_14 = run.status === 0
      ? 'VERIFIED_AVAILABLE'
      : run.status === 2 || /UNAVAILABLE|ERRNO=38|SECCOMP_ERRNO=22/.test(text)
        ? 'VERIFIED_UNAVAILABLE'
        : 'PROBE_FAILED';
    return finalizeProbe({ control, state, method: 'COMPILED_KERNEL_PROBE', compiler, exitCode: run.status, signal: run.signal, stdout, stderr, detail: bounded(text), sourceSha256 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function executeCgroupProbe(): ExecutedControlProbeV33_14 {
  let state: ExecutedControlStateV33_14 = 'VERIFIED_UNAVAILABLE';
  let detail = 'CGROUP_V2_NOT_MOUNTED_OR_NOT_DELEGATED';
  try {
    const stat = statfsSync('/sys/fs/cgroup');
    const cgroup2Magic = 0x63677270;
    const controllers = existsSync('/sys/fs/cgroup/cgroup.controllers') ? readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8').trim() : '';
    const writable = spawnSync('/bin/sh', ['-c', 'test -w /sys/fs/cgroup && test -w /sys/fs/cgroup/cgroup.procs'], { timeout: 2_000 }).status === 0;
    if (Number(stat.type) === cgroup2Magic && writable && controllers !== '') {
      state = 'VERIFIED_AVAILABLE';
      detail = `CGROUP_V2_DELEGATED:${controllers}`;
    } else detail = `CGROUP_FS_TYPE=${String(stat.type)};WRITABLE=${String(writable)};CONTROLLERS=${controllers}`;
  } catch (error) {
    state = 'PROBE_FAILED';
    detail = error instanceof Error ? error.message : String(error);
  }
  return finalizeProbe({ control: 'cgroup_v2', state, method: 'CGROUP_V2_FILESYSTEM_AND_DELEGATION_PROBE', compiler: null, exitCode: state === 'VERIFIED_AVAILABLE' ? 0 : 2, signal: null, stdout: Buffer.from(detail), stderr: Buffer.alloc(0), detail: bounded(detail), sourceSha256: null });
}

function finalizeProbe(input: {
  readonly control: ExecutedControlProbeV33_14['control'];
  readonly state: ExecutedControlStateV33_14;
  readonly method: string;
  readonly compiler: string | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly detail: string;
  readonly sourceSha256: string | null;
}): ExecutedControlProbeV33_14 {
  const material = {
    control: input.control,
    state: input.state,
    method: input.method,
    compiler: input.compiler,
    exitCode: input.exitCode,
    signal: input.signal,
    stdoutSha256: sha256Bytes(input.stdout),
    stderrSha256: sha256Bytes(input.stderr),
    detail: input.detail,
    sourceSha256: input.sourceSha256,
  };
  return { ...material, probeDigest: sha256(material) };
}

function verifyProbeDigest(probe: ExecutedControlProbeV33_14): boolean {
  const { probeDigest, ...material } = probe;
  return sha256(material) === probeDigest;
}

function compilerPath(): string | null {
  for (const name of ['gcc', 'cc', 'clang']) {
    const result = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', timeout: 2_000 });
    const value = result.status === 0 ? result.stdout.trim() : '';
    if (value !== '') return value;
  }
  return null;
}

function bounded(value: string): string { return value.trim().replaceAll(/\s+/g, ' ').slice(0, 500); }
function required(value: string, code: string): string { if (value.trim() === '') throw new Error(code); return value; }
function parseIso(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code); return parsed; }
function toBuffer(value: string | Buffer | null | undefined): Buffer { return Buffer.isBuffer(value) ? value : Buffer.from(value ?? ''); }

const OPENAT2_PROBE_SOURCE = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 2) return 3;
  int dirfd = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (dirfd < 0) return 4;
  struct open_how how = {0};
  how.flags = O_RDONLY | O_CLOEXEC;
  how.resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS;
  int fd = syscall(SYS_openat2, dirfd, "probe.txt", &how, sizeof(how));
  if (fd >= 0) { close(fd); close(dirfd); puts("AVAILABLE"); return 0; }
  int saved = errno;
  close(dirfd);
  printf("ERRNO=%d:%s\n", saved, strerror(saved));
  return saved == ENOSYS ? 2 : 1;
}
`;

const SECCOMP_PROBE_SOURCE = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
int main(void) {
  pid_t child = fork();
  if (child < 0) return 3;
  if (child == 0) {
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) _exit(10);
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_STRICT, 0, 0, 0) != 0) _exit(100 + errno);
    syscall(SYS_getpid);
    _exit(11);
  }
  int status = 0;
  if (waitpid(child, &status, 0) < 0) return 4;
  if (WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL) { puts("AVAILABLE"); return 0; }
  if (WIFEXITED(status)) {
    int code = WEXITSTATUS(status);
    if (code >= 100) { printf("SECCOMP_ERRNO=%d\n", code - 100); return 2; }
    printf("CHILD_EXIT=%d\n", code); return 1;
  }
  return 1;
}
`;
