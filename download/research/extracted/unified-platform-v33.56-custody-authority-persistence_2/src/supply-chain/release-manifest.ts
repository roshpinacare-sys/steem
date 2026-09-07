import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { SigningIdentity } from '../contracts/crypto.js';
import { sha256 } from '../contracts/crypto.js';
import { KeyLifecycleRegistry, type PurposeBoundEnvelope } from '../security/key-lifecycle.js';

export interface SourceFileRecord {
  readonly path: string;
  readonly bytes: number;
  readonly digest: string;
}

export interface SourceManifest {
  readonly format: 'sovereign-source-manifest';
  readonly version: 1;
  readonly files: readonly SourceFileRecord[];
  readonly root: string;
}

export interface CycloneDxLikeSbom {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: '1.5';
  readonly serialNumber: string;
  readonly version: 1;
  readonly metadata: { readonly component: { readonly type: 'application'; readonly name: string; readonly version: string } };
  readonly components: readonly { readonly type: 'library'; readonly name: string; readonly version: string; readonly licenses: readonly string[] }[];
  readonly limitations: readonly string[];
}

export interface DevelopmentReleaseManifest {
  readonly releaseId: string;
  readonly project: string;
  readonly version: string;
  readonly sourceRoot: string;
  readonly packageLockDigest: string;
  readonly sbomDigest: string;
  readonly runtime: string;
  readonly buildCommand: string;
  readonly createdAt: string;
  readonly evidenceClass: 'ATTESTED';
  readonly limitations: readonly string[];
}

const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', 'dist', 'coverage', '.git', '.cache']);
const EXCLUDED_VOLATILE_PATH_PREFIXES = ['evidence/generated/', 'evidence/runs/'] as const;
const EXCLUDED_VOLATILE_FILES = new Set(['evidence/V32_6_CURRENT_RUN.json']);

export function buildSourceManifest(root: string): SourceManifest {
  const absolute = resolve(root);
  const files = walk(absolute)
    .filter((path) => !relative(absolute, path).split(sep).some((part) => EXCLUDED_DIRECTORY_NAMES.has(part)))
    .filter((path) => {
      const relativePath = relative(absolute, path).replaceAll('\\', '/');
      return !EXCLUDED_VOLATILE_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
        && !EXCLUDED_VOLATILE_FILES.has(relativePath);
    })
    .map((path) => {
      const bytes = readFileSync(path);
      return { path: relative(absolute, path).split(sep).join('/'), bytes: bytes.byteLength, digest: rawDigest(bytes) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { format: 'sovereign-source-manifest', version: 1, files, root: sha256(files) };
}

export function buildCycloneDxLikeSbom(packageLockPath: string): CycloneDxLikeSbom {
  const lock = JSON.parse(readFileSync(packageLockPath, 'utf8')) as {
    name?: string; version?: string; packages?: Record<string, { version?: string; license?: string }>;
  };
  if (lock.packages === undefined) throw new Error('package_lock_packages_missing');
  const root = lock.packages[''] ?? {};
  const components = Object.entries(lock.packages)
    .filter(([path]) => path.startsWith('node_modules/'))
    .map(([path, info]) => ({
      type: 'library' as const,
      name: basename(path),
      version: info.version ?? 'unknown',
      licenses: info.license === undefined ? [] : [info.license],
    }))
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const name = lock.name ?? 'unknown-application';
  const version = lock.version ?? root.version ?? '0.0.0';
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${sha256({ name, version, components }).slice(0, 32)}`, version: 1,
    metadata: { component: { type: 'application', name, version } },
    components,
    limitations: ['locally-generated-sbom-shape-not-official-cyclonedx-conformance-validated', 'transitive-metadata-limited-to-package-lock'],
  };
}

export function signDevelopmentRelease(options: {
  readonly root: string;
  readonly project: string;
  readonly version: string;
  readonly identity: SigningIdentity;
  readonly registry: KeyLifecycleRegistry;
  readonly now?: Date;
  readonly buildCommand?: string;
}): { readonly sourceManifest: SourceManifest; readonly sbom: CycloneDxLikeSbom; readonly envelope: PurposeBoundEnvelope<DevelopmentReleaseManifest> } {
  const now = options.now ?? new Date();
  const sourceManifest = buildSourceManifest(options.root);
  const packageLockPath = join(resolve(options.root), 'package-lock.json');
  const packageLockDigest = rawDigest(readFileSync(packageLockPath));
  const sbom = buildCycloneDxLikeSbom(packageLockPath);
  const manifest: DevelopmentReleaseManifest = {
    releaseId: `development-${options.version}-${sourceManifest.root.slice(0, 12)}`,
    project: options.project,
    version: options.version,
    sourceRoot: sourceManifest.root,
    packageLockDigest,
    sbomDigest: sha256(sbom),
    runtime: process.version,
    buildCommand: options.buildCommand ?? 'npm ci --ignore-scripts && npm run validate:v32',
    createdAt: now.toISOString(),
    evidenceClass: 'ATTESTED',
    limitations: ['development-release-not-production-qualified', 'no-sigstore-or-slsa-conformance-tooling-in-environment', 'signer-custody-qualified-separately'],
  };
  const envelope = options.registry.sign(manifest, options.identity, {
    purpose: 'release-signer', environment: 'test', nonce: `development-release:${manifest.releaseId}`,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  });
  return { sourceManifest, sbom, envelope };
}

export function scanPotentialSecrets(root: string): readonly { readonly path: string; readonly rule: string }[] {
  const absolute = resolve(root);
  const findings: { path: string; rule: string }[] = [];
  const patterns: readonly [string, RegExp][] = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
    ['aws-access-key', /AKIA[0-9A-Z]{16}/],
    ['generic-token-assignment', /(?:token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i],
  ];
  for (const path of walk(absolute)) {
    const relativePath = relative(absolute, path).split(sep).join('/');
    if (relativePath.startsWith('node_modules/') || relativePath.startsWith('dist/') || relativePath.startsWith('.git/') || statSync(path).size > 2_000_000) continue;
    let content: string;
    try { content = readFileSync(path, 'utf8'); } catch { continue; }
    for (const [rule, pattern] of patterns) if (pattern.test(content)) findings.push({ path: relativePath, rule });
  }
  return findings;
}

function walk(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  visit(root);
  return output;
}

function rawDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
