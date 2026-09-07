# Next Session Prompt — ECOS V267 → V268

**Use this file as the opening prompt for the next AI session.**

---

## Context

You are continuing work on the ECOS canonical release series. The previous session delivered **V267 Canonical** — a complete, tested, packaged release.

**Working archive:** `ecos_v267_canonical.zip`  
**Test result:** 83/83 passing (`node tests/v267.test.cjs`)  
**Package version:** 267.0.0

---

## What Was Built in V267

V267 applied three horizontal capabilities across all 8 core modules:

1. **Enhanced Provider Validation** — every module validates injected providers at construction time
2. **Performance Telemetry** — `getPerf267()` returns p50/p95/p99 latency percentiles on every module
3. **Security Hardening** — rate-limiting (wallets: 100ms/userId, MCP: 50ms/toolId), userId sanitization

**New in V267:**
- `src/lib/providerAdapters267.js` — 14 provider contracts, 14 conformant stubs, runtime validators
- `ecos-api-server-v267-patch.js` — 50+ V267 endpoints (health, perf, providers/validate)
- `tests/v267.test.cjs` — 83 tests covering regression + all new features

---

## V268 Recommended Scope

V268 should continue the additive upgrade pattern. Suggested themes:

### Theme 1: Observability Platform (P12)
- Add structured logging adapter DI to all modules (`logAdapter` with `info/warn/error` interface)
- Add `getAuditLog267()` → paginated audit event export
- Add `/api/v268/observability/events` — queryable structured event stream
- Add OpenTelemetry-compatible span export stub

### Theme 2: Offline-Tolerant Queue (P17)
- Enhance `ussdSmsStateMachine267` with persistent offline queue
- Add `offlineQueueProvider` DI: `enqueue(job)`, `dequeue()`, `getQueueDepth()`
- Replay queued messages when connectivity restored
- Add `GET /api/v268/queue/depth` and `POST /api/v268/queue/flush`

### Theme 3: Cost-Aware SLM Cascade (P23)
- Enhance `executionPrograms267` with `slmCascadeProvider` DI
- `slmCascadeProvider.selectModel(taskBudget, taskComplexity)` → `{ modelId, estimatedCost }`
- Add budget-gated model selection logic in mission dispatch
- Add `GET /api/v268/programs/:programId/cost-estimate`

### Theme 4: Agent Reflection Framework (P05)
- Add `reflectionProvider` DI to `mcpDeepIntegration267`
- `reflectionProvider.reflect(toolId, input, output, latencyMs)` — post-call reflection hook
- Add `getReflectionLog267()` — recent reflections
- Enable HITL escalation based on reflection score threshold

### Theme 5: Quadratic Funding (P20)
- Enhance `splitModule267` with quadratic allocation support
- `splitModule.createQuadraticRound(roundId, recipients, opts)` → matching pool calculation
- `splitModule.distributeQuadratic(roundId, contributions)` → applies QF formula
- Add `vestingProvider.createVestingSchedule267` call for quadratic recipients

---

## V268 Implementation Instructions

```
You are building ECOS V268 Canonical — an additive upgrade over V267.

Rules:
1. All new identifiers end with 268 (classes, methods, constants, exports)
2. Zero new npm dependencies — Node.js built-ins only
3. All V267 tests must continue to pass after V268 changes
4. Every new DI provider must be:
   a. Validated at constructor time (throw with descriptive message on invalid)
   b. Added to PROVIDER_CONTRACTS_268 in providerAdapters268.js
   c. Given a conformant stub in providerAdapters268.js
5. Every new module feature must be covered by tests/v268.test.cjs
6. Mirror src/lib/*268.js → lib/*268.js when complete
7. Package as ecos_v268_canonical.zip

Start by:
1. Copying ecos_v267_canonical/ → ecos_v268_canonical/
2. Running sed -i 's/267/268/g' on all src/lib/*267.js files
3. Verifying node tests/v267.test.cjs still passes (rename to v268 after sed)
4. Then implementing the chosen V268 theme
```

---

## File Locations (V267)

```
tasks/
  ecos_v267_canonical/        ← working directory
    src/lib/                  ← 24 lib modules (23 core + providerAdapters267)
    lib/                      ← mirrored from src/lib/
    tests/v267.test.cjs       ← 83 tests, 0 failures
    ecos-api-server-v267-patch.js
    package.json              ← version: 267.0.0
    AI_PROTOCOL_V267.md
    CHANGELOG_V267.md
    NEXT_SESSION_PROMPT_V267.md
    V267_IMPLEMENTATION_REPORT.md
  ecos_v267_canonical.zip     ← deliverable archive
```

---

## Provider Interface Quick Reference (V267)

| Provider | Required Methods | Module |
|----------|-----------------|--------|
| settlementProvider | `settleX402(from, to, amountMicro, resource, facilitator)` | x402267 |
| custodyProvider | `createWallet()`, `linkExternal()` | embeddedWallet267 |
| mcpServerRegistry | `get()`, `set()` | mcpDeepIntegration267 |
| toolExecutor | `async function(toolId, input, opts)` | mcpDeepIntegration267 |
| persistenceAdapter | `loadBloomState()`, `saveBloomState()` | auditBloom267 |
| smsGateway | `send(userId, message)` | ussdSmsStateMachine267 |
| ussdGateway | `send(userId, message)` | ussdSmsStateMachine267 |
| sessionStore | `get()`, `set()` | ussdSmsStateMachine267 |
| antiDumpProvider | `evaluateDumpRisk()` | splitModule267 |
| vestingProvider | `validateVesting()` | splitModule267 |
| authProvider | `verifyUser(userId, meta)` | onboardingFlow267 |
| cryptoWordsFilter | `check(text)` | onboardingFlow267 |
| schedulerProvider | `schedule()`, `cancel()` | executionPrograms267 |
| budgetProvider | `checkBudget()`, `debitBudget()` | executionPrograms267 |

---

## Key Invariants to Maintain

1. **No crypto jargon in user-facing text** — onboarding enforces this via built-in list or injected filter
2. **BigInt amounts throughout** — all micro-credit amounts are `BigInt`
3. **Audit trail on every state change** — `_log267()` / `auditLog.append()` on all mutations
4. **Stub-mode always works** — every module runs correctly with no providers injected
5. **Zero breaking changes** — V267 code still instantiates with V266 options objects

---

*Generated by ECOS V267 session — 2026-06-01*
