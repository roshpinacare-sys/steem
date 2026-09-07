/**
 * lib/ledger — barrel export.
 * Services import from here; never from individual files directly.
 *
 * @example
 * ```ts
 * import { InMemoryLedger, LedgerError } from "../../lib/ledger/index.ts";
 * import type { PaymentProvider, MicroCents, Account } from "../../lib/ledger/index.ts";
 * ```
 */

export type {
  Account,
  AccountType,
  EntryType,
  JournalEntry,
  LedgerTransaction,
  MicroCents,
  PaymentProvider,
  SolvencyProof,
  TransactionKind,
} from "./types.ts";

export { InMemoryLedger, LedgerError } from "./in-memory-ledger.ts";
export { PgLedgerStore } from "./pg-ledger.ts";
export { DrizzlePaymentProvider } from "./drizzle-payment-provider.ts";
export type { DrizzleDbLike } from "./drizzle-payment-provider.ts";
