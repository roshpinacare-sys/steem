/**
 * lib/escrow-client/types.ts — types for the external Escrow SDK client.
 *
 * Zero external dependencies. Uses built-in fetch (Node 22+) only.
 */

import type { EscrowAgreement } from "../escrow/types.ts";

/** Options for all escrow fetch operations. */
export interface EscrowFetchOptions {
  /** Optional API key sent as x-api-key header. */
  apiKey?: string;
  /** Optional timeout in milliseconds (default 10_000). */
  timeoutMs?: number;
}

/** Error thrown by the escrow client on network, auth, validation, or state failures. */
export class EscrowClientError extends Error {
  readonly code: EscrowClientErrorCode;
  constructor(message: string, code: EscrowClientErrorCode) {
    super(message);
    this.name = "EscrowClientError";
    this.code = code;
  }
}

export type EscrowClientErrorCode =
  | "missing_base_url"
  | "missing_tenant_id"
  | "missing_escrow_id"
  | "missing_body_field"
  | "network_error"
  | "timeout"
  | "not_found"
  | "unauthorized"
  | "conflict"
  | "server_error"
  | "invalid_response";

/** Result returned by fetchEscrow (GET /api/escrow/:id). */
export interface FetchEscrowResult {
  agreement: EscrowAgreement;
  status: number;
}

/** Result returned by createEscrow (POST /api/escrow). */
export interface CreateEscrowResult {
  agreement: EscrowAgreement;
  status: number;
}

/** Result returned by fundEscrow, releaseEscrow, refundEscrow. */
export interface MutateEscrowResult {
  agreement: EscrowAgreement;
  status: number;
}
