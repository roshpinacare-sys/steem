import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { SigningIdentity } from '../contracts/crypto.js';
import { KeyLifecycleRegistry } from '../security/key-lifecycle.js';
import { PrivateIdentityStore, SlidingWindowRateLimiter, type AuthenticatedPrincipal } from '../security/private-identity.js';
import { WorkflowService } from './workflow-service.js';

export interface PrivatePilotServerOptions {
  readonly dataRoot: string;
  readonly identityStore: PrivateIdentityStore;
  readonly sessionSigningSecret: string;
  readonly bootstrapToken: string;
  readonly passportSignerByTenant: ReadonlyMap<string, SigningIdentity>;
  readonly keyRegistryByTenant: ReadonlyMap<string, KeyLifecycleRegistry>;
  readonly allowedRepositoriesByTenant?: ReadonlyMap<string, readonly string[]>;
  readonly allowedOrigin?: string;
  readonly secureCookies?: boolean;
  readonly now?: () => Date;
}

export function createPrivatePilotServer(options: PrivatePilotServerOptions) {
  const loginLimiter = new SlidingWindowRateLimiter(5, 60_000);
  const actionLimiter = new SlidingWindowRateLimiter(120, 60_000);
  const now = options.now ?? (() => new Date());
  return createServer(async (request, response) => {
    try {
      setSecurityHeaders(response, options.allowedOrigin);
      enforceOrigin(request, options.allowedOrigin);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return servePrivateStatic(url.pathname, response);
      const clientKey = request.socket.remoteAddress ?? 'unknown';
      if (url.pathname === '/api/v20/health' && request.method === 'GET') {
        return sendJson(response, 200, {
          status: 'ok', version: 'v32', readiness: 'Development', promotionBoundary: 'shadow-only',
          authentication: 'persistent-local-private-profile', postgres: 'environment-blocked',
          untrustedRepositoryExecution: 'blocked-until-qualified-isolation', externalMutation: 'disabled',
        });
      }
      if (url.pathname === '/api/v20/login' && request.method === 'POST') {
        loginLimiter.consume(clientKey, now().getTime());
        const body = await readJson(request);
        if (!isObject(body)) throw new HttpError(400, 'login_body_must_be_object');
        if (!constantEqual(String(body.bootstrapToken ?? ''), options.bootstrapToken)) throw new HttpError(401, 'bootstrap_authentication_failed');
        const issued = options.identityStore.issueSession({
          userId: String(body.userId ?? ''), tenantId: String(body.tenantId ?? ''),
          signingSecret: options.sessionSigningSecret, ttlMs: 8 * 60 * 60_000,
        }, now());
        response.setHeader('set-cookie', sessionCookie(issued.token, options.secureCookies === true));
        return sendJson(response, 200, { principal: issued.principal, csrfToken: issued.csrfToken });
      }

      actionLimiter.consume(clientKey, now().getTime());
      const { principal, token } = authenticateRequest(request, options.identityStore, options.sessionSigningSecret, now());
      if (url.pathname === '/api/v20/me' && request.method === 'GET') return sendJson(response, 200, principal);
      if (url.pathname === '/api/v20/operations' && request.method === 'GET') {
        return sendJson(response, 200, workflowFor(options, principal, now()).operations());
      }
      if (url.pathname === '/api/v20/logout' && request.method === 'POST') {
        requireCsrf(request, options.identityStore, principal);
        options.identityStore.revokeSession(principal.sessionId, principal.userId, now());
        response.setHeader('set-cookie', expiredSessionCookie(options.secureCookies === true));
        return sendJson(response, 200, { status: 'logged-out' });
      }
      if (url.pathname === '/api/v20/audit' && request.method === 'GET') {
        options.identityStore.requireRole(principal, ['admin', 'auditor']);
        return sendJson(response, 200, { records: options.identityStore.listAudit(principal.tenantId), chainValid: options.identityStore.verifyAuditChain() });
      }

      const service = workflowFor(options, principal, now());
      if (url.pathname === '/api/v20/fixture' && request.method === 'GET') {
        options.identityStore.requireRole(principal, ['admin', 'operator']);
        return sendJson(response, 200, service.fixture());
      }
      if (url.pathname === '/api/v20/sessions/intake' && request.method === 'POST') {
        requireCsrf(request, options.identityStore, principal);
        options.identityStore.requireRole(principal, ['admin', 'operator']);
        const body = await readJson(request);
        if (!isObject(body)) throw new HttpError(400, 'intake_body_must_be_object');
        return sendJson(response, 201, await service.intake(body));
      }
      const match = url.pathname.match(/^\/api\/v20\/sessions\/([a-f0-9]{24})(?:\/(execute|review|rollback))?$/);
      if (match !== null) {
        const sessionId = match[1];
        if (sessionId === undefined) throw new HttpError(400, 'session_id_missing');
        const action = match[2];
        if (request.method === 'GET' && action === undefined) return sendJson(response, 200, service.get(sessionId));
        requireCsrf(request, options.identityStore, principal);
        if (request.method === 'POST' && action === 'execute') {
          options.identityStore.requireRole(principal, ['admin', 'operator']);
          return sendJson(response, 200, await service.execute(sessionId));
        }
        if (request.method === 'POST' && action === 'review') {
          options.identityStore.requireRole(principal, ['admin', 'reviewer']);
          return sendJson(response, 200, service.review(sessionId, principal.userId));
        }
        if (request.method === 'POST' && action === 'rollback') {
          options.identityStore.requireRole(principal, ['admin', 'operator']);
          return sendJson(response, 200, service.rollback(sessionId));
        }
      }
      throw new HttpError(404, 'not_found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : mapErrorStatus(error);
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(response, status, { error: message });
    }
  });
}

function workflowFor(options: PrivatePilotServerOptions, principal: AuthenticatedPrincipal, now: Date): WorkflowService {
  const signer = options.passportSignerByTenant.get(principal.tenantId);
  const registry = options.keyRegistryByTenant.get(principal.tenantId);
  if (signer === undefined || registry === undefined) throw new HttpError(503, 'tenant_signing_material_unavailable');
  return new WorkflowService(
    join(resolve(options.dataRoot), 'tenants', principal.tenantId, 'workflow'),
    now,
    options.allowedRepositoriesByTenant?.get(principal.tenantId) ?? [],
    { tenantId: principal.tenantId, subjectId: principal.userId, builderId: principal.userId, passportSigner: signer, keyRegistry: registry, now: () => now },
  );
}


function servePrivateStatic(pathname: string, response: ServerResponse): void {
  const filename = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!['index.html', 'pilot.js', 'pilot.css'].includes(filename)) throw new HttpError(404, 'not_found');
  const path = resolve('web-v20', filename);
  const content = readFileSync(path);
  const type = extname(filename) === '.html' ? 'text/html; charset=utf-8' : extname(filename) === '.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
  response.statusCode = 200;
  response.setHeader('content-type', type);
  response.setHeader('content-length', content.byteLength);
  response.end(content);
}

