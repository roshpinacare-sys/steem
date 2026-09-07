/**
 * lib/dashboard-client/index.ts — barrel export for the external Transparency Dashboard SDK.
 */

export {
  fetchChain,
  fetchBalances,
  fetchPassportList,
} from "./dashboard-client.ts";

export { DashboardClientError } from "./types.ts";

export type {
  DashboardFetchOptions,
  DashboardClientErrorCode,
  FetchChainResult,
  FetchBalancesResult,
  FetchPassportListResult,
} from "./types.ts";
