# TFA — Status (one-pager)

**As of v434.** Full audit: **473 pass / 0 cannotRun / 0 realFail**.
v434: LAW 7 (economic-fairness invariant) added to the system-invariants suite. TFA's cross-vendor cost-arbitrage revenue model is only legitimate if the caller always pays ≤ the next-best market price — which holds iff the routing fee is capped by the spread (gap to the runner-up). v434 locks this against the real `cost-arbitrage.ts`: fee ≤ spread across every fraction, `winnerCost + fee ≤ runnerUpCost`, fail-closed on invalid fractions, and a lone vendor has zero spread so a max fee of zero (can't overcharge). No runtime change — the cap already existed in `routingFeeFromSpread`; v434 makes it a permanent law. 10→14 invariant tests. baseline 473→473.
v433: eliminated double policy-evaluation in `runPolicySimulation()` — `guardDecision` is now derived in the same pass as the per-policy visibility loop instead of a second `GuardEvaluator` pass that re-ran every `policy.evaluate()`. 3 new tests.
v432: eval/golden-tasks.ts efficiency — `runAllGoldenTasks()` replaced M=6 separate `.reduce()` passes (O(tasks × names)) with a single loop accumulating overallSum and all scorecardSums in one pass (O(tasks)); added empty-tasks guard. 3 new tests.
v431: Single-pass status+stale accumulation in `checkWitnessLiveness` — merged a `.filter().map()` re-scan into the original status-building loop; same membership/ordering, one pass instead of three. 3 new regression tests.
v430: Single-pass allow/deny partition in `compareScenarios` — replaced two `filter+map` calls (4 traversals) with one partitioning loop; also a denied-scenario `filter+map` replaced with a direct push loop. 3 new regression tests.
v429: Single-pass `replay()` in `pg-execution-store.ts` — merged `.map(rowToLogEntry)` + indexed for-loop into one loop, eliminating an intermediate array per replay call. 3 new regression tests.
v425–v428: O(1) Set-based state-machine transition lookup (`VALID_TRANSITION_SET`, 3 tests) · Count-proof HTTP route §2.B-1 (10 integration tests).

## What's built and verified

| Capability | Status | Where |
|---|---|---|
| Ed25519 Action Passports + offline verifier | ✅ | `lib/passport`, `scripts/verify-passport.mjs` |
| KeyRing (kid, rotation-proof, revocation-closed) | ✅ | `lib/passport/key-ring.ts`, `lib/adapter/agent-adapter.ts` |
| Sovereign ledger (BigInt μ¢, double-entry, fuzz) | ✅ | `lib/ledger` |
| Solvency monitor | ✅ | `GET /api/monitor/{status,run}` |
| Escrow (fund/release/refund/dispute) | ✅ | `lib/escrow` |
| Marketplace (post/claim/route) | ✅ | `lib/marketplace` |
| Potential Engine | ✅ | `lib/potential` |
| Agent identity + delegation | ✅ | `lib/agent-identity` |
| Cross-tenant introduction (request/inbox/accept) | ✅ | `lib/introduction` |
| Trust-score track record + Pg cache | ✅ | `lib/track-record` |
| Trust-tier policy (`minTrustScore`) | ✅ | `lib/policy/policy-compiler.ts` |
| Fee engine (basis-points, on-success) | ✅ | escrow release path |
| Tenant onboarding API | ✅ | `src/routes/sovereign-routes.ts` |
| Per-tenant API keys (scrypt/JWT) | ✅ | `lib/api-key`, `lib/auth` |
| Tenant dashboard (zero-dep HTML) | ✅ | `src/http` |
| Rate limiting + request-id + structured logging | ✅ | `src/http/express-adapter.ts` |
| Idempotency-Key replay protection | ✅ | `src/http/idempotency.ts` |

