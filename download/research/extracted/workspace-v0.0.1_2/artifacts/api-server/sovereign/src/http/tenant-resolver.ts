/**
 * src/http/tenant-resolver.ts — resolve tenantId from x-api-key, an SSO bearer
 * JWT, or x-tenant-id.
 *
 * API-Key auth (v91, step G.6) replaces the exposed x-tenant-id header.
 * SSO bearer-token auth (v321, RBAC/SSO sub-step 1) adds a third path for
 * enterprise auth: TFA does not perform the OIDC/SAML exchange itself (that
 * stays with the customer's IdP/gateway) — it only verifies the signature on
 * an already-issued JWT and maps its `tenantId` + `scopes`/`roles` claims onto
 * the exact same RBAC chokepoint (`requireScope`) that API keys already use.
 * Precedence: x-api-key > Authorization: Bearer <jwt> > x-tenant-id.
 * Fail-closed: invalid / revoked / expired api key → 401; invalid / expired /
 * tenantId-less SSO token → 401. The SSO path is inert (skipped entirely)
 * unless a secret is configured — no behavior change for existing deployments.
 *
 * Security note: the SSO secret is a plain HMAC-SHA256 key (lib/auth/jwt.ts,
 * zero-dep). It authenticates a token your own IdP-integration layer issued
 * after a real OIDC/SAML login — it is NOT an OIDC/SAML client implementation.
 */

import type { ApiKeyService } from "../../lib/api-key/index.ts";
import { verifyJwt } from "../../lib/auth/jwt.ts";

/** Resolve the SSO JWT secret: explicit option wins, else TFA_SSO_JWT_SECRET. Unset → SSO path inert. */
export function resolveSsoSecret(opt?: string): string | undefined {
  if (typeof opt === "string" && opt.length > 0) return opt;
  const env = (globalThis as any).process?.env?.TFA_SSO_JWT_SECRET;
  return typeof env === "string" && env.length > 0 ? env : undefined;
}

/**
 * Tenant resolution with a production enforcement mode (release-audit fix, v110).
 *
 *   requireApiKey=false (dev default): x-api-key if present, else bare x-tenant-id (convenient).
 *   requireApiKey=true  (production):  ONLY a valid x-api-key resolves a tenant; bare x-tenant-id
 *                                      is rejected 401 (fail-closed). Enabled via the option or
 *                                      the TFA_REQUIRE_API_KEY=1 environment variable.
 */
export function apiKeyRequired(opt?: boolean): boolean {
  if (typeof opt === "boolean") return opt;
  const env = (globalThis as any).process?.env?.TFA_REQUIRE_API_KEY;
  return env === "1" || env === "true";
}

export async function resolveTenantId(
  apiKeyService: ApiKeyService | undefined,
  headers: Record<string, string | string[] | undefined>,
  requireApiKey?: boolean,
  ssoJwtSecret?: string,
): Promise<{ tenantId?: string; scopes?: string[]; error?: string; status?: number }> {
  const enforce = apiKeyRequired(requireApiKey);
  const apiKeyHeader = headers["x-api-key"];
  if (apiKeyHeader && typeof apiKeyHeader === "string" && apiKeyService) {
    const key = await apiKeyService.validate(apiKeyHeader);
    if (!key) return { error: "invalid or revoked api key", status: 401 };
    return { tenantId: key.tenantId, scopes: key.scopes };
  }

  // SSO bearer-token path (v321). Only consulted when a secret is configured —
  // existing deployments that never set TFA_SSO_JWT_SECRET see no change at all.
  const ssoSecret = resolveSsoSecret(ssoJwtSecret);
  const authHeader = headers["authorization"] ?? headers["Authorization"];
  const bearerRaw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (ssoSecret && typeof bearerRaw === "string" && bearerRaw.startsWith("Bearer ")) {
    const token = bearerRaw.slice(7).trim();
    const result = verifyJwt(token, ssoSecret);
    if (!result.ok) return { error: `invalid sso token (${result.reason})`, status: 401 };
    const { tenantId, scopes, roles } = result.payload;
    if (!tenantId || typeof tenantId !== "string") {
      return { error: "sso token missing tenantId claim", status: 401 };
    }
    return { tenantId, scopes: scopes ?? roles };
  }

  if (enforce) {
    // Production: identity comes only from a verified key. A bare tenant header is an
    // unauthenticated claim — fail-closed.
    return { error: "x-api-key required (api-key enforcement enabled)", status: 401 };
  }
  const tenantId = headers["x-tenant-id"];
  // Trusted mode (requireApiKey=false): bare x-tenant-id is accepted.
  // Grant superadmin scopes implicitly — every scope check passes in dev/test.
  // In production (requireApiKey=true, above) this branch is unreachable.
  if (tenantId && typeof tenantId === "string") return { tenantId, scopes: ["superadmin"] };
  return { error: "x-tenant-id or x-api-key header required", status: 400 };
}
