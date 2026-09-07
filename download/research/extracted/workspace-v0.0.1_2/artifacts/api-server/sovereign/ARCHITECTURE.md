# TFA — Architecture

## Layering

```
┌─────────────────────────────────────────────────────────────────┐
│  src/http/   — express-adapter.ts (prod) | sovereign-server.ts    │
│               (zero-dep node:http, dev/test) | request-id, rate-  │
│               limiting, structured logging                        │
├─────────────────────────────────────────────────────────────────┤
│  src/routes/sovereign-routes.ts — one route table, both adapters  │
├─────────────────────────────────────────────────────────────────┤
│  src/composition.ts — buildSovereignStack(): wires every lib/*    │
│   into a single per-process SovereignStack object (or per-tenant  │
│   where isolation requires it)                                    │
├─────────────────────────────────────────────────────────────────┤
│  lib/orchestrator   — TfaOrchestrator: policy → execute → audit   │
│  lib/policy         — DeclarativePolicy compiler (policy-as-data) │
│  lib/ledger         — InMemoryLedger / DrizzlePaymentProvider      │
│  lib/ledger-orchestrator — ledger action types + dispatch          │
│  lib/escrow         — fund/release/refund/dispute state machine    │
│  lib/marketplace    — opportunities, claim, routing                │
│  lib/potential      — strength mapping, success-path, collab.      │
│  lib/passport       — Ed25519-signed Action Passports              │
│  lib/agent-identity — identity + delegation chains                 │
│  lib/track-record   — trust-score computation (+ Pg cache)         │
│  lib/transparency   — chain/balances/passport read-views            │
│  lib/api-key        — per-tenant API key issuance/verification     │
│  lib/auth           — JWT (HMAC), password (scrypt), TOTP — node:crypto only │
│  lib/jobs, lib/events, lib/db — background work, outbox, Drizzle    │
└─────────────────────────────────────────────────────────────────┘
```

Every `lib/*` module is independently testable, dependency-free (or behind an
interface for its one optional dependency, e.g. Drizzle/Postgres), and exports a
single barrel `index.ts`.

## The kernel: Orchestrator → Policy → Audit

Every state-changing action in TFA — minting money, releasing an escrow, routing
a user to an opportunity — goes through `TfaOrchestrator.execute()`:

```
execute(action, context)
  1. POLICY  — compiled DeclarativePolicy rules evaluate the action.
               Unknown action type → deny (fail-closed).
               minTrustScore conditions consult the TrackRecord provider.
  2. GUARD   — if allowed, the action's domain guard runs (e.g. ledger
               guardMint checks balances, escrow guard checks state).
  3. EXECUTE — the underlying operation runs (ledger write, escrow
               transition, ...).
  4. AUDIT   — an AuditRecord is appended to a per-tenant hash-linked
               chain, whether the action was allowed, denied, or errored.
  5. PASSPORT (optional) — if a Signer is configured, an Ed25519-signed
               Action Passport is issued referencing the audit record.
```

`AuditRecord`s are hash-linked (`prevHash` → `hash`), so any tampering with
history breaks the chain — detectable by `GET /api/transparency/chain` or
`scripts/verify-passport.mjs` offline.

## Policy-as-data

Policies are plain JSON/TS objects (`DeclarativePolicy[]`), not code:

```ts
{ name: "tx-spending-cap",
  rules: [{ if: { actionType: ["ledger.mint","ledger.transfer"], amountAbove: "100000000" },
            then: "deny", reason: "exceeds spending cap" }],
  default: "allow" }
```

`defaultPolicies()` composes a global allowlist (`ledger-allowlist`, fail-closed
on unknown action types), a spending cap, and — per tenant — a plan-based
action-rate limit (`tenant-plan-limit`, `PLAN_LIMITS.free/pro`). Adding a new
policy means adding data, not shipping code.

## The ledger (sovereign money)

