import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  sha256Bytes,
  signEnvelope,
} from '../contracts/crypto.js';
import {
  type RepositoryAdmissionPolicyV33_11,
  type RepositoryAdmissionReportV33_11,
  scanRepositoryAdmissionV33_11,
  verifyRepositoryAdmissionReportV33_11,
} from '../repository/malicious-repository-admission-v33_11.js';

export interface QualifiedHostileCodeIsolationPolicyV33_12 {
  readonly version: '33.12';
  readonly policyId: string;
  readonly runtime: 'LOCAL_LINUX_USER_MOUNT_NET_PID_NAMESPACE_REFERENCE';
  readonly allowedEntrypointExtensions: readonly ['.sh'];
  readonly maximumDurationMs: number;
  readonly maximumCpuSeconds: number;
  readonly maximumMemoryBytes: number;
  readonly maximumProcesses: number;
  readonly maximumFileBytes: number;
  readonly maximumOpenFiles: number;
  readonly maximumWorkspaceBytes: number;
  readonly maximumOutputBytes: number;
  readonly inputBoundary: 'READ_ONLY_BIND_NOEXEC';
  readonly workspaceBoundary: 'BOUNDED_TMPFS_NOEXEC';
  readonly networkBoundary: 'EMPTY_NETWORK_NAMESPACE';
  readonly environmentBoundary: 'EMPTY_ALLOWLIST_ONLY';
  readonly secretInjectionAllowed: false;
  readonly noNewPrivilegesRequired: true;
  readonly dropCapabilitiesRequired: true;
  readonly runtimeUid: 65534;
  readonly runtimeGid: 65534;
  readonly seccompProfile: 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME';
  readonly cgroupEnforcement: 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME';
  readonly externalQualification: 'required';
  readonly productionPromotion: 'blocked';
  readonly policyDigest: string;
}

export interface IsolationChallengeAuthorizationV33_12 {
  readonly version: '33.12';
  readonly authorizationId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly admissionReportDigest: string;
  readonly entrypointPath: string;
  readonly entrypointDigest: string;
  readonly purpose: 'ADVERSARIAL_QUALIFICATION_FIXTURE_ONLY';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly externalEffectsAllowed: false;
  readonly productionPromotion: 'blocked';
  readonly authorizationDigest: string;
}

export interface IsolationRuntimeProbeV33_12 {
  readonly available: boolean;
  readonly platform: NodeJS.Platform;
  readonly commands: Readonly<Record<'unshare' | 'mount' | 'chroot' | 'prlimit' | 'timeout' | 'busybox' | 'setpriv', string | null>>;
  readonly combinedNamespaceProbePassed: boolean;
  readonly limitationCodes: readonly string[];
  readonly probeDigest: string;
}

export type QualifiedIsolationTerminationV33_12 =
  | 'COMPLETED'
  | 'WALL_TIME_LIMIT'
  | 'CPU_OR_RESOURCE_LIMIT'
  | 'OUTPUT_LIMIT'
  | 'RUNTIME_SETUP_FAILED';

export interface QualifiedIsolationReceiptV33_12 {
  readonly version: '33.12';
  readonly receiptId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly admissionReportDigest: string;
  readonly challengeAuthorizationDigest?: string;
  readonly policyDigest: string;
  readonly entrypointPath: string;
  readonly entrypointDigest: string;
  readonly argumentsDigest: string;
  readonly runtime: 'LOCAL_LINUX_USER_MOUNT_NET_PID_NAMESPACE_REFERENCE';
  readonly evidenceClass: 'LOCAL_LINUX_NAMESPACE_ISOLATION_REFERENCE';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly termination: QualifiedIsolationTerminationV33_12;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly sourceDigestBefore: string;
  readonly sourceDigestAfter: string;
  readonly sourceUnchanged: boolean;
  readonly namespaceProbePassed: boolean;
  readonly networkDisabledObserved: boolean;
  readonly hostFilesystemBlockedObserved: boolean;
  readonly procRootEscapeBlockedObserved: boolean;
  readonly inputReadOnlyObserved: boolean;
  readonly workspaceWritableObserved: boolean;
  readonly runtimeUidObserved: 65534 | null;
  readonly noNewPrivilegesObserved: boolean;
  readonly capabilitiesDroppedObserved: boolean;
  readonly environmentSanitizedObserved: boolean;
  readonly processLimitObserved: boolean;
  readonly fileSizeLimitObserved: boolean;
  readonly memoryLimitObserved: boolean;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutExcerpt: string;
  readonly stderrExcerpt: string;
  readonly runtimeRootDestroyed: boolean;
  readonly workspaceDestroyed: boolean;
  readonly commandsExecuted: 1;
  readonly externalEffectsExecuted: 0;
  readonly secretsInjected: 0;
  readonly productionPromotion: 'blocked';
  readonly externalQualification: 'not_executed';
  readonly limitations: readonly string[];
  readonly receiptDigest: string;
}

