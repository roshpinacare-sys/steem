/**
 * lib/indexer/index.ts — barrel exports for the Trust-Graph read-model.
 */

export type {
  ReadModelActor,
  ReadModelExecution,
  ReadModelApproval,
  ReadModelEscrow,
  ReadModelPassport,
  ReadModelDispute,
  IndexerErrorCode,
  IndexerEvent,
  ReadModelStore,
} from "./types.ts";
export { IndexerError } from "./types.ts";
export { InMemoryReadModelStore } from "./in-memory-store.ts";
export { PgReadModelStore } from "./pg-read-model-store.ts";
export { IndexerEventBus } from "./event-bus.ts";

export { computeTenantInsights } from "./insights.ts";
export type { TenantInsights, TenantInsightsInput } from "./insights.ts";
