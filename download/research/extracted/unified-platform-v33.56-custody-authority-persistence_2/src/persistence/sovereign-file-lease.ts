import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface SovereignFileLeaseOptions {
  readonly timeoutMs?: number;
  readonly staleAfterMs?: number;
  readonly pollMs?: number;
  readonly now?: () => Date;
}

export interface SovereignFileLeaseRecord {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly bootId?: string;
  readonly processStartTicks?: string;
  readonly acquiredAt: string;
}

interface LeaseHandle {
  readonly path: string;
  readonly descriptor: number;
  readonly record: SovereignFileLeaseRecord;
}

export function withSovereignFileLease<T>(path: string, operation: () => T, options: SovereignFileLeaseOptions = {}): T {
  const handle = acquireLease(path, options);
  try {
    return operation();
  } finally {
    releaseLease(handle);
  }
}

export async function withSovereignFileLeaseAsync<T>(path: string, operation: () => Promise<T>, options: SovereignFileLeaseOptions = {}): Promise<T> {
  const handle = await acquireLeaseAsync(path, options);
  try {
    return await operation();
  } finally {
    releaseLease(handle);
  }
}

function acquireLease(path: string, options: SovereignFileLeaseOptions): LeaseHandle {
  const timeoutMs = positive(options.timeoutMs ?? 5_000, 'file_lease_timeout_invalid');
  const staleAfterMs = positive(options.staleAfterMs ?? 30_000, 'file_lease_stale_window_invalid');
  const pollMs = positive(options.pollMs ?? 20, 'file_lease_poll_invalid');
  const now = options.now ?? (() => new Date());
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = tryAcquire(path, now);
    if (handle !== undefined) return handle;
    recoverStaleLease(path, staleAfterMs, now());
    if (Date.now() >= deadline) throw new Error('file_lease_timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
}

async function acquireLeaseAsync(path: string, options: SovereignFileLeaseOptions): Promise<LeaseHandle> {
  const timeoutMs = positive(options.timeoutMs ?? 5_000, 'file_lease_timeout_invalid');
  const staleAfterMs = positive(options.staleAfterMs ?? 30_000, 'file_lease_stale_window_invalid');
  const pollMs = positive(options.pollMs ?? 20, 'file_lease_poll_invalid');
  const now = options.now ?? (() => new Date());
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = tryAcquire(path, now);
    if (handle !== undefined) return handle;
    recoverStaleLease(path, staleAfterMs, now());
    if (Date.now() >= deadline) throw new Error('file_lease_timeout');
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}

function tryAcquire(path: string, now: () => Date): LeaseHandle | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    throw error;
  }
  const identity = currentProcessIdentity();
  const record: SovereignFileLeaseRecord = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    ...(identity.bootId === undefined ? {} : { bootId: identity.bootId }),
    ...(identity.processStartTicks === undefined ? {} : { processStartTicks: identity.processStartTicks }),
    acquiredAt: now().toISOString(),
  };
  try {
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
    fsyncSync(descriptor);
    return { path, descriptor, record };
  } catch (error) {
    closeSync(descriptor);
    try { unlinkSync(path); } catch { /* best effort after failed acquisition */ }
    throw error;
  }
}

function recoverStaleLease(path: string, staleAfterMs: number, now: Date): void {
  if (!existsSync(path)) return;
  let ageMs: number;
  try {
    ageMs = now.getTime() - statSync(path).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (ageMs <= staleAfterMs) return;
  const record = readLeaseRecord(path);
  if (record !== undefined && leaseOwnerAlive(record)) return;
  try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function releaseLease(handle: LeaseHandle): void {
  closeSync(handle.descriptor);
  const current = readLeaseRecord(handle.path);
  if (current === undefined || current.token !== handle.record.token) throw new Error('file_lease_ownership_lost');
  try { unlinkSync(handle.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function readLeaseRecord(path: string): SovereignFileLeaseRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<SovereignFileLeaseRecord>;
    if (value.version !== 1 || typeof value.token !== 'string' || value.token.trim() === '' || !Number.isInteger(value.pid) || (value.pid ?? 0) <= 0 || typeof value.hostname !== 'string' || typeof value.acquiredAt !== 'string' || !Number.isFinite(Date.parse(value.acquiredAt))) return undefined;
    return value as SovereignFileLeaseRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}

function leaseOwnerAlive(record: SovereignFileLeaseRecord): boolean {
  if (record.hostname !== hostname()) return true;
  const identity = processIdentity(record.pid);
  if (identity === undefined) return false;
  if (record.bootId !== undefined && identity.bootId !== undefined && record.bootId !== identity.bootId) return false;
  if (record.processStartTicks !== undefined && identity.processStartTicks !== undefined && record.processStartTicks !== identity.processStartTicks) return false;
  return true;
}

function currentProcessIdentity(): { bootId?: string; processStartTicks?: string } {
  return processIdentity(process.pid) ?? {};
}

function processIdentity(pid: number): { bootId?: string; processStartTicks?: string } | undefined {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return undefined;
    if (code !== 'EPERM') return undefined;
  }
  const result: { bootId?: string; processStartTicks?: string } = {};
  try { result.bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { /* non-Linux fallback */ }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = afterName[19]; if (ticks !== undefined) result.processStartTicks = ticks;
  } catch { /* non-Linux fallback */ }
  return result;
}

function positive(value: number, code: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}
