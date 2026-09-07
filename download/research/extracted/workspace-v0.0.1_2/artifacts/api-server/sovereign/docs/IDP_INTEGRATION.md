# TFA — IdP Integration Guide (Okta / Azure AD / generic OIDC-SAML)

> Companion to `docs/RUNBOOK.md` §2 (`TFA_SSO_JWT_SECRET`) and §12 (Security Checklist).
> Added v322 — closes MANIFEST "next missing" #2 of v321.

## The boundary, in one diagram

```
 ┌──────────┐   OIDC/SAML login    ┌──────────────────┐   Bearer <jwt>   ┌─────┐
 │  End user │ ───────────────────▶│  YOUR gateway     │ ───────────────▶│ TFA │
 └──────────┘                      │  (Lambda / APIM / │                 └─────┘
                                    │   reverse proxy)  │
                                    │                    │
                                    │  1. IdP SDK verifies the id_token/   │
                                    │     SAML assertion (network calls,   │
                                    │     JWKS, signature — all here)      │
                                    │  2. mintTfaSsoToken(claims, …)        │
                                    │     (zero-dep, no network)            │
                                    └────────────────────┘
```

TFA never talks to Okta, Azure AD, or any IdP directly. It only verifies a
short-lived HS256 JWT (`lib/auth/jwt.ts`, existing since v321) that **your**
gateway mints after it has already done the real OIDC/SAML work using the
IdP's own SDK. `mintTfaSsoToken()` (`lib/auth/idp-exchange.ts`, v322) is the
one zero-dep function that turns verified IdP claims into that token — it is
the piece this guide wires up for two common IdPs below.

This split is deliberate: a full OIDC/SAML client (discovery-document
fetch, JWKS cache + rotation, SAML XML parsing) is exactly the kind of
external dependency TFA's zero-dep rule forbids, and it is a solved problem
your IdP already ships an SDK for. TFA's job is the 30 seconds *after* login
succeeds: turning "this user is who they say they are, on this tenant, with
these roles" into a token TFA's RBAC chokepoint already understands.

## Claim mapping contract

Whatever IdP you use, your gateway must produce an `IdpClaims` object before
calling `mintTfaSsoToken`:

| `IdpClaims` field | Required | Typical source |
|---|---|---|
| `tenantId` | Yes | A custom claim you configure the IdP to emit (Okta custom authorization-server claim, Azure AD app role / optional claim), or a lookup keyed by the IdP's org/tenant identifier |
| `subject` | Yes | The IdP's `sub` (Okta) or `oid`/`sub` (Azure AD) |
| `scopes` / `roles` | No (but RBAC grants nothing without at least one) | IdP groups or app-role claims, mapped to TFA's existing scope strings (the same ones API keys use, e.g. `admin:kill-switch`) |

Missing `tenantId` or `subject` is a hard failure (`IdpExchangeError`), not a
default — see `tests/auth/idp-exchange.test.ts`.

## Recipe: Okta

1. In Okta, add a custom claim to your Authorization Server (Security → API
   → your default server → Claims): a claim named e.g. `tfa_tenant_id`
   sourced from a user/app profile attribute, plus a `groups` claim scoped
   to the groups you map to TFA roles.
2. Your gateway (an Okta-fronted Lambda, or middleware in front of TFA)
   verifies the Okta `id_token`/`access_token` using Okta's own JWT verifier
   (`@okta/jwt-verifier` or your framework's OIDC middleware) — this is the
   network-calling, JWKS-fetching half that stays entirely on your side.
3. On success, map the verified claims and call:
   ```ts
   import { mintTfaSsoToken } from "@tfa/auth"; // or wherever lib/auth is published from
   const tfaToken = mintTfaSsoToken(
     { tenantId: oktaClaims.tfa_tenant_id, subject: oktaClaims.sub, scopes: oktaClaims.groups },
     { secret: process.env.TFA_SSO_JWT_SECRET! },
   );
   ```
4. Forward to TFA as `Authorization: Bearer <tfaToken>`.

## Recipe: Azure AD (Microsoft Entra ID)

1. In your Azure AD app registration, configure optional claims (Token
   configuration) to emit `tid` (tenant) and an app role or group claim your
   gateway can map to TFA scopes.
2. Your gateway (an Azure Function behind APIM, or middleware) validates the
   Azure AD access token against Azure AD's JWKS using `passport-azure-ad`
   or your framework's OIDC support — again, entirely your side.
3. Map and mint, same shape as the Okta recipe:
   ```ts
   const tfaToken = mintTfaSsoToken(
     { tenantId: tenantLookup(azureClaims.tid), subject: azureClaims.oid, roles: azureClaims.roles },
     { secret: process.env.TFA_SSO_JWT_SECRET! },
   );
   ```
4. Forward to TFA as `Authorization: Bearer <tfaToken>`.

## Security notes

- `TFA_SSO_JWT_SECRET` is a shared HMAC secret between your gateway and TFA —
  it is not an IdP secret and should never be handed to end users or
  embedded in any client-side code. Only the gateway process should hold it.
- Keep `expiresInSec` short (default 300s). The gateway re-mints on every
  request (or caches briefly, scoped to the IdP session) — the IdP session,
  not this token, is the real authority.
- If a tenant is compromised at the gateway-mapping layer (wrong
  `tenantId` resolved), TFA's RBAC and tenant-isolation invariants still
  hold — the blast radius is whatever scopes that token carries, never
  cross-tenant data, since every TFA query is filtered by `tenantId`.
- This guide does not cover OIDC/SAML client setup itself (Okta/Azure AD
  app registration, redirect URIs, PKCE) — use the IdP's own quick-start;
  this document starts where that quick-start ends.
