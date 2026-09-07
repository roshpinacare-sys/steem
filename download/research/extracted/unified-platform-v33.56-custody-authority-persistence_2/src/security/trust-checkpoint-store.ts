import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from '../contracts/crypto.js';
import { KeyLifecycleRegistry, type TrustSnapshot } from './key-lifecycle.js';

export interface TrustCheckpoint {
  readonly sequence: number;
  readonly tenantId: string;
  readonly channel: string;
  readonly epoch: number;
  readonly trustRoot: string;
  readonly snapshotDigest: string;
  readonly approvedBy: readonly string[];
  readonly createdAt: string;
  readonly previousDigest: string | null;
  readonly digest: string;
}

interface CheckpointFile {
  readonly schemaVersion: '1.0';
  readonly checkpoints: readonly TrustCheckpoint[];
  readonly anchor: string | null;
}

export class MonotonicTrustCheckpointStore {
  readonly file: string;
  readonly lockFile: string;

  constructor(path: string) {
    this.file = resolve(path);
    this.lockFile = `${this.file}.lock`;
    mkdirSync(dirname(this.file), { recursive: true });
    if (!existsSync(this.file)) this.#write({ schemaVersion: '1.0', checkpoints: [], anchor: null });
    this.verify();
  }

  apply(input: {
    readonly tenantId: string;
    readonly channel: string;
    readonly snapshot: TrustSnapshot;
    readonly approvedBy: readonly string[];
    readonly createdAt?: Date;
  }): TrustCheckpoint {
    if (input.tenantId.trim() === '' || input.channel.trim() === '') throw new Error('checkpoint_identity_required');
    if (!KeyLifecycleRegistry.verifySnapshot(input.snapshot)) throw new Error('invalid_trust_snapshot');
    const approvals = [...new Set(input.approvedBy.filter((item) => item.trim() !== ''))].sort();
    if (approvals.length < 2) throw new Error('checkpoint_dual_control_required');
    return this.#withLock(() => {
      const state = this.#readAndVerify();
      const latest = [...state.checkpoints].reverse().find((item) => item.tenantId === input.tenantId && item.channel === input.channel);
      if (latest !== undefined) {
        if (input.snapshot.epoch < latest.epoch) throw new Error('trust_rollback_detected');
        if (input.snapshot.epoch === latest.epoch) {
          if (input.snapshot.root !== latest.trustRoot) throw new Error('trust_epoch_fork_detected');
          return structuredClone(latest);
        }
      }
      const material = {
        sequence: state.checkpoints.length + 1,
        tenantId: input.tenantId,
        channel: input.channel,
        epoch: input.snapshot.epoch,
        trustRoot: input.snapshot.root,
        snapshotDigest: sha256(input.snapshot),
        approvedBy: approvals,
        createdAt: (input.createdAt ?? new Date()).toISOString(),
        previousDigest: state.anchor,
      };
      const checkpoint: TrustCheckpoint = { ...material, digest: sha256(material) };
      this.#write({ schemaVersion: '1.0', checkpoints: [...state.checkpoints, checkpoint], anchor: checkpoint.digest });
      return structuredClone(checkpoint);
    });
  }

  list(): readonly TrustCheckpoint[] { return this.#readAndVerify().checkpoints.map((item) => structuredClone(item)); }

  verify(): { readonly ok: true; readonly count: number; readonly anchor: string | null } {
    const state = this.#readAndVerify();
    return { ok: true, count: state.checkpoints.length, anchor: state.anchor };
  }

  #readAndVerify(): CheckpointFile {
    const state = JSON.parse(readFileSync(this.file, 'utf8')) as CheckpointFile;
    if (state.schemaVersion !== '1.0' || !Array.isArray(state.checkpoints)) throw new Error('checkpoint_file_invalid');
    let previous: string | null = null;
    for (let index = 0; index < state.checkpoints.length; index += 1) {
      const checkpoint = state.checkpoints[index];
      if (checkpoint === undefined || checkpoint.sequence !== index + 1 || checkpoint.previousDigest !== previous) throw new Error('checkpoint_chain_invalid');
      const { digest, ...material } = checkpoint;
      if (digest !== sha256(material)) throw new Error('checkpoint_digest_invalid');
      previous = digest;
    }
    if (state.anchor !== previous) throw new Error('checkpoint_anchor_invalid');
    return state;
  }

  #write(state: CheckpointFile): void {
    const tmp = join(dirname(this.file), `.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(tmp, this.file);
    const dir = openSync(dirname(this.file), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }

  #withLock<T>(operation: () => T): T {
    const deadline = Date.now() + 10_000;
    let fd: number | undefined;
    while (fd === undefined) {
      try {
        fd = openSync(this.lockFile, 'wx', 0o600);
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
        fsyncSync(fd);
      } catch (error) {
        if (!isExists(error)) throw error;
        if (isStaleLock(this.lockFile)) { rmSync(this.lockFile, { force: true }); continue; }
        if (Date.now() >= deadline) throw new Error('checkpoint_lock_timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try { return operation(); }
    finally { closeSync(fd); rmSync(this.lockFile, { force: true }); }
  }
}

function isExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST';
}

function isStaleLock(path: string): boolean {
  try {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { readonly pid?: unknown; readonly createdAt?: unknown };
    const pid = Number(parsed.pid);
    if (!Number.isInteger(pid) || pid <= 0) return ageMs > 30_000;
    try { process.kill(pid, 0); return false; }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
      return code === 'ESRCH' && ageMs > 100;
    }
  } catch { return false; }
}
