/**
 * lib/dashboard-client/dashboard-client.ts — external Transparency Dashboard SDK client.
 *
 * Provides fetch helpers for the sovereign transparency REST endpoints:
 *   • fetchChain       — GET /api/transparency/chain
 *   • fetchBalances    — GET /api/transparency/balances
 *   • fetchPassportList — GET /api/transparency/passports
 *
 * Zero external dependencies — uses Node 22+ native fetch only.
 * Fail-closed: invalid input → DashboardClientError; network failure → error.
 */

import type { ChainView, BalancesView, PassportListView } from "../transparency/types.ts";
import {
  DashboardClientError,
  type DashboardFetchOptions,
  type FetchChainResult,
  type FetchBalancesResult,
  type FetchPassportListResult,
} from "./types.ts";

// ─── Internal helpers ────────────────────────────────────────────────────────

function guardBaseUrl(baseUrl: unknown): string {
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new DashboardClientError("baseUrl is required", "missing_base_url");
  }
  return baseUrl.replace(/\/$/, "");
}

function guardTenantId(tenantId: unknown): string {
  if (!tenantId || typeof tenantId !== "string") {
    throw new DashboardClientError("tenantId is required", "missing_tenant_id");
  }
  return tenantId;
}

function buildHeaders(tenantId: string, opts: DashboardFetchOptions): Record<string, string> {
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
      throw new DashboardClientError(`request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new DashboardClientError(`network error: ${err.message}`, "network_error");
  }
  clearTimeout(timer);
  return response;
}

function mapStatusToError(response: Response, bodyText: string): never {
  if (response.status === 404) {
    throw new DashboardClientError(bodyText || "not found (404)", "not_found");
  }
  if (response.status === 401 || response.status === 403) {
    throw new DashboardClientError(bodyText || "unauthorized (401/403)", "unauthorized");
  }
  if (response.status >= 500) {
    throw new DashboardClientError(bodyText || `server error (${response.status})`, "server_error");
  }
  throw new DashboardClientError(bodyText || `unexpected status ${response.status}`, "server_error");
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DashboardClientError("response is not valid JSON", "invalid_response");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the tenant's full audit chain view.
 *
 * @param baseUrl  Server base URL (e.g. "http://127.0.0.1:7700").
 * @param tenantId Mandatory tenant identifier (sent as x-tenant-id header).
 * @param opts     Optional apiKey / timeout.
 */
export async function fetchChain(
  baseUrl: string,
  tenantId: string,
  opts: DashboardFetchOptions = {},
): Promise<FetchChainResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/transparency/chain`;
  const tenant = guardTenantId(tenantId);
  const response = await doFetch(url, { method: "GET", headers: buildHeaders(tenant, opts) }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const body = await parseJsonResponse(response);
  if (!body || typeof body !== "object" || !("tenantId" in body)) {
    throw new DashboardClientError("response missing tenantId field", "invalid_response");
  }
  return { view: body as ChainView, status: response.status };
}

/**
 * Fetch the tenant's balances view with live solvency proof.
 *
 * @param baseUrl  Server base URL.
 * @param tenantId Mandatory tenant identifier.
 * @param opts     Optional apiKey / timeout.
 */
export async function fetchBalances(
  baseUrl: string,
  tenantId: string,
  opts: DashboardFetchOptions = {},
): Promise<FetchBalancesResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/transparency/balances`;
  const tenant = guardTenantId(tenantId);
  const response = await doFetch(url, { method: "GET", headers: buildHeaders(tenant, opts) }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const body = await parseJsonResponse(response);
  if (!body || typeof body !== "object" || !("tenantId" in body)) {
    throw new DashboardClientError("response missing tenantId field", "invalid_response");
  }
  return { view: body as BalancesView, status: response.status };
}

/**
 * Fetch the tenant's passport list view.
 *
 * @param baseUrl  Server base URL.
 * @param tenantId Mandatory tenant identifier.
 * @param opts     Optional apiKey / timeout.
 */
export async function fetchPassportList(
  baseUrl: string,
  tenantId: string,
  opts: DashboardFetchOptions = {},
): Promise<FetchPassportListResult> {
  const url = `${guardBaseUrl(baseUrl)}/api/transparency/passports`;
  const tenant = guardTenantId(tenantId);
  const response = await doFetch(url, { method: "GET", headers: buildHeaders(tenant, opts) }, opts.timeoutMs ?? 10_000);

  if (response.status !== 200) {
    const text = await response.text().catch(() => "");
    mapStatusToError(response, text);
  }

  const body = await parseJsonResponse(response);
  if (!body || typeof body !== "object" || !("tenantId" in body)) {
    throw new DashboardClientError("response missing tenantId field", "invalid_response");
  }
  return { view: body as PassportListView, status: response.status };
}
