# TFA — Security

This document describes TFA's threat model, key management, and the fail-closed
guarantees that hold across the system. It is written for an auditor, security
reviewer, or customer's security team evaluating TFA before integration.

## Core security properties

1. **Fail-closed by default.** Any action whose type is not explicitly allowed by
   policy is **denied**, not ignored (`ledger-allowlist` in
   `defaultPolicies()`, `src/composition.ts`). New action types must be added to
   policy data before they can execute — there is no implicit-allow path.
2. **Every decision is audited — including denials.** `TfaOrchestrator.execute()`
   writes an `AuditRecord` for allowed, denied, *and* errored actions. A denied
   action leaves a trail; nothing is silently dropped.
3. **The audit chain is tamper-evident.** Each `AuditRecord` includes a hash of
   the previous record (`prevHash` → `hash`). Any edit to history breaks the
   chain. Verifiable offline via `scripts/verify-passport.mjs` and online via
   `GET /api/transparency/chain`.
4. **Tenant isolation is enforced at the data layer, not just the API layer.**
   Every store method takes `tenantId` and throws `TENANT_VIOLATION` on mismatch.
   A bug in a route handler that forgets to check `tenantId` still cannot read or
   write another tenant's data, because the underlying store rejects it.
5. **Money has one path in and one path out.** `guardMint` and `guardWithdraw`
   are the *only* functions in `lib/ledger` that change total supply. Both are
   orchestrator-gated (`ledger.mint` / `ledger.withdraw` action types), so both
   are policy-checked, audited, and solvency-checked
   (`proofOfSolvency`, `GET /api/monitor/run`).
6. **Amounts are `bigint`, never floating point.** `MicroCents = bigint`
   throughout `lib/ledger`. Non-`bigint` amount inputs are a type error at the
   library boundary, and invalid numeric strings throw rather than silently
   coercing to `0` or `NaN`.

## Cryptography — zero external dependencies

All cryptographic primitives use Node's built-in `node:crypto`:

| Purpose | Algorithm | Module |
|---|---|---|
| Password hashing | scrypt | `lib/auth/password.ts` |
| Session / API tokens | HMAC-SHA256 (JWT) | `lib/auth/jwt.ts` |
| 2FA | TOTP (RFC 6238) | `lib/auth/totp.ts` |
| Action Passports | Ed25519 | `lib/passport` |
| Audit chain links | SHA-256 | `lib/orchestrator/audit.ts` |
| API keys | random bytes + hash | `lib/api-key` |
| Webhook callbacks | HMAC-SHA256 | `lib/escrow/webhook.ts` |

No third-party crypto library (jose, bcrypt, otplib, etc.) is in the dependency
tree for these primitives. `lib/auth/crypto-provider.ts` exposes them behind a
`CryptoProvider` interface — a deployment can substitute its own provider (e.g.
an HSM-backed signer for passports) without touching call sites.

## Key management

- **Passport signing key (Ed25519).** Configured via the `signer` option to
  `buildSovereignStack()`. The **public key** is served at
  `GET /api/passport/public-key` so third parties can verify passports without
  any shared secret. The **private key** never leaves the process that signs; it
  is not stored in the audit chain, the ledger, or any API response.
- **JWT signing secret (HMAC-SHA256).** A server-side secret used to sign session
  tokens. Rotating it invalidates all outstanding sessions (acceptable —
  short-lived tokens, refresh flow re-issues).
- **API keys** (`lib/api-key`). Generated as random bytes; only a hash is stored
  (`InMemoryApiKeyStore` / Drizzle equivalent). The raw key is returned **once**,
  at creation time (`POST /api/auth/api-keys`), and cannot be retrieved again —
  losing it requires issuing a new key and revoking the old one
  (`DELETE /api/auth/api-keys/:keyId`).
- **Webhook HMAC secrets.** Each webhook registration gets a unique per-endpoint
  secret (random 32-byte hex). The secret is returned **once** at registration time
  and never echoed again. Consumers verify callbacks offline using the standalone
  `verifyWebhookSignature` utility (`sdk/escrow-client/verify-webhook.mjs`) — zero
  kernel imports, only `node:crypto`. A valid signature proves the payload was
  signed by TFA with the shared secret; tampered payloads or wrong secrets are
  rejected with a constant-time comparison.
- **No secrets in the agent's reach.** Agents interacting with the orchestrator
  receive policy decisions and passports — never signing keys, JWT secrets, or
  raw database credentials.

## Threat model

### In scope / mitigated

