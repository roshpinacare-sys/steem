import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, statfsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, type SignedEnvelope, type SigningIdentity, sha256, sha256Bytes, signEnvelope } from '../contracts/crypto.js';

export type IsolationControlStatusV33_13 = 'VERIFIED_AVAILABLE' | 'UNAVAILABLE_FAIL_CLOSED' | 'NOT_PROBED';

export interface HostIsolationCapabilityAttestationV33_13 {
  readonly version: '33.13';
  readonly attestationId: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly kernelRelease: string;
  readonly localNamespaceRuntime: IsolationControlStatusV33_13;
  readonly openat2Snapshot: IsolationControlStatusV33_13;
  readonly seccompFilter: IsolationControlStatusV33_13;
  readonly cgroupV2: IsolationControlStatusV33_13;
  readonly secondRuntimeImplementation: IsolationControlStatusV33_13;
  readonly externalIndependentWitness: IsolationControlStatusV33_13;
  readonly productionPromotion: 'blocked';
  readonly limitations: readonly string[];
  readonly attestationDigest: string;
}

export interface DescriptorPinnedFileV33_13 {
  readonly path: string;
  readonly type: 'file';
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly sizeBytes: number;
  readonly contentSha256: string;
}

export interface DescriptorPinnedRepositoryManifestV33_13 {
  readonly version: '33.13';
  readonly method: 'POSIX_O_NOFOLLOW_FSTAT_DOUBLE_CHECK_REFERENCE';
  readonly root: string;
  readonly files: readonly DescriptorPinnedFileV33_13[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly openat2Used: false;
  readonly raceHardening: 'PARTIAL_REFERENCE_ONLY';
  readonly manifestDigest: string;
}

export interface IsolationRuntimeAdapterV33_13<Request, Receipt> {
  readonly adapterId: string;
  readonly implementation: 'LOCAL_LINUX_NAMESPACE_V33_12_ADAPTER' | 'EXTERNAL_RUNTIME_ADAPTER';
  readonly execute: (request: Request) => Receipt;
}

export function probeHostIsolationCapabilitiesV33_13(input: {
  readonly attestationId: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly signer: SigningIdentity;
}): SignedEnvelope<HostIsolationCapabilityAttestationV33_13> {
  const generatedAt = strictIso(input.generatedAt, 'host_attestation_generated_at_invalid');
  const validUntil = strictIso(input.validUntil, 'host_attestation_valid_until_invalid');
  if (validUntil <= generatedAt) throw new Error('host_attestation_window_invalid');

  const localNamespaceRuntime: IsolationControlStatusV33_13 = namespaceProbe() ? 'VERIFIED_AVAILABLE' : 'UNAVAILABLE_FAIL_CLOSED';
  const kernel = release();
  const openat2Snapshot: IsolationControlStatusV33_13 = kernelSupportsOpenat2(kernel)
    ? 'NOT_PROBED'
    : 'UNAVAILABLE_FAIL_CLOSED';
  const seccompFilter: IsolationControlStatusV33_13 = seccompLoaderAvailable()
    ? 'NOT_PROBED'
    : 'UNAVAILABLE_FAIL_CLOSED';
  const cgroupV2: IsolationControlStatusV33_13 = writableCgroupV2()
    ? 'NOT_PROBED'
    : 'UNAVAILABLE_FAIL_CLOSED';
  const secondRuntimeImplementation: IsolationControlStatusV33_13 = secondRuntimeAvailable()
    ? 'NOT_PROBED'
    : 'UNAVAILABLE_FAIL_CLOSED';

  const material = {
    version: '33.13' as const,
    attestationId: required(input.attestationId, 'host_attestation_id_required'),
    generatedAt: new Date(generatedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    platform: platform(),
    architecture: arch(),
    kernelRelease: kernel,
    localNamespaceRuntime,
    openat2Snapshot,
    seccompFilter,
    cgroupV2,
    secondRuntimeImplementation,
    externalIndependentWitness: 'UNAVAILABLE_FAIL_CLOSED' as const,
    productionPromotion: 'blocked' as const,
    limitations: [
      'HOST_CAPABILITY_ATTESTATION_IS_LOCAL_ONLY',
      'OPENAT2_REQUIRES_SEPARATE_EXECUTED_PROBE',
      'SECCOMP_REQUIRES_SEPARATE_EXECUTED_PROBE',
      'CGROUP_V2_REQUIRES_WRITABLE_DELEGATED_SUBTREE',
      'SECOND_RUNTIME_REQUIRES_EXTERNAL_QUALIFICATION',
      'NO_EXTERNAL_INDEPENDENT_WITNESS',
    ],
  };
  return signEnvelope({ ...material, attestationDigest: sha256(material) }, input.signer);
}

export function verifyHostIsolationCapabilityAttestationV33_13(input: {
  readonly envelope: SignedEnvelope<HostIsolationCapabilityAttestationV33_13>;
  readonly keys: KeyRegistry;
  readonly trustedSignerIds: readonly string[];
  readonly at: string;
}): boolean {
  const at = Date.parse(input.at);
  const payload = input.envelope.payload;
  if (!Number.isFinite(at)
    || !input.trustedSignerIds.includes(input.envelope.issuerKeyId)
    || !input.keys.verifyAt(input.envelope, input.at)
    || payload.version !== '33.13'
    || payload.productionPromotion !== 'blocked'
    || Date.parse(payload.generatedAt) > at
    || Date.parse(payload.validUntil) <= at) return false;
  const { attestationDigest, ...material } = payload;
  return sha256(material) === attestationDigest;
}

export function captureDescriptorPinnedRepositoryManifestV33_13(rootInput: string): DescriptorPinnedRepositoryManifestV33_13 {
  const root = resolve(rootInput);
  const files: DescriptorPinnedFileV33_13[] = [];
  const walk = (directory: string): void => {
    const directoryBefore = lstatSync(directory);
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) throw new Error('descriptor_snapshot_directory_invalid');
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`descriptor_snapshot_symlink_rejected:${rel}`);
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) throw new Error(`descriptor_snapshot_special_file_rejected:${rel}`);
      const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = fstatSync(fd);
        const content = readFileSync(fd);
        const after = fstatSync(fd);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
          throw new Error(`descriptor_snapshot_file_changed:${rel}`);
        }
        if (before.dev !== stat.dev || before.ino !== stat.ino) throw new Error(`descriptor_snapshot_path_rebound:${rel}`);
        files.push({
          path: rel,
          type: 'file',
          device: before.dev,
          inode: before.ino,
          mode: before.mode,
          sizeBytes: before.size,
          contentSha256: sha256Bytes(content),
        });
      } finally {
        closeSync(fd);
      }
    }
    const directoryAfter = lstatSync(directory);
    if (directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino || directoryBefore.mtimeMs !== directoryAfter.mtimeMs || directoryBefore.ctimeMs !== directoryAfter.ctimeMs) {
      throw new Error('descriptor_snapshot_directory_changed');
    }
  };
  walk(root);
  const material = {
    version: '33.13' as const,
    method: 'POSIX_O_NOFOLLOW_FSTAT_DOUBLE_CHECK_REFERENCE' as const,
    root,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    openat2Used: false as const,
    raceHardening: 'PARTIAL_REFERENCE_ONLY' as const,
  };
  return { ...material, manifestDigest: sha256(material) };
}

