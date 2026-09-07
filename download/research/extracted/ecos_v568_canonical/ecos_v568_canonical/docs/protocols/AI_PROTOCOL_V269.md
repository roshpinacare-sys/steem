# ECOS AI Protocol — V269

**Version:** 269  
**Date:** 2026-06-01  
**Status:** Canonical  
**Predecessor:** V268 (improved — 257 tests passing)

---

## 1. Overview

V269 extends the ECOS AI protocol with:

1. **eventBus DI contract** — cross-module async event routing (pub/sub)  
2. **providerAdapters269** — 22 total contracts (21 from V268 + eventBus)  
3. **createV269State** — full module wiring with eventBus + snapshotEngine injection  
4. **V269 API endpoints** — `/api/v269/*` covering health, perf, events, snapshots  
5. **Hardened test suite** — 44 V269 tests + 257 V268 regression tests (301 total)

---

## 2. eventBus Contract

```js
eventBus.publish(topic, payload)
  → { ok: boolean, eventId: string }

eventBus.subscribe(topic, fn)
  → { ok: boolean }

eventBus.unsubscribe(topic, fn)
  → { ok: boolean }

// Optional:
eventBus.getHistory(topic?)   → Event[]
eventBus.clearHistory()       → { ok: boolean }
eventBus.listTopics()         → string[]
```

Development stub: `createEventBusStub269({ silent: true })`

---

## 3. Provider DI Contract Summary (V269)

All 22 contracts declared in `providerAdapters269.js`:

| # | Contract | V268 | V269 | Module |
|---|---|---|---|---|
| 1 | settlementProvider | ✓ | ✓ | x402268 |
| 2 | custodyProvider | ✓ | ✓ | embeddedWallet268 |
| 3 | mcpServerRegistry | ✓ | ✓ | mcpDeepIntegration268 |
| 4 | toolExecutor | ✓ | ✓ | mcpDeepIntegration268 |
| 5 | persistenceAdapter | ✓ | ✓ | auditBloom268 |
| 6 | smsGateway | ✓ | ✓ | ussdSmsStateMachine268 |
| 7 | ussdGateway | ✓ | ✓ | ussdSmsStateMachine268 |
| 8 | sessionStore | ✓ | ✓ | ussdSmsStateMachine268 |
| 9 | antiDumpProvider | ✓ | ✓ | splitModule268 |
| 10 | vestingProvider | ✓ | ✓ | splitModule268 |
| 11 | authProvider | ✓ | ✓ | onboardingFlow268 |
| 12 | cryptoWordsFilter | ✓ | ✓ | onboardingFlow268 |
| 13 | schedulerProvider | ✓ | ✓ | executionPrograms268 |
| 14 | budgetProvider | ✓ | ✓ | executionPrograms268 |
| 15 | hitlGate | ✓ | ✓ | reflectionLoop268 |
| 16 | sandboxExec | ✓ | ✓ | reflectionLoop268 |
| 17 | intelligenceRegistry | ✓ | ✓ | costAwareRouter268 |
| 18 | vectorMemory | ✓ | ✓ | — (injectable) |
| 19 | db | ✓ | ✓ | — (injectable) |
| 20 | snapshotEngine | ✓ | ✓ | — (injectable) |
| 21 | logAdapter | ✓ | ✓ | all modules |
| 22 | **eventBus** | — | **NEW** | cross-module |

---

## 4. Versioning Rules

- All new identifiers end with `269`.
- No V268 identifier is removed, renamed, or made breaking.
- V269 modules are drop-in replacements / additive layers over V268.
- Future versions (V270+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 5. Security Constraints (inherited + new)

All V268 constraints apply unchanged. V269 adds:

| Constraint | Enforcement |
|---|---|
| eventBus topic whitespace | Topics must be non-empty strings (enforced in stub; production adapter should validate) |
| Snapshot ID isolation | Each snapshotId is independently scoped — no cross-contamination |

---

## 6. Iron Rules (never violate)

1. All new identifiers end with the next version number
2. Zero new npm dependencies — Node.js built-ins only
3. NEVER touch `lib/fiatLedger.js` or `lib/auditLog.js` (sacred files)
4. No endpoint removal — additive only
5. Package version matches version number (`269.0.0`)
6. All monetary amounts use `BigInt` micro-cents
7. `TRADABLE_TOKEN_ENABLED=false` until governance vote
8. Vesting: ALL rewards vest ≥ 12 months
