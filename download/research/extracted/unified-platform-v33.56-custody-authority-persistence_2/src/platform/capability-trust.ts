import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../contracts/crypto.js';
import {
  applyCapabilityTrustEvent,
  effectiveTrustViolationSeverity,
  independentReviewers,
  validateCapabilityIdentity,
  validateTrustTransition,
  validateTrustViolation,
} from './capability-trust-policy.js';

import type { CapabilityIdentity, CapabilityTrustEvent, CapabilityTrustState, TrustEventType, TrustViolation } from './capability-trust-types.js';
export type { CapabilityIdentity, CapabilityTrustEvent, CapabilityTrustState, CapabilityTrustStatus, TrustEventType, TrustViolation, TrustViolationKind, TrustViolationSeverity } from './capability-trust-types.js';

interface TrustAnchor {
  readonly sequence: number;
  readonly root: string | null;
  readonly updatedAt: string;
  readonly digest: string;
}

interface PendingTrustWrite {
  readonly event: CapabilityTrustEvent;
  readonly anchor: TrustAnchor;
  readonly digest: string;
}

export class PersistentCapabilityTrustStore {
  readonly #root: string;
  readonly #eventsPath: string;
  readonly #anchorPath: string;
  readonly #lockPath: string;
  readonly #pendingPath: string;
  readonly #events: CapabilityTrustEvent[] = [];
  readonly #states = new Map<string, CapabilityTrustState>();

