/**
 * lib/passport-client/passport-client.ts — external Passport SDK client.
 *
 * Provides:
 *   • fetchPassport — HTTP client to retrieve a signed ActionPassport from any
 *     TFA server exposing GET /api/passport/:auditId.
 *   • verifyPassport — local, zero-dependency verification (wraps the canonical
 *     standalone verifier from scripts/verify-passport.mjs).
 *
 * Zero external dependencies — uses Node 22+ native fetch and node:crypto.
 * Fail-closed: invalid input → PassportClientError; network failure → error.
 */

import type { ActionPassport } from "../passport/types.ts";
import {
  PassportClientError,
  type PassportClientErrorCode,
  type FetchPassportOptions,
  type FetchPassportResult,
  type FetchPublicKeyResult,
  type VerifyPassportResult,
  type PassportVerifyKeys,
} from "./types.ts";

// Re-export the standalone verifier (zero deps, node:crypto only).
import { verifyPassport as _verify, canonicalStringify } from "../../scripts/verify-passport.mjs";
import { verifyActionPassport as _verifyActionPassport } from "../passport/passport-verifier.ts";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a signed ActionPassport from a TFA server.
 *
 * @param baseUrl  Server base URL (e.g. "http://127.0.0.1:7700").
 * @param auditId  The audit record ID to request a passport for.
 * @param tenantId Mandatory tenant identifier (sent as x-tenant-id header).
 * @param opts     Optional apiKey / timeout.
 *
 * @returns FetchPassportResult containing the parsed passport.
 *
 * Fail-closed:
 *   • missing baseUrl / auditId / tenantId → PassportClientError
 *   • HTTP 404 → "not_found"
 *   • HTTP 401/403 → "unauthorized"
 *   • HTTP 5xx → "server_error"
 *   • network failure / timeout → "network_error" / "timeout"
 *   • invalid JSON body → "invalid_response"
 */
export async function fetchPassport(
  baseUrl: string,
  auditId: string,
  tenantId: string,
  opts: FetchPassportOptions = {},
): Promise<FetchPassportResult> {
  // Guard inputs (fail-closed).
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new PassportClientError("baseUrl is required", "missing_base_url");
  }
  if (!auditId || typeof auditId !== "string") {
    throw new PassportClientError("auditId is required", "missing_audit_id");
  }
  if (!tenantId || typeof tenantId !== "string") {
    throw new PassportClientError("tenantId is required", "missing_tenant_id");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/passport/${encodeURIComponent(auditId)}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError") {
      throw new PassportClientError(`request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new PassportClientError(`network error: ${err.message}`, "network_error");
  }
  clearTimeout(timer);

  // Map HTTP status to error code (fail-closed).
  if (response.status === 404) {
    throw new PassportClientError("passport not found (404)", "not_found");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PassportClientError("unauthorized (401/403)", "unauthorized");
  }
  if (response.status >= 500) {
    throw new PassportClientError(`server error (${response.status})`, "server_error");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new PassportClientError(`unexpected status ${response.status}`, "server_error");
  }

  // Parse JSON safely.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PassportClientError("response is not valid JSON", "invalid_response");
  }

  if (!body || typeof body !== "object" || !("passport" in body)) {
    throw new PassportClientError("response missing passport field", "invalid_response");
  }

  const passport = (body as any).passport as ActionPassport;
  if (!passport || typeof passport !== "object") {
    throw new PassportClientError("passport field is not an object", "invalid_response");
  }

  return {
    passport,
    status: response.status,
    etag: response.headers.get("etag") || undefined,
  };
}

/**
 * Fetch the kernel signer's public key from a TFA server.
 *
 * @param baseUrl  Server base URL (e.g. "http://127.0.0.1:7700").
 * @param tenantId Mandatory tenant identifier (sent as x-tenant-id header).
 * @param opts     Optional apiKey / timeout.
 *
 * @returns FetchPublicKeyResult containing algorithm and publicKey.
 *
 * Fail-closed:
 *   • missing baseUrl / tenantId → PassportClientError
 *   • HTTP 5xx → "server_error"
 *   • network failure / timeout → "network_error" / "timeout"
 *   • invalid JSON body → "invalid_response"
 */
export async function fetchPublicKey(
  baseUrl: string,
  tenantId: string,
  opts: FetchPassportOptions = {},
): Promise<FetchPublicKeyResult> {
  // Guard inputs (fail-closed).
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new PassportClientError("baseUrl is required", "missing_base_url");
  }
  if (!tenantId || typeof tenantId !== "string") {
    throw new PassportClientError("tenantId is required", "missing_tenant_id");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/passport/public-key`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError") {
      throw new PassportClientError(`request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new PassportClientError(`network error: ${err.message}`, "network_error");
  }
  clearTimeout(timer);

  // Map HTTP status to error code (fail-closed).
  if (response.status >= 500) {
    throw new PassportClientError(`server error (${response.status})`, "server_error");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new PassportClientError(`unexpected status ${response.status}`, "server_error");
  }

  // Parse JSON safely.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PassportClientError("response is not valid JSON", "invalid_response");
  }

  if (!body || typeof body !== "object" || !("algorithm" in body)) {
    throw new PassportClientError("response missing algorithm field", "invalid_response");
  }

  const algorithm = (body as any).algorithm as string;
  if (algorithm !== "ed25519" && algorithm !== "hmac-sha256") {
    throw new PassportClientError(`unknown algorithm ${algorithm}`, "invalid_response");
  }

  return {
    algorithm,
    publicKey: (body as any).publicKey ?? null,
    status: response.status,
  };
}

/**
 * Verify an ActionPassport locally using the canonical standalone verifier.
 *
 * @param passport The parsed ActionPassport object.
 * @param keys     Verification keys (HMAC secret or Ed25519 public key).
 * @param opts     Optional strict mode (treats skipped signature checks as failures).
 *
 * @returns VerifyPassportResult with per-check details.
 */
export function verifyPassport(
  passport: ActionPassport,
  keys: PassportVerifyKeys,
  opts?: { strict?: boolean },
): VerifyPassportResult {
  // Use the KeyRing-aware verifier when keyRing is provided; otherwise fall back
  // to the standalone zero-dependency verifier.
  if (keys.keyRing) {
    const report = _verifyActionPassport(passport, keys, { strict: !!opts?.strict });
    return {
      ok: report.ok,
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
      })),
    };
  }

  const report = _verify(passport, keys, { strict: !!opts?.strict }) as VerifyPassportResult;
  return {
    ok: report.ok,
    checks: report.checks.map((c) => ({
      name: c.name,
      status: c.status,
      message: c.message,
    })),
  };
}

// Re-export canonicalStringify so SDK consumers can reproduce hashes independently.
export { canonicalStringify };
