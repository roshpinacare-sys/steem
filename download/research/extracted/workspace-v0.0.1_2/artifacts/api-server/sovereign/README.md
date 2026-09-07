# TFA — Sovereign Trust-as-a-Service Backend

> **Trust Price Discovery**: authority is earned through a proven track record, not declared.
> TFA is the layer AI agents and organizations need to act, transact, and be held
> accountable — autonomously, auditable, and independent of any single cloud vendor.

---

## What TFA is

TFA is a multi-tenant backend that gives every autonomous action — a payment, an
agent task, a marketplace claim — three guarantees:

1. **It happened inside policy.** Every action passes through a single
   declarative-policy gate (`policy-as-data`, not code) before it executes.
   Unknown action = denied, by default (fail-closed).
2. **It is recorded immutably.** Every allowed *and* denied action is written to a
   hash-linked audit chain — tamper-evident, per tenant.
3. **It is provable to a third party.** Every audited action can be issued an
   Ed25519-signed **Action Passport** — a portable proof that *this agent, under
   this policy, did this thing, at this time* — verifiable with nothing but a
   public key (`scripts/verify-passport.mjs`, zero dependencies).

On top of this kernel sits a **sovereign ledger** (BigInt μ¢, double-entry,
`guardMint`/`guardWithdraw` as the only chokepoints for money creation/destruction),
an **escrow + marketplace** for agent-to-agent work, and a **Potential Engine** that
maps a user's strengths to opportunities and routes them toward success.

## Why "sovereign"

- **Zero required external dependencies.** Crypto (JWT/password/TOTP) is
  `node:crypto` only. The ledger, policy engine, audit chain, and passport signer
  are all in-house. Postgres is optional — everything has an in-memory
  implementation for dev/test.
- **No vendor lock-in.** Stripe, OIDC providers, etc. are optional adapters behind
  interfaces — the platform runs, and proves itself, without them.
- **Tenant isolation is structural.** Every store, every query, every guard is
  scoped by `tenantId`. Cross-tenant access is a `TENANT_VIOLATION`, not a missing
  `WHERE` clause.

## Quickstart (< 60 seconds, zero dependencies)

```bash
cd artifacts/api-server/sovereign
node examples/quickstart.mjs
```

This single script: registers a tenant → defines a policy → an agent performs a
mint → receives a signed passport → the tenant's track record updates. No
install, no network, no database.

For a fuller walkthrough (escrow, marketplace, dispute, fees), run:

```bash
node examples/full-economy-demo.mjs
```

## Running the server

```bash
pnpm install        # only needed for the Express adapter / Postgres stores
pnpm typecheck       # tsc --noEmit, no build step
node src/http/sovereign-server.ts   # in-memory stack, zero-dep
```

The in-memory `startSovereignServer()` boots a plain `node:http` server — no
Express, no Postgres required. `src/http/express-adapter.ts` wraps the same
route table for production deployments (adds rate-limiting, request-id logging,
and Drizzle-backed stores).

## API surface (selected)

| Area | Endpoints |
|---|---|
| Ledger | `POST /api/ledger/accounts`, `POST /api/ledger/mint`, `POST /api/ledger/withdraw`, `POST /api/ledger/transfer`, `GET /api/ledger/solvency` |
| Potential Engine | `POST /api/potential/{profile,personality,success-path,collaboration}` |
| Marketplace | `POST/GET /api/marketplace/opportunities`, `POST /api/marketplace/route`, claim |
| Escrow | `POST /api/escrow`, `/fund`, `/release`, `/refund`, `/dispute`, `/undispute` |
| Trust & Audit | `GET /api/passport/{public-key,:auditId}`, `GET /api/transparency/{chain,balances,passports}` |
| Track Record | `GET /api/track-record/:identityId` |
| Tenants & Plans | `POST /api/tenants` (with `plan: "free"|"pro"`) |
| Auth | `POST /api/auth/api-keys`, `GET /api/auth/api-keys`, `DELETE /api/auth/api-keys/:keyId` |
| Ops | `GET /api/monitor/status`, `POST /api/monitor/run` |

Full machine-readable spec: `lib/api-spec/openapi.yaml`. Live contract tests under
`tests/contract/`.

## Tenant Dashboard

A single zero-dependency HTML page (served from the running server) shows a
tenant's track record, escrows, passports, and ledger balances — read-only,
understandable by non-engineers. See `MANIFEST.md` (v98) for details.

## Pricing model

Plans (`free`, `pro`) are **policy-as-data** — monthly action caps are configured,
not coded (`PLAN_LIMITS` in `src/composition.ts`, `tenant-plan-limit` guard). A
tenant with no assigned plan has no cap (fail-soft).

## Project layout

```
artifacts/api-server/sovereign/
  lib/            # pure, dependency-free domain libraries (ledger, policy, escrow, ...)
  src/            # composition (buildSovereignStack), HTTP adapters, routes
  tests/          # unit + integration + contract tests — `node <file>.test.ts`
  scripts/        # ecos-audit.mjs (truth engine), verify-passport.mjs (offline verifier)
  examples/       # quickstart.mjs, full-economy-demo.mjs, third-party-verify.mjs
```

## Further reading

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system design, data flow, module map.
- **[SECURITY.md](./SECURITY.md)** — threat model, key management, fail-closed guarantees.
- **[STATUS.md](./STATUS.md)** — one-page status: what's built, what's verified, what's next.
- **[TESTING.md](./TESTING.md)** — how the zero-dependency test kit works.
- **[MANIFEST.md](./MANIFEST.md)** — canonical source of truth for agents; build history.
- **[TFA_breakthrough_research.md](./TFA_breakthrough_research.md)** — the Trust Price
  Discovery thesis.

## Testing

```bash
node scripts/ecos-audit.mjs --full
```

This is the **truth engine**: it discovers and runs every `*.test.ts` file with
Node's built-in TypeScript stripping (no build step, no test framework), and
reports `pass / cannotRun / realFail`. A green "pass" count only counts tests that
actually executed and returned `Passed: N / Failed: 0`.
