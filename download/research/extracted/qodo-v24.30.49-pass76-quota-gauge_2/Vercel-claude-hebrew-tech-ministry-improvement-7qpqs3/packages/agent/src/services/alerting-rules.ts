/**
 * Alerting Rules — evaluates threshold-based alerts and fires webhooks.
 * Rules: cost spike (+50% vs rolling avg), high error rate (>10%),
 * SLO breach, critical CVE detected.
 */
import { log as logger } from './logger.js';
import type { SloReport } from './slo-tracker.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Alert {
  rule: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  firedAt: string;
}

export interface AlertContext {
  currentCostUsd: number;
  rollingAvgCostUsd: number;
  recentErrorRatePct: number;
  sloReport: SloReport;
  criticalCveCount: number;
  /** Optional webhook URL for firing alerts. Callers should supply the value
   *  from the validated environment instead of reading process.env directly. */
  webhookUrl?: string;
}

export function evaluateAlerts(ctx: AlertContext): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // Rule 1: Cost spike — current run cost > 150% of rolling average
  const costRatio = ctx.rollingAvgCostUsd > 0
    ? ctx.currentCostUsd / ctx.rollingAvgCostUsd
    : 0;
  if (costRatio > 1.5) {
    alerts.push({
      rule: 'cost_spike',
      severity: 'WARNING',
      message: `Run cost $${ctx.currentCostUsd.toFixed(4)} is ${((costRatio - 1) * 100).toFixed(0)}% above rolling average $${ctx.rollingAvgCostUsd.toFixed(4)}`,
      value: ctx.currentCostUsd,
      threshold: ctx.rollingAvgCostUsd * 1.5,
      firedAt: now,
    });
  }

  // Rule 2: High error rate
  if (ctx.recentErrorRatePct > 10) {
    alerts.push({
      rule: 'high_error_rate',
      severity: ctx.recentErrorRatePct > 25 ? 'CRITICAL' : 'WARNING',
      message: `Error rate ${ctx.recentErrorRatePct.toFixed(1)}% exceeds 10% threshold`,
      value: ctx.recentErrorRatePct,
      threshold: 10,
      firedAt: now,
    });
  }

  // Rule 3: SLO breach
  if (!ctx.sloReport.slo1.met) {
    alerts.push({
      rule: 'slo1_breach',
      severity: 'CRITICAL',
      message: `SLO-1 breached: ${ctx.sloReport.slo1.actual} (target: ${ctx.sloReport.slo1.target})`,
      value: ctx.sloReport.slo1.p90DurationS,
      threshold: 900,
      firedAt: now,
    });
  }
  if (!ctx.sloReport.slo2.met) {
    alerts.push({
      rule: 'slo2_breach',
      severity: 'WARNING',
      message: `SLO-2 breached: ${ctx.sloReport.slo2.actual} (target: ${ctx.sloReport.slo2.target})`,
      value: ctx.sloReport.slo2.errorRatePct,
      threshold: 10,
      firedAt: now,
    });
  }

  // Rule 4: Critical CVE
  if (ctx.criticalCveCount > 0) {
    alerts.push({
      rule: 'critical_cve',
      severity: 'CRITICAL',
      message: `${ctx.criticalCveCount} unresolved CRITICAL CVE(s) detected`,
      value: ctx.criticalCveCount,
      threshold: 0,
      firedAt: now,
    });
  }

  for (const alert of alerts) {
    logger.warn(`Alert fired: ${alert.rule}`, { ...alert });
  }

  // Fire webhooks (best-effort). Callers must supply the webhook URL from the
  // validated environment object; process.env is intentionally not read here.
  if (alerts.length > 0 && ctx.webhookUrl) {
    fireWebhooks(ctx.webhookUrl, alerts).catch(() => { /* best-effort */ });
  }

  return alerts;
}

async function fireWebhooks(url: string, alerts: Alert[]): Promise<void> {
  await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts }),
    },
    20_000,
  );
}