const REQUIRED_COMMANDS = ['unshare', 'mount', 'chroot', 'prlimit', 'timeout', 'busybox', 'setpriv'] as const;
const APPLETS = ['ash', 'awk', 'cat', 'cp', 'cut', 'dd', 'env', 'find', 'head', 'id', 'ls', 'mkdir', 'nc', 'ps', 'rm', 'seq', 'sha256sum', 'sh', 'sleep', 'sort', 'stat', 'timeout', 'touch', 'tr', 'wc', 'wget', 'xargs', 'yes'] as const;
const PROBE_PREFIX = 'V33_12_PROBE_';

export function createQualifiedHostileCodeIsolationPolicyV33_12(input: {
  readonly policyId: string;
  readonly maximumDurationMs?: number;
  readonly maximumCpuSeconds?: number;
  readonly maximumMemoryBytes?: number;
  readonly maximumProcesses?: number;
  readonly maximumFileBytes?: number;
  readonly maximumOpenFiles?: number;
  readonly maximumWorkspaceBytes?: number;
  readonly maximumOutputBytes?: number;
}): QualifiedHostileCodeIsolationPolicyV33_12 {
  const material = {
    version: '33.12' as const,
    policyId: required(input.policyId, 'isolation_policy_id_required'),
    runtime: 'LOCAL_LINUX_USER_MOUNT_NET_PID_NAMESPACE_REFERENCE' as const,
    allowedEntrypointExtensions: ['.sh'] as const,
    maximumDurationMs: bounded(input.maximumDurationMs ?? 2_000, 100, 30_000, 'isolation_duration_invalid'),
    maximumCpuSeconds: bounded(input.maximumCpuSeconds ?? 2, 1, 30, 'isolation_cpu_invalid'),
    maximumMemoryBytes: bounded(input.maximumMemoryBytes ?? 64 * 1024 * 1024, 32 * 1024 * 1024, 1024 * 1024 * 1024, 'isolation_memory_invalid'),
    maximumProcesses: bounded(input.maximumProcesses ?? 16, 4, 128, 'isolation_process_limit_invalid'),
    maximumFileBytes: bounded(input.maximumFileBytes ?? 1024 * 1024, 4096, 64 * 1024 * 1024, 'isolation_file_limit_invalid'),
    maximumOpenFiles: bounded(input.maximumOpenFiles ?? 64, 16, 1024, 'isolation_open_file_limit_invalid'),
    maximumWorkspaceBytes: bounded(input.maximumWorkspaceBytes ?? 4 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024, 'isolation_workspace_limit_invalid'),
    maximumOutputBytes: bounded(input.maximumOutputBytes ?? 512 * 1024, 4096, 8 * 1024 * 1024, 'isolation_output_limit_invalid'),
    inputBoundary: 'READ_ONLY_BIND_NOEXEC' as const,
    workspaceBoundary: 'BOUNDED_TMPFS_NOEXEC' as const,
    networkBoundary: 'EMPTY_NETWORK_NAMESPACE' as const,
    environmentBoundary: 'EMPTY_ALLOWLIST_ONLY' as const,
    secretInjectionAllowed: false as const,
    noNewPrivilegesRequired: true as const,
    dropCapabilitiesRequired: true as const,
    runtimeUid: 65534 as const,
    runtimeGid: 65534 as const,
    seccompProfile: 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME' as const,
    cgroupEnforcement: 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME' as const,
    externalQualification: 'required' as const,
    productionPromotion: 'blocked' as const,
  };
  if (material.maximumFileBytes > material.maximumWorkspaceBytes) throw new Error('isolation_file_workspace_relationship_invalid');
  return { ...material, policyDigest: sha256(material) };
}

export function createIsolationChallengeAuthorizationV33_12(input: Omit<IsolationChallengeAuthorizationV33_12, 'version' | 'purpose' | 'externalEffectsAllowed' | 'productionPromotion' | 'authorizationDigest'>): IsolationChallengeAuthorizationV33_12 {
  const issued = parseIso(input.issuedAt, 'isolation_authorization_issued_at_invalid');
  const expires = parseIso(input.expiresAt, 'isolation_authorization_expires_at_invalid');
  if (expires <= issued) throw new Error('isolation_authorization_window_invalid');
  const material = {
    version: '33.12' as const,
    authorizationId: required(input.authorizationId, 'isolation_authorization_id_required'),
    tenantId: required(input.tenantId, 'isolation_authorization_tenant_required'),
    repositoryId: required(input.repositoryId, 'isolation_authorization_repository_required'),
    admissionReportDigest: digest(input.admissionReportDigest, 'isolation_authorization_report_digest_invalid'),
    entrypointPath: safeRelativeEntrypoint(input.entrypointPath),
    entrypointDigest: digest(input.entrypointDigest, 'isolation_authorization_entrypoint_digest_invalid'),
    purpose: 'ADVERSARIAL_QUALIFICATION_FIXTURE_ONLY' as const,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    externalEffectsAllowed: false as const,
    productionPromotion: 'blocked' as const,
  };
  return { ...material, authorizationDigest: sha256(material) };
}

