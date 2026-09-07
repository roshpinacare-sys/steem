/**
 * src/http/sovereign-server.ts — zero-dependency HTTP mount for the sovereign API (Node built-in http).
 * Lets the sovereign stack run + be tested end-to-end offline, with NO Express/framework needed.
 * The real TFA server can instead mount the same handlers on Express (see mountOnExpress note below).
 */
import { createServer, type Server } from "node:http";
import { buildSovereignStack } from "../composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { sovereignRoutes, type Route, type Ctx } from "../routes/sovereign-routes.ts";
import { executionRoutes } from "../routes/execution-routes.ts";
import { adapterRoutes } from "../routes/adapter-routes.ts";
import { settlementRoutes } from "../routes/settlement-routes.ts";
import { evalRoutes } from "../routes/eval-routes.ts";
import { indexerRoutes } from "../routes/indexer-routes.ts";
import { sovereigntyRoutes } from "../routes/sovereignty-routes.ts";
import { kidResolverRoutes } from "../routes/kid-resolver-routes.ts";
import { confidenceRoutes } from "../routes/confidence-routes.ts";
import { driftExplainRoutes } from "../routes/drift-explain-routes.ts";
import { killSwitchRoutes } from "../routes/kill-switch-routes.ts";
import { transparencyLogRoutes } from "../routes/transparency-log-routes.ts";
import { witnessRoutes } from "../routes/witness-routes.ts";
import { spendBudgetRoutes } from "../routes/spend-budget-routes.ts";
import { arbitrageRoutes } from "../routes/arbitrage-routes.ts";
import { disputeRoutes } from "../routes/dispute-routes.ts";
import { passportRevocationRoutes } from "../routes/passport-revocation-routes.ts";
import { receiptVerifyRoutes } from "../routes/receipt-verify-routes.ts";
import { mcpRoutes } from "../routes/mcp-routes.ts";
import { ardRoutes } from "../routes/ard-routes.ts";
import { pqcAdminRoutes } from "../routes/pqc-admin-routes.ts";
import { mcpServerFromStack } from "../composition.ts";
import { renderDashboardHtml } from "../dashboard/dashboard.ts";
import { renderSwaggerUiHtml } from "../docs/swagger-ui.ts";
import { InMemoryIdempotencyStore, checkIdempotency, isStateChanging, type IdempotencyStore } from "./idempotency.ts";
import { PgIdempotencyStore, PgIdempotencySync } from "./pg-idempotency-store.ts";
import { CompositeReplayProtection, type ReplayProtection } from "./replay-protection.ts";
import type { DbPool } from "../../lib/db/types.ts";
import { resolveTenantId } from "./tenant-resolver.ts";
import { TokenBucketRateLimiter, DEFAULT_RATE_LIMIT, buildRateLimitHeaders, type RateLimitConfig } from "./rate-limiter.ts";
import { attachRequestId } from "./request-id.ts";
import { StructuredLogger, beginLog, endLog, type LogSink } from "./structured-logger.ts";
// @ts-ignore — runtime-only env checker (plain .mjs, no types by design)
import { checkEnv } from "../../scripts/check-env.mjs";
import { checkLiveness, checkReadiness, type HealthState } from "./health-routes.ts";

export interface SovereignServerOptions {
  rateLimit?: RateLimitConfig;
  /** Production: require a valid x-api-key for every request (also via TFA_REQUIRE_API_KEY=1). */
  requireApiKey?: boolean;
  /**
   * SSO bearer-token secret (v321, RBAC/SSO sub-step 1). When set (or via
   * TFA_SSO_JWT_SECRET), `Authorization: Bearer <jwt>` is accepted as a third
   * tenant-resolution path alongside x-api-key — see tenant-resolver.ts.
   * Unset by default: existing deployments are unaffected.
   */
  ssoJwtSecret?: string;
  logSink?: LogSink;
  /**
   * DbPool for persistence (J1, sub-step: idempotency).
   * When provided AND process.env.TFA_PERSIST === "pg", idempotency records are
   * persisted via PgIdempotencyStore (survives restart) instead of the in-memory
   * map. Falls back to InMemoryIdempotencyStore if omitted — same as before v112.
   */
  pool?: DbPool;
  /**
   * When true, state-changing requests (POST/PUT/PATCH/DELETE) without an
   * Idempotency-Key header are rejected with 400. Defaults to true (v239).
   * Set to false for backward-compatibility during migration.
   */
  requireIdempotencyKey?: boolean;
  /**
   * Per-route rate limit overrides (v249, gap #17 sub-step 1).
   * Override the default per-route caps for specific high-sensitivity endpoints.
   * adapterRun: POST /api/adapter/run (default: 20 req/min per tenant).
   * Missing keys fall back to the built-in defaults.
   */
  routeRateLimits?: {
    adapterRun?: RateLimitConfig;
  };
}

