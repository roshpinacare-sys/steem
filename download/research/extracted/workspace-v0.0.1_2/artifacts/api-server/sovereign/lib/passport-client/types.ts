/**
 * lib/passport-client/types.ts — types for the external Passport SDK client.
 *
 * Zero external dependencies. Uses built-in fetch (Node 22+) and node:crypto.
 */

import type { ActionPassport } from "../passport/types.ts";

/** Keys required for local passport signature verification. */
export interface PassportVerifyKeys {
  /** HMAC secret for passport-level HMAC-SHA256 signatures. */
  hmacSecret?: string | Buffer;
  /** Ed25519 SPKI PEM public key for passport-level Ed25519 signatures. */
  publicKey?: string;
  /** HMAC secret for audit-record-level HMAC-SHA256 signatures. */
  auditHmacSecret?: string | Buffer;
  /** Ed25519 SPKI PEM public key for audit-record-level Ed25519 signatures. */
  auditPublicKey?: string;
  /**
   * KeyRing for kid-based verification — the preferred path for portable proofs.
   * When the passport carries a `kid` field AND keyRing is provided, the verifier
   * resolves the key from the ring and verifies against THAT key.
   */
  keyRing?: import("../passport/key-ring.ts").KeyRing;
}

/** Options for fetching a passport from a remote TFA server. */
export interface FetchPassportOptions {
  /** Optional API key sent as x-api-key header. */
  apiKey?: string;
  /** Optional timeout in milliseconds (default 10_000). */
  timeoutMs?: number;
}

/** Error thrown by the passport client on network, auth, or validation failures. */
export class PassportClientError extends Error {
  readonly code: PassportClientErrorCode;
  constructor(message: string, code: PassportClientErrorCode) {
    super(message);
    this.name = "PassportClientError";
    this.code = code;
  }
}

export type PassportClientErrorCode =
  | "missing_base_url"
  | "missing_audit_id"
  | "missing_tenant_id"
  | "network_error"
  | "timeout"
  | "not_found"
  | "unauthorized"
  | "server_error"
  | "invalid_response"
  | "verify_failed";

/** Result returned by fetchPassport. */
export interface FetchPassportResult {
  passport: ActionPassport;
  /** HTTP status from the server. */
  status: number;
  /** ETag or similar cache header if present. */
  etag?: string;
}

/** Result returned by fetchPublicKey. */
export interface FetchPublicKeyResult {
  algorithm: "ed25519" | "hmac-sha256";
  publicKey: string | null;
  status: number;
}

/** Result returned by verifyPassport. */
export interface VerifyPassportResult {
  ok: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "skipped";
    message?: string;
  }>;
}
