import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { sha256 } from '../contracts/crypto.js';

export type ArtifactRetention = 'standard' | 'long-term' | 'legal-hold';

export interface ArtifactRecord {
  readonly recordId: string;
  readonly tenantId: string;
  readonly artifactId: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly blobDigest: string;
  readonly createdAt: string;
  readonly retention: ArtifactRetention;
  readonly metadata: Readonly<Record<string, string>>;
  readonly supersedesRecordId?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly recordDigest: string;
}

export interface PutArtifactInput {
  readonly tenantId: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
  readonly createdAt?: Date;
  readonly retention?: ArtifactRetention;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly supersedesRecordId?: string;
}

export class ContentAddressedArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
    mkdirSync(this.#blobRoot(), { recursive: true });
    mkdirSync(this.#tenantRoot(), { recursive: true });
  }

  put(input: PutArtifactInput): ArtifactRecord {
    validateTenant(input.tenantId);
    validateText(input.kind, 'artifact_kind_required');
    validateText(input.mediaType, 'artifact_media_type_required');
    if (!Buffer.isBuffer(input.bytes)) throw new Error('artifact_bytes_required');
    const createdAt = (input.createdAt ?? new Date()).toISOString();
    const blobDigest = rawDigest(input.bytes);
    const blobPath = this.#blobPath(blobDigest);
    mkdirSync(dirname(blobPath), { recursive: true });
    if (existsSync(blobPath)) {
      if (rawDigest(readFileSync(blobPath)) !== blobDigest) throw new Error('artifact_blob_collision_or_tamper');
    } else {
      atomicWrite(blobPath, input.bytes, 0o440);
    }
    if (input.supersedesRecordId !== undefined) this.get(input.tenantId, input.supersedesRecordId);
    const material = {
      tenantId: input.tenantId,
      artifactId: `artifact-${randomUUID()}`,
      kind: input.kind,
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      blobDigest,
      createdAt,
      retention: input.retention ?? 'standard',
      metadata: normalizeMetadata(input.metadata ?? {}),
      ...(input.supersedesRecordId === undefined ? {} : { supersedesRecordId: input.supersedesRecordId }),
    };
    const recordId = sha256(material).slice(0, 32);
    const record: ArtifactRecord = { recordId, ...material, recordDigest: sha256({ recordId, ...material }) };
    const recordPath = this.#recordPath(input.tenantId, recordId);
    if (existsSync(recordPath)) {
      const existing = JSON.parse(readFileSync(recordPath, 'utf8')) as ArtifactRecord;
      if (existing.recordDigest !== record.recordDigest) throw new Error('artifact_record_conflict');
      return existing;
    }
    atomicWrite(recordPath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), 0o440);
    return structuredClone(record);
  }

  get(tenantId: string, recordId: string): ArtifactRecord {
    validateTenant(tenantId);
    validateRecordId(recordId);
    const path = this.#recordPath(tenantId, recordId);
    if (!existsSync(path)) throw new Error('artifact_record_not_found');
    const record = JSON.parse(readFileSync(path, 'utf8')) as ArtifactRecord;
    if (record.tenantId !== tenantId || record.recordId !== recordId) throw new Error('artifact_record_tenant_mismatch');
    if (sha256(stripRecordDigest(record)) !== record.recordDigest) throw new Error('artifact_record_tampered');
    return structuredClone(record);
  }

  read(tenantId: string, recordId: string): Buffer {
    const record = this.get(tenantId, recordId);
    const bytes = readFileSync(this.#blobPath(record.blobDigest));
    if (bytes.byteLength !== record.byteLength || rawDigest(bytes) !== record.blobDigest) throw new Error('artifact_blob_tampered');
    return bytes;
  }

  verify(tenantId: string, recordId: string): { readonly ok: boolean; readonly recordDigest: string; readonly blobDigest: string } {
    try {
      const record = this.get(tenantId, recordId);
      this.read(tenantId, recordId);
      return { ok: true, recordDigest: record.recordDigest, blobDigest: record.blobDigest };
    } catch {
      return { ok: false, recordDigest: '', blobDigest: '' };
    }
  }

  list(tenantId: string): readonly ArtifactRecord[] {
    validateTenant(tenantId);
    const directory = this.#recordsDirectory(tenantId);
    if (!existsSync(directory)) return [];
    const indexPath = join(directory, 'index.json');
    const ids = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) as string[] : this.#discoverRecordIds(directory);
    return ids.map((id) => this.get(tenantId, id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  revoke(tenantId: string, recordId: string, reason: string, now = new Date()): ArtifactRecord {
    validateText(reason, 'artifact_revocation_reason_required');
    const current = this.get(tenantId, recordId);
    if (current.retention === 'legal-hold') throw new Error('artifact_legal_hold_prevents_revocation');
    const replacement: ArtifactRecord = {
      ...current,
      revokedAt: now.toISOString(),
      revocationReason: reason,
      recordDigest: '',
    };
    const final = { ...replacement, recordDigest: sha256(stripRecordDigest(replacement)) };
    atomicReplace(this.#recordPath(tenantId, recordId), Buffer.from(`${JSON.stringify(final, null, 2)}\n`), 0o440);
    return final;
  }

  createBackup(destination: string): { readonly root: string; readonly manifestDigest: string; readonly fileCount: number } {
    const target = resolve(destination);
    rmSync(target, { recursive: true, force: true });
    cpSync(this.#root, target, { recursive: true, preserveTimestamps: true });
    const manifest = this.#manifest(target);
    atomicWrite(join(target, 'BACKUP_MANIFEST.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o440);
    return { root: target, manifestDigest: manifest.manifestDigest, fileCount: manifest.files.length };
  }

  static restoreFromBackup(backup: string, destination: string): ContentAddressedArtifactStore {
    const source = resolve(backup);
    const manifestPath = join(source, 'BACKUP_MANIFEST.json');
    if (!existsSync(manifestPath)) throw new Error('artifact_backup_manifest_missing');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: readonly { path: string; digest: string }[]; manifestDigest: string };
    if (manifest.manifestDigest !== sha256(manifest.files)) throw new Error('artifact_backup_manifest_tampered');
    for (const file of manifest.files) {
      const sourcePath = resolveWithin(source, file.path);
      if (!existsSync(sourcePath) || rawDigest(readFileSync(sourcePath)) !== file.digest) throw new Error(`artifact_backup_file_tampered:${file.path}`);
    }
    const target = resolve(destination);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const file of manifest.files) {
      const sourcePath = resolveWithin(source, file.path);
      const targetPath = resolveWithin(target, file.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
    return new ContentAddressedArtifactStore(target);
  }

  unsafeTamperBlobForTest(record: ArtifactRecord, replacement: Buffer): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('unsafe_test_api_forbidden');
    writeFileSync(this.#blobPath(record.blobDigest), replacement);
  }

  unsafeTamperRecordForTest(tenantId: string, recordId: string): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('unsafe_test_api_forbidden');
    const path = this.#recordPath(tenantId, recordId);
    const record = JSON.parse(readFileSync(path, 'utf8')) as ArtifactRecord;
    writeFileSync(path, JSON.stringify({ ...record, kind: 'tampered' }));
  }

  #blobRoot(): string { return join(this.#root, 'blobs', 'sha256'); }
  #tenantRoot(): string { return join(this.#root, 'tenants'); }
  #blobPath(digest: string): string { return join(this.#blobRoot(), digest.slice(0, 2), digest); }
  #recordsDirectory(tenantId: string): string { return join(this.#tenantRoot(), tenantId, 'records'); }
  #recordPath(tenantId: string, recordId: string): string { return join(this.#recordsDirectory(tenantId), `${recordId}.json`); }

  #discoverRecordIds(directory: string): string[] {
    return readdirSync(directory).filter((name: string) => /^[a-f0-9]{32}\.json$/.test(name)).map((name: string) => name.slice(0, -5));
  }

  #manifest(root: string): { readonly files: readonly { path: string; digest: string; bytes: number }[]; readonly manifestDigest: string } {
    const files = walkFiles(root).filter((path) => !path.endsWith('BACKUP_MANIFEST.json')).map((absolute) => {
      const path = absolute.slice(root.length + 1).split(sep).join('/');
      const bytes = readFileSync(absolute);
      return { path, digest: rawDigest(bytes), bytes: bytes.byteLength };
    }).sort((a, b) => a.path.localeCompare(b.path));
    return { files, manifestDigest: sha256(files) };
  }
}

function rawDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stripRecordDigest(record: ArtifactRecord): Omit<ArtifactRecord, 'recordDigest'> {
  const { recordDigest: _recordDigest, ...material } = record;
  return material;
}

function validateTenant(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(value)) throw new Error('invalid_artifact_tenant');
}

function validateRecordId(value: string): void {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error('invalid_artifact_record_id');
}

function validateText(value: string, code: string): void {
  if (value.trim() === '') throw new Error(code);
}

function normalizeMetadata(metadata: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(metadata).sort()) {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) throw new Error('invalid_artifact_metadata_key');
    const value = metadata[key];
    if (value === undefined || value.length > 2048) throw new Error('invalid_artifact_metadata_value');
    result[key] = value;
  }
  return result;
}

function atomicWrite(path: string, bytes: Buffer, mode: number): void {
  if (existsSync(path)) throw new Error('immutable_artifact_exists');
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, path);
}

function atomicReplace(path: string, bytes: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, path);
}

function resolveWithin(root: string, relativePath: string): string {
  if (relativePath.startsWith('/') || relativePath.split(/[\\/]/).includes('..') || relativePath.includes('\0')) throw new Error('unsafe_backup_path');
  const target = resolve(root, relativePath);
  const absoluteRoot = resolve(root);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) throw new Error('backup_path_escape');
  return target;
}

function walkFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  visit(root);
  return output;
}

