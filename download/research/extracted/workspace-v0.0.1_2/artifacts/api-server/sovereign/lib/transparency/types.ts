/**
 * lib/transparency/types.ts — Minimal Transparency Dashboard: response types.
 *
 * Three read-only views exposed by GET /api/transparency/*:
 *   • ChainView     — ordered audit chain with integrity status (שרשרת)
 *   • BalancesView  — tenant accounts + live solvency proof (יתרות)
 *   • PassportListView — lightweight passport references per chain record (דרכונים)
 *
 * All monetary amounts serialised as decimal strings (BigInt-safe).
 * All views are strictly scoped to the requesting tenantId (tenant isolation).
 */

// ─── Chain (שרשרת) ───────────────────────────────────────────────────────────

/** One record in the audit chain — public fields only, no secret derivation. */
export interface ChainRecord {
  id: string;
  actionType: string;
  source: string;
  outcome: "allowed" | "denied" | "error";
  reason?: string;
  occurredAt: string;
  prevHash: string;
  hash: string;
  /** true when the record carries a kernel signature (adds provenance). */
  signed: boolean;
}

export interface ChainView {
  tenantId: string;
  /** Whether every hash link in the chain is intact (tamper-evident). */
  chainIntact: boolean;
  recordCount: number;
  records: ChainRecord[];
}

// ─── Balances (יתרות) ─────────────────────────────────────────────────────────

/** Account balance with monetary amount as decimal string (BigInt-safe). */
export interface AccountBalance {
  id: string;
  ownerId: string;
  type: string;
  name: string;
  /** μ¢ as decimal string. */
  balance: string;
}

export interface SolvencySnapshot {
  isSolvent: boolean;
  totalAssets: string;
  totalLiabilities: string;
  netEquity: string;
  accountCount: number;
  balanceHash: string;
  generatedAt: string;
}

export interface BalancesView {
  tenantId: string;
  accounts: AccountBalance[];
  solvency: SolvencySnapshot;
}

// ─── Passports (דרכונים) ──────────────────────────────────────────────────────

/**
 * Light summary linking an audit record to its on-demand passport endpoint.
 * Full passports are served by GET /api/passport/:auditId on request.
 */
export interface PassportSummary {
  auditId: string;
  actionType: string;
  outcome: "allowed" | "denied" | "error";
  occurredAt: string;
  /** Relative URL to fetch the full signed ActionPassport. */
  passportHref: string;
}

export interface PassportListView {
  tenantId: string;
  count: number;
  passports: PassportSummary[];
}