export function probeQualifiedHostIsolationV33_12(): IsolationRuntimeProbeV33_12 {
  const commands = Object.fromEntries(REQUIRED_COMMANDS.map((name) => [name, commandPath(name)])) as Record<(typeof REQUIRED_COMMANDS)[number], string | null>;
  let combinedNamespaceProbePassed = false;
  if (process.platform === 'linux' && Object.values(commands).every((value) => value !== null)) {
    const hostNamespaceIds = {
      user: readNamespaceId('/proc/self/ns/user'),
      mount: readNamespaceId('/proc/self/ns/mnt'),
      network: readNamespaceId('/proc/self/ns/net'),
      pid: readNamespaceId('/proc/self/ns/pid'),
      ipc: readNamespaceId('/proc/self/ns/ipc'),
      uts: readNamespaceId('/proc/self/ns/uts'),
    };
    const probeRoot = mkdtempSync(join(tmpdir(), 'v33-12-probe-'));
    const bindSource = join(probeRoot, 'bind-source');
    const bindTarget = join(probeRoot, 'bind-target');
    const workspace = join(probeRoot, 'workspace');
    const sealedProc = join(probeRoot, 'sealed-proc');
    const devNull = join(probeRoot, 'dev-null');
    mkdirSync(bindSource, { recursive: true });
    mkdirSync(bindTarget, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sealedProc, { recursive: true });
    writeFileSync(join(bindSource, 'probe.txt'), 'probe');
    writeFileSync(devNull, '');
    try {
      const result = spawnSync(commands.unshare!, [
        '--user',
        '--map-users=0:0:1',
        '--map-users=65534:65534:1',
        '--map-groups=0:0:1',
        '--map-groups=65534:65534:1',
        '--mount',
        '--net',
        '--pid',
        '--ipc',
        '--uts',
        '--fork',
        '/bin/sh',
        '-ceu',
        [
          'test "$(id -u)" = 0',
          'test "$(readlink /proc/self/ns/user)" != "$HOST_USER_NS"',
          'test "$(readlink /proc/self/ns/mnt)" != "$HOST_MOUNT_NS"',
          'test "$(readlink /proc/self/ns/net)" != "$HOST_NETWORK_NS"',
          'test "$(readlink /proc/self/ns/pid)" != "$HOST_PID_NS"',
          'test "$(readlink /proc/self/ns/ipc)" != "$HOST_IPC_NS"',
          'test "$(readlink /proc/self/ns/uts)" != "$HOST_UTS_NS"',
          'mount --make-rprivate /',
          'mount --bind "$PROBE_BIND_SOURCE" "$PROBE_BIND_TARGET"',
          'mount -o remount,bind,ro,nosuid,nodev,noexec "$PROBE_BIND_TARGET"',
          'mount -t tmpfs -o size=65536,nosuid,nodev,noexec tmpfs "$PROBE_WORKSPACE"',
          'mount -t tmpfs -o size=65536,nosuid,nodev,noexec,ro tmpfs "$PROBE_SEALED_PROC"',
          'mount --bind /dev/null "$PROBE_DEV_NULL"',
          'test -r "$PROBE_BIND_TARGET/probe.txt"',
          '! echo forbidden > "$PROBE_BIND_TARGET/probe.txt" 2>/dev/null',
          'echo allowed > "$PROBE_WORKSPACE/write.txt"',
          'test ! -e "$PROBE_SEALED_PROC/1/root"',
        ].join(' && '),
      ], {
        encoding: 'utf8',
        timeout: 3_000,
        env: {
          PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
          HOST_USER_NS: hostNamespaceIds.user,
          HOST_MOUNT_NS: hostNamespaceIds.mount,
          HOST_NETWORK_NS: hostNamespaceIds.network,
          HOST_PID_NS: hostNamespaceIds.pid,
          HOST_IPC_NS: hostNamespaceIds.ipc,
          HOST_UTS_NS: hostNamespaceIds.uts,
          PROBE_BIND_SOURCE: bindSource,
          PROBE_BIND_TARGET: bindTarget,
          PROBE_WORKSPACE: workspace,
          PROBE_SEALED_PROC: sealedProc,
          PROBE_DEV_NULL: devNull,
        },
      });
      combinedNamespaceProbePassed = result.status === 0 && result.error === undefined;
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  }
  const limitationCodes = [
    'LOCAL_SINGLE_HOST_REFERENCE_ONLY',
    'SEALED_EMPTY_PROCFS_REFERENCE',
    'NO_SECCOMP_PROFILE',
    'NO_CGROUP_V2_ENFORCEMENT',
    'NO_MICROVM_OR_HARDWARE_ISOLATION',
    'NO_INDEPENDENT_EXTERNAL_REVIEW',
    'NO_PRODUCTION_AUTHORITY',
  ];
  const material = { available: process.platform === 'linux' && Object.values(commands).every((value) => value !== null) && combinedNamespaceProbePassed, platform: process.platform, commands, combinedNamespaceProbePassed, limitationCodes };
  return { ...material, probeDigest: sha256(material) };
}

export function executeQualifiedHostileCodeV33_12(input: {
  readonly root: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly admissionEnvelope: SignedEnvelope<RepositoryAdmissionReportV33_11>;
  readonly admissionKeys: KeyRegistry;
  readonly admissionPolicy: RepositoryAdmissionPolicyV33_11;
  readonly trustedAdmissionSignerIds: readonly string[];
  readonly policy: QualifiedHostileCodeIsolationPolicyV33_12;
  readonly entrypointPath: string;
  readonly args?: readonly string[];
  readonly challengeAuthorization?: SignedEnvelope<IsolationChallengeAuthorizationV33_12>;
  readonly challengeKeys?: KeyRegistry;
  readonly trustedChallengeSignerIds?: readonly string[];
  readonly signer: SigningIdentity;
  readonly receiptId: string;
  readonly startedAt: string;
}): SignedEnvelope<QualifiedIsolationReceiptV33_12> {
  verifyPolicy(input.policy);
  const runtimeProbe = probeQualifiedHostIsolationV33_12();
  if (!runtimeProbe.available) throw new Error('qualified_isolation_runtime_unavailable');
  const startedAtMs = parseIso(input.startedAt, 'isolation_started_at_invalid');
  if (!verifyRepositoryAdmissionReportV33_11({ envelope: input.admissionEnvelope, keys: input.admissionKeys, trustedSignerIds: input.trustedAdmissionSignerIds })) throw new Error('isolation_admission_report_invalid');
  const report = input.admissionEnvelope.payload;
  if (report.tenantId !== input.tenantId || report.repositoryId !== input.repositoryId) throw new Error('isolation_admission_binding_invalid');
  const reportDigest = report.reportDigest;
  if (input.admissionPolicy.policyDigest !== report.policyDigest) throw new Error('isolation_admission_policy_binding_invalid');
  const root = resolve(input.root);
  const sourceDigestBefore = repositorySnapshotDigest(root);
  const runtimeBase = mkdtempSync(join(tmpdir(), 'v33-12-runtime-'));
  const rootfs = join(runtimeBase, 'rootfs');
  const inputSnapshot = join(runtimeBase, 'input-snapshot');
  try {
    createReadOnlyInputSnapshot(root, inputSnapshot);
  const sourceDigestAfterSnapshot = repositorySnapshotDigest(root);
  if (sourceDigestAfterSnapshot !== sourceDigestBefore) { rmSync(runtimeBase, { recursive: true, force: true }); throw new Error('isolation_source_changed_during_snapshot'); }
  const current = scanRepositoryAdmissionV33_11({ root: inputSnapshot, tenantId: input.tenantId, repositoryId: input.repositoryId, policy: input.admissionPolicy, signer: input.signer, generatedAt: new Date(startedAtMs).toISOString() }).payload;
  if (current.repositoryRootDigest !== report.repositoryRootDigest
    || current.scannedFileCount !== report.scannedFileCount
    || current.scannedTotalBytes !== report.scannedTotalBytes
    || current.decision !== report.decision
    || current.blockingFindingCount !== report.blockingFindingCount
    || sha256(current.findings) !== sha256(report.findings)) { rmSync(runtimeBase, { recursive: true, force: true }); throw new Error('isolation_admission_report_stale'); }
  const entrypointPath = safeRelativeEntrypoint(input.entrypointPath);
  const entrypointAbsolute = resolve(inputSnapshot, entrypointPath);
  ensureInside(inputSnapshot, entrypointAbsolute);
  const entryStat = lstatSync(entrypointAbsolute);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) { rmSync(runtimeBase, { recursive: true, force: true }); throw new Error('isolation_entrypoint_invalid'); }
  const entrypointDigest = sha256Bytes(readFileSync(entrypointAbsolute));
  const challengeDigest = authorizeExecution({ ...input, report, reportDigest, entrypointPath, entrypointDigest, startedAtMs });
  const executionStartedAtMs = Date.now();
  const args = [...(input.args ?? [])].map((value) => validateArg(value));
  let result: ReturnType<typeof spawnSync>;
  let completedAtMs = Date.now();
  try {
    buildMinimalRootfs(rootfs);
    const commandPaths = runtimeProbe.commands;
    const wrapper = createNamespaceWrapper({ rootfs, repositoryRoot: inputSnapshot, entrypointPath, args, policy: input.policy, tenantId: input.tenantId, repositoryId: input.repositoryId });
    result = spawnSync(commandPaths.timeout!, [
      '--signal=TERM',
      '--kill-after=1s',
      `${Math.ceil(input.policy.maximumDurationMs / 1000)}s`,
      commandPaths.unshare!,
      '--user',
      '--map-users=0:0:1',
      '--map-users=65534:65534:1',
      '--map-groups=0:0:1',
      '--map-groups=65534:65534:1',
      '--mount',
      '--net',
      '--pid',
      '--ipc',
      '--uts',
      '--fork',
      '/bin/sh',
      '-ceu',
      wrapper,
    ], {
      encoding: 'buffer',
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        ROOTFS: rootfs,
        REPOSITORY_ROOT: inputSnapshot,
      },
      maxBuffer: input.policy.maximumOutputBytes,
      timeout: input.policy.maximumDurationMs + 4_000,
      killSignal: 'SIGKILL',
    });
    completedAtMs = Date.now();
  } catch (error) {
    rmSync(runtimeBase, { recursive: true, force: true });
    throw error;
  }
  const stdout = toBuffer(result.stdout);
  const stderr = toBuffer(result.stderr);
  const probes = parseProbes(stdout.toString('utf8'));
  const sourceDigestAfter = repositorySnapshotDigest(root);
  rmSync(runtimeBase, { recursive: true, force: true });
  const runtimeRootDestroyed = !existsSync(runtimeBase);
  const timedOut = result.status === 124 || result.signal === 'SIGKILL' || result.error?.name === 'ETIMEDOUT';
  const termination = classifyTermination(result, timedOut, stderr.toString('utf8'));
  const stderrText = stderr.toString('utf8');
  const material = {
    version: '33.12' as const,
    receiptId: required(input.receiptId, 'isolation_receipt_id_required'),
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    admissionReportDigest: reportDigest,
    ...(challengeDigest === undefined ? {} : { challengeAuthorizationDigest: challengeDigest }),
    policyDigest: input.policy.policyDigest,
    entrypointPath,
    entrypointDigest,
    argumentsDigest: sha256(args),
    runtime: input.policy.runtime,
    evidenceClass: 'LOCAL_LINUX_NAMESPACE_ISOLATION_REFERENCE' as const,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - executionStartedAtMs),
    termination,
    exitCode: result.status,
    signal: result.signal,
    timedOut,
    sourceDigestBefore,
    sourceDigestAfter,
    sourceUnchanged: sourceDigestBefore === sourceDigestAfter,
    namespaceProbePassed: runtimeProbe.combinedNamespaceProbePassed,
    networkDisabledObserved: probes.NETWORK === 'BLOCKED',
    hostFilesystemBlockedObserved: probes.HOST_FS === 'BLOCKED',
    procRootEscapeBlockedObserved: probes.PROC_ROOT === 'BLOCKED',
    inputReadOnlyObserved: probes.INPUT_WRITE === 'BLOCKED',
    workspaceWritableObserved: probes.WORKSPACE_WRITE === 'ALLOWED',
    runtimeUidObserved: probes.UID === '65534' ? 65534 as const : null,
    noNewPrivilegesObserved: probes.NO_NEW_PRIVS === '1',
    capabilitiesDroppedObserved: probes.CAP_BOUNDING === '[none]' && probes.CAP_INHERITABLE === '[none]' && probes.CAP_AMBIENT === '[none]',
    environmentSanitizedObserved: probes.ENVIRONMENT === 'SANITIZED',
    processLimitObserved: /cannot fork|resource temporarily unavailable/i.test(stderrText),
    fileSizeLimitObserved: /file size limit/i.test(stderrText) || result.status === 153,
    memoryLimitObserved: /out of memory|cannot allocate memory|allocation failed/i.test(stderrText) || result.status === 137,
    stdoutSha256: sha256Bytes(stdout),
    stderrSha256: sha256Bytes(stderr),
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdoutExcerpt: boundedExcerpt(stdout.toString('utf8')),
    stderrExcerpt: boundedExcerpt(stderr.toString('utf8')),
    runtimeRootDestroyed,
    workspaceDestroyed: runtimeRootDestroyed,
    commandsExecuted: 1 as const,
    externalEffectsExecuted: 0 as const,
    secretsInjected: 0 as const,
    productionPromotion: 'blocked' as const,
    externalQualification: 'not_executed' as const,
    limitations: [
      ...runtimeProbe.limitationCodes,
      'SHELL_ENTRYPOINTS_ONLY',
      'LOCAL_KERNEL_AND_HOST_TRUSTED',
      'NETWORK_BLOCK_OBSERVED_IN_EMPTY_NAMESPACE_NOT_INDEPENDENTLY_WITNESSED',
      'RLIMITS_NOT_CGROUP_ACCOUNTING',
    ],
  };
    return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.signer);
  } catch (error) {
    rmSync(runtimeBase, { recursive: true, force: true });
    throw error;
  }
}

