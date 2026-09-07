# AI Protocol V267 — Provider Validation, Performance Telemetry & Security Hardening

**Release:** V267 Canonical  
**Date:** 2026-06-01  
**Status:** Production-ready  
**Predecessor:** V266 Canonical

---

## Overview

V267 is an **additive upgrade** to the ECOS canonical stack. Every change is backward-compatible with V266; existing code continues to work unchanged. V267 introduces three horizontal capabilities applied uniformly across all eight core modules:

1. **Enhanced Provider Validation** — Constructor-time interface checks for every injected dependency
2. **Performance Telemetry** — p50/p95/p99 latency percentiles via `getPerf267()` on all modules
3. **Security Hardening** — Rate-limiting, userId sanitization, input validation guards

A new dedicated module, `providerAdapters267.js`, ships 14 provider contracts, conformant stubs, and runtime validators.

---

## Module Inventory

| Module | Program | V267 Additions |
|--------|---------|----------------|
| `x402267.js` | P13 x402 Payment Rails | settlementProvider validation, perf, `checkSettlementHealth267()` |
| `embeddedWallet267.js` | P16 Embedded Wallet Layer | custodyProvider validation, 100ms rate-limit, userId sanitization, perf, `checkCustodyHealth267()` |
| `mcpDeepIntegration267.js` | P15 MCP Deep Integration | mcpServerRegistry/toolExecutor validation, 50ms per-tool rate-limit, perf, `checkToolExecutorHealth267()` |
| `auditBloom267.js` | P07 Audit Chain Expansion | persistenceAdapter validation, perf, `checkPersistenceHealth267()` |
| `ussdSmsStateMachine267.js` | P18 USSD/SMS Degraded Path | smsGateway/ussdGateway/sessionStore validation, perf, `checkGatewayHealth267()` |
| `splitModule267.js` | P21 Vesting & Anti-Dump Controls | antiDumpProvider/vestingProvider validation, perf, `checkProviderHealth267()` |
| `onboardingFlow267.js` | P11 Mobile-First UX | authProvider DI + verifyUser integration, cryptoWordsFilter DI, perf, `checkProviderHealth267()` |
| `executionPrograms267.js` | P24 Onboarding Funnel / P-all | schedulerProvider DI, budgetProvider DI, perf, `checkProviderHealth267()` |
| `providerAdapters267.js` | Cross-cutting | 14 contracts, 14 stubs, `validateAllProviders267()`, `createAdapterScaffold267()`, `createAllStubs267()` |

API surface additions: `ecos-api-server-v267-patch.js` — 50+ V267 endpoints including `/api/v267/perf`, `/api/v267/health`, `/api/v267/providers/validate`.

---

## Provider Interface Contracts

All contracts are defined in `providerAdapters267.js` under `PROVIDER_CONTRACTS_267`.

### settlementProvider (x402267)
```js
{
  settleX402(from, to, amountMicro, resource, facilitator): Promise<{ok, txId}>
}
```

### custodyProvider (embeddedWallet267)
```js
{
  createWallet(userId, provider, identity, opts): { walletId, walletAddress, ... }
  linkExternal(userId, externalAddress, opts): { walletId, walletAddress, ... }
}
```

### mcpServerRegistry (mcpDeepIntegration267)
```js
// Map-like: must implement get(key) and set(key, value)
```

### toolExecutor (mcpDeepIntegration267)
```js
async function toolExecutor(toolId, input, opts): Promise<output>
```

### persistenceAdapter (auditBloom267)
```js
{
  loadBloomState(): { bitsetBase64, exactKeys, events }
  saveBloomState(state): void
}
```

### smsGateway / ussdGateway (ussdSmsStateMachine267)
```js
{ send(userId, message): { ok } }
```

### sessionStore (ussdSmsStateMachine267)
```js
// Map-like: must implement get(key) and set(key, value)
```

### antiDumpProvider (splitModule267)
```js
{ evaluateDumpRisk(splitId, amountMicro, policy, totalDistributed, meta): { blocked, reason } }
```

### vestingProvider (splitModule267)
```js
{
  validateVesting(vestingDays, enforceVesting): { ok }
  getVestedAmount(splitId, amountMicro): { vestedAmount }
  getVestingStatus(splitId): { vestedPct }
}
```

### authProvider (onboardingFlow267)
```js
{ verifyUser(userId, meta): Promise<{ ok }> }  // throws on auth failure
```

