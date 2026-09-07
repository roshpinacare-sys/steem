/**
 * lib/dashboard-client/types.ts — types for the external Transparency Dashboard SDK client.
 *
 * Zero external dependencies. Uses built-in fetch (Node 22+) only.
 */

import type { ChainView, BalancesView, PassportListView } from "../transparency/types.ts";

/** Options for all dashboard fetch operations. */
export interface DashboardFetchOptions {
  /** Optional API key sent as x-api-key header. */
  apiKey?: string;
  /** Optional timeout in milliseconds (default 10_000). */
  timeoutMs?: number;
}

/** Error thrown by the dashboard client on network, auth, or validation failures. */
export class DashboardClientError extends Error {
  readonly code: DashboardClientErrorCode;
  constructor(message: string, code: DashboardClientErrorCode) {
    super(message);
    this.name = "DashboardClientError";
    this.code = code;
  }
}

export type DashboardClientErrorCode =
  | "missing_base_url"
  | "missing_tenant_id"
  | "network_error"
  | "timeout"
  | "not_found"
  | "unauthorized"
  | "server_error"
  | "invalid_response";

/** Result returned by fetchChain (GET /api/transparency/chain). */
export interface FetchChainResult {
  view: ChainView;
  status: number;
}

/** Result returned by fetchBalances (GET /api/transparency/balances). */
export interface FetchBalancesResult {
  view: BalancesView;
  status: number;
}

/** Result returned by fetchPassportList (GET /api/transparency/passports). */
export interface FetchPassportListResult {
  view: PassportListView;
  status: number;
}
