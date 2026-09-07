# ECOS V268 Changelog

**Release date:** 2026-06-01  
**Branch:** canonical  
**Baseline:** V267 (83/83 tests passing)

---

## Summary

V268 is a purely **additive** release. No V267 module signatures, exports, or
behaviour are changed. All 83 V267 regression tests continue to pass unchanged.

---

## New: 15 Base-Module Telemetry Contracts

Every base module now exposes two new public methods:

| Method | Returns |
|---|---|
| `getPerf268()` | `{ p50, p95, p99, count }` — latency percentiles (ms) |
| `checkXHealth268()` | `{ ok: boolean, version: '268', ... }` — liveness check |

Modules instrumented (with latency call-sites added to primary methods):

| # | Module | Primary instrumented method |
|---|---|---|
| C1 | `agentReceipts268` | `initReceipt268` |
| C2 | `breakageEngine268` | `recordIssuance268` |
| C3 | `conversionGateway268` | `creditToUsdc268` (async) |
| C4 | `costAwareRouter268` | `route268` (async) |
| C5 | `creditReserve268` | `issue268` |
| C6 | `injectionFirewall268` | `tagUntrusted268` |
| C7 | `memoryIntegrity268` | `signWrite268` |
| C8 | `metacognition268` | `recordOutcome268` |
| C9 | `offlineQueue268` | `enqueue268` |
| C10 | `quadraticFunding268` | `createRound268` |
| C11 | `reflectionLoop268` | `execute268` (async, all exit paths) |
| C12 | `reputationLedger268` | `attest268` |
| C13 | `sybilGuard268` | `evaluate268` |
| C14 | `telemetry268` | `recordRequest268` |
| C15 | `tipModule268` | `tip268` |

All 9 V267-enhanced modules (`x402268`, `splitModule268`, `onboardingFlow268`,
`embeddedWallet268`, `ussdSmsStateMachine268`, `auditBloom268`,
`executionPrograms268`, `mcpDeepIntegration268`, `reputationLedger268`)
already had `getPerf268()` from V267 and are unchanged.

---

## New: 6 Provider Contracts

`providerAdapters268.js` adds six provider contract definitions (previously
absent) to the 15 V267 contracts, bringing the total to **21**:

| Contract key | Required methods |
|---|---|
| `hitlGate` | `escalate`, `getStatus` |
| `sandboxExec` | `run`, `getStats` |
| `intelligenceRegistry` | `get`, `list` |
| `vectorMemory` | `add`, `search`, `delete` |
| `db` | `query`, `insert`, `update`, `delete`, `transaction` |
| `snapshotEngine` | `save`, `load`, `list`, `delete` |

Each contract ships a matching `create<Name>Stub268()` factory that passes
`validateProvider268()`. `createAllStubs268()` returns all 21 stubs as a
single object.

---

## New: `logAdapter` DI Contract

A new `logAdapter` provider contract formalises structured logging injection.

Required methods: `info`, `warn`, `error`, `debug`, `setContext`

`createLogAdapterStub268({ silent: true })` suppresses output in tests.  
`validateProvider268('logAdapter', adapter)` validates conformance.

---

## New: `ecos-api-server-v268-patch.js`

Exports:

- `createV268State(opts)` — wires all 24 modules, injects cross-module
  providers, validates all 21 DI contracts, returns a ready-to-use state
  object with `version: '268'` and a `modules` capability map.
- `registerEcosV268Routes(app, state)` — mounts V268 telemetry and health
  endpoints on an Express-compatible app.

---

## New: Test Suite — `tests/v268.test.cjs`

174 tests across sections A (V267 regression smoke), B (providerAdapters268),
C (createV268State), C1–C15 (per-module unit tests).

---

## BigInt Consistency

All micro-credit amounts across the 15 new modules use `BigInt` (`0n`).
No `number` type is used for monetary values. Float USDC amounts in x402
payloads remain `number` as per the x402 wire format.

---

## Dependencies

Zero new npm dependencies added. All V268 code uses Node.js built-ins
(`node:crypto`, `node:buffer`) only.

---

## Identifier Convention

All new exports, constants, methods, and class names end with the suffix `268`.
No V267 identifier (`267`) is removed or renamed.