### cryptoWordsFilter (onboardingFlow267)
```js
{ check(text): { blocked, word? } }  // receives original-case JSON string
```

### schedulerProvider (executionPrograms267)
```js
{
  schedule(missionId, task, opts): { ok }
  cancel(missionId): { ok }
}
```

### budgetProvider (executionPrograms267)
```js
{
  checkBudget(programId, amountMicro): { ok }   // throws if exceeded
  debitBudget(programId, amountMicro, meta): { ok }
}
```

---

## Performance Telemetry API

Every V267 module exposes:

```js
module.getPerf267()
// Returns: { p50: number, p95: number, p99: number, count: number }  (all in ms)
```

The ring buffer holds the last 1,000 latency samples per module. Access aggregate telemetry via:

```
GET /api/v267/perf
```

Response:
```json
{
  "ok": true,
  "version": "267",
  "perf": {
    "x402":       { "p50": 1, "p95": 4, "p99": 12, "count": 37 },
    "wallets":    { "p50": 0, "p95": 1, "p99": 3,  "count": 14 },
    "mcp":        { "p50": 2, "p95": 8, "p99": 15, "count": 22 },
    "ussd":       { "p50": 1, "p95": 3, "p99": 7,  "count": 9  },
    "auditBloom": { "p50": 0, "p95": 1, "p99": 2,  "count": 45 },
    "splits":     { "p50": 0, "p95": 1, "p99": 2,  "count": 8  },
    "onboarding": { "p50": 2, "p95": 6, "p99": 11, "count": 5  },
    "programs":   { "p50": 0, "p95": 1, "p99": 1,  "count": 12 }
  }
}
```

---

## Health Check API

Every V267 module exposes a provider health check method. Access them all via:

```
GET /api/v267/health
```

Each module reports whether its injected providers are conformant. A `type: 'stub'` response means no external provider was injected (safe for development). A `type: 'external'` response means a provider was injected and validated at construction time.

---

## Provider Validation API

Validate a set of provider implementations at runtime against V267 contracts:

```
POST /api/v267/providers/validate
Content-Type: application/json
{ "settlementProvider": { ... }, "custodyProvider": { ... } }
```

Response:
```json
{
  "ok": true,
  "results": { "settlementProvider": { "ok": true, "errors": [], "warnings": [] } },
  "allErrors": [],
  "allWarnings": []
}
```

---

## Security Changes

| Area | Change |
|------|--------|
| embeddedWallet267 | userId length capped at 256 chars; rejects >256 at construction |
| embeddedWallet267 | 100ms create rate-limit per userId (bypass with `opts.forceNew`) |
| mcpDeepIntegration267 | 50ms per-tool rate-limit (configurable via `opts.rateMs`) |
| onboardingFlow267 | authProvider.verifyUser called on `identity` step before completing |
| onboardingFlow267 | External cryptoWordsFilter receives original-case text (not pre-lowercased) |
| All modules | Constructor-time provider validation throws with actionable error messages |

---

## Upgrade Guide (V266 → V267)

V267 is **100% backward compatible**. No breaking changes.

### Option A: Zero changes (stub mode)
All V267 modules default to built-in stubs when no external provider is injected. Existing V266 instantiation code works unchanged.

### Option B: Inject providers
Pass provider implementations to module constructors:

```js
const { X402Processor267 } = require('./src/lib/x402267');
const processor = new X402Processor267({
  settlementProvider: myStripeAdapter,   // V267 new
  logger: myLogger,
});
```

### Option C: Use providerAdapters267 for development stubs
```js
const { createAllStubs267 } = require('./src/lib/providerAdapters267');
const stubs = createAllStubs267({ logger: console.log });
const { createV267State } = require('./ecos-api-server-v267-patch');
const state = createV267State(stubs);
```

---

## Identifier Convention

All V267 identifiers end with `267`:
- Classes: `X402Processor267`, `EmbeddedWallet267`, etc.
- Methods: `processPayment267()`, `createWallet267()`, `getPerf267()`, etc.
- Constants: `X402_VERSION_267`, `WALLET_RISK_267`, `PROGRAMS_267`, etc.
- Exports: `module.exports = { X402Processor267, X402_VERSION_267, ... }`

---

## Zero New Dependencies

V267 introduces zero new npm packages. All additions use Node.js built-ins (`node:crypto`). Provider adapters and stubs are pure JavaScript with no external runtime dependencies.