export function verifyQualifiedIsolationReceiptV33_12(input: {
  readonly envelope: SignedEnvelope<QualifiedIsolationReceiptV33_12>;
  readonly keys: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
}): boolean {
  const receipt = input.envelope.payload;
  if (!input.trustedSignerIds.includes(input.envelope.issuerKeyId) || !input.keys.verifyAt(input.envelope, receipt.completedAt)) return false;
  const { receiptDigest, ...material } = receipt;
  return receipt.version === '33.12'
    && receipt.runtime === 'LOCAL_LINUX_USER_MOUNT_NET_PID_NAMESPACE_REFERENCE'
    && receipt.evidenceClass === 'LOCAL_LINUX_NAMESPACE_ISOLATION_REFERENCE'
    && receipt.productionPromotion === 'blocked'
    && receipt.externalQualification === 'not_executed'
    && receipt.externalEffectsExecuted === 0
    && receipt.secretsInjected === 0
    && receipt.commandsExecuted === 1
    && sha256(material) === receiptDigest;
}

function authorizeExecution(input: {
  readonly report: RepositoryAdmissionReportV33_11;
  readonly reportDigest: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly entrypointPath: string;
  readonly entrypointDigest: string;
  readonly startedAtMs: number;
  readonly admissionEnvelope: SignedEnvelope<RepositoryAdmissionReportV33_11>;
  readonly challengeAuthorization?: SignedEnvelope<IsolationChallengeAuthorizationV33_12>;
  readonly challengeKeys?: KeyRegistry;
  readonly trustedChallengeSignerIds?: readonly string[];
}): string | undefined {
  if (input.report.decision === 'QUALIFIED_ISOLATION_REQUIRED' && input.report.blockingFindingCount === 0) return undefined;
  if (input.report.decision !== 'QUARANTINE' || input.report.blockingFindingCount <= 0) throw new Error('isolation_admission_decision_invalid');
  const envelope = input.challengeAuthorization;
  const keys = input.challengeKeys;
  const trusted = input.trustedChallengeSignerIds ?? [];
  if (envelope === undefined || keys === undefined || !trusted.includes(envelope.issuerKeyId) || envelope.issuerKeyId === input.admissionEnvelope.issuerKeyId || !keys.verifyAt(envelope, new Date(input.startedAtMs))) throw new Error('isolation_challenge_authorization_invalid');
  const authorization = envelope.payload;
  const { authorizationDigest, ...material } = authorization;
  if (authorization.version !== '33.12'
    || sha256(material) !== authorizationDigest
    || authorization.tenantId !== input.tenantId
    || authorization.repositoryId !== input.repositoryId
    || authorization.admissionReportDigest !== input.reportDigest
    || authorization.entrypointPath !== input.entrypointPath
    || authorization.entrypointDigest !== input.entrypointDigest
    || authorization.purpose !== 'ADVERSARIAL_QUALIFICATION_FIXTURE_ONLY'
    || authorization.externalEffectsAllowed
    || authorization.productionPromotion !== 'blocked'
    || Date.parse(authorization.issuedAt) > input.startedAtMs
    || Date.parse(authorization.expiresAt) <= input.startedAtMs) throw new Error('isolation_challenge_authorization_binding_invalid');
  return authorization.authorizationDigest;
}

