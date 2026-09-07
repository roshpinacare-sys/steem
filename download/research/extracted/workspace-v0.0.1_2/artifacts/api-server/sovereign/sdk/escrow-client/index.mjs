// @tfa/escrow-client — standalone, zero-dependency client for TFA Sovereign Escrow.
//
// Drives the completion-contingent payment lifecycle over HTTP:
//   create → fund → release   (happy path)
//   create → fund → dispute → undispute → refund   (dispute path)
//
// Zero external dependencies — uses Node 22+ native fetch only. No imports
// from the TFA kernel: this file is self-contained and safe to publish/copy
// into a third-party project.
//
// Library mode:
//   import { createEscrow, fetchEscrow, fundEscrow, releaseEscrow, refundEscrow,
//            disputeEscrow, undisputeEscrow, EscrowClientError,
//            verifyWebhookSignature } from "@tfa/escrow-client";
//
// All money amounts are μ¢ (micro-cents) and travel as decimal strings over
// the wire; this client revives `agreement.amount` back into a JS BigInt.

export { verifyWebhookSignature } from "./verify-webhook.mjs";

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Error thrown by the escrow client on network, auth, validation, or state failures.
 * `code` is one of: missing_base_url, missing_tenant_id, missing_escrow_id,
 * missing_body_field, network_error, timeout, not_found, unauthorized, conflict,
 * server_error, invalid_response.
 */
export class EscrowClientError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EscrowClientError";
    this.code = code;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function guardBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new EscrowClientError("baseUrl is required", "missing_base_url");
  }
  return baseUrl.replace(/\/$/, "");
}

function guardTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new EscrowClientError("tenantId is required", "missing_tenant_id");
  }
  return tenantId;
}

function guardEscrowId(escrowId) {
  if (!escrowId || typeof escrowId !== "string") {
    throw new EscrowClientError("escrowId is required", "missing_escrow_id");
  }
  return escrowId;
}

function buildHeaders(tenantId, opts) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  return headers;
}

async function doFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw new EscrowClientError(`request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new EscrowClientError(`network error: ${e.message}`, "network_error");
  }
  clearTimeout(timer);
  return response;
}

function mapStatusToError(response, bodyText) {
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

/** The server serialises BigInt amount to a decimal string; revive it back to bigint. */
function reviveEscrowAgreement(obj) {
  if (!obj || typeof obj !== "object") {
    throw new EscrowClientError("response agreement is not an object", "invalid_response");
  }
  const amount = typeof obj.amount === "string" ? BigInt(obj.amount) : obj.amount;
  if (typeof amount !== "bigint") {
    throw new EscrowClientError("response agreement amount is not a valid bigint string", "invalid_response");
  }
  return { ...obj, amount };
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new EscrowClientError("response is not valid JSON", "invalid_response");
  }
}

function extractAgreement(body) {
  if (!body || typeof body !== "object" || !("agreement" in body)) {
    throw new EscrowClientError("response missing agreement field", "invalid_response");
  }
  return reviveEscrowAgreement(body.agreement);
}

async function postAction(baseUrl, escrowId, tenantId, action, opts, expectedStatus) {
  const url = `${guardBaseUrl(baseUrl)}/api/escrow/${encodeURIComponent(guardEscrowId(escrowId))}/${action}`;
  const tenant = guardTenantId(tenantId);
  const payload = { initiatedBy: opts.initiatedBy ?? "api" };
  if (opts.reason !== undefined) payload.reason = opts.reason;

  const response = await doFetch(
    url,
    { method: "POST", headers: buildHeaders(tenant, opts), body: JSON.stringify(payload) },
    opts.timeoutMs ?? 10_000,
  );

  if (response.status !== expectedStatus) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const resBody = await parseJsonResponse(response);
  return { agreement: extractAgreement(resBody), status: response.status };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch an escrow agreement by id.
 *
 * @param {string} baseUrl  Server base URL (e.g. "http://127.0.0.1:7700").
 * @param {string} escrowId The escrow agreement id.
 * @param {string} tenantId Mandatory tenant identifier (sent as x-tenant-id header).
 * @param {{apiKey?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function fetchEscrow(baseUrl, escrowId, tenantId, opts = {}) {
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

/** Alias of {@link fetchEscrow} for readability at call sites. */
export const getEscrow = fetchEscrow;

/**
 * Create a new escrow agreement. No money moves yet — call {@link fundEscrow} next.
 *
 * @param {string} baseUrl  Server base URL.
 * @param {string} tenantId Mandatory tenant identifier.
 * @param {{opportunityId: string, payerAccountId: string, workerAccountId: string, amount: bigint|string|number}} payload
 * @param {{apiKey?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function createEscrow(baseUrl, tenantId, payload, opts = {}) {
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
 * Fund an escrow agreement (created → funded): payer → escrow transfer.
 *
 * @param {string} baseUrl
 * @param {string} escrowId
 * @param {string} tenantId
 * @param {{apiKey?: string, timeoutMs?: number, initiatedBy?: string}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function fundEscrow(baseUrl, escrowId, tenantId, opts = {}) {
  return postAction(baseUrl, escrowId, tenantId, "fund", opts, 200);
}

/**
 * Release an escrow agreement (funded → released): escrow → worker on completion.
 *
 * @param {string} baseUrl
 * @param {string} escrowId
 * @param {string} tenantId
 * @param {{apiKey?: string, timeoutMs?: number, initiatedBy?: string}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function releaseEscrow(baseUrl, escrowId, tenantId, opts = {}) {
  return postAction(baseUrl, escrowId, tenantId, "release", opts, 200);
}

/**
 * Refund an escrow agreement (funded → refunded): escrow → payer on cancellation.
 *
 * @param {string} baseUrl
 * @param {string} escrowId
 * @param {string} tenantId
 * @param {{apiKey?: string, timeoutMs?: number, initiatedBy?: string}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function refundEscrow(baseUrl, escrowId, tenantId, opts = {}) {
  return postAction(baseUrl, escrowId, tenantId, "refund", opts, 200);
}

/**
 * Freeze a funded escrow (funded → disputed). Money does not move; only blocks
 * further release/refund until {@link undisputeEscrow}.
 *
 * @param {string} baseUrl
 * @param {string} escrowId
 * @param {string} tenantId
 * @param {{apiKey?: string, timeoutMs?: number, initiatedBy?: string, reason?: string}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function disputeEscrow(baseUrl, escrowId, tenantId, opts = {}) {
  return postAction(baseUrl, escrowId, tenantId, "dispute", opts, 200);
}

/**
 * Unfreeze a disputed escrow (disputed → funded). Only the funder may undispute.
 *
 * @param {string} baseUrl
 * @param {string} escrowId
 * @param {string} tenantId
 * @param {{apiKey?: string, timeoutMs?: number, initiatedBy?: string}} [opts]
 * @returns {Promise<{agreement: object, status: number}>}
 */
export async function undisputeEscrow(baseUrl, escrowId, tenantId, opts = {}) {
  return postAction(baseUrl, escrowId, tenantId, "undispute", opts, 200);
}
