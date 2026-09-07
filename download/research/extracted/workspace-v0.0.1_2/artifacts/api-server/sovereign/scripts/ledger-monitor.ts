/**
 * scripts/ledger-monitor.ts — Automated Ledger Solvency Auditor & Webhook Alert Monitor.
 *
 * This script periodically or on-demand audits the TFA ledger:
 *   1. Verifies proofOfSolvency (total assets >= total liabilities).
 *   2. Scans all accounts for negative balances (underflows).
 *   3. Checks for tenant isolation violations (cross-tenant accounts in listing).
 *   4. Scans all transactions for ultra-high-value transfers or unauthorized mints.
 *   5. Dispatches alerts to Slack/Discord webhooks upon anomalies or solvency breach.
 */

import type { PaymentProvider, Account, LedgerTransaction, SolvencyProof } from "../lib/ledger/types.ts";

export interface LedgerMonitorConfig {
  tenantId: string;
  slackWebhookUrl?: string;
  highValueThreshold: bigint; // Limit above which transfers trigger alerts (in μ¢)
  alertOnSolvencyBreach: boolean;
  alertOnAnomalies: boolean;
}

export interface AuditResult {
  tenantId: string;
  timestamp: string;
  isSolvent: boolean;
  accountsChecked: number;
  anomalies: string[];
  alertSent: boolean;
}

/**
 * Sends a simulated/mock webhook alert to Slack, Discord, or an external paging system.
 * Supports simulating network failure for specific URLs (e.g., contains 'fail').
 */
export async function sendWebhookAlert(webhookUrl: string, payload: { text: string; attachments?: any[] }): Promise<boolean> {
  if (!webhookUrl || webhookUrl.trim() === "") {
    return false;
  }
  
  if (webhookUrl.includes("fail") || webhookUrl.includes("error")) {
    throw new Error("Webhook connection failure: ECONNREFUSED");
  }

  // Simulated successful HTTP POST request to webhook
  console.log(`[Webhook Monitor Alert dispatched to ${webhookUrl}]:`, JSON.stringify(payload, null, 2));
  return true;
}

/**
 * Runs a complete audit on the given PaymentProvider for a specific tenant.
 */
export async function auditLedger(
  provider: PaymentProvider,
  config: LedgerMonitorConfig
): Promise<AuditResult> {
  const anomalies: string[] = [];
  const tenantId = config.tenantId;

  // 1. Audit solvency via official proofOfSolvency method
  let solvencyProof: SolvencyProof;
  let isSolvent = false;
  try {
    solvencyProof = await provider.proofOfSolvency(tenantId);
    isSolvent = solvencyProof.isSolvent;
    if (!isSolvent && config.alertOnSolvencyBreach) {
      anomalies.push(`Solvency proof breached! Net equity: ${solvencyProof.netEquity} μ¢`);
    }
  } catch (e: any) {
    isSolvent = false;
    anomalies.push(`Failed to generate solvency proof: ${e.message}`);
  }

  // 2. Scan all accounts for anomalies
  let accounts: Account[] = [];
  try {
    accounts = await provider.listAccounts(tenantId);
    for (const acc of accounts) {
      // Tenant Isolation check
      if (acc.tenantId !== tenantId) {
        anomalies.push(`Tenant isolation violation: account ${acc.id} belongs to tenant ${acc.tenantId}, not audited tenant ${tenantId}`);
      }

      // Negative balance check
      if (acc.balance < 0n && acc.ownerId !== "system" && acc.type !== "equity") {
        anomalies.push(`Negative balance detected on account ${acc.id} (${acc.name}): ${acc.balance} μ¢`);
      }
    }
  } catch (e: any) {
    anomalies.push(`Failed to list accounts for audit: ${e.message}`);
  }

  // 3. Scan all transactions for anomalies (ultra-high-value, unauthorized mints, etc.)
  try {
    for (const acc of accounts) {
      const txs = await provider.getTransactions(tenantId, acc.id);
      for (const tx of txs) {
        // Tenant isolation violation check in transaction history
        if (tx.tenantId !== tenantId) {
          anomalies.push(`Tenant isolation violation: transaction ${tx.id} belongs to tenant ${tx.tenantId}, not audited tenant ${tenantId}`);
        }

        // Ultra-high-value transfer check
        if (tx.amount > config.highValueThreshold) {
          anomalies.push(`Ultra-high-value transaction detected: TX ${tx.id} of ${tx.amount} μ¢ exceeds threshold of ${config.highValueThreshold} μ¢`);
        }

        // Unauthorized mint check (e.g. mint initiated by unauthorized entities)
        if (tx.kind === "mint" && tx.initiatedBy !== "system" && tx.initiatedBy !== "admin") {
          anomalies.push(`Unauthorized mint transaction detected: TX ${tx.id} initiated by unauthorized actor "${tx.initiatedBy}"`);
        }
      }
    }
  } catch (e: any) {
    anomalies.push(`Failed to audit transactions: ${e.message}`);
  }

  // 4. Alert dispatching if anomalies or solvency breaches are found
  let alertSent = false;
  if (anomalies.length > 0 && config.slackWebhookUrl) {
    try {
      const payload = {
        text: `🚨 TFA Ledger Monitor Alert for Tenant "${tenantId}"!`,
        attachments: anomalies.map((a) => ({ text: a, color: "danger" })),
      };
      alertSent = await sendWebhookAlert(config.slackWebhookUrl, payload);
    } catch (err: any) {
      console.error(`[Webhook Monitor] Error dispatching webhook alert: ${err.message}`);
    }
  }

  return {
    tenantId,
    timestamp: new Date().toISOString(),
    isSolvent,
    accountsChecked: accounts.length,
    anomalies,
    alertSent,
  };
}