function createNamespaceWrapper(input: {
  readonly rootfs: string;
  readonly repositoryRoot: string;
  readonly entrypointPath: string;
  readonly args: readonly string[];
  readonly policy: QualifiedHostileCodeIsolationPolicyV33_12;
  readonly tenantId: string;
  readonly repositoryId: string;
}): string {
  const command = ['/bin/sh', `/input/${input.entrypointPath}`, ...input.args].map(shellQuote).join(' ');
  const cleanEnv = [
    '/bin/env', '-i',
    'PATH=/bin',
    'HOME=/workspace',
    'TMPDIR=/tmp',
    `TENANT_ID=${input.tenantId}`,
    `REPOSITORY_ID=${input.repositoryId}`,
  ].map(shellQuote).join(' ');
  const probe = [
    'echo "V33_12_PROBE_UID=$(id -u)"',
    'nnp=$(/usr/bin/setpriv --dump 2>/dev/null | awk -F: \'/no_new_privs/ {gsub(/ /,"",$2); print $2}\'); echo "V33_12_PROBE_NO_NEW_PRIVS=$nnp"',
    `dump=$(/usr/bin/setpriv --dump 2>/dev/null); bounding=$(printf "%s\n" "$dump" | awk -F: '/Capability bounding set/ {gsub(/^ +| +$/ ,"",$2); print $2}'); inheritable=$(printf "%s\n" "$dump" | awk -F: '/Inheritable capabilities/ {gsub(/^ +| +$/ ,"",$2); print $2}'); ambient=$(printf "%s\n" "$dump" | awk -F: '/Ambient capabilities/ {gsub(/^ +| +$/ ,"",$2); print $2}'); echo "V33_12_PROBE_CAP_BOUNDING=$bounding"; echo "V33_12_PROBE_CAP_INHERITABLE=$inheritable"; echo "V33_12_PROBE_CAP_AMBIENT=$ambient"`,
    'if wget -T 1 -O /workspace/.network-probe http://1.1.1.1 >/dev/null 2>&1; then echo V33_12_PROBE_NETWORK=OPEN; else echo V33_12_PROBE_NETWORK=BLOCKED; fi',
    'if cat /etc/passwd >/workspace/.host-probe 2>/dev/null; then echo V33_12_PROBE_HOST_FS=VISIBLE; else echo V33_12_PROBE_HOST_FS=BLOCKED; fi',
    'if cat /proc/1/root/etc/passwd >/workspace/.proc-root-probe 2>/dev/null; then echo V33_12_PROBE_PROC_ROOT=VISIBLE; else echo V33_12_PROBE_PROC_ROOT=BLOCKED; fi',
    'if echo forbidden >/input/.v33-12-write-probe 2>/dev/null; then echo V33_12_PROBE_INPUT_WRITE=ALLOWED; else echo V33_12_PROBE_INPUT_WRITE=BLOCKED; fi',
    'if echo allowed >/workspace/.write-probe 2>/dev/null; then echo V33_12_PROBE_WORKSPACE_WRITE=ALLOWED; else echo V33_12_PROBE_WORKSPACE_WRITE=BLOCKED; fi',
    'keys=$(env | cut -d= -f1 | sort | tr "\\n" ","); case "$keys" in *API*|*TOKEN*|*SECRET*|*PASSWORD*|*CREDENTIAL*) echo V33_12_PROBE_ENVIRONMENT=LEAKED;; *) echo V33_12_PROBE_ENVIRONMENT=SANITIZED;; esac',
  ].join('; ');
  const inner = `${probe}; exec ${command}`;
  return [
    'mount --make-rprivate /',
    `mount --bind "$REPOSITORY_ROOT" "$ROOTFS/input"`,
    `mount -o remount,bind,ro,nosuid,nodev,noexec "$ROOTFS/input"`,
    `mount -t tmpfs -o size=${input.policy.maximumWorkspaceBytes},nosuid,nodev,noexec tmpfs "$ROOTFS/workspace"`,
    `mount -t tmpfs -o size=1048576,nosuid,nodev,noexec tmpfs "$ROOTFS/tmp"`,
    'chmod 0777 "$ROOTFS/workspace" "$ROOTFS/tmp"',
    'mount --bind /dev/null "$ROOTFS/dev/null"',
    'mount -t tmpfs -o size=65536,nosuid,nodev,noexec,ro tmpfs "$ROOTFS/proc"',
    `prlimit --cpu=${input.policy.maximumCpuSeconds}:${input.policy.maximumCpuSeconds} --as=${input.policy.maximumMemoryBytes}:${input.policy.maximumMemoryBytes} --nproc=${input.policy.maximumProcesses}:${input.policy.maximumProcesses} --fsize=${input.policy.maximumFileBytes}:${input.policy.maximumFileBytes} --nofile=${input.policy.maximumOpenFiles}:${input.policy.maximumOpenFiles} --core=0:0 -- chroot "$ROOTFS" /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all ${cleanEnv} /bin/sh -c ${shellQuote(inner)}`,
  ].join('\n');
}


