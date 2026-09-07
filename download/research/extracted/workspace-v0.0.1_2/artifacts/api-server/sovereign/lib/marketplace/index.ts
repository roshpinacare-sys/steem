/**
 * lib/marketplace/index.ts — barrel export.
 *
 * Usage:
 *   import { InMemoryOpportunityCatalog, MARKETPLACE_ACTION_TYPES } from "../lib/marketplace/index.ts";
 *   import type { OpportunityCatalog, OpportunityInput, MarketplaceError } from "../lib/marketplace/index.ts";
 */
export type {
  OpportunityCatalog,
  OpportunityInput,
  MarketplaceActionType,
  MarketplaceErrorCode,
} from "./types.ts";
export {
  MARKETPLACE_ACTION_TYPES,
  DEFAULT_CLAIM_FEE_MC,
  DEFAULT_LISTING_FEE_MC,
  MarketplaceError,
} from "./types.ts";
export { InMemoryOpportunityCatalog } from "./catalog.ts";
export { PgOpportunityCatalog } from "./pg-catalog.ts";
export {
  selectCheapestVendor,
  routingFeeFromSpread,
  ArbitrageError,
  type VendorQuote,
  type ArbitrageResult,
  type ArbitrageErrorCode,
} from "./cost-arbitrage.ts";
