/**
 * lib/transparency/index.ts — barrel export for the Transparency Dashboard.
 *
 * Public surface:
 *   • buildChainView        — audit chain with integrity status (שרשרת)
 *   • buildBalancesView     — account balances + solvency proof (יתרות)
 *   • buildPassportListView — lightweight passport references (דרכונים)
 *   • All view types
 */

export { buildChainView, buildBalancesView, buildPassportListView } from "./dashboard.ts";
export type {
  ChainRecord,
  ChainView,
  AccountBalance,
  SolvencySnapshot,
  BalancesView,
  PassportSummary,
  PassportListView,
} from "./types.ts";