  constructor(root: string) {
    this.#root = resolve(root);
    this.#eventsPath = join(this.#root, 'events.jsonl');
    this.#anchorPath = join(this.#root, 'anchor.json');
    this.#lockPath = join(this.#root, '.write.lock');
    this.#pendingPath = join(this.#root, 'pending-write.json');
    mkdirSync(this.#root, { recursive: true });
    const release = this.#acquireWriteLock();
    try { this.#load(); } finally { release(); }
  }

  register(identity: CapabilityIdentity, now = new Date()): CapabilityTrustState {
    validateCapabilityIdentity(identity);
    const ref = capabilityRef(identity.capabilityId, identity.version);
    if (this.#states.has(key(identity.tenantId, ref))) throw new Error('capability_already_registered');
    this.#append(identity.tenantId, ref, 'REGISTERED', { ...identity, originalScopes: [...identity.originalScopes].sort() }, now);
    return this.get(identity.tenantId, ref);
  }

  registerUpgrade(input: CapabilityIdentity & { readonly predecessorRef: string }, now = new Date()): CapabilityTrustState {
    validateCapabilityIdentity(input);
    const predecessor = this.get(input.tenantId, input.predecessorRef);
    if (predecessor.publisherId !== input.publisherId) throw new Error('capability_upgrade_publisher_mismatch');
    const ref = capabilityRef(input.capabilityId, input.version);
    if (this.#states.has(key(input.tenantId, ref))) throw new Error('capability_already_registered');
    this.#append(input.tenantId, ref, 'UPGRADE_REGISTERED', {
      tenantId: input.tenantId,
      capabilityId: input.capabilityId,
      version: input.version,
      publisherId: input.publisherId,
      originalScopes: [...input.originalScopes].sort(),
      predecessorRef: input.predecessorRef,
    }, now);
    return this.get(input.tenantId, ref);
  }

  recordViolation(tenantId: string, capability: string, violation: TrustViolation, now = new Date()): CapabilityTrustState {
    const current = this.get(tenantId, capability);
    validateTrustViolation(violation);
    if (current.status === 'REVOKED') throw new Error('capability_already_revoked');
    const effectiveSeverity = effectiveTrustViolationSeverity(violation);
    this.#append(tenantId, capability, 'VIOLATION_RECORDED', { ...violation, severity: effectiveSeverity }, now);
    return this.get(tenantId, capability);
  }

  openAppeal(tenantId: string, capability: string, input: { readonly requestedBy: string; readonly reason: string; readonly evidenceRefs: readonly string[] }, now = new Date()): CapabilityTrustState {
    const current = this.get(tenantId, capability);
    if (current.status !== 'RESTRICTED' && current.status !== 'QUARANTINED') throw new Error('capability_appeal_not_allowed');
    if (input.requestedBy.trim() === '' || input.reason.trim() === '' || input.evidenceRefs.length === 0) throw new Error('invalid_capability_appeal');
    this.#append(tenantId, capability, 'APPEAL_OPENED', input, now);
    return this.get(tenantId, capability);
  }

  approveOverride(tenantId: string, capability: string, input: { readonly reviewers: readonly string[]; readonly reason: string }, now = new Date()): CapabilityTrustState {
    const current = this.get(tenantId, capability);
    if (current.status !== 'RESTRICTED' && current.status !== 'QUARANTINED') throw new Error('capability_override_not_allowed');
    const reviewers = independentReviewers(input.reviewers, current.publisherId);
    if (reviewers.length < 2) throw new Error('capability_override_dual_control_required');
    if (input.reason.trim() === '') throw new Error('capability_override_reason_required');
    this.#append(tenantId, capability, 'OVERRIDE_APPROVED', { reviewers, reason: input.reason }, now);
    return this.get(tenantId, capability);
  }

  recertify(tenantId: string, capability: string, input: {
    readonly evidenceRoot: string;
    readonly reviewers: readonly string[];
    readonly restoredScopes: readonly string[];
  }, now = new Date()): CapabilityTrustState {
    const current = this.get(tenantId, capability);
    if (current.status !== 'REQUALIFICATION_REQUIRED' && current.status !== 'QUARANTINED' && current.status !== 'RESTRICTED') {
      throw new Error('capability_recertification_not_required');
    }
    if (!/^[a-f0-9]{64}$/.test(input.evidenceRoot)) throw new Error('invalid_recertification_evidence_root');
    const reviewers = independentReviewers(input.reviewers, current.publisherId);
    if (reviewers.length < 2) throw new Error('recertification_dual_control_required');
    const scopes = [...new Set(input.restoredScopes)].sort();
    if (scopes.length === 0 || scopes.some((scope) => !current.originalScopes.includes(scope))) throw new Error('recertification_scope_escalation');
    this.#append(tenantId, capability, 'RECERTIFIED', { evidenceRoot: input.evidenceRoot, reviewers, restoredScopes: scopes }, now);
    return this.get(tenantId, capability);
  }

  revoke(tenantId: string, capability: string, input: { readonly reason: string; readonly reviewers: readonly string[]; readonly evidenceRef: string }, now = new Date()): CapabilityTrustState {
    const current = this.get(tenantId, capability);
    if (current.status === 'REVOKED') return current;
    const reviewers = independentReviewers(input.reviewers, current.publisherId);
    if (reviewers.length < 2) throw new Error('capability_revocation_dual_control_required');
    if (input.reason.trim() === '' || input.evidenceRef.trim() === '') throw new Error('invalid_capability_revocation');
    this.#append(tenantId, capability, 'REVOKED', { ...input, reviewers }, now);
    return this.get(tenantId, capability);
  }

  get(tenantId: string, capability: string): CapabilityTrustState {
    const state = this.#states.get(key(tenantId, capability));
    if (state === undefined) throw new Error('capability_trust_state_not_found');
    return structuredClone(state);
  }

  list(tenantId: string): readonly CapabilityTrustState[] {
    return [...this.#states.values()].filter((state) => state.tenantId === tenantId)
      .sort((a, b) => capabilityRef(a.capabilityId, a.version).localeCompare(capabilityRef(b.capabilityId, b.version)))
      .map((state) => structuredClone(state));
  }

  verify(): { readonly ok: boolean; readonly count: number; readonly root: string | null } {
    let previous: string | null = null;
    for (let index = 0; index < this.#events.length; index += 1) {
      const event = this.#events[index];
      if (event === undefined || event.sequence !== index + 1 || event.previousDigest !== previous) return { ok: false, count: this.#events.length, root: null };
      const { digest: _digest, ...material } = event;
      if (sha256(material) !== event.digest) return { ok: false, count: this.#events.length, root: null };
      previous = event.digest;
    }
    const anchor = this.#readAnchor();
    if (anchor.sequence !== this.#events.length || anchor.root !== previous || anchor.digest !== sha256({ sequence: anchor.sequence, root: anchor.root, updatedAt: anchor.updatedAt })) {
      return { ok: false, count: this.#events.length, root: previous };
    }
    return { ok: true, count: this.#events.length, root: previous };
  }

  events(tenantId: string, capability?: string): readonly CapabilityTrustEvent[] {
    return this.#events.filter((event) => event.tenantId === tenantId && (capability === undefined || event.capabilityRef === capability)).map((event) => structuredClone(event));
  }

  #append(tenantId: string, capability: string, type: TrustEventType, payload: Readonly<Record<string, unknown>>, now: Date): void {
    if (tenantId.trim() === '' || capability.trim() === '') throw new Error('capability_trust_identity_required');
    const release = this.#acquireWriteLock();
    try {
      this.#load();
      if (type === 'VIOLATION_RECORDED') {
        const violationId = typeof payload.violationId === 'string' ? payload.violationId : '';
        const existing = this.#events.find((event) => event.tenantId === tenantId && event.capabilityRef === capability && event.type === 'VIOLATION_RECORDED' && event.payload.violationId === violationId);
        if (existing !== undefined) {
          if (sha256(existing.payload) !== sha256(payload)) throw new Error('trust_violation_id_conflict');
          return;
        }
      }
      const current = this.#states.get(key(tenantId, capability));
      validateTrustTransition(current, type);
      const previousDigest = this.#events.at(-1)?.digest ?? null;
      const material = {
        sequence: this.#events.length + 1,
        eventId: randomUUID(),
        tenantId,
        capabilityRef: capability,
        type,
        payload,
        createdAt: now.toISOString(),
        previousDigest,
      };
      const event: CapabilityTrustEvent = { ...material, digest: sha256(material) };
      const anchorMaterial = { sequence: event.sequence, root: event.digest, updatedAt: now.toISOString() };
      const anchor: TrustAnchor = { ...anchorMaterial, digest: sha256(anchorMaterial) };
      const pendingMaterial = { event, anchor };
      const pending: PendingTrustWrite = { ...pendingMaterial, digest: sha256(pendingMaterial) };
      atomicReplace(this.#pendingPath, `${JSON.stringify(pending, null, 2)}
`);
      appendAndSync(this.#eventsPath, `${JSON.stringify(event)}
`);
      if (process.env.NODE_ENV === 'test' && process.env.V22_TRUST_CRASH_POINT === 'after-event') throw new Error('injected_trust_crash_after_event');
      atomicReplace(this.#anchorPath, `${JSON.stringify(anchor, null, 2)}
`);
      rmSync(this.#pendingPath, { force: true });
      this.#events.push(event);
      this.#apply(event);
    } finally { release(); }
  }

  #load(): void {
    this.#events.length = 0;
    this.#states.clear();
    this.#recoverPendingWrite();
    if (existsSync(this.#eventsPath)) {
      const lines = readFileSync(this.#eventsPath, 'utf8').split('\n').filter((line) => line.trim() !== '');
      for (const line of lines) {
        const event = JSON.parse(line) as CapabilityTrustEvent;
        this.#events.push(event);
        this.#apply(event);
      }
    }
    if (!existsSync(this.#anchorPath)) {
      if (this.#events.length > 0) throw new Error('capability_trust_anchor_missing');
      this.#writeAnchor({ sequence: 0, root: null, updatedAt: new Date(0).toISOString() });
    }
    const verification = this.verify();
    if (!verification.ok) throw new Error('capability_trust_log_tampered_or_rolled_back');
  }

  #recoverPendingWrite(): void {
    if (!existsSync(this.#pendingPath)) return;
    const pending = JSON.parse(readFileSync(this.#pendingPath, 'utf8')) as PendingTrustWrite;
    const { digest: _pendingDigest, ...pendingMaterial } = pending;
    if (pending.digest !== sha256(pendingMaterial)) throw new Error('capability_trust_pending_write_tampered');
    const { digest: _eventDigest, ...eventMaterial } = pending.event;
    if (pending.event.digest !== sha256(eventMaterial)) throw new Error('capability_trust_pending_event_tampered');
    const { digest: _anchorDigest, ...anchorMaterial } = pending.anchor;
    if (pending.anchor.digest !== sha256(anchorMaterial) || pending.anchor.sequence !== pending.event.sequence || pending.anchor.root !== pending.event.digest) throw new Error('capability_trust_pending_anchor_invalid');
    const events = existsSync(this.#eventsPath)
      ? readFileSync(this.#eventsPath, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as CapabilityTrustEvent)
      : [];
    const last = events.at(-1);
    if (last?.digest !== pending.event.digest) {
      const expectedSequence = events.length + 1;
      const expectedPrevious = last?.digest ?? null;
      if (pending.event.sequence !== expectedSequence || pending.event.previousDigest !== expectedPrevious) throw new Error('capability_trust_pending_write_conflict');
      appendAndSync(this.#eventsPath, `${JSON.stringify(pending.event)}
`);
    }
    atomicReplace(this.#anchorPath, `${JSON.stringify(pending.anchor, null, 2)}
`);
    rmSync(this.#pendingPath, { force: true });
  }

  #acquireWriteLock(timeoutMs = trustLockTimeoutMs()): () => void {
    const started = Date.now();
    while (true) {
      try {
        const fd = openSync(this.#lockPath, 'wx', 0o600);
        const lock = { pid: process.pid, acquiredAt: new Date().toISOString(), nonce: randomUUID() };
        writeFileSync(fd, `${JSON.stringify(lock)}
`); fsyncSync(fd); closeSync(fd);
        return () => { rmSync(this.#lockPath, { force: true }); };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        if (this.#recoverStaleLock()) continue;
        if (Date.now() - started >= timeoutMs) throw new Error('capability_trust_write_lock_timeout');
        sleep(10);
      }
    }
  }

  #recoverStaleLock(): boolean {
    try {
      const parsed = JSON.parse(readFileSync(this.#lockPath, 'utf8')) as { pid?: unknown; acquiredAt?: unknown };
      const pid = typeof parsed.pid === 'number' ? parsed.pid : -1;
      const acquiredAt = typeof parsed.acquiredAt === 'string' ? Date.parse(parsed.acquiredAt) : Number.NaN;
      const stale = !processAlive(pid) || !Number.isFinite(acquiredAt) || Date.now() - acquiredAt > 60_000;
      if (!stale) return false;
      renameSync(this.#lockPath, `${this.#lockPath}.stale-${Date.now()}-${randomUUID()}`);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
  }

  #apply(event: CapabilityTrustEvent): void {
    const stateKey = key(event.tenantId, event.capabilityRef);
    const next = applyCapabilityTrustEvent(this.#states.get(stateKey), event);
    this.#states.set(stateKey, next);
  }

  #readAnchor(): TrustAnchor {
    if (!existsSync(this.#anchorPath)) throw new Error('capability_trust_anchor_missing');
    return JSON.parse(readFileSync(this.#anchorPath, 'utf8')) as TrustAnchor;
  }

  #writeAnchor(material: Omit<TrustAnchor, 'digest'>): void {
    const anchor: TrustAnchor = { ...material, digest: sha256(material) };
    atomicReplace(this.#anchorPath, `${JSON.stringify(anchor, null, 2)}\n`);
  }
}

export function capabilityRef(capabilityId: string, version: string): string {
  if (capabilityId.trim() === '' || version.trim() === '') throw new Error('capability_ref_required');
  return `${capabilityId}@${version}`;
}

function key(tenantId: string, capability: string): string { return `${tenantId}:${capability}`; }
function atomicReplace(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`; const fd = openSync(temporary, 'wx', 0o600); try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temporary, path); }
function appendAndSync(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); const fd = openSync(path, 'a', 0o600); try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } }
function isAlreadyExists(error: unknown): boolean { return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'; }
function processAlive(pid: number): boolean { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function sleep(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function trustLockTimeoutMs(): number { const configured = Number(process.env.V22_TRUST_LOCK_TIMEOUT_MS ?? '10000'); return Number.isFinite(configured) && configured >= 25 ? configured : 10_000; }
