/**
 * src/http/express-adapter.ts — Express 5 adapter for sovereign API routes.
 *
 * Bridges the framework-agnostic sovereignRoutes (Ctx/Res contract) to Express 5.
 * Uses `import type` for all Express types so this file is importable in offline
 * tests (node --experimental-strip-types erases type imports — no express module
 * is required unless mountSovereignRoutes is actually called at runtime).
 *
 * Usage in the main TFA Express app:
 *
 *   import express from "express";
 *   import { mountSovereignRoutes } from "./sovereign/src/http/express-adapter.js";
 *   import { buildSovereignStack } from "./sovereign/src/composition.js";
 *
 *   const app = express();
 *   app.use(express.json());
 *   mountSovereignRoutes(app, buildSovereignStack());
 *
 * The sovereign stack ships with InMemoryLedger by default. For production
 * Drizzle/Postgres persistence, implement PaymentProvider against your Drizzle
 * schema and pass the resulting stack: buildSovereignStack(policies, opts).
 *
 * See: lib/ledger/types.ts → PaymentProvider interface.
 *      lib/db/in-memory-driver.ts → reference implementation pattern.
 */

import type { Router, Request, Response, NextFunction } from "express";
import type { SovereignStack } from "../composition.ts";
import { sovereignRoutes, type Ctx } from "../routes/sovereign-routes.ts";
import { adapterRoutes } from "../routes/adapter-routes.ts";
import { executionRoutes } from "../routes/execution-routes.ts";
import { settlementRoutes } from "../routes/settlement-routes.ts";
import { evalRoutes } from "../routes/eval-routes.ts";
import { indexerRoutes } from "../routes/indexer-routes.ts";
import { sovereigntyRoutes } from "../routes/sovereignty-routes.ts";
import { confidenceRoutes } from "../routes/confidence-routes.ts";
import { killSwitchRoutes } from "../routes/kill-switch-routes.ts";
import { introductionRoutes } from "../routes/introduction-routes.ts";
import { receiptVerifyRoutes } from "../routes/receipt-verify-routes.ts";
import { resolveTenantId } from "./tenant-resolver.ts";
import { TokenBucketRateLimiter, DEFAULT_RATE_LIMIT, buildRateLimitHeaders, type RateLimitConfig } from "./rate-limiter.ts";
import { attachRequestId } from "./request-id.ts";
import { StructuredLogger, beginLog, endLog, type LogSink } from "./structured-logger.ts";
import { InMemoryIdempotencyStore, checkIdempotency, isStateChanging, type IdempotencyStore } from "./idempotency.ts";
import { PgIdempotencyStore, PgIdempotencySync } from "./pg-idempotency-store.ts";
import { CompositeReplayProtection, type ReplayProtection } from "./replay-protection.ts";
import type { DbPool } from "../../lib/db/types.ts";

export interface SovereignHttpOptions {
  /** Rate-limit config; defaults to 100 req / 60s per tenant. */
  rateLimit?: RateLimitConfig;
  /**
   * SSO bearer-token secret (v321, RBAC/SSO sub-step 1). When set (or via
   * TFA_SSO_JWT_SECRET), `Authorization: Bearer <jwt>` is accepted as a third
   * tenant-resolution path alongside x-api-key — see tenant-resolver.ts.
   * Unset by default: existing deployments are unaffected.
   */
  ssoJwtSecret?: string;
  /** Custom log sink (default = JSON line to stdout). Pass a no-op in tests. */
  logSink?: LogSink;
  /**
   * DbPool for idempotency persistence (J1, sub-step: idempotency).
   * When provided AND process.env.TFA_PERSIST === "pg", idempotency records are
   * persisted via PgIdempotencyStore. Falls back to InMemoryIdempotencyStore if omitted.
   */
  pool?: DbPool;
  /**
   * When true, state-changing requests (POST/PUT/PATCH/DELETE) without an
   * Idempotency-Key header are rejected with 400. Defaults to true (v239).
   * Set to false for backward-compatibility during migration.
   */
  requireIdempotencyKey?: boolean;
}

