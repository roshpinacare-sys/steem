// @tfa/escrow-client — TypeScript declarations.
// Zero external dependencies. These types are self-contained (no imports
// from the TFA kernel) so the package can be published standalone.

/** Lifecycle states of an escrow agreement. */
export type EscrowState = "created" | "funded" | "released" | "refunded" | "disputed";

/** A signed declaration by the worker that the contracted work was submitted. */
export interface WorkerAttestation {
  workerId: string;
  statement: string;
  attestedAt: string;
  signature: string;
  algorithm: string;
}

/**
 * EscrowAgreement — as returned by the TFA Sovereign Escrow API, with
 * `amount` (and other money fields) revived from decimal strings to BigInt.
 */
export interface EscrowAgreement {
  id: string;
  tenantId: string;
  opportunityId: string;
  payerAccountId: string;
  workerAccountId: string;
  escrowAccountId: string;
  amount: bigint;
  state: EscrowState;
  createdAt: string;
  fundedBy?: string;
  fundAuditId?: string;
  settleAuditId?: string;
  attestation?: WorkerAttestation;
  disputedBy?: string;
  disputeReason?: string;
  feeBasisPoints?: number;
  feeAmount?: bigint;
  feeAccountId?: string;
  feeAuditId?: string;
}

/** Error codes thrown by the escrow client. */
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

/** Error thrown by the escrow client on network, auth, validation, or state failures. */
export class EscrowClientError extends Error {
  readonly code: EscrowClientErrorCode;
  constructor(message: string, code: EscrowClientErrorCode);
}

/** Options shared by all escrow client calls. */
export interface EscrowFetchOptions {
  /** Sent as the x-api-key header (production tenant resolution). */
  apiKey?: string;
  /** Request timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
}

/** Options for fund/release/refund/dispute/undispute calls. */
export interface EscrowActionOptions extends EscrowFetchOptions {
  /** Identity initiating the action (defaults to "api"). */
  initiatedBy?: string;
  /** Human-readable reason — only used by disputeEscrow. */
  reason?: string;
}

export interface EscrowResult {
  agreement: EscrowAgreement;
  status: number;
}

export function fetchEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowFetchOptions,
): Promise<EscrowResult>;

/** Alias of {@link fetchEscrow}. */
export const getEscrow: typeof fetchEscrow;

export function createEscrow(
  baseUrl: string,
  tenantId: string,
  payload: {
    opportunityId: string;
    payerAccountId: string;
    workerAccountId: string;
    amount: bigint | string | number;
  },
  opts?: EscrowFetchOptions,
): Promise<EscrowResult>;

export function fundEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowActionOptions,
): Promise<EscrowResult>;

export function releaseEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowActionOptions,
): Promise<EscrowResult>;

export function refundEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowActionOptions,
): Promise<EscrowResult>;

export function disputeEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowActionOptions,
): Promise<EscrowResult>;

export function undisputeEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts?: EscrowActionOptions,
): Promise<EscrowResult>;

// ─── Webhook verification ───────────────────────────────────────────────────

/** Result of verifying a webhook HMAC-SHA256 signature. */
export interface WebhookVerificationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a TFA webhook HMAC-SHA256 signature offline.
 *
 * The server signs the raw request body (UTF-8) with the registration secret
 * and sends the result in the `x-tfa-signature` header as:
 *   `sha256=<base64(hmac-sha256(secret, payload))>`
 *
 * @param secret    The webhook registration secret (UTF-8 string).
 * @param payload   The raw request body exactly as received (UTF-8 string).
 * @param signature The `x-tfa-signature` header value (must start with `sha256=`).
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): WebhookVerificationResult;