function createReadOnlyInputSnapshot(sourceRoot: string, destinationRoot: string): void {
  mkdirSync(destinationRoot, { recursive: true, mode: 0o755 });
  const copy = (sourceDir: string, destinationDir: string): void => {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = join(sourceDir, entry.name);
      const destination = join(destinationDir, entry.name);
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
      else if (stat.isDirectory()) { const mode = ((stat.mode & 0o777) | 0o555) & ~0o222; mkdirSync(destination, { mode }); copy(source, destination); chmodSync(destination, mode); }
      else if (stat.isFile()) { const mode = ((stat.mode & 0o777) | 0o444) & ~0o222; copyFileSync(source, destination); chmodSync(destination, mode); }
    }
  };
  copy(sourceRoot, destinationRoot);
  chmodSync(destinationRoot, 0o755);
}

function buildMinimalRootfs(rootfs: string): void {
  for (const path of ['bin', 'usr/bin', 'lib', 'lib64', 'dev', 'input', 'workspace', 'tmp', 'proc']) mkdirSync(join(rootfs, path), { recursive: true });
  writeFileSync(join(rootfs, 'dev/null'), '');
  const busybox = commandPath('busybox');
  const setpriv = commandPath('setpriv');
  if (busybox === null || setpriv === null) throw new Error('isolation_runtime_binary_missing');
  copyExecutableWithDependencies(busybox, join(rootfs, 'bin/busybox'), rootfs);
  copyExecutableWithDependencies(setpriv, join(rootfs, 'usr/bin/setpriv'), rootfs);
  for (const applet of APPLETS) symlinkSync('busybox', join(rootfs, `bin/${applet}`));
  chmodSync(join(rootfs, 'bin/busybox'), 0o755);
  chmodSync(join(rootfs, 'usr/bin/setpriv'), 0o755);
}