// ─── BigInt-safe JSON serialisation ──────────────────────────────────────────

/**
 * Express's `res.json()` calls `JSON.stringify` which throws on BigInt values.
 * Sovereign amounts are BigInt μ¢ — serialize them as decimal strings instead.
 */
function bigIntSafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register all sovereign API routes onto an Express Router (or Express app).
 *
 * Tenant isolation is enforced at the adapter boundary:
 *   - Missing `x-tenant-id` header → 400 before the handler is invoked.
 *   - Each Ctx carries the validated tenantId; handlers filter by it.
 *
 * @param router - Express Router or Express app (both expose the same verb methods).
 * @param stack  - A built SovereignStack (call buildSovereignStack() once per process).
 */
export function mountSovereignRoutes(
  router: Router,
  stack: SovereignStack,
  opts?: SovereignHttpOptions,
): void {
  const rateLimitConfig = opts?.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateLimiter = new TokenBucketRateLimiter(rateLimitConfig);
  const logger = new StructuredLogger(opts?.logSink);

  // ── Replay protection (gap #5 sub-step 2): unified IdempotencyStore + NonceRegistry ──
  let idemStore: IdempotencyStore;
  let idemSync: PgIdempotencySync | null = null;
  if (process.env.TFA_PERSIST === "pg" && opts?.pool) {
    const pgIdem = new PgIdempotencyStore(opts.pool);
    pgIdem.init().catch((err: unknown) => {
      console.error("[express-adapter] PgIdempotencyStore init failed (degraded to in-memory):", err);
    });
    idemSync = new PgIdempotencySync(pgIdem);
    idemStore = idemSync;
  } else {
    idemStore = new InMemoryIdempotencyStore();
  }
  const replayProtection: ReplayProtection = new CompositeReplayProtection(idemStore, stack.nonceRegistry);

  const routes = [
    ...sovereignRoutes(stack),
    ...adapterRoutes(stack.signer, stack.executionStore, stack.indexerEventBus, {
      nonceRegistry: replayProtection,
    }),
    ...executionRoutes(stack.executionStore, stack.indexerEventBus),
    ...settlementRoutes(stack.settlement, stack.webhookService, stack.signer, stack.indexerEventBus, stack.approvalStore),
    ...evalRoutes(),
    ...indexerRoutes(stack.readModelStore),
    ...sovereigntyRoutes(stack),
    ...confidenceRoutes(stack.signer),
    ...killSwitchRoutes(stack),
    ...introductionRoutes(stack),
    ...receiptVerifyRoutes(stack.signer),
  ];

  function setHeaders(res: Response, headers: Record<string, string>): void {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof res.setHeader === "function") {
        res.setHeader(k, v);
      }
    }
  }

  for (const route of routes) {
    const method = route.method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "delete"
      | "patch";

    (router as unknown as Record<string, Function>)[method](
      route.pattern,
      async (req: Request, res: Response, _next: NextFunction) => {
        // ── Request ID ──────────────────────────────────────────────────────
        const { id: reqId } = attachRequestId(req, res);
        (req as any)._requestId = reqId;

        // ── Tenant resolution ───────────────────────────────────────────────
        const resolved = await resolveTenantId(stack.apiKeyService, req.headers as Record<string, string | string[] | undefined>, undefined, opts?.ssoJwtSecret);
        if (resolved.error) {
          const logCtx = beginLog(req);
          const status = resolved.status ?? 400;
          res.status(status).type("json").send(bigIntSafe({ error: resolved.error }));
          endLog(logCtx, status, { logger });
          return;
        }
        const tenantId = resolved.tenantId!;
        (req as any)._tenantId = tenantId;

        // ── Rate limit (per tenant) ────────────────────────────────────────
        const rateResult = rateLimiter.consume(tenantId);
        const rlHeaders = buildRateLimitHeaders(rateLimitConfig, rateResult);
        if (!rateResult.allowed) {
          const logCtx = beginLog(req);
          setHeaders(res, rlHeaders);
          res.status(429).type("json").send(bigIntSafe({ error: "rate limit exceeded" }));
          endLog(logCtx, 429, { error: "rate limit exceeded", logger });
          return;
        }

        // ── Idempotency (v227→v239): safe retries + enforcement (default true) ──
        const idemKey = isStateChanging(req.method || "") ? String(req.headers["idempotency-key"] || "") : "";
        const requireIdem = opts?.requireIdempotencyKey !== false; // default true
        if (requireIdem && isStateChanging(req.method || "") && !idemKey) {
          setHeaders(res, rlHeaders);
          res.status(400).type("json").send(bigIntSafe({ error: "Idempotency-Key header is required for state-changing requests" }));
          return;
        }
        if (idemKey) {
          if (idemSync) await idemSync.preload(tenantId, idemKey);
          const decision = checkIdempotency(idemStore, tenantId, idemKey, req.method || "POST", req.path || route.pattern);
          if (decision.kind === "replay") {
            setHeaders(res, { ...rlHeaders, "idempotency-replayed": "true" });
            res.status(decision.status).type("json").send(bigIntSafe(decision.body));
            return;
          }
          if (decision.kind === "conflict") {
            setHeaders(res, rlHeaders);
            res.status(decision.status).type("json").send(bigIntSafe(decision.body));
            return;
          }
          const logCtx = beginLog(req);
          try {
            const ctx: Ctx = {
              tenantId,
              body: (req as any).body ?? {},
              params: req.params as Record<string, string>,
              scopes: resolved.scopes,
            };
            const result = await route.handler(ctx);
            decision.finish(result.status, result.body);
            setHeaders(res, rlHeaders);
            res.status(result.status).type("json").send(bigIntSafe(result.body));
            endLog(logCtx, result.status, { logger });
          } catch (err: unknown) {
            decision.abort();
            const msg = err instanceof Error ? err.message : "internal error";
            setHeaders(res, rlHeaders);
            res.status(500).type("json").send(bigIntSafe({ error: msg }));
            endLog(logCtx, 500, { error: msg, logger });
          }
          return;
        }

        // ── Route handler + structured log ─────────────────────────────────
        const logCtx = beginLog(req);
        try {
          const ctx: Ctx = {
            tenantId,
            body: (req as any).body ?? {},
            params: req.params as Record<string, string>,
            scopes: resolved.scopes,
          };
          const result = await route.handler(ctx);
          setHeaders(res, rlHeaders);
          res.status(result.status).type("json").send(bigIntSafe(result.body));
          endLog(logCtx, result.status, { logger });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "internal error";
          setHeaders(res, rlHeaders);
          res.status(500).type("json").send(bigIntSafe({ error: msg }));
          endLog(logCtx, 500, { error: msg, logger });
        }
      },
    );
  }
}

