# CHANGELOG — V267 Canonical

## [267.0.0] — 2026-06-01

### Release Type: Additive Upgrade (backward-compatible with V266)

---

### NEW — providerAdapters267.js (new module)

- **14 provider interface contracts** defined in `PROVIDER_CONTRACTS_267`
- **`validateProvider267(type, impl)`** — validate a single provider against its contract
- **`validateAllProviders267(opts)`** — validate all providers in an options object simultaneously
- **`createAdapterScaffold267(type, opts)`** — factory returning a conformant stub for any provider type
- **`createAllStubs267(overrides)`** — create all 14 stubs at once (for test/dev environments)
- **Named stub factories** for direct use:
  - `createSettlementProviderStub267()` — x402 settlement stub with `settleX402()`
  - `createCustodyProviderStub267()` — in-memory wallet custody stub
  - `createPersistenceAdapterStub267()` — in-memory Bloom state persistence stub
  - `createGatewayStub267(type)` — SMS/USSD gateway stub with call history
  - `createSessionStoreStub267()` — Map-based session store stub
  - `createAntiDumpProviderStub267()` — anti-dump risk evaluator stub
  - `createVestingProviderStub267()` — vesting validation stub (enforces 365-day minimum)
  - `createAuthProviderStub267()` — user auth verification stub
  - `createCryptoWordsFilterStub267(blocklist)` — configurable crypto-term filter stub
  - `createSchedulerProviderStub267()` — task scheduler stub with in-memory queue
  - `createBudgetProviderStub267()` — budget management stub with cap/debit/credit cycle

---

### NEW — ecos-api-server-v267-patch.js (new file)

- `registerEcosV267Routes(app, deps)` — registers all V267 API routes on an Express-like app
- `createV267State(deps)` — constructs full V267 module state with all DI providers wired
- **New V267-only endpoints:**
  - `GET /api/v267/health` — aggregate health check across all modules with provider health
  - `GET /api/v267/perf` — aggregate p50/p95/p99 latency telemetry for all modules
  - `POST /api/v267/providers/validate` — runtime provider contract validation
  - `GET /api/v267/x402/health` — x402 settlement health
  - `GET /api/v267/mcp/health` — MCP tool-executor health
  - `GET /api/v267/wallets/health` — custody provider health
  - `GET /api/v267/ussd/health` — gateway health (sms + ussd)
  - `GET /api/v267/audit-bloom/health` — persistence adapter health
  - `GET /api/v267/splits/health` — anti-dump/vesting provider health
  - `GET /api/v267/onboarding/health` — auth/filter provider health
  - `GET /api/v267/programs/:programId/missions` — add mission with scheduler integration
  - `POST /api/v267/programs/:programId/block` — block program and cancel scheduled missions
  - `GET /api/v267/wallets/:userId/mobile` — mobile wallet compact view
  - `POST /api/v267/wallets/:userId/link` — link external wallet
  - `POST /api/v267/ussd/:userId/resume` / `cancel` — session lifecycle control
  - `GET /api/v267/onboarding/:userId/skip/:stepId` — skip step (if supported)

---

### CHANGED — x402267.js (enhanced from x402266.js)

- **NEW:** Constructor validates `settlementProvider` interface at instantiation time
  - Required: `settleX402(from, to, amountMicro, resource, facilitator)`
  - Throws `Error('x402267: settlementProvider must implement settleX402(payload, receipt)')` on invalid
- **NEW:** `_perf267` ring buffer (max 1000 samples) tracking `processPayment267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }` latency percentiles
- **NEW:** `checkSettlementHealth267()` — reports provider type (`stub` or `external`) and conformance
- **NEW:** `_calcPercentiles267(arr)` — shared helper for percentile computation

---

### CHANGED — embeddedWallet267.js (enhanced from embeddedWallet266.js)

- **NEW:** Constructor validates `custodyProvider` interface:
  - Required: `createWallet(userId, provider, identity, opts)`, `linkExternal(userId, externalAddress, opts)`
  - Provider return must include `walletAddress` field
- **NEW:** `userId` input sanitization — rejects strings longer than 256 characters
- **NEW:** Create rate-limit guard: 100ms minimum between wallet creations per userId
  - Configurable: bypass with `opts.forceNew = true`
  - Stored in `this._lastCreate267` Map