- **Cross-tenant data access** — mitigated structurally (see property 4 above).
  Threat: a compromised or buggy handler for tenant A reads/writes tenant B's
  ledger or audit data. Mitigation: every store call requires `tenantId` and
  throws on mismatch; tested explicitly in every integration test suite
  (`tenant isolation` test cases throughout `tests/integration/`).
- **Unauthorized money creation** — mitigated by chokepoint design (property 5).
  Threat: a new code path mints credits without going through policy. Mitigation:
  `InMemoryLedger`/`DrizzlePaymentProvider` have no other balance-increasing
  method; `guardMint` requires `initiatedBy` and is policy-gated.
- **Policy bypass via unknown action type** — mitigated by fail-closed allowlist
  (property 1). A new feature that forgets to register its action type in policy
  data is **denied**, not silently allowed — the failure mode is "feature doesn't
  work" (loud), not "feature works without authorization" (silent).
- **Audit tampering** — mitigated by hash-linking (property 3). An attacker with
  write access to the audit store who edits a past record breaks the chain at
  that point forward — detectable.
- **Passport forgery** — mitigated by Ed25519 signatures over the audit record
  content. A forged passport either doesn't verify against the published public
  key, or (if the audit record itself was edited) breaks the audit chain.
- **Webhook forgery / tampering** — mitigated by per-registration HMAC-SHA256
  secrets and timing-safe verification. Threat: an attacker sends a fake
  `settlement.released` callback to a partner's endpoint. Mitigation: every
  callback carries `x-tfa-signature: sha256=<base64>`; consumers verify with
  the shared secret before acting on the event. The verifier is standalone
  (`sdk/escrow-client/verify-webhook.mjs`) so consumers need no TFA code trust.
- **Replay / over-spending via rate abuse** — mitigated by the in-house
  `TokenBucketRateLimiter` (`src/http/express-adapter.ts`) per tenant, plus
  policy-level spending caps (`tx-spending-cap`) and plan-based action caps
  (`tenant-plan-limit`, `PLAN_LIMITS.free/pro`).
