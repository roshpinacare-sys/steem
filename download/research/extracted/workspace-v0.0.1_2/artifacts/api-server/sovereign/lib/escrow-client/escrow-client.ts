/**
 * lib/escrow-client/escrow-client.ts — external Escrow SDK client.
 *
 * Provides fetch helpers for the sovereign escrow REST endpoints:
 *   • fetchEscrow    — GET /api/escrow/:id
 *   • createEscrow   — POST /api/escrow
 *   • fundEscrow     — POST /api/escrow/:id/fund
 *   • releaseEscrow  — POST /api/escrow/:id/release
 *   • refundEscrow   — POST /api/escrow/:id/refund
 *
 * Zero external dependencies — uses Node 22+ native fetch only.
 * Fail-closed: invalid input → EscrowClientError; network failure → error.
 */

import type { EscrowAgreement } from "../escrow/types.ts";
import {
  EscrowClientError,
  type EscrowFetchOptions,
  type FetchEscrowResult,
  type CreateEscrowResult,
  type MutateEscrowResult,
} from "./types.ts";

// ─── Internal helpers ────────────────────────────────────────────────────────

function guardBaseUrl(baseUrl: unknown): string {
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new EscrowClientError("baseUrl is required", "missing_base_url");
  }
  return baseUrl.replace(/\/$/, "");
}

function guardTenantId(tenantId: unknown): string {
  if (!tenantId || typeof tenantId !== "string") {
    throw new EscrowClientError("tenantId is required", "missing_tenant_id");
  }
  return tenantId;
}

function guardEscrowId(escrowId: unknown): string {
  if (!escrowId || typeof escrowId !== "string") {
    throw new EscrowClientError("escrowId is required", "missing_escrow_id");
  }
  return escrowId;
}

function buildHeaders(tenantId: string, opts: EscrowFetchOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  return headers;
}