- **NEW:** `_perf267` ring buffer tracking wallet create latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkCustodyHealth267()` — reports custody provider conformance
- **NEW:** `_recordLatency267(t0)` — shared latency recording helper

---

### CHANGED — mcpDeepIntegration267.js (enhanced from mcpDeepIntegration266.js)

- **NEW:** Constructor validates `mcpServerRegistry` — must implement `get()` and `set()` (Map-like)
- **NEW:** Constructor validates `toolExecutor` — must be a function, not an object
- **NEW:** Per-tool call rate-limit: 50ms default, configurable per call via `opts.rateMs`
  - Blocked calls return `{ ok: false, code: 'RATE_LIMITED', toolId }`
  - State stored in `this._lastCall267` Map
- **NEW:** `_perf267` ring buffer tracking `callTool267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkToolExecutorHealth267()` — reports executor type and conformance

---

### CHANGED — auditBloom267.js (enhanced from auditBloom266.js)

- **NEW:** Constructor validates `persistenceAdapter` interface:
  - Required: `loadBloomState()`, `saveBloomState(state)`
- **NEW:** `_perf267` ring buffer tracking `addEvent267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkPersistenceHealth267()` — reports adapter type (`in-memory` or `external`)

---

### CHANGED — ussdSmsStateMachine267.js (enhanced from ussdSmsStateMachine266.js)

- **NEW:** Constructor validates three providers:
  - `smsGateway` — must implement `send(userId, message)`
  - `ussdGateway` — must implement `send(userId, message)`
  - `sessionStore` — must implement `get(key)` and `set(key, value)` (Map-like)
- **NEW:** `_t0` timing added in `handleInput267` entry point
- **NEW:** `_perf267` ring buffer tracking `handleInput267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkGatewayHealth267()` — reports all three provider states

---

### CHANGED — splitModule267.js (enhanced from splitModule266.js)

- **NEW:** Constructor validates `antiDumpProvider` — must implement `evaluateDumpRisk()`
- **NEW:** Constructor validates `vestingProvider` — must implement `validateVesting()`
- **NEW:** `_t0` timing added in `distribute267` entry point
- **NEW:** `_perf267` ring buffer tracking `distribute267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkProviderHealth267()` — reports antiDump and vesting provider health
- **NEW:** `_recordLatency267(t0)` — shared latency recording helper

---

### CHANGED — onboardingFlow267.js (enhanced from onboardingFlow266.js)

- **NEW:** `authProvider` DI injection with constructor-time validation
  - Required: `verifyUser(userId, meta)` — async, throws on auth failure
  - Called during `completeStep267` on `identity` step only
- **NEW:** `cryptoWordsFilter` DI injection with constructor-time validation
  - Required: `check(text)` — receives **original-case** JSON string (not pre-lowercased)
  - Returns `{ blocked: boolean, word?: string }`
  - Falls back to built-in `CRYPTO_WORDS_267` list when no filter injected
- **CHANGED:** `completeStep267` — passes `inputRaw` (original case) to external filter, `inputText` (lowercased) to built-in list
- **NEW:** `_calcPercentiles267(arr)` — added as module-level helper
- **NEW:** `_perf267` ring buffer tracking `completeStep267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkProviderHealth267()` — reports authProvider, embeddedWallet, cryptoWordsFilter health
- **NEW:** `_recordLatency267(t0)` — shared latency recording helper

---

### CHANGED — executionPrograms267.js (enhanced from executionPrograms266.js)

- **NEW:** `schedulerProvider` DI injection with constructor-time validation
  - Required: `schedule(missionId, task, opts)`, `cancel(missionId)`
  - Called in `addMission267()` and `blockProgram267()` (cancel all on block)
- **NEW:** `budgetProvider` DI injection with constructor-time validation
  - Required: `checkBudget(programId, amountMicro)`, `debitBudget(programId, amountMicro, meta)`
  - Called in `startProgram267()` (check) and `completeProgram267()` (debit if spent > 0)
- **NEW:** `_calcPercentiles267(arr)` — added as module-level helper
- **NEW:** `_perf267` ring buffer tracking `startProgram267` and `addMission267` latency
- **NEW:** `getPerf267()` — returns `{ p50, p95, p99, count }`
- **NEW:** `checkProviderHealth267()` — reports scheduler, budget, costRouter provider health
- **NEW:** `_recordLatency267(t0)` — shared latency recording helper

---

### TEST SUITE — tests/v267.test.cjs (new file)

- **83 tests, 0 failures** (as of 2026-06-01)
- **Section A:** V266 regression (11 tests re-run against all V267 modules)
- **Section B1:** providerAdapters267 — 18 tests covering contracts, validators, all 14 stubs
- **Section B2:** x402267 new features — 5 tests
- **Section B3:** embeddedWallet267 new features — 8 tests
- **Section B4:** mcpDeepIntegration267 new features — 6 tests
- **Section B5:** auditBloom267 new features — 5 tests
- **Section B6:** ussdSmsStateMachine267 new features — 5 tests
- **Section B7:** splitModule267 new features — 5 tests
- **Section B8:** onboardingFlow267 new features — 7 tests
- **Section B9:** executionPrograms267 new features — 10 tests
- **Section B10:** API patch and full-stack DI wiring — 3 tests

---

### Dependency changes

None. Zero new npm packages. All additions use Node.js built-ins only.

---

### Files changed

| File | Status |
|------|--------|
| `src/lib/providerAdapters267.js` | **NEW** |
| `ecos-api-server-v267-patch.js` | **NEW** |
| `tests/v267.test.cjs` | **NEW** |
| `AI_PROTOCOL_V267.md` | **NEW** |
| `CHANGELOG_V267.md` | **NEW** |
| `NEXT_SESSION_PROMPT_V267.md` | **NEW** |
| `V267_IMPLEMENTATION_REPORT.md` | **NEW** |
| `src/lib/x402267.js` | Enhanced |
| `src/lib/embeddedWallet267.js` | Enhanced |
| `src/lib/mcpDeepIntegration267.js` | Enhanced |
| `src/lib/auditBloom267.js` | Enhanced |
| `src/lib/ussdSmsStateMachine267.js` | Enhanced |
| `src/lib/splitModule267.js` | Enhanced |
| `src/lib/onboardingFlow267.js` | Enhanced |
| `src/lib/executionPrograms267.js` | Enhanced |
| `lib/*267.js` (15 files) | Mirrored from src/lib/ |
| `package.json` | version: 267.0.0 |

All other V267 modules (15 remaining libs) received the standard 266→267 global identifier substitution from V266 baseline.