/**
 * Count how many routes would be mounted for a given stack.
 * Includes sovereign core, adapter, execution, settlement, eval, indexer,
 * sovereignty, confidence, kill-switch, and introduction routes.
 */
export function sovereignRouteCount(stack: SovereignStack): number {
  return listSovereignRoutes(stack).length;
}

/**
 * Return a plain description of all routes (method + pattern) without touching
 * Express at all. Handy for documentation generation and smoke tests.
 * Includes all route families mounted by mountSovereignRoutes.
 */
export function listSovereignRoutes(
  stack: SovereignStack,
): Array<{ method: string; pattern: string }> {
  return [
    ...sovereignRoutes(stack),
    ...adapterRoutes(stack.signer, stack.executionStore, stack.indexerEventBus, {
      nonceRegistry: stack.nonceRegistry,
    }),
    ...executionRoutes(stack.executionStore, stack.indexerEventBus),
    ...settlementRoutes(stack.settlement, stack.webhookService, stack.signer, stack.indexerEventBus, stack.approvalStore),
    ...evalRoutes(),
    ...indexerRoutes(stack.readModelStore),
    ...sovereigntyRoutes(stack),
    ...confidenceRoutes(stack.signer),
    ...killSwitchRoutes(stack),
    ...introductionRoutes(stack),
    ...receiptVerifyRoutes(stack.signer),
  ].map((r) => ({
    method: r.method,
    pattern: r.pattern,
  }));
}