- All amounts are `bigint` μ¢ (micro-cents). Never `number`.
- Double-entry: every operation writes two `JournalEntry` rows summing to zero.
- `guardMint` / `guardWithdraw` are the **only** ways credits are created or
  destroyed — both are orchestrator-gated actions (`ledger.mint`,
  `ledger.withdraw`), so they're policy-checked and audited like everything else.
- `proofOfSolvency` recomputes the global balance and is exposed at
  `GET /api/ledger/solvency` and via the periodic monitor
  (`GET /api/monitor/status`, `POST /api/monitor/run`).
- Two implementations behind `PaymentProvider`: `InMemoryLedger` (tests/dev) and
  `DrizzlePaymentProvider` (Postgres, same guarantees, same interface).

## Escrow & Marketplace

`lib/escrow` is a small state machine: `created → funded → released | refunded`,
with a `disputed` side-state any party can enter (freezes movement; only the
funder can resolve). `lib/marketplace` lets tenants post `Opportunity` records,
lets the Potential Engine `route()` users to the best-fit ones, and lets agents
`claim` and fulfill them via escrow — closing the loop from "what should I work
on" to "I got paid for it, provably."

## Potential Engine

`lib/potential` maps `KnowledgeSignal`/`AnalyticsSignal` inputs to a
`StrengthProfile` (per category, 0–100), then:
- `route()` — ranks `Opportunity` records by fit (matched vs. missing strengths).
- `success-path` — given a target opportunity, returns the gap-closing steps.
- `collaboration` — pairs complementary strength-profiles for shared work,
  tracked through an escrow to completion.

## Identity, Delegation & Track Record

`lib/agent-identity` gives every human or agent a stable identity and supports
delegation chains (agent acting *on behalf of* a principal — checked by policy
conditions like `requireValidDelegation`). `lib/track-record` aggregates an
identity's audit history (allowed/denied ratio, escrow outcomes, disputes) into
a trust score — the input to `minTrustScore` policy conditions and the core of
**Trust Price Discovery**: a new identity starts with no special privilege; an
identity with a long clean record can be granted higher-trust actions by policy,
without any code change.

## Multi-tenancy

Every store (`InMemoryAuditStore`, `InMemoryLedger`, escrow/marketplace/track-
record stores, `TenantPlanRegistry`, `InMemoryApiKeyStore`) is keyed by
`tenantId`. The HTTP layer extracts `tenantId` from the API key (or
`x-tenant-id` header in dev) before any handler runs; every domain method takes
`tenantId` as its first argument and throws `TENANT_VIOLATION` on mismatch.
`buildSovereignStack()` returns one process-wide stack; tenant isolation is
enforced *inside* that stack, not by spinning up separate processes.

## HTTP layer

`src/routes/sovereign-routes.ts` defines one `Route[]` table consumed by two
adapters:

- **`sovereign-server.ts`** — raw `node:http`, in-memory stores, used by every
  integration test and `examples/*.mjs`. Zero dependencies, boots in
  milliseconds.
- **`express-adapter.ts`** — production adapter: Express 5, adds
  `x-request-id` propagation (`src/http/request-id.ts`), an in-house
  token-bucket rate limiter (`TokenBucketRateLimiter`), structured JSON
  logging, and wires Drizzle-backed stores when `DATABASE_URL` is set.

Both adapters produce identical `AuditRecord`s and `Passport`s — the kernel
guarantees don't change based on deployment shape.

## Background work

`lib/jobs` (outbox-pattern job queue) and `lib/events` handle anything that
shouldn't block a request — e.g. periodic solvency sweeps
(`GET /api/monitor/status` reflects `lib/jobs`-driven cron state), notification
delivery, and fee settlement on escrow release.

## Testing & verification

There is no build step and no test framework. `node <file>.test.ts` runs a file
directly (Node 22+ strips TS types natively); `tests/_harness.mjs` provides
`test`/`eq`/`assert`. `scripts/ecos-audit.mjs --full` discovers every
`*.test.ts`, runs it, and reports `pass / cannotRun / realFail` — this is the
single source of truth for "is the system working," referenced by every
MANIFEST.md update.