- **Insufficient-funds / overdraft** — `guardWithdraw` and `transfer` check
  balance before mutating state and throw `INSUFFICIENT_FUNDS`; no partial state
  change occurs on a rejected operation (verified by "balance unchanged after
  failed withdraw" tests).

## Mitigation table — newer capabilities

The following table maps threats introduced by newer TFA capabilities to their
mitigations and the test/verification that backs each claim.

| Threat | Mitigation | Verification |
|---|---|---|
| **Webhook forgery / tampering** — attacker sends fake `settlement.released` callback | Per-registration HMAC-SHA256 secret + timing-safe `verifySignature`. Secret ≥ 16 bytes, generated if caller omits. Payload canonical JSON signed; tampering breaks signature. | `tests/escrow/webhook.test.ts`, `tests/escrow/webhook-verification-sdk.test.ts`, `sdk/escrow-client/verify-webhook.mjs` |
| **Webhook secret leakage** — secret echoed in API responses | Secret returned **once** at registration; `GET` list/details redact it. Store interface never leaks secret field. | `tests/escrow/webhook.test.ts` (registration flow), `lib/escrow/webhook.ts` |
| **Key rotation breaks old proofs** — verifier only has current public key | `KeyRing` stores key history by `kid`. Proofs carry `kid`; verifier resolves the signing key active at the time of signing. "Retiring" keys remain valid during overlap. | `tests/adapter/kid-in-receipt-and-passport.test.ts`, `tests/passport/kid-end-to-end.test.ts`, `lib/passport/key-ring.ts` |
| **Compromised signing key** — attacker forges proofs with stolen private key | `KeyRing.revoke(kid)` marks key `revoked`; `verify()` returns `false` for any proof signed with that kid, historical or new. Verifier routes return **410 Gone** for revoked kids. | `tests/passport/kid-end-to-end.test.ts`, `lib/passport/key-ring.ts` |
| **Rotation overlap gap** — old proofs rejected before all verifiers cache new key | `KeyRing.rotate()` marks old active key as `retiring` (not `revoked`). Both active and retiring keys verify until the retiring key is explicitly revoked. | `tests/http/kid-resolver-routes.test.ts`, `lib/passport/key-ring.ts` |
| **Cross-tenant data leakage** — tenant A learns tenant B's full audit chain | Introduction exposes only the **requested proof bundle** (track-record or passport), not the source tenant's full chain. Target tenant must explicitly `accept` before data flows. | `tests/introduction/cross-tenant-introduction.test.ts`, `lib/introduction/introduction-store.ts` |
| **Introduction request spoofing** — attacker forges an introduction from tenant A to tenant B | Every request is signed by the kernel signer over a canonicalized payload. Tampering breaks signature verification at acceptance time. | `tests/introduction/cross-tenant-introduction.test.ts` |
| **Introduction access by unrelated tenant** — tenant C reads A→B introduction | `IntroductionStore.getWithAccess` checks that the querying tenant is either `sourceTenantId` or `targetTenantId`; otherwise returns `null` → HTTP 404. | `tests/introduction/cross-tenant-introduction.test.ts` |
| **Risk fusion manipulated by client** — client supplies fake low reputationScore | `assessRisk` validates `reputationScore` is a finite number in `[0,100]`; out-of-range throws. Reputation band is server-derived from `TrackRecordCache`, never client-supplied. | `tests/risk/risk-intelligence.test.ts` |
| **Trusted actor bypasses policy** — high reputationScore weakens the gate | Fusion is **monotonic**: reputation can only *escalate* (increase risk), never lower the static approval-class floor. A trusted actor gets an informational score reduction, not a weaker gate. | `tests/risk/risk-intelligence.test.ts` (trusted band tests) |
| **Opaque / unexplainable risk score** — operators cannot defend a decision | Every `RiskAssessment` carries `factors[]` with signed contributions per signal. `explanation[]` is a human-readable sentence. Deterministic: same inputs → same score, anyone can reproduce. | `tests/risk/risk-intelligence.test.ts`, `lib/risk/risk-intelligence.ts` |
| **Unknown / malformed action type bypass** — new action type not in taxonomy | `baseClass()` falls back to `"deny"` for unknown classes. `assessRisk` fail-closed: bad input throws rather than silently defaulting to a weaker class. | `tests/risk/risk-intelligence.test.ts`, `lib/risk/risk-intelligence.ts` |
| **Agent provenance spoofing** — client claims to be a different vendor/agent | `normalizeAgentProvenance` derives a deterministic `provenanceId` (SHA-256 over canonical vendor+agentId+model). Same inputs always yield the same id; changing any field changes the id. The provenance block is included in the Ed25519-signed passport body, so a forged/altered claim invalidates the passport signature. | `tests/mcp-server/assess-risk-provenance.test.ts`, `lib/adapter/agent-provenance.ts`, `lib/passport/passport.ts` |
| **Missing vendor / agentId in provenance** — caller supplies partial provenance | `normalizeAgentProvenance` throws if `vendor` or `agentId` is empty/missing. `resolveProvenance` in `lib/passport/passport.ts` propagates the throw; the MCP tool returns an error response rather than silently issuing a provenance-free result. | `tests/mcp-server/assess-risk-provenance.test.ts` (fail-closed ×2), `lib/adapter/agent-provenance.ts` |
| **Unknown vendor label mislabeled** — unrecognized vendor string aliased to a known vendor | `normalizeVendor` falls back to `"custom"` and preserves the raw label in the `customVendorLabel` field — it never silently re-labels an unrecognized vendor. Information is retained; no false vendor attribution. | `tests/security/threat-mitigations.test.ts` (provenance section), `lib/adapter/agent-provenance.ts` |
| **Provenance id non-determinism** — two identical provenance claims produce different fingerprints | `provenanceId` is SHA-256 over a stable canonical string (`vendor|agentId|model|product`). Tested: same inputs reproduce the same id across independent calls; already-normalized input passes through unchanged (`resolveProvenance` idempotent). | `tests/mcp-server/assess-risk-provenance.test.ts`, `tests/security/threat-mitigations.test.ts` |
| **Silent signer downgrade** — the zero-dep PQC simulation fallback (`pqc-loader.ts`) is active in production but operators have no signal | `GET /readyz` exposes `checks.pqc`: the active signer algorithm verbatim, prefixed `sim: ` whenever it ends in `-sim`. Wired live from `resolvedStack.signer` in `sovereign-server.ts`, so the flag reflects the real composition, not a static claim. Never flips readiness to `503` — a sim signer is a valid (non-PQC-secure) configuration, not an outage — so ops can alert on the string without the check itself causing false-positive downtime. | `tests/http/health-shutdown.test.ts` (unit + live-wiring integration), `tests/security/threat-mitigations.test.ts` |
| **Stale reputation proof replayed indefinitely** — a `TrustProofBundleV2` issued once had no expiry, so a third party could keep presenting an old (possibly outdated) reputation claim as current forever | `validUntil` (ISO 8601) is now part of the hashed bundle body — tampering with it invalidates the bundle like any other field. The public Trust API route (`GET /api/track-record/:id/proof-v2`) applies a 24h default window (`PROOF_BUNDLE_DEFAULT_VALID_MS`). `verifyProofBundleV2` rejects an expired bundle unconditionally once a `validUntil` claim is present; `requireFreshness` lets a caller additionally reject bundles that omit the claim. The anchor time is the **verifier's own clock** (`now` option), never read from the bundle, so a prover can't extend its own window. Pre-v370 bundles (no `validUntil`) still verify by default — additive, not a breaking change. | `tests/track-record/proof-bundle-v2.test.ts` (freshness-bound section), `tests/security/threat-mitigations.test.ts` |
| **PQC check false-claims real provider when none is wired** — readyz reports `pqc` even though no signer was supplied to `HealthState` | The `pqc` key is **omitted entirely** when `state.signer` is undefined, rather than defaulting to a value — absence of evidence is not reported as evidence of a real provider. | `tests/http/health-shutdown.test.ts` ("no signer supplied omits pqc check"), `tests/security/threat-mitigations.test.ts` |
| **ARD domain↔identity spoofing** — attacker publishes a `urn:ai:victim.com:...` agent id but signs it under an unrelated `trustManifest.identity` domain they control | `verifyArdAgent` requires an **exact match** between the URN's publisher-FQDN authority and the domain extracted from `trustManifest.identity` (`did:web`/`https://`/`spiffe://` all normalized to a bare domain). Any mismatch sets `checks.domainAlignment=false` and `valid=false` immediately — checked before JWS verification runs. | `tests/adapter/ard-verifier.test.ts` ("fail-closed: domain mismatch"), `tests/security/threat-mitigations.test.ts`, `lib/adapter/ard-verifier.ts` |
| **ARD JWS algorithm confusion** — attacker crafts a detached JWS with `alg:"none"`/`"RS256"`/other unsupported algorithm to bypass signature checking | `verifyDetachedJws` checks the header `alg` against a hard allow-list (`EdDSA`, `HS256`) **before** attempting any signature verification, and separately requires the header `alg` to match the algorithm the actual `Signer` instance produces — a mismatch on either axis returns `false`, never throws-then-defaults-open. | `tests/adapter/ard-publisher.test.ts` ("rejects unknown algorithm"), `tests/security/threat-mitigations.test.ts`, `lib/adapter/ard-publisher.ts` |

### Out of scope / deployment responsibility

- **Transport security (TLS).** TFA assumes it sits behind a TLS-terminating
  reverse proxy / load balancer. The bundled `node:http` server
  (`sovereign-server.ts`) is plaintext and intended for tests/dev only.
- **Secrets storage at rest.** TFA expects signing keys and JWT secrets to be
  injected via environment/secret-manager; it does not implement its own secrets
  vault.
- **Postgres access control / network isolation.** `DrizzlePaymentProvider` and
  other Pg-backed stores assume the database itself is network-isolated and
  access-controlled by the deployment environment.
- **Denial of service at the network layer** (volumetric attacks) — the
  token-bucket limiter protects per-tenant fairness at the application layer, not
  the network edge.
- **Physical/host security**, **dependency supply-chain auditing** of `pnpm`
  packages used for the Express/Drizzle production adapters (the kernel itself
  has none, but the production HTTP/DB adapters do).

## Reporting a vulnerability

This is an internal engineering manifest, not a public disclosure channel. If you
are reviewing this as a security assessment, findings should be routed through
your engagement's normal reporting process, with reference to the specific
`lib/*` module and the property (1–6 above) it relates to.

## Verifying TFA's claims yourself

Every claim in this document is backed by a test that runs with
`node scripts/ecos-audit.mjs --full` (see `MANIFEST.md` for current pass count).
In particular:

- Tenant isolation: `grep -rl "TENANT_VIOLATION\|tenant isolation" tests/`
- Fail-closed policy: `grep -rl "fail-closed\|403" tests/integration/`
- Solvency: `tests/ledger/`, `GET /api/monitor/run` integration tests
- Passport verification: `examples/third-party-verify.mjs`,
  `tests/integration/*passport*`
- Webhook verification: `examples/verify-webhook.mjs`,
  `tests/escrow/webhook-verification-sdk.test.ts`
- Mitigation table claims: `tests/security/threat-mitigations.test.ts`