async function doFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    clearTimeout(timer);
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError") {
      throw new EscrowClientError(`request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new EscrowClientError(`network error: ${err.message}`, "network_error");
  }
  clearTimeout(timer);
  return response;
}

function mapStatusToError(response: Response, bodyText: string): never {
  if (response.status === 404) {
    throw new EscrowClientError(bodyText || "not found (404)", "not_found");
  }
  if (response.status === 401 || response.status === 403) {
    throw new EscrowClientError(bodyText || "unauthorized (401/403)", "unauthorized");
  }
  if (response.status === 409) {
    throw new EscrowClientError(bodyText || "conflict (409)", "conflict");
  }
  if (response.status >= 500) {
    throw new EscrowClientError(bodyText || `server error (${response.status})`, "server_error");
  }
  throw new EscrowClientError(bodyText || `unexpected status ${response.status}`, "server_error");
}

/** The server serialises BigInt amount to string; revive it back to bigint. */
function reviveEscrowAgreement(obj: unknown): EscrowAgreement {
  if (!obj || typeof obj !== "object") {
    throw new EscrowClientError("response agreement is not an object", "invalid_response");
  }
  const a = obj as Record<string, unknown>;
  const amount = typeof a.amount === "string" ? BigInt(a.amount) : a.amount;
  if (typeof amount !== "bigint") {
    throw new EscrowClientError("response agreement amount is not a valid bigint string", "invalid_response");
  }
  return { ...a, amount } as EscrowAgreement;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new EscrowClientError("response is not valid JSON", "invalid_response");
  }
}

function extractAgreement(body: unknown): EscrowAgreement {
  if (!body || typeof body !== "object" || !("agreement" in body)) {
    throw new EscrowClientError("response missing agreement field", "invalid_response");
  }
  return reviveEscrowAgreement((body as any).agreement);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch an escrow agreement by id.
 *
 * @param baseUrl  Server base URL (e.g. "http://127.0.0.1:7700").
 * @param escrowId The escrow agreement id.
 * @param tenantId Mandatory tenant identifier (sent as x-tenant-id header).
 * @param opts     Optional apiKey / timeout.
 */
export async function fetchEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts: EscrowFetchOptions = {},
): Promise<FetchEscrowResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/escrow/${encodeURIComponent(guardEscrowId(escrowId))}`;
  const tenant = guardTenantId(tenantId);
  const response = await doFetch(url, { method: "GET", headers: buildHeaders(tenant, opts) }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const body = await parseJsonResponse(response);
  return { agreement: extractAgreement(body), status: response.status };
}

/**
 * Create a new escrow agreement.
 *
 * @param baseUrl  Server base URL.
 * @param tenantId Mandatory tenant identifier.
 * @param payload  { opportunityId, payerAccountId, workerAccountId, amount }
 * @param opts     Optional apiKey / timeout.
 */
export async function createEscrow(
  baseUrl: string,
  tenantId: string,
  payload: {
    opportunityId: string;
    payerAccountId: string;
    workerAccountId: string;
    amount: bigint | string | number;
  },
  opts: EscrowFetchOptions = {},
): Promise<CreateEscrowResult> {
  if (!payload || typeof payload !== "object") {
    throw new EscrowClientError("payload is required", "missing_body_field");
  }
  if (!payload.opportunityId || !payload.payerAccountId || !payload.workerAccountId || payload.amount === undefined) {
    throw new EscrowClientError("opportunityId, payerAccountId, workerAccountId, and amount are required", "missing_body_field");
  }

  const url = `${guardBaseUrl(baseUrl)}/api/escrow`;
  const tenant = guardTenantId(tenantId);
  const body = JSON.stringify({
    opportunityId: String(payload.opportunityId),
    payerAccountId: String(payload.payerAccountId),
    workerAccountId: String(payload.workerAccountId),
    amount: String(payload.amount),
  });

  const response = await doFetch(url, { method: "POST", headers: buildHeaders(tenant, opts), body }, opts.timeoutMs ?? 10_000);

  if (response.status !== 201) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const resBody = await parseJsonResponse(response);
  return { agreement: extractAgreement(resBody), status: response.status };
}

/**
 * Fund an escrow agreement (created → funded).
 *
 * @param baseUrl  Server base URL.
 * @param escrowId The escrow agreement id.
 * @param tenantId Mandatory tenant identifier.
 * @param opts     Optional initiatedBy / apiKey / timeout.
 */
export async function fundEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts: EscrowFetchOptions & { initiatedBy?: string } = {},
): Promise<MutateEscrowResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/escrow/${encodeURIComponent(guardEscrowId(escrowId))}/fund`;
  const tenant = guardTenantId(tenantId);
  const body = JSON.stringify({ initiatedBy: opts.initiatedBy ?? "api" });

  const response = await doFetch(url, { method: "POST", headers: buildHeaders(tenant, opts), body }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const resBody = await parseJsonResponse(response);
  return { agreement: extractAgreement(resBody), status: response.status };
}

/**
 * Release an escrow agreement (funded → released).
 *
 * @param baseUrl  Server base URL.
 * @param escrowId The escrow agreement id.
 * @param tenantId Mandatory tenant identifier.
 * @param opts     Optional initiatedBy / apiKey / timeout.
 */
export async function releaseEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts: EscrowFetchOptions & { initiatedBy?: string } = {},
): Promise<MutateEscrowResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/escrow/${encodeURIComponent(guardEscrowId(escrowId))}/release`;
  const tenant = guardTenantId(tenantId);
  const body = JSON.stringify({ initiatedBy: opts.initiatedBy ?? "api" });

  const response = await doFetch(url, { method: "POST", headers: buildHeaders(tenant, opts), body }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const resBody = await parseJsonResponse(response);
  return { agreement: extractAgreement(resBody), status: response.status };
}

/**
 * Refund an escrow agreement (funded → refunded).
 *
 * @param baseUrl  Server base URL.
 * @param escrowId The escrow agreement id.
 * @param tenantId Mandatory tenant identifier.
 * @param opts     Optional initiatedBy / apiKey / timeout.
 */
export async function refundEscrow(
  baseUrl: string,
  escrowId: string,
  tenantId: string,
  opts: EscrowFetchOptions & { initiatedBy?: string } = {},
): Promise<MutateEscrowResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/escrow/${encodeURIComponent(guardEscrowId(escrowId))}/refund`;
  const tenant = guardTenantId(tenantId);
  const body = JSON.stringify({ initiatedBy: opts.initiatedBy ?? "api" });

  const response = await doFetch(url, { method: "POST", headers: buildHeaders(tenant, opts), body }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const resBody = await parseJsonResponse(response);
  return { agreement: extractAgreement(resBody), status: response.status };
}
