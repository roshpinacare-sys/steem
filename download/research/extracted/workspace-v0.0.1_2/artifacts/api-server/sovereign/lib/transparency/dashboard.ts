/**
 * lib/transparency/dashboard.ts — Transparency Dashboard: pure builder functions.
 *
 * These functions read from the existing sovereign stack (AuditStore +
 * PaymentProvider) and assemble the three read-only dashboard views.
 * No side effects, no mutations, no external dependencies.
 *
 * Tenant isolation: every function accepts tenantId and reads ONLY records
 * that belong to that tenant. Cross-tenant data never leaks.
 */

import type { AuditStore } from "../orchestrator/types.ts";
import type { PaymentProvider } from "../ledger/types.ts";
import type {
  ChainView,
  ChainRecord,
  BalancesView,
  AccountBalance,
  SolvencySnapshot,
  PassportListView,
  PassportSummary,
} from "./types.ts";

// ─── Chain view (שרשרת) ───────────────────────────────────────────────────────

/**
 * Build a ChainView for a tenant.
 *
 * @param tenantId   - Tenant to query. Isolation is enforced by AuditStore.
 * @param auditStore - The kernel's InMemoryAuditStore (or any AuditStore impl).
 */
export function buildChainView(
  tenantId: string,
  auditStore: AuditStore,
): ChainView {
  const records = auditStore.getChain(tenantId);
  const chainIntact = auditStore.verifyChain(tenantId);

  const chainRecords: ChainRecord[] = records.map((r) => {
    const rec: ChainRecord = {
      id: r.id,
      actionType: r.actionType,
      source: r.source,
      outcome: r.outcome,
      occurredAt: r.occurredAt,
      prevHash: r.prevHash,
      hash: r.hash,
      signed: r.signature !== undefined,
    };
    if (r.reason !== undefined) rec.reason = r.reason;
    return rec;
  });

  return {
    tenantId,
    chainIntact,
    recordCount: chainRecords.length,
    records: chainRecords,
  };
}

// ─── Balances view (יתרות) ────────────────────────────────────────────────────

/**
 * Build a BalancesView for a tenant.
 *
 * @param tenantId - Tenant to query. Provider enforces isolation internally.
 * @param provider - The PaymentProvider (InMemoryLedger or PgLedgerStore).
 */
export async function buildBalancesView(
  tenantId: string,
  provider: PaymentProvider,
): Promise<BalancesView> {
  const [accounts, solvencyProof] = await Promise.all([
    provider.listAccounts(tenantId),
    provider.proofOfSolvency(tenantId),
  ]);

  const accountBalances: AccountBalance[] = accounts.map((a) => ({
    id: a.id,
    ownerId: a.ownerId,
    type: a.type,
    name: a.name,
    balance: a.balance.toString(),
  }));

  const solvency: SolvencySnapshot = {
    isSolvent: solvencyProof.isSolvent,
    totalAssets: solvencyProof.totalAssets.toString(),
    totalLiabilities: solvencyProof.totalLiabilities.toString(),
    netEquity: solvencyProof.netEquity.toString(),
    accountCount: solvencyProof.accountCount,
    balanceHash: solvencyProof.balanceHash,
    generatedAt: solvencyProof.generatedAt,
  };

  return { tenantId, accounts: accountBalances, solvency };
}

// ─── Passport list view (דרכונים) ─────────────────────────────────────────────

/**
 * Build a PassportListView for a tenant.
 *
 * Returns lightweight summaries derived from the audit chain. Full signed
 * passports are fetched on demand via GET /api/passport/:auditId, so this
 * endpoint is always fast regardless of chain length.
 *
 * Only "allowed" records are surfaced — "denied" and "error" records did not
 * produce ledger state so they are not actionable passport references.
 *
 * @param tenantId   - Tenant to query.
 * @param auditStore - The kernel's AuditStore (getChain is tenant-scoped).
 */
export function buildPassportListView(
  tenantId: string,
  auditStore: AuditStore,
): PassportListView {
  const records = auditStore.getChain(tenantId);

  const passports: PassportSummary[] = records
    .filter((r) => r.outcome === "allowed")
    .map((r) => ({
      auditId: r.id,
      actionType: r.actionType,
      outcome: r.outcome,
      occurredAt: r.occurredAt,
      passportHref: `/api/passport/${r.id}`,
    }));

  return {
    tenantId,
    count: passports.length,
    passports,
  };
}