| PassportClaim + revocation | ✅ | `lib/passport/claim.ts` |
| PgExecutionStore | ✅ | `lib/orchestrator/pg-execution-store.ts` |
| ExecutionWorkflow (routes, scheduler, supervisor) | ✅ | `src/routes/execution-routes.ts` |
| HMAC-signed webhooks + delivery log | ✅ | `lib/escrow/webhook.ts` |
| OpenAPI 3.1 spec + Swagger UI | ✅ | `lib/api-spec/openapi.yaml`, `src/docs/swagger-ui.ts` |
| Containerization (Dockerfile + docker-compose) | ✅ | `Dockerfile`, `docker-compose.yml`, `tests/containerization` |
| Load smoke test (1,000 concurrent ops + p95 report) | ✅ | `tests/http/load-smoke.test.ts` |
| Threshold approval (Safe-style HMAC token) | ✅ | `lib/escrow/threshold-approval.ts` |
| PgSettlementStore | ✅ | `lib/escrow/pg-settlement-store.ts` |
| MANIFEST drift check (auto-detect desync before implementing) | ✅ | `scripts/manifest-drift-check.mjs`, `tests/scripts/manifest-drift-check.test.ts` |
| Settlement routes + all flows | ✅ | `src/routes/settlement-routes.ts` |
| SDK packages (`escrow-client`, `passport-client`, `cli`) publishable | ✅ | `sdk/` |
| CI workflow governance (`.github/workflows/ci.yml`) | ✅ | `tests/sdk-cli/ci-workflow.test.ts` |
| GitHub Action PR comment posting (`post-comment` + demo workflow) | ✅ | `sdk/github-action/action.yml`, `examples/github-action-pr-demo.yml` |
| Tenant export bundle (signed) | ✅ | `src/sovereignty/` |
| Adapter server-side risk classification | ✅ | `lib/adapter/agent-adapter.ts` |
| Receipt verification endpoint (signature + decision integrity) | ✅ | `src/routes/receipt-verify-routes.ts` |
| MCP server (18 tools, JSON-RPC 2.0) | ✅ | `lib/mcp-server/mcp-server.ts` |
| Policy simulation harness (what-if, zero side-effects) | ✅ | `lib/risk/policy-simulator.ts` |
| MCP receipt verification (signature + decision integrity) | ✅ | `lib/mcp-server/mcp-server.ts` |
| MCP capability tokens + NonceRegistry | ✅ | `lib/mcp-server/capability-token.ts` |
| rotate-key RBAC | ✅ | `src/routes/sovereignty-routes.ts` |
| TransparencyLog (Merkle-anchored) | ✅ | `lib/transparency-log/` |

| `TFA_SIGNER_KIND` env opt-in | ✅ | `src/composition.ts` |
| HybridSigner + MlDsaStubSigner (PQC) | ✅ | `lib/orchestrator/signer.ts` |
| MlDsaDeterministicProvider (PQC sim) | ✅ | `lib/orchestrator/signer.ts` |
| MlDsaOqsProvider + adaptPqcProvider | ✅ | `lib/orchestrator/pqc-adapter.ts` |
| `mcpServerFromStack` factory | ✅ | `src/composition.ts` |
| MCP settlement tools | ✅ | `lib/mcp-server/mcp-server.ts` |
| `TfaMcpServer` fail-closed constructor | ✅ | `lib/mcp-server/mcp-server.ts` |
| ConfidenceGate HTTP routes | ✅ | `src/routes/confidence-routes.ts` |
| PgKnowledgeGraphSource wired to root | ✅ | `lib/potential/pg-kg-source.ts` |
| KillSwitch adapter + admin endpoints | ✅ | `lib/adapter/agent-adapter.ts`, `src/routes/kill-switch-routes.ts` |
| Idempotency on all state-changing methods | ✅ | `src/http/idempotency.ts` |
| Unified ReplayProtection | ✅ | `src/http/replay-protection.ts` |

| `TFA_PERSIST=pg` server composition (pool passed to buildSovereignStack, fail-closed without pool) | ✅ | `src/http/sovereign-server.ts`, `tests/release/persist-flag-server-composition.test.ts` |
| Migration bundle (all pg-store tables, idempotent, ordered, with report) | ✅ | `scripts/migrate.mjs`, `tests/migrate/migrate.test.ts` |
| SSO bearer-token auth (verify) + IdP-integration adapter (mint) | ✅ | `lib/auth/jwt.ts`, `lib/auth/idp-exchange.ts`, `docs/IDP_INTEGRATION.md` |
| readyz PQC-provider visibility (`checks.pqc`, sim-flagged, never fails readiness) | ✅ | `src/http/health-routes.ts`, `tests/http/health-shutdown.test.ts` |
| Visual-regression CLI (check / `--update` / `--dir`, ops-facing) | ✅ | `scripts/visual-regression-check.ts`, `tests/scripts/visual-regression-check.test.ts` |

## What's not yet verified

- `pnpm typecheck` — cannot run in sandbox (no pnpm).
- Live Express server under load — not in offline suite.

## What's next

See `MANIFEST.md` → "החסר הבא". Run `node scripts/manifest-drift-check.mjs` first to detect desync before starting.

## How to verify

```bash
node scripts/ecos-audit.mjs --full      # full suite: pass / cannotRun / realFail
node examples/quickstart.mjs              # happy path, <60s
node examples/full-economy-demo.mjs       # escrow + marketplace + fees + dispute
```

No install, no network, no DB required.