function copyExecutableWithDependencies(source: string, destination: string, rootfs: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  for (const dependency of dynamicDependencies(source)) {
    const target = join(rootfs, dependency.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) copyFileSync(dependency, target);
  }
}

function dynamicDependencies(path: string): readonly string[] {
  const text = execFileSync('ldd', [path], { encoding: 'utf8' });
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const viaArrow = line.match(/=>\s+(\/[^\s]+)\s+/)?.[1];
    const direct = line.match(/^\s*(\/[^\s]+)\s+/)?.[1];
    const candidate = viaArrow ?? direct;
    if (candidate !== undefined && existsSync(candidate)) found.add(candidate);
  }
  return [...found].sort();
}

function repositorySnapshotDigest(root: string): string {
  const rows: Array<Record<string, string | number>> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) rows.push({ path: rel, type: 'symlink', target: readlinkSync(absolute) });
      else if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) rows.push({ path: rel, type: 'file', mode: stat.mode, size: stat.size, digest: sha256Bytes(readFileSync(absolute)) });
    }
  };
  walk(root);
  return sha256(rows);
}

function parseProbes(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(PROBE_PREFIX)) continue;
    const index = line.indexOf('=');
    if (index <= PROBE_PREFIX.length) continue;
    result[line.slice(PROBE_PREFIX.length, index)] = line.slice(index + 1).trim();
  }
  return result;
}

