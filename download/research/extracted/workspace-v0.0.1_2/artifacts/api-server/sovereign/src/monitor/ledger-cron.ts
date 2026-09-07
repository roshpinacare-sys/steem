/**
 * src/monitor/ledger-cron.ts — Scheduled solvency & anomaly auditor for TFA.
 *
 * Wraps the stateless `auditLedger()` function in a real interval-based worker:
 *   - Starts with `.start(intervalMs)` — fires immediately then every intervalMs.
 *   - Stops with `.stop()` (clears the timer so the process can exit cleanly).
 *   - Tenants are registered via `.registerTenant(tenantId)` — called automatically
 *     by the Express adapter on any financial operation.
 *   - `.runNow(tenantId)` allows an on-demand single-tenant audit (e.g. from POST /api/monitor/run).
 *   - `.getStatus()` returns the full cron state for GET /api/monitor/status.
 *
 * The timer is unref()'d so it never prevents clean process exit.
 */

import type { PaymentProvider } from "../../lib/ledger/types.ts";
import { auditLedger } from "../../scripts/ledger-monitor.ts";
import type { LedgerMonitorConfig, AuditResult } from "../../scripts/ledger-monitor.ts";

export type { AuditResult };

export interface CronConfig {
  slackWebhookUrl?: string;
  highValueThreshold?: bigint;
  alertOnSolvencyBreach?: boolean;
  alertOnAnomalies?: boolean;
}

export interface CronStatus {
  running: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  tenants: string[];
  totalRuns: number;
  results: Record<string, AuditResult>;
}

export class LedgerCron {
  private readonly provider: PaymentProvider;
  private readonly cfg: Omit<LedgerMonitorConfig, "tenantId">;
  private _intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tenants = new Set<string>();
  private results = new Map<string, AuditResult>();
  private lastRunAt: Date | null = null;
  private totalRuns = 0;

  constructor(
    provider: PaymentProvider,
    cfg: CronConfig = {},
    intervalMs = 60_000,
  ) {
    this.provider = provider;
    this._intervalMs = intervalMs;
    this.cfg = {
      slackWebhookUrl: cfg.slackWebhookUrl,
      highValueThreshold: cfg.highValueThreshold ?? 100_000_000n,
      alertOnSolvencyBreach: cfg.alertOnSolvencyBreach ?? true,
      alertOnAnomalies: cfg.alertOnAnomalies ?? true,
    };
  }

  /** Register a tenant so the periodic sweep will audit it. Idempotent. */
  registerTenant(tenantId: string): void {
    this.tenants.add(tenantId);
  }

  /**
   * Start the cron. Runs an audit immediately, then repeats every intervalMs.
   * Safe to call multiple times — second call is a no-op if already running.
   */
  start(intervalMs?: number): void {
    if (this.timer !== null) return;
    if (intervalMs !== undefined) this._intervalMs = intervalMs;
    // Fire immediately so the first status read isn't empty
    this.runAll().catch(() => {});
    this.timer = setInterval(() => {
      this.runAll().catch(() => {});
    }, this._intervalMs);
    // unref so the interval never prevents clean process shutdown
    if (typeof (this.timer as any).unref === "function") {
      (this.timer as any).unref();
    }
  }

  /** Stop the cron. The process can now exit cleanly. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get intervalMs(): number {
    return this._intervalMs;
  }

  /**
   * Run an audit for a single tenant immediately (bypasses the interval timer).
   * Also registers the tenant if not already known.
   */
  async runNow(tenantId: string): Promise<AuditResult> {
    this.registerTenant(tenantId);
    const config: LedgerMonitorConfig = { tenantId, ...this.cfg };
    const result = await auditLedger(this.provider, config);
    this.results.set(tenantId, result);
    this.lastRunAt = new Date();
    this.totalRuns += 1;
    return result;
  }

  /** Audit all registered tenants. Called by the interval timer. */
  private async runAll(): Promise<void> {
    const tasks = [...this.tenants].map((tid) =>
      this.runNow(tid).catch((err: unknown) => {
        // Never let a single-tenant failure crash the sweep
        console.error(`[LedgerCron] audit failed for tenant ${tid}:`, err);
      }),
    );
    await Promise.allSettled(tasks);
  }

  /** Snapshot of the current cron state — safe to serialise to JSON. */
  getStatus(): CronStatus {
    const nextRunAt =
      this.timer !== null && this.lastRunAt !== null
        ? new Date(this.lastRunAt.getTime() + this._intervalMs).toISOString()
        : null;

    return {
      running: this.timer !== null,
      intervalMs: this._intervalMs,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      nextRunAt,
      tenants: [...this.tenants],
      totalRuns: this.totalRuns,
      results: Object.fromEntries(this.results),
    };
  }
}