function namespaceProbe(): boolean {
  const unshare = commandPath('unshare');
  if (platform() !== 'linux' || unshare === null) return false;
  const result = spawnSync(unshare, ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '/bin/sh', '-c', 'test "$(id -u)" = 0'], { timeout: 3_000 });
  return result.status === 0 && result.error === undefined;
}

function writableCgroupV2(): boolean {
  try {
    const stat = statfsSync('/sys/fs/cgroup');
    const cgroup2Magic = 0x63677270;
    return Number(stat.type) === cgroup2Magic && spawnSync('/bin/sh', ['-c', 'test -w /sys/fs/cgroup && test -r /sys/fs/cgroup/cgroup.controllers']).status === 0;
  } catch {
    return false;
  }
}

function seccompLoaderAvailable(): boolean {
  return commandPath('nsjail') !== null || commandPath('bwrap') !== null || commandPath('firejail') !== null;
}

function secondRuntimeAvailable(): boolean {
  return ['runc', 'crun', 'jailer', 'qemu-system-x86_64'].some((name) => commandPath(name) !== null);
}

function kernelSupportsOpenat2(kernelRelease: string): boolean {
  const match = kernelRelease.match(/^(\d+)\.(\d+)/);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 6);
}

function commandPath(name: string): string | null {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${shellQuote(name)}`], { encoding: 'utf8' });
  const value = result.status === 0 ? result.stdout.trim() : '';
  return value === '' ? null : value;
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function required(value: string, code: string): string { if (value.trim() === '') throw new Error(code); return value; }
function strictIso(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code); return parsed; }
