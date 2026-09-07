/**
 * lib/settlement-rails/index.ts — SettlementRail barrel export.
 */

export type {
  MicroCents,
  DisbursementRequest,
  DisbursementResult,
  DisbursementStatus,
  SettlementRail,
  RailRegistry,
  SettlementRailErrorCode,
} from "./types.ts";

export { SettlementRailError } from "./types.ts";

export {
  ManualSettlementRail,
  InMemoryRailRegistry,
  type ManualRailConfig,
  type ManualDisbursementRecord,
} from "./manual-rail.ts";