function match(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const rp = r.pattern.split("/"), pp = pathname.split("/");
    if (rp.length !== pp.length) continue;
    const params: Record<string, string> = {}; let okMatch = true;
    for (let i = 0; i < rp.length; i++) { if (rp[i].startsWith(":")) params[rp[i].slice(1)] = decodeURIComponent(pp[i]); else if (rp[i] !== pp[i]) { okMatch = false; break; } }
    if (okMatch) return { route: r, params };
  }
  return null;
}

export type SovereignServer = Server & { shutdown: (timeoutMs?: number) => Promise<void> };

export function startSovereignServer(port = 0, stack?: import("../composition.ts").SovereignStack, opts?: SovereignServerOptions): SovereignServer {
  // ── Startup env validation (check-env, v122) ─────────────────────────────
  // Run FIRST — before buildSovereignStack — so env errors are reported cleanly
  // rather than surfacing as internal composition errors (e.g. "requires a pool").
  // TFA_ENV_CHECK_SKIP=1 disables the check (tests / CI that manually control env).
  const skipEnvCheck = process.env.TFA_ENV_CHECK_SKIP === "1";
  if (!skipEnvCheck) {
    const envResult = checkEnv(process.env as Record<string, string | undefined>);
    for (const w of envResult.warnings) {
      ((opts?.logSink ?? console) as { warn?: (m: string) => void }).warn?.(`[sovereign] env warning: ${w}`);
    }
    if (!envResult.ok) {
      const msg = `[sovereign] startup aborted — env errors:\n${envResult.errors.join("\n")}`;
      process.stderr.write(msg + "\n");
      throw new Error(msg);
    }
  }
  // J1: wire pool into the composition root so TFA_PERSIST=pg actually produces
  // durable stores (ledger→DrizzlePaymentProvider, audit→PgAuditSync, etc.).
  // When opts.pool is present we NEVER override with an in-memory provider.
  // When absent we let buildSovereignStack decide: InMemoryLedger in dev/test,
  // fail-closed throw in production (v126 seam).
  const resolvedStack = stack ?? buildSovereignStack(undefined, opts?.pool ? { pool: opts.pool } : { provider: new InMemoryLedger() });

  // ── Replay protection (gap #5 sub-step 2): unified IdempotencyStore + NonceRegistry ──
  // Falls back to in-memory (v111 behaviour) when no pool or TFA_PERSIST != "pg".
  // Fail-closed is not at stake here (idempotency absence = "proceed", never a security
  // hole) so a missing pool degrades gracefully rather than refusing to boot.
  let idemStore: IdempotencyStore;
  let idemSync: PgIdempotencySync | null = null;
  if (process.env.TFA_PERSIST === "pg" && opts?.pool) {
    const pgIdem = new PgIdempotencyStore(opts.pool);
    pgIdem.init().catch((err: unknown) => {
      console.error("[sovereign] PgIdempotencyStore init failed (idempotency degraded to in-memory):", err);
    });
    idemSync = new PgIdempotencySync(pgIdem);
    idemStore = idemSync;
  } else {
    idemStore = new InMemoryIdempotencyStore();
  }
  const replayProtection: ReplayProtection = new CompositeReplayProtection(idemStore, resolvedStack.nonceRegistry);

  // Merge sovereign routes + execution routes into one table.
  // Execution routes are mounted alongside sovereign routes; the router handles
  // them identically — same Ctx/Res contract, same tenant-isolation guarantee.
  const allRoutes: Route[] = [
    ...sovereignRoutes(resolvedStack),
    ...executionRoutes(resolvedStack.executionStore, resolvedStack.indexerEventBus),
    ...adapterRoutes(resolvedStack.signer, resolvedStack.executionStore, resolvedStack.indexerEventBus, {
      nonceRegistry: replayProtection,
      transparencyLog: resolvedStack.transparencyLog,
    }, resolvedStack.killSwitch),
    ...settlementRoutes(resolvedStack.settlement, resolvedStack.webhookService, resolvedStack.signer, resolvedStack.indexerEventBus, resolvedStack.approvalStore),
    ...evalRoutes(),
    ...indexerRoutes(resolvedStack.readModelStore),
    ...sovereigntyRoutes(resolvedStack),
    ...kidResolverRoutes(resolvedStack),
    ...confidenceRoutes(resolvedStack.signer),
    ...driftExplainRoutes(),
    ...killSwitchRoutes(resolvedStack),
    ...transparencyLogRoutes(resolvedStack),
    ...witnessRoutes(resolvedStack),
    ...spendBudgetRoutes(resolvedStack),
    ...arbitrageRoutes(resolvedStack),
    ...disputeRoutes(resolvedStack),
    ...passportRevocationRoutes(resolvedStack),
    ...receiptVerifyRoutes(resolvedStack.signer),
    ...mcpRoutes(mcpServerFromStack(resolvedStack)),
    ...ardRoutes(resolvedStack),
    ...pqcAdminRoutes(resolvedStack),
  ];

  const rateLimitConfig = opts?.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateLimiter = new TokenBucketRateLimiter(rateLimitConfig);

  /**
   * Per-route rate limiters (gap #17 sub-step 1, v249).
   * Tighter caps on sensitive endpoints independent of global per-tenant limit.
   * Key format: `${tenantId}:${method}:${pathname}` to allow per-tenant tracking.
   * Config is intentionally strict: AI action submission is expensive and
   * should not be saturated by a single tenant in a burst.
   */
  const ROUTE_RATE_LIMITS: Array<{ method: string; pattern: string; config: RateLimitConfig }> = [
    // POST /api/adapter/run — AI action submission through the Trust Gate.
    // Default: 1000 requests/minute per tenant (burst-tolerant for load tests
    // and CI). In production, operators should configure a tighter cap via
    // opts.routeRateLimits.adapterRun (e.g. 60 req/min for paid plan enforcement).
    {
      method: "POST",
      pattern: "/api/adapter/run",
      config: opts?.routeRateLimits?.adapterRun ?? { windowMs: 60_000, maxRequests: 1000 },
    },
  ];
  const routeLimiters = new Map<string, TokenBucketRateLimiter>(
    ROUTE_RATE_LIMITS.map((r) => [
      `${r.method}:${r.pattern}`,
      new TokenBucketRateLimiter(r.config),
    ]),
  );

  const logger = new StructuredLogger(opts?.logSink);

  // ── Health state (shared by healthz/readyz handlers) ─────────────────────
  const healthState: HealthState = {
    draining: false,
    monitor: resolvedStack.monitor,
    pool: opts?.pool,
    auditStore: resolvedStack.auditStore,
    signer: resolvedStack.signer,
  };

  // ── In-flight request counter (for graceful drain) ────────────────────────
  let inFlight = 0;
  let drainResolve: (() => void) | null = null;

  const server = createServer(async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    // ── Query params (for indexer routes etc.) ──────────────────────────────
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });

    // ── Health probes — unauthenticated, short-circuit before all middleware ─
    if (req.method === "GET" && url.pathname === "/healthz") {
      const result = checkLiveness(healthState);
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.body));
    }
    if (req.method === "GET" && url.pathname === "/readyz") {
      const result = await checkReadiness(healthState);
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.body));
    }

    if (req.method === "GET" && url.pathname === "/dashboard") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(renderDashboardHtml());
    }
    if (req.method === "GET" && url.pathname === "/api/docs") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(renderSwaggerUiHtml("/api/openapi.yaml"));
    }
    if (req.method === "GET" && url.pathname === "/api/openapi.yaml") {
      const specPath = new URL("../../lib/api-spec/openapi.yaml", import.meta.url);
      try {
        const spec = await import("node:fs").then((fs) => fs.promises.readFile(specPath, "utf8"));
        res.writeHead(200, { "content-type": "text/yaml; charset=utf-8" });
        return res.end(spec);
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "spec not available" }));
      }
    }
    const m = match(allRoutes, req.method || "GET", url.pathname);

    // ── Request ID ─────────────────────────────────────────────────────────
    const { id: reqId } = attachRequestId(req, res);
    (req as any)._requestId = reqId;

    const send = (status: number, body: any, extraHeaders?: Record<string, string>) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (extraHeaders) Object.assign(headers, extraHeaders);
      res.writeHead(status, headers);
      res.end(JSON.stringify(body, (_k, v) => typeof v === "bigint" ? v.toString() : v));
    };

    if (!m) {
      const logCtx = beginLog(req);
      send(404, { error: "no route" });
      endLog(logCtx, 404, { logger });
      return;
    }

    // ── Track in-flight requests for graceful drain ───────────────────────
    inFlight++;
    res.on("finish", () => {
      inFlight--;
      if (inFlight === 0 && drainResolve !== null) {
        drainResolve();
        drainResolve = null;
      }
    });

    resolveTenantId(resolvedStack.apiKeyService, req.headers as Record<string, string | string[] | undefined>, opts?.requireApiKey, opts?.ssoJwtSecret).then((resolved) => {
      if (resolved.error) {
        const logCtx = beginLog(req);
        const status = resolved.status ?? 400;
        send(status, { error: resolved.error });
        endLog(logCtx, status, { logger });
        return;
      }
      const tenantId = resolved.tenantId!;
      (req as any)._tenantId = tenantId;

      // ── Rate limit (per tenant, global) ─────────────────────────────────
      const rateResult = rateLimiter.consume(tenantId);
      const rlHeaders = buildRateLimitHeaders(rateLimitConfig, rateResult);
      if (!rateResult.allowed) {
        const logCtx = beginLog(req);
        send(429, { error: "rate limit exceeded" }, rlHeaders);
        endLog(logCtx, 429, { error: "rate limit exceeded", logger });
        return;
      }

      // ── Rate limit (per route, tighter caps on sensitive endpoints) ──────
      // v249: POST /api/adapter/run gets a stricter cap (default 20 req/min).
      // Returns 429 with x-ratelimit-scope=route + Retry-After to distinguish
      // from the global per-tenant limit.
      const routeLimiterKey = `${req.method}:${url.pathname}`;
      const routeLimiter = routeLimiters.get(routeLimiterKey);
      if (routeLimiter) {
        const routeConsumeKey = `${tenantId}:${routeLimiterKey}`;
        const routeResult = routeLimiter.consume(routeConsumeKey);
        if (!routeResult.allowed) {
          const routeCfg = ROUTE_RATE_LIMITS.find(
            (r) => r.method === req.method && r.pattern === url.pathname,
          )!.config;
          const routeRlHeaders = {
            ...buildRateLimitHeaders(routeCfg, routeResult),
            "x-ratelimit-scope": "route",
            "retry-after": String(Math.ceil(Math.max(0, routeResult.resetAt - Date.now()) / 1000)),
          };
          const logCtx = beginLog(req);
          send(429, { error: "route rate limit exceeded" }, routeRlHeaders);
          endLog(logCtx, 429, { error: "route rate limit exceeded", logger });
          return;
        }
      }

      let raw = ""; req.on("data", (d: Buffer) => { raw += d; if (raw.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        const logCtx = beginLog(req);
        let body: any = {}; if (raw) { try { body = JSON.parse(raw); } catch { send(400, { error: "invalid JSON" }, rlHeaders); endLog(logCtx, 400, { error: "invalid JSON", logger }); return; } }
        // ── Idempotency (v111→v239): safe retries + enforcement (default true) ──
        const idemKey = isStateChanging(req.method || "") ? String(req.headers["idempotency-key"] || "") : "";
        const requireIdem = opts?.requireIdempotencyKey !== false; // default true
        if (requireIdem && isStateChanging(req.method || "") && !idemKey) {
          send(400, { error: "Idempotency-Key header is required for state-changing requests" }, rlHeaders);
          return;
        }
        if (idemKey) {
          if (idemSync) await idemSync.preload(tenantId, idemKey);
          const decision = checkIdempotency(idemStore, tenantId, idemKey, req.method || "POST", url.pathname);
          if (decision.kind === "replay") { send(decision.status, decision.body, { ...rlHeaders, "idempotency-replayed": "true" }); endLog(logCtx, decision.status, { logger }); return; }
          if (decision.kind === "conflict") { send(decision.status, decision.body, rlHeaders); endLog(logCtx, decision.status, { logger }); return; }
          try { const ctx: Ctx = { tenantId, body, params: m.params, query, headers: req.headers as any, scopes: resolved.scopes }; const r = await m.route.handler(ctx); decision.finish(r.status, r.body); send(r.status, r.body, { ...rlHeaders, ...(r.headers ?? {}) }); endLog(logCtx, r.status, { logger }); }
          catch (e: any) { decision.abort(); send(500, { error: e?.message || "internal error" }, rlHeaders); endLog(logCtx, 500, { error: e?.message || "internal error", logger }); }
          return;
        }
        try { const ctx: Ctx = { tenantId, body, params: m.params, query, headers: req.headers as any, scopes: resolved.scopes }; const r = await m.route.handler(ctx); send(r.status, r.body, { ...rlHeaders, ...(r.headers ?? {}) }); endLog(logCtx, r.status, { logger }); }
        catch (e: any) { send(500, { error: e?.message || "internal error" }, rlHeaders); endLog(logCtx, 500, { error: e?.message || "internal error", logger }); }
      });
    });
  });
  server.listen(port);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const activeSockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => activeSockets.delete(socket));
  });

  let shutdownStarted = false;
  async function shutdown(timeoutMs = 10_000): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;
    healthState.draining = true;

    // 1. Stop accepting new connections (callback fires when all connections are gone)
    const closePromise = new Promise<void>((resolve) => server.close(() => resolve()));

    // 2. Close idle keep-alive connections immediately so the in-flight drain can progress
    if (typeof (server as any).closeIdleConnections === "function") {
      (server as any).closeIdleConnections();
    }

    // 3. Wait for in-flight requests to drain (up to timeoutMs)
    if (inFlight > 0) {
      await Promise.race([
        new Promise<void>((resolve) => { drainResolve = resolve; }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }

    // 4. Force-close any sockets still open (clients that ignored idle-close or raw TCP conns)
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    } else {
      for (const sock of activeSockets) {
        try { sock.destroy(); } catch { /* best-effort */ }
      }
    }
    activeSockets.clear();

    // 5. Now that all sockets are closed, await server.close() to finish
    await closePromise;

    // 6. Close pool if present
    if (opts?.pool && typeof (opts.pool as any).end === "function") {
      try { await (opts.pool as any).end(); } catch { /* best-effort */ }
    }

    // 7. Stop the solvency monitor
    if ((resolvedStack as any).monitor && typeof (resolvedStack as any).monitor.stop === "function") {
      (resolvedStack as any).monitor.stop();
    }
  }

  return Object.assign(server, { shutdown }) as SovereignServer;
}