function classifyTermination(result: ReturnType<typeof spawnSync>, timedOut: boolean, stderr: string): QualifiedIsolationTerminationV33_12 {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS') return 'OUTPUT_LIMIT';
  if (timedOut) return 'WALL_TIME_LIMIT';
  if (/cannot fork|resource temporarily unavailable|file size limit|out of memory|cannot allocate memory|allocation failed/i.test(stderr)) return 'CPU_OR_RESOURCE_LIMIT';
  if (result.status === null || result.error !== undefined) return 'RUNTIME_SETUP_FAILED';
  if (result.status >= 128 || result.status === 137 || result.status === 153) return 'CPU_OR_RESOURCE_LIMIT';
  return 'COMPLETED';
}

function verifyPolicy(policy: QualifiedHostileCodeIsolationPolicyV33_12): void {
  const { policyDigest, ...material } = policy;
  if (sha256(material) !== policyDigest
    || policy.version !== '33.12'
    || policy.runtime !== 'LOCAL_LINUX_USER_MOUNT_NET_PID_NAMESPACE_REFERENCE'
    || policy.inputBoundary !== 'READ_ONLY_BIND_NOEXEC'
    || policy.workspaceBoundary !== 'BOUNDED_TMPFS_NOEXEC'
    || policy.networkBoundary !== 'EMPTY_NETWORK_NAMESPACE'
    || policy.environmentBoundary !== 'EMPTY_ALLOWLIST_ONLY'
    || policy.secretInjectionAllowed
    || !policy.noNewPrivilegesRequired
    || !policy.dropCapabilitiesRequired
    || policy.runtimeUid !== 65534
    || policy.runtimeGid !== 65534
    || policy.seccompProfile !== 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME'
    || policy.cgroupEnforcement !== 'NOT_AVAILABLE_IN_REFERENCE_RUNTIME'
    || policy.externalQualification !== 'required'
    || policy.productionPromotion !== 'blocked') throw new Error('isolation_policy_invalid');
}

function readNamespaceId(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return '';
  }
}

function commandPath(name: string): string | null {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${shellQuote(name)}`], { encoding: 'utf8' });
  const value = result.status === 0 ? result.stdout.trim() : '';
  return value === '' ? null : value;
}

function safeRelativeEntrypoint(path: string): string {
  const value = required(path, 'isolation_entrypoint_required').replaceAll('\\', '/');
  if (value.startsWith('/') || value.split('/').some((part) => part === '' || part === '.' || part === '..') || extname(value) !== '.sh') throw new Error('isolation_entrypoint_path_invalid');
  return value;
}

function ensureInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('isolation_path_escape');
}

function validateArg(value: string): string {
  if (value.includes('\0') || Buffer.byteLength(value) > 4096) throw new Error('isolation_argument_invalid');
  return value;
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function toBuffer(value: string | Buffer | null | undefined): Buffer { return Buffer.isBuffer(value) ? value : Buffer.from(value ?? ''); }
function boundedExcerpt(value: string): string { return value.slice(0, 4096); }
function required(value: string, code: string): string { if (value.trim() === '') throw new Error(code); return value; }
function bounded(value: number, minimum: number, maximum: number, code: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(code); return value; }
function digest(value: string, code: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); return value; }
function parseIso(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code); return parsed; }
