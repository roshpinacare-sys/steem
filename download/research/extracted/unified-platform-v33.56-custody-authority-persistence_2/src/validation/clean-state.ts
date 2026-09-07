import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ValidationLeaseRecord {
  readonly runId: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export interface ValidationPreparation {
  readonly runId: string;
  readonly generatedRoot: string;
  readonly quarantinedPath?: string;
  readonly priorFileCount: number;
}

export class CleanValidationWorkspace {
  readonly #root: string;
  readonly #evidenceRoot: string;
  readonly #generatedRoot: string;
  readonly #quarantineRoot: string;
  readonly #lockPath: string;
  #lease: ValidationLeaseRecord | undefined;

  constructor(root: string) {
    this.#root = resolve(root);
    this.#evidenceRoot = join(this.#root, 'evidence');
    this.#generatedRoot = join(this.#evidenceRoot, 'generated');
    this.#quarantineRoot = join(this.#evidenceRoot, 'quarantine');
    this.#lockPath = join(this.#root, '.validation-v22.lock');
  }

  acquire(runId: string = randomUUID(), now = new Date(), staleAfterMs = 30 * 60_000): ValidationLeaseRecord {
    if (runId.trim() === '') throw new Error('validation_run_id_required');
    mkdirSync(this.#root, { recursive: true });
    const record = { runId, pid: process.pid, acquiredAt: now.toISOString() };
    try {
      const fd = openSync(this.#lockPath, 'wx', 0o600);
      try { writeFileSync(fd, `${JSON.stringify(record)}\n`); } finally { closeSync(fd); }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = readLease(this.#lockPath);
      const age = now.getTime() - Date.parse(existing.acquiredAt);
      if (age <= staleAfterMs && processAlive(existing.pid)) throw new Error('validation_already_running');
      const stalePath = `${this.#lockPath}.stale-${sanitize(existing.runId)}-${now.getTime()}`;
      renameSync(this.#lockPath, stalePath);
      const fd = openSync(this.#lockPath, 'wx', 0o600);
      try { writeFileSync(fd, `${JSON.stringify(record)}\n`); } finally { closeSync(fd); }
    }
    this.#lease = record;
    return record;
  }

  prepare(now = new Date()): ValidationPreparation {
    const lease = this.#requireLease();
    mkdirSync(this.#evidenceRoot, { recursive: true });
    let priorFileCount = 0;
    let quarantinedPath: string | undefined;
    if (existsSync(this.#generatedRoot)) {
      priorFileCount = countFiles(this.#generatedRoot);
      if (priorFileCount > 0 || readdirSync(this.#generatedRoot).length > 0) {
        mkdirSync(this.#quarantineRoot, { recursive: true });
        quarantinedPath = join(this.#quarantineRoot, `generated-${now.getTime()}-${sanitize(lease.runId)}`);
        renameSync(this.#generatedRoot, quarantinedPath);
      } else rmSync(this.#generatedRoot, { recursive: true, force: true });
    }
    mkdirSync(this.#generatedRoot, { recursive: true });
    writeFileSync(join(this.#generatedRoot, '.in-progress.json'), `${JSON.stringify({ ...lease, preparedAt: now.toISOString(), priorFileCount, quarantinedPath: quarantinedPath ?? null }, null, 2)}\n`, { mode: 0o600 });
    return quarantinedPath === undefined
      ? { runId: lease.runId, generatedRoot: this.#generatedRoot, priorFileCount }
      : { runId: lease.runId, generatedRoot: this.#generatedRoot, quarantinedPath, priorFileCount };
  }

  complete(status: 'passed' | 'failed' | 'blocked', now = new Date()): void {
    const lease = this.#requireLease();
    mkdirSync(this.#generatedRoot, { recursive: true });
    rmSync(join(this.#generatedRoot, '.in-progress.json'), { force: true });
    writeFileSync(join(this.#generatedRoot, '.completed.json'), `${JSON.stringify({ ...lease, status, completedAt: now.toISOString() }, null, 2)}\n`, { mode: 0o600 });
    this.release();
  }

  release(): void {
    const lease = this.#lease;
    if (lease === undefined) return;
    if (existsSync(this.#lockPath)) {
      const onDisk = readLease(this.#lockPath);
      if (onDisk.runId !== lease.runId || onDisk.pid !== lease.pid) throw new Error('validation_lock_ownership_lost');
      rmSync(this.#lockPath, { force: true });
    }
    this.#lease = undefined;
  }

  inspect(): { readonly generatedFileCount: number; readonly inProgress: boolean; readonly lock?: ValidationLeaseRecord } {
    const generatedFileCount = existsSync(this.#generatedRoot) ? countFiles(this.#generatedRoot) : 0;
    const inProgress = existsSync(join(this.#generatedRoot, '.in-progress.json'));
    const lock = existsSync(this.#lockPath) ? readLease(this.#lockPath) : undefined;
    return lock === undefined ? { generatedFileCount, inProgress } : { generatedFileCount, inProgress, lock };
  }

  #requireLease(): ValidationLeaseRecord {
    if (this.#lease === undefined) throw new Error('validation_lease_required');
    return this.#lease;
  }
}

function readLease(path: string): ValidationLeaseRecord {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ValidationLeaseRecord>;
  if (typeof parsed.runId !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.acquiredAt !== 'string' || !Number.isFinite(Date.parse(parsed.acquiredAt))) throw new Error('validation_lock_corrupt');
  return { runId: parsed.runId, pid: parsed.pid, acquiredAt: parsed.acquiredAt };
}
function countFiles(root: string): number {
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    total += entry.isDirectory() ? countFiles(path) : 1;
  }
  return total;
}
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function sanitize(value: string): string { return basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_'); }
function isAlreadyExists(error: unknown): boolean { return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'; }
