/**
 * src/http/health-routes.ts — Health & readiness endpoints for TFA.
 *
 * GET /healthz — liveness probe.
 *   Always returns 200 {"status":"ok"} if the process is alive and not draining.
 *   Returns 503 {"status":"draining"} once graceful shutdown has begun.
 *
 * GET /readyz — readiness probe.
 *   Returns 200 when the server is ready to serve traffic:
 *     • not draining
 *     • DB reachable (if pool is configured)
 *     • last solvency check passed (if monitor has run at least once)
 *     • audit chain verified (if auditStore is configured)
 *   Returns 503 with a checks object listing failures when not ready.
 *
 * Both endpoints are intentionally unauthenticated (no x-tenant-id required)
 * so load-balancers can poll them without credentials.
 */

import type { LedgerCron } from "../monitor/ledger-cron.ts";
import type { DbPool } from "../../lib/db/types.ts";
import type { AuditStore, AsyncAuditStore } from "../../lib/orchestrator/types.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

export interface HealthState {
  /** Set to true once graceful shutdown starts — both probes return 503. */
  draining: boolean;
  /** Optional monitor for readyz solvency check. */
  monitor?: LedgerCron;
  /** Optional pool for readyz DB reachability check. */
  pool?: DbPool;
  /** Optional auditStore for readyz chain-verification check. */
  auditStore?: AuditStore | AsyncAuditStore;
  /**
   * Optional signer for readyz PQC-provider visibility (PQC stage-2b sub-step).
   * When provided, readyz reports whether the active algorithm is a real
   * compiled PQC provider or the zero-dep simulation fallback — see
   * lib/orchestrator/pqc-loader.ts ("Ops monitoring should alert when
   * algorithm ends with -sim"). Never fails readiness: a "-sim" provider is
   * a valid, functional configuration (e.g. sandbox/dev), just not
   * post-quantum secure, so this is surfaced as information, not a fault.
   */
  signer?: Pick<Signer, "algorithm">;
}

export interface HealthCheckResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Liveness ──────────────────────────────────────────────────────────────────

/** GET /healthz — is the process alive? */
export function checkLiveness(state: HealthState): HealthCheckResult {
  if (state.draining) {
    return { status: 503, body: { status: "draining" } };
  }
  return { status: 200, body: { status: "ok" } };
}

// ── Readiness ─────────────────────────────────────────────────────────────────

/** GET /readyz — is the server ready to accept traffic? */
export async function checkReadiness(state: HealthState): Promise<HealthCheckResult> {
  const checks: Record<string, "ok" | string> = {};
  let ready = true;

  // Check 1: not draining
  if (state.draining) {
    checks.draining = "shutting down";
    ready = false;
  } else {
    checks.draining = "ok";
  }

  // Check 2: DB reachability
  if (state.pool) {
    try {
      await state.pool.query("SELECT 1");
      checks.db = "ok";
    } catch (err) {
      checks.db = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
      ready = false;
    }
  } else {
    checks.db = "ok";
  }

  // Check 3: solvency — if monitor has run, last result must be solvent
  if (state.monitor) {
    const cronStatus = state.monitor.getStatus();
    const results = cronStatus.results;
    const tenants = Object.keys(results);
    if (tenants.length === 0) {
      // Monitor has not run yet — optimistic pass (no data yet)
      checks.solvency = "ok";
    } else {
      const insolvent = tenants.filter((t) => results[t] && !results[t].isSolvent);
      if (insolvent.length > 0) {
        checks.solvency = `insolvent tenants: ${insolvent.join(", ")}`;
        ready = false;
      } else {
        checks.solvency = "ok";
      }
    }
  } else {
    // No monitor attached — skip check
    checks.solvency = "ok";
  }

  // Check 4: chain verified — sample one tenant to prove audit chain integrity
  if (state.auditStore) {
    const tenantsToCheck = state.monitor ? state.monitor.getStatus().tenants : [];
    if (tenantsToCheck.length === 0) {
      // No tenants yet — verify store responds with empty chain (still intact)
      try {
        const chainResult = await Promise.resolve(state.auditStore.verifyChain("_health_probe"));
        if (chainResult) {
          checks.chain = "ok";
        } else {
          checks.chain = "store returned false for empty tenant";
          ready = false;
        }
      } catch (err) {
        checks.chain = `verify error: ${err instanceof Error ? err.message : String(err)}`;
        ready = false;
      }
    } else {
      // Verify first monitored tenant as a sample
      const sampleTenant = tenantsToCheck[0];
      try {
        const chainResult = await Promise.resolve(state.auditStore.verifyChain(sampleTenant));
        if (chainResult) {
          checks.chain = "ok";
        } else {
          checks.chain = `audit chain broken for tenant ${sampleTenant}`;
          ready = false;
        }
      } catch (err) {
        checks.chain = `verify error: ${err instanceof Error ? err.message : String(err)}`;
        ready = false;
      }
    }
  } else {
    checks.chain = "ok";
  }

  // Check 5: PQC provider visibility — informational only, never fails readiness.
  // "-sim" suffix means the zero-dep simulation fallback is active (valid in
  // sandbox/dev, expected until ops installs a real compiled OQS/WASM module).
  if (state.signer) {
    const algorithm = state.signer.algorithm;
    checks.pqc = algorithm.includes("-sim") ? `sim: ${algorithm}` : algorithm;
  }

  if (ready) {
    return { status: 200, body: { status: "ok", checks } };
  }
  return { status: 503, body: { status: "not ready", checks } };
}
