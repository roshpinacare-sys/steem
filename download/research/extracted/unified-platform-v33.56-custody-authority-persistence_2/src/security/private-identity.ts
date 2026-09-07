import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson, sha256 } from '../contracts/crypto.js';

export const PILOT_ROLES = ['admin', 'operator', 'reviewer', 'auditor'] as const;
export type PilotRole = (typeof PILOT_ROLES)[number];

export interface UserRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly createdAt: string;
}

export interface TenantRecord {
  readonly tenantId: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly createdAt: string;
}

export interface MembershipRecord {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: readonly PilotRole[];
  readonly status: 'ACTIVE' | 'REVOKED';
}

interface StoredSession {
  readonly sessionId: string;
  readonly tokenDigest: string;
  readonly csrfDigest: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly PilotRole[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

interface AuditRecord {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly action: string;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly subjectId?: string;
  readonly digest: string;
  readonly previousDigest: string | null;
}

interface IdentityState {
  readonly version: 1;
  readonly users: readonly UserRecord[];
  readonly tenants: readonly TenantRecord[];
  readonly memberships: readonly MembershipRecord[];
  readonly sessions: readonly StoredSession[];
  readonly audits: readonly AuditRecord[];
}

interface SessionTokenPayload {
  readonly version: 1;
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly PilotRole[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface AuthenticatedPrincipal {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly PilotRole[];
  readonly expiresAt: string;
}

export interface IssuedSession {
  readonly token: string;
  readonly csrfToken: string;
  readonly principal: AuthenticatedPrincipal;
}

export class PrivateIdentityStore {
  readonly #path: string;
  #state: IdentityState;

  constructor(path: string) {
    this.#path = resolve(path);
    this.#state = existsSync(this.#path)
      ? JSON.parse(readFileSync(this.#path, 'utf8')) as IdentityState
      : { version: 1, users: [], tenants: [], memberships: [], sessions: [], audits: [] };
    validateState(this.#state);
    if (!existsSync(this.#path)) this.#save();
  }

  bootstrap(input: { readonly tenant: TenantRecord; readonly users: readonly UserRecord[]; readonly memberships: readonly MembershipRecord[] }, now = new Date()): void {
    const tenants = mergeBy(this.#state.tenants, [input.tenant], 'tenantId');
    const users = mergeBy(this.#state.users, input.users, 'userId');
    const memberships = mergeMemberships(this.#state.memberships, input.memberships);
    this.#state = { ...this.#state, tenants, users, memberships };
    this.#appendAudit('IDENTITY_BOOTSTRAP', 'system-bootstrap', input.tenant.tenantId, undefined, now);
    this.#save();
  }

  issueSession(input: { readonly userId: string; readonly tenantId: string; readonly signingSecret: string; readonly ttlMs: number }, now = new Date()): IssuedSession {
    validateSecret(input.signingSecret);
    if (!Number.isInteger(input.ttlMs) || input.ttlMs < 60_000 || input.ttlMs > 24 * 60 * 60_000) throw new Error('invalid_session_ttl');
    const user = this.#state.users.find((item) => item.userId === input.userId);
    const tenant = this.#state.tenants.find((item) => item.tenantId === input.tenantId);
    const membership = this.#state.memberships.find((item) => item.userId === input.userId && item.tenantId === input.tenantId);
    if (user === undefined || user.status !== 'ACTIVE') throw new Error('user_not_active');
    if (tenant === undefined || tenant.status !== 'ACTIVE') throw new Error('tenant_not_active');
    if (membership === undefined || membership.status !== 'ACTIVE') throw new Error('membership_not_active');
    const sessionId = randomBytes(18).toString('hex');
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const payload: SessionTokenPayload = {
      version: 1,
      sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      roles: [...membership.roles].sort(),
      issuedAt,
      expiresAt,
      nonce: randomBytes(16).toString('base64url'),
    };
    const token = encodeToken(payload, input.signingSecret);
    const csrfToken = randomBytes(32).toString('base64url');
    const stored: StoredSession = {
      sessionId,
      tokenDigest: sha256(token),
      csrfDigest: sha256(csrfToken),
      userId: input.userId,
      tenantId: input.tenantId,
      roles: payload.roles,
      issuedAt,
      expiresAt,
    };
    this.#state = { ...this.#state, sessions: [...this.#state.sessions, stored] };
    this.#appendAudit('SESSION_ISSUED', input.userId, input.tenantId, sessionId, now);
    this.#save();
    return { token, csrfToken, principal: toPrincipal(payload) };
  }

  authenticate(token: string, signingSecret: string, now = new Date()): AuthenticatedPrincipal {
    validateSecret(signingSecret);
    const payload = decodeToken(token, signingSecret);
    const stored = this.#state.sessions.find((session) => session.sessionId === payload.sessionId);
    if (stored === undefined || stored.tokenDigest !== sha256(token)) throw new Error('session_not_found');
    if (stored.revokedAt !== undefined) throw new Error('session_revoked');
    if (now.getTime() >= Date.parse(stored.expiresAt) || now.getTime() >= Date.parse(payload.expiresAt)) throw new Error('session_expired');
    if (stored.userId !== payload.userId || stored.tenantId !== payload.tenantId || canonicalJson(stored.roles) !== canonicalJson(payload.roles)) throw new Error('session_claim_mismatch');
    const user = this.#state.users.find((item) => item.userId === payload.userId);
    const tenant = this.#state.tenants.find((item) => item.tenantId === payload.tenantId);
    const membership = this.#state.memberships.find((item) => item.userId === payload.userId && item.tenantId === payload.tenantId);
    if (user?.status !== 'ACTIVE' || tenant?.status !== 'ACTIVE' || membership?.status !== 'ACTIVE') throw new Error('session_authority_revoked');
    if (canonicalJson([...membership.roles].sort()) !== canonicalJson(payload.roles)) throw new Error('session_role_stale');
    return toPrincipal(payload);
  }

  verifyCsrf(sessionId: string, csrfToken: string): boolean {
    const stored = this.#state.sessions.find((session) => session.sessionId === sessionId && session.revokedAt === undefined);
    if (stored === undefined) return false;
    const actual = Buffer.from(stored.csrfDigest, 'hex');
    const supplied = Buffer.from(sha256(csrfToken), 'hex');
    return actual.byteLength === supplied.byteLength && timingSafeEqual(actual, supplied);
  }

  requireRole(principal: AuthenticatedPrincipal, allowed: readonly PilotRole[]): void {
    if (!principal.roles.some((role) => allowed.includes(role))) throw new Error('role_not_authorized');
  }

  revokeSession(sessionId: string, actorId: string, now = new Date()): void {
    const current = this.#state.sessions.find((session) => session.sessionId === sessionId);
    if (current === undefined) throw new Error('session_not_found');
    const sessions = this.#state.sessions.map((session) => session.sessionId === sessionId ? { ...session, revokedAt: now.toISOString() } : session);
    this.#state = { ...this.#state, sessions };
    this.#appendAudit('SESSION_REVOKED', actorId, current.tenantId, sessionId, now);
    this.#save();
  }

  revokeMembership(tenantId: string, userId: string, actorId: string, now = new Date()): void {
    let found = false;
    const memberships = this.#state.memberships.map((membership) => {
      if (membership.tenantId === tenantId && membership.userId === userId) {
        found = true;
        return { ...membership, status: 'REVOKED' as const };
      }
      return membership;
    });
    if (!found) throw new Error('membership_not_found');
    this.#state = { ...this.#state, memberships };
    this.#appendAudit('MEMBERSHIP_REVOKED', actorId, tenantId, userId, now);
    this.#save();
  }

  listAudit(tenantId: string): readonly AuditRecord[] {
    return this.#state.audits.filter((record) => record.tenantId === tenantId || record.tenantId === undefined).map((record) => structuredClone(record));
  }

  verifyAuditChain(): boolean {
    let previous: string | null = null;
    for (const record of this.#state.audits) {
      const { digest, ...material } = record;
      if (record.previousDigest !== previous || digest !== sha256(material)) return false;
      previous = digest;
    }
    return true;
  }

  #appendAudit(action: string, actorId: string, tenantId: string | undefined, subjectId: string | undefined, now: Date): void {
    const previousDigest = this.#state.audits.at(-1)?.digest ?? null;
    const material = {
      sequence: this.#state.audits.length + 1,
      occurredAt: now.toISOString(),
      action,
      actorId,
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(subjectId === undefined ? {} : { subjectId }),
      previousDigest,
    };
    const record: AuditRecord = { ...material, digest: sha256(material) };
    this.#state = { ...this.#state, audits: [...this.#state.audits, record] };
  }

  #save(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.#path);
  }
}

export class SlidingWindowRateLimiter {
  readonly #events = new Map<string, number[]>();
  constructor(readonly limit: number, readonly windowMs: number) {
    if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowMs) || windowMs <= 0) throw new Error('invalid_rate_limit');
  }
  consume(key: string, nowMs = Date.now()): void {
    const earliest = nowMs - this.windowMs;
    const current = (this.#events.get(key) ?? []).filter((value) => value > earliest);
    if (current.length >= this.limit) throw new Error('rate_limit_exceeded');
    current.push(nowMs);
    this.#events.set(key, current);
  }
}

function encodeToken(payload: SessionTokenPayload, secret: string): string {
  const encoded = Buffer.from(canonicalJson(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function decodeToken(token: string, secret: string): SessionTokenPayload {
  const [encoded, suppliedSignature, extra] = token.split('.');
  if (encoded === undefined || suppliedSignature === undefined || extra !== undefined) throw new Error('invalid_session_token');
  const expected = createHmac('sha256', secret).update(encoded).digest();
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) throw new Error('invalid_session_signature');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionTokenPayload;
  if (payload.version !== 1 || payload.sessionId.trim() === '' || !Number.isFinite(Date.parse(payload.issuedAt)) || !Number.isFinite(Date.parse(payload.expiresAt))) throw new Error('invalid_session_claims');
  if (!payload.roles.every((role) => PILOT_ROLES.includes(role))) throw new Error('invalid_session_roles');
  return payload;
}

function toPrincipal(payload: SessionTokenPayload): AuthenticatedPrincipal {
  return { sessionId: payload.sessionId, userId: payload.userId, tenantId: payload.tenantId, roles: payload.roles, expiresAt: payload.expiresAt };
}

function validateSecret(secret: string): void {
  if (secret.length < 32) throw new Error('session_signing_secret_too_short');
}

function validateState(state: IdentityState): void {
  if (state.version !== 1) throw new Error('identity_state_version_unsupported');
  if (!Array.isArray(state.users) || !Array.isArray(state.tenants) || !Array.isArray(state.memberships) || !Array.isArray(state.sessions) || !Array.isArray(state.audits)) throw new Error('invalid_identity_state');
}

function mergeBy<T extends Record<K, string>, K extends keyof T>(current: readonly T[], incoming: readonly T[], key: K): readonly T[] {
  const map = new Map<string, T>(current.map((item) => [item[key], item]));
  for (const item of incoming) {
    const existing = map.get(item[key]);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(item)) throw new Error(`identity_bootstrap_conflict:${String(item[key])}`);
    map.set(item[key], item);
  }
  return [...map.values()];
}

function mergeMemberships(current: readonly MembershipRecord[], incoming: readonly MembershipRecord[]): readonly MembershipRecord[] {
  const map = new Map(current.map((item) => [`${item.tenantId}:${item.userId}`, item]));
  for (const item of incoming) {
    if (item.roles.length === 0 || !item.roles.every((role) => PILOT_ROLES.includes(role))) throw new Error('invalid_membership_roles');
    const key = `${item.tenantId}:${item.userId}`;
    const existing = map.get(key);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(item)) throw new Error(`membership_bootstrap_conflict:${key}`);
    map.set(key, { ...item, roles: [...new Set(item.roles)].sort() });
  }
  return [...map.values()];
}