/**
 * Wire SIGTERM/SIGINT handlers for a SovereignServer so container orchestrators
 * receive a clean exit(0). Exported for programmatic use (e.g. Express mount).
 */
export function wireGracefulShutdown(
  server: SovereignServer,
  opts?: { timeoutMs?: number; signals?: ("SIGTERM" | "SIGINT")[] },
): void {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const signals = opts?.signals ?? ["SIGTERM", "SIGINT"];
  for (const sig of signals) {
    process.once(sig, () => {
      console.log(`[sovereign] ${sig} received — starting graceful shutdown`);
      server.shutdown(timeoutMs).then(() => {
        console.log("[sovereign] shutdown complete");
        process.exit(0);
      }).catch((err: unknown) => {
        console.error("[sovereign] shutdown error:", err);
        process.exit(1);
      });
    });
  }
}

// For real TFA (Express 5): import { sovereignRoutes, executionRoutes } and buildSovereignStack(),
// then for each route do app[r.method.toLowerCase()](r.pattern, (req,res)=>
// r.handler({tenantId:req.header('x-tenant-id'), body:req.body, params:req.params})
// .then(o=>res.status(o.status).json(o.body))). Same handlers, no rewrite.

if (process.argv[1] && process.argv[1].endsWith("sovereign-server.ts")) {
  const s = startSovereignServer(Number(process.env.PORT) || 7700);
  const addr = s.address();
  console.log("[sovereign] listening", typeof addr === "object" ? addr?.port : addr);

  // Graceful shutdown on SIGTERM/SIGINT (exit 0 so container orchestrators know it was clean)
  wireGracefulShutdown(s, { timeoutMs: 10_000, signals: ["SIGTERM", "SIGINT"] });
}
