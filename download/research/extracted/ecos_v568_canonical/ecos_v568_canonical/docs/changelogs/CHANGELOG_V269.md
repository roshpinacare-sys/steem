# ECOS V269 Changelog

**Release date:** 2026-06-01  
**Branch:** canonical  
**Baseline:** V268 improved (257/257 tests passing)

---

## Summary

V269 is a purely **additive** release. No V268 module signatures, exports, or
behaviour are changed. All 257 V268 tests continue to pass unchanged.

V269 closes three gaps left open by V268:

1. **Integration test hardening** — C16/C17/C18 flows from v268_improved are
   now part of the canonical test suite with full assertions.
2. **providerAdapters269** — consolidates all 22 provider contracts (21 from
   V268 + new `eventBus` contract) with stubs, validators, and scaffolds.
3. **Observability endpoints** — `/api/v269/*` telemetry, event-bus, and
   snapshot endpoints, plus `createV269State` wiring.

---

## New: providerAdapters269.js

Adds one new provider contract on top of the 21 inherited from V268:

| Contract key | Required methods | Purpose |
|---|---|---|
| `eventBus` | `publish`, `subscribe`, `unsubscribe` | Cross-module async event routing |

All 21 V268 contracts preserved verbatim. Total: **22 contracts**.

Ships `createEventBusStub269()`, `createAllStubs269()`, and
`validateProvider269(contractKey, impl)`.

---

## New: ecos-api-server-v269-patch.js

Exports:

- `createV269State(opts)` — wires all modules, injects eventBus if provided,
  validates all 22 DI contracts, returns state with `version: '269'`.
- `registerEcosV269Routes(app, state)` — mounts endpoints:
  - `GET  /api/v269/health`
  - `GET  /api/v269/perf`
  - `GET  /api/v269/providers/validate`
  - `POST /api/v269/events/publish`
  - `GET  /api/v269/events/history`
  - `POST /api/v269/snapshot/save`
  - `POST /api/v269/snapshot/load`
  - `GET  /api/v269/version`

---

## New: tests/v269.test.cjs

44 tests across sections:
- **A** — V268 regression smoke (createV268State, providerAdapters268)
- **B** — providerAdapters269 (validateProvider269, createAllStubs269)
- **C** — createV269State wiring
- **D** — eventBus contract conformance + stub behaviour
- **E** — snapshot save/load round-trip
- **F** — /api/v269/version endpoint shape

---

## New: NEXT_SESSION_PROMPT_V269.md

Bootstrap file for the next AI session (V270).

---

## Dependencies

Zero new npm dependencies. All V269 code uses Node.js built-ins only.

---

## Identifier Convention

All new exports end with the suffix `269`. No V268 identifier is removed.