function authenticateRequest(request: IncomingMessage, store: PrivateIdentityStore, signingSecret: string, now: Date): { principal: AuthenticatedPrincipal; token: string } {
  const cookies = parseCookies(request.headers.cookie ?? '');
  const token = cookies.sovereign_session;
  if (token === undefined) throw new HttpError(401, 'authentication_required');
  try { return { principal: store.authenticate(token, signingSecret, now), token }; }
  catch (error) { throw new HttpError(401, error instanceof Error ? error.message : 'authentication_failed'); }
}

function requireCsrf(request: IncomingMessage, store: PrivateIdentityStore, principal: AuthenticatedPrincipal): void {
  const token = request.headers['x-csrf-token'];
  if (typeof token !== 'string' || !store.verifyCsrf(principal.sessionId, token)) throw new HttpError(403, 'csrf_validation_failed');
}

function enforceOrigin(request: IncomingMessage, allowedOrigin: string | undefined): void {
  const origin = request.headers.origin;
  if (origin !== undefined && allowedOrigin !== undefined && origin !== allowedOrigin) throw new HttpError(403, 'origin_not_allowed');
  if (origin !== undefined && allowedOrigin === undefined) throw new HttpError(403, 'cross_origin_requests_disabled');
}

function setSecurityHeaders(response: ServerResponse, allowedOrigin: string | undefined): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), usb=()');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (allowedOrigin !== undefined) response.setHeader('access-control-allow-origin', allowedOrigin);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256_000) throw new HttpError(413, 'request_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new HttpError(400, 'invalid_json'); }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

function sessionCookie(token: string, secure: boolean): string {
  return `sovereign_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`;
}

function expiredSessionCookie(secure: boolean): string {
  return `sovereign_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of header.split(';')) {
    const index = item.indexOf('=');
    if (index <= 0) continue;
    result[item.slice(0, index).trim()] = item.slice(index + 1).trim();
  }
  return result;
}

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not_authorized') || message.includes('role_not_authorized')) return 403;
  if (message.includes('not_found')) return 404;
  if (message.includes('environment_blocked')) return 503;
  return 400;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
