import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../contracts/crypto.js';
import type { DigitalThreadSnapshot } from './digital-thread.js';
import type { RecertificationPlan, RecertificationResult } from './recertification-types.js';

export interface StoredRecertificationCase {
  readonly version: 1;
  readonly incidentDigest: string;
  readonly plan: RecertificationPlan;
  readonly thread: DigitalThreadSnapshot;
  readonly completionInputDigest?: string;
  readonly result?: RecertificationResult;
  readonly digest: string;
}

export class PersistentRecertificationCaseStore {
  readonly #root: string;
  readonly #lockPath: string;
  constructor(root: string) {
    if (root.trim() === '') throw new Error('recertification_store_root_required');
    this.#root = resolve(root); this.#lockPath = join(this.#root, '.write.lock');
    mkdirSync(this.#root, { recursive: true, mode: 0o700 }); fsyncDirectory(this.#root);
  }
  findByIncident(incidentId: string): StoredRecertificationCase | undefined {
    if (incidentId.trim() === '') throw new Error('recertification_incident_id_required');
    for (const name of readdirSync(this.#root).filter((value) => value.endsWith('.json')).sort()) {
      const record = this.#readPath(join(this.#root, name));
      if (record.plan.incidentId === incidentId) return record;
    }
    return undefined;
  }
  get(caseId: string): StoredRecertificationCase {
    const path = this.#path(caseId);
    if (!existsSync(path)) throw new Error('recertification_case_not_found');
    return this.#readPath(path);
  }
  create(incidentDigest: string, plan: RecertificationPlan, thread: DigitalThreadSnapshot): StoredRecertificationCase {
    if (!/^[a-f0-9]{64}$/.test(incidentDigest)) throw new Error('recertification_incident_digest_invalid');
    const release = this.#lock();
    try {
      const existing = this.findByIncident(plan.incidentId);
      if (existing !== undefined) {
        if (existing.incidentDigest !== incidentDigest) throw new Error('recertification_incident_id_conflict');
        return existing;
      }
      const material = { version: 1 as const, incidentDigest, plan: structuredClone(plan), thread: structuredClone(thread) };
      const record: StoredRecertificationCase = { ...material, digest: sha256(material) };
      atomicReplace(this.#path(plan.caseId), `${JSON.stringify(record, null, 2)}\n`);
      fsyncDirectory(this.#root); return structuredClone(record);
    } finally { release(); }
  }
  complete(caseId: string, completionInputDigest: string, result: RecertificationResult, thread: DigitalThreadSnapshot): StoredRecertificationCase {
    if (!/^[a-f0-9]{64}$/.test(completionInputDigest)) throw new Error('recertification_completion_digest_invalid');
    const release = this.#lock();
    try {
      const current = this.get(caseId);
      if (current.result !== undefined) {
        if (current.completionInputDigest !== completionInputDigest || sha256(current.result) !== sha256(result)) throw new Error('recertification_completion_conflict');
        return current;
      }
      const material = { version: 1 as const, incidentDigest: current.incidentDigest, plan: { ...current.plan, status: 'RECERTIFIED' as const, digitalThreadRoot: thread.root }, thread: structuredClone(thread), completionInputDigest, result: structuredClone(result) };
      const record: StoredRecertificationCase = { ...material, digest: sha256(material) };
      atomicReplace(this.#path(caseId), `${JSON.stringify(record, null, 2)}\n`); fsyncDirectory(this.#root);
      return structuredClone(record);
    } finally { release(); }
  }
  #path(caseId: string): string { if (caseId.trim() === '') throw new Error('recertification_case_id_required'); return join(this.#root, `${sha256({ caseId })}.json`); }
  #readPath(path: string): StoredRecertificationCase {
    const record = JSON.parse(readFileSync(path, 'utf8')) as StoredRecertificationCase;
    const { digest, ...material } = record;
    if (digest !== sha256(material)) throw new Error('recertification_case_tampered');
    if (record.plan.caseId.trim() === '' || record.plan.incidentId.trim() === '' || record.thread.root.trim() === '') throw new Error('recertification_case_invalid');
    return structuredClone(record);
  }
  #lock(timeoutMs = 10_000): () => void {
    const started = Date.now();
    while (true) {
      try {
        const fd = openSync(this.#lockPath, 'wx', 0o600); writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`); fsyncSync(fd); closeSync(fd);
        return () => rmSync(this.#lockPath, { force: true });
      } catch (error) {
        if (!isExists(error)) throw error;
        if (recoverStale(this.#lockPath)) continue;
        if (Date.now() - started >= timeoutMs) throw new Error('recertification_store_lock_timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }
}
function atomicReplace(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}-${randomUUID()}`; const fd = openSync(temp, 'wx', 0o600); try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, path); }
function fsyncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function isExists(error: unknown): boolean { return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'; }
function recoverStale(path: string): boolean { try { const parsed = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; at?: unknown }; const pid = typeof parsed.pid === 'number' ? parsed.pid : -1; const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : NaN; const stale = !alive(pid) || !Number.isFinite(at) || Date.now() - at > 60_000; if (!stale) return false; renameSync(path, `${path}.stale-${Date.now()}-${randomUUID()}`); return true; } catch (error) { return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'; } }
function alive(pid: number): boolean { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
