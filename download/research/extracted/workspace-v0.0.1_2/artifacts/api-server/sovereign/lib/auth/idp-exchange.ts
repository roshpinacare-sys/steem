/**
 * lib/auth/idp-exchange.ts — IdP-integration adapter (v322, MANIFEST "next missing" #2 of v321).
 *
 * v321 added the VERIFY half of SSO: tenant-resolver.ts checks the signature
 * on an `Authorization: Bearer <jwt>` and maps its tenantId/scopes onto the
 * existing RBAC chokepoint. What was still missing is the MINT half: the
 * customer's IdP (Okta / Azure AD / Auth0 / etc.) speaks OIDC/SAML, not TFA's
 * HS256 token format — something has to sit between "user finished an IdP
 * login" and "TFA sees a Bearer token it can verify".
 *
 * That something is the customer's own gateway/Lambda/edge-function, NOT
 * TFA. TFA intentionally does not ship an OIDC/SAML client — that would add
 * an external dependency (a discovery-document fetcher, a JWKS cache, a
 * SAML XML parser) for a step that happens once per login and is already
 * solved by the IdP's own SDK. What TFA *can* own, zero-dep, is the narrow
 * last step: turn already-verified IdP claims into a TFA-shaped token using
 * the exact signJwt() that tenant-resolver.ts already trusts.
 *
 * mintTfaSsoToken() is that last step. It makes no network calls and
 * verifies nothing — it is only ever called AFTER the gateway has already
 * validated the IdP's id_token / SAML assertion. Its only job is fail-closed
 * claims mapping: refuse to mint a token with a guessed tenant or an
 * unidentified subject. See docs/IDP_INTEGRATION.md for the Okta / Azure AD
 * wiring recipes that call this function.
 */
import { signJwt, type JwtPayload } from "./jwt.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Claims already extracted and verified by the customer's IdP/gateway layer
 * (e.g. from a validated Okta id_token or an Azure AD access token). This
 * adapter does not validate these — that trust boundary is the caller's.
 */
export interface IdpClaims {
  /** TFA tenant, mapped from an IdP custom claim (e.g. Okta "org_id" / Azure AD "tid" → tenant lookup). */
  tenantId: string;
  /** End-user identifier, mapped from the IdP's "sub". */
  subject: string;
  /** Mapped from IdP groups/scopes claim. Either scopes or roles (or both) should be present for RBAC to grant anything. */
  scopes?: string[];
  /** Mapped from IdP groups/roles claim. */
  roles?: string[];
}

export interface MintTfaSsoTokenOptions {
  /** Must be the same value tenant-resolver.ts verifies with (ssoJwtSecret / TFA_SSO_JWT_SECRET). */
  secret: string;
  /** Default 300s — short-lived on purpose: the IdP session, not this token, is the real source of truth. */
  expiresInSec?: number;
  issuer?: string;
}

export type IdpExchangeFailReason = "missing_secret" | "missing_tenant_id" | "missing_subject";

export class IdpExchangeError extends Error {
  readonly reason: IdpExchangeFailReason;
  constructor(reason: IdpExchangeFailReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "IdpExchangeError";
  }
}

// ─── Mint ─────────────────────────────────────────────────────────────────────

/**
 * Mint a TFA-compatible bearer JWT from already-verified IdP claims.
 *
 * Fail-closed: throws IdpExchangeError instead of minting a token with a
 * missing/guessed tenantId or subject. There is no default tenant and no
 * anonymous subject — an incomplete claims mapping must be fixed by the
 * caller's gateway config, not papered over here.
 */
export function mintTfaSsoToken(claims: IdpClaims, opts: MintTfaSsoTokenOptions): string {
  if (!opts.secret) {
    throw new IdpExchangeError("missing_secret", "ssoJwtSecret is required to mint a TFA SSO token");
  }
  if (!claims.tenantId || typeof claims.tenantId !== "string") {
    throw new IdpExchangeError(
      "missing_tenant_id",
      "IdP claims are missing tenantId — refusing to mint a token for a guessed tenant",
    );
  }
  if (!claims.subject || typeof claims.subject !== "string") {
    throw new IdpExchangeError(
      "missing_subject",
      "IdP claims are missing subject — refusing to mint a token with no identified user",
    );
  }

  const payload: JwtPayload = {
    sub: claims.subject,
    tenantId: claims.tenantId,
    ...(claims.scopes ? { scopes: claims.scopes } : {}),
    ...(claims.roles ? { roles: claims.roles } : {}),
  };

  return signJwt(payload, {
    secret: opts.secret,
    expiresInSec: opts.expiresInSec ?? 300,
    issuer: opts.issuer ?? "tfa-idp-exchange",
  });
}
