# ECOS AI Protocol — V268

**Version:** 268  
**Date:** 2026-06-01  
**Status:** Canonical

---

## 1. Overview

V268 extends the ECOS AI protocol with three dimensions:

1. **Observable telemetry** — every base module records per-call latency,
   exposing `getPerf268()` and `checkXHealth268()` for runtime monitoring.
2. **Formalised DI contracts** — six new provider contracts (plus `logAdapter`)
   give agent runtimes a typed interface for HITL, sandboxed execution,
   intelligence routing, vector memory, persistence, and snapshots.
3. **Structured logging DI** — the `logAdapter` contract replaces ad-hoc
   `console.*` calls with injected, context-aware structured logging.

---

## 2. Module Telemetry Protocol

### 2.1 `getPerf268()` contract

Every module MUST implement:

```js
getPerf268() → { p50: number, p95: number, p99: number, count: number }
```

- Latencies are measured in **milliseconds** using `Date.now()`.
- The ring buffer holds the last **1,000** samples.
- Percentiles are computed over the full buffer on each call (O(n log n)).
- `count` reflects total samples recorded since module instantiation.
- If no samples exist, returns `{ p50: 0, p95: 0, p99: 0, count: 0 }`.

### 2.2 `checkXHealth268()` contract

Every module MUST implement a health check method named
`check<ModuleName>Health268()`:

```js
checkXHealth268() → { ok: boolean, version: '268', [moduleSpecificFields] }
```

- MUST return `ok: true` under normal operation.
- MAY include additional diagnostic fields (e.g., `queueDepth`, `backingRatio`).
- MUST NOT throw; catches internal errors and returns `ok: false`.

### 2.3 Instrumentation pattern

```js
someMethod268(args) {
  const _t0 = Date.now();
  // ... business logic ...
  this._recordLatency268(_t0);
  return result;
}

_recordLatency268(t0) {
  const ms = Date.now() - t0;
  this._perf268.latencies.push(ms);
  if (this._perf268.latencies.length > 1000)
    this._perf268.latencies.shift();
}
```

For async methods, `_recordLatency268` MUST be called on **all exit paths**
(including early returns and HITL escalation branches).

---

## 3. Provider DI Contract Protocol

### 3.1 Contract registration

All 21 contracts are declared in `providerAdapters268.js`:

```
PROVIDER_CONTRACTS_268[contractKey] = {
  required: ['method1', 'method2', ...],
  optional: ['optMethod'],
  description: 'Human-readable purpose',
}
```

### 3.2 Validation

```js
validateProvider268(contractKey, providerObject)
  → { ok: boolean, errors: string[] }

validateAllProviders268(providersObject)
  → { ok: boolean, allErrors: { [key]: string[] } }
```

### 3.3 V268 new contracts

| Contract | Agent capability unlocked |
|---|---|
| `hitlGate` | Human-in-the-loop approval gates on mission output |
| `sandboxExec` | Safe code execution for reflectionLoop verifier |
| `intelligenceRegistry` | Tiered model selection (haiku / sonnet / opus) |
| `vectorMemory` | Semantic memory add / search / delete |
| `db` | Persistent structured storage (query / insert / update) |
| `snapshotEngine` | State snapshot save / load for checkpoint recovery |

### 3.4 `logAdapter` DI contract

```js
logAdapter.info(message, context)    // structured info log
logAdapter.warn(message, context)    // warning
logAdapter.error(message, context)   // error
logAdapter.debug(message, context)   // debug (may no-op in prod)
logAdapter.setContext(contextObject) // attach persistent request context
```

Modules that previously used `console.*` directly SHOULD accept a
`logAdapter` option and fall back to `console` when not provided.

---

## 4. Integration Flows

### 4.1 Agent Payment Flow (x402 → creditReserve → tipModule)

```
Client                X402Processor268        CreditReserve268     TipModule268
  │─── POST /api/pay ──►│                          │                    │
  │                     │─── processPayment268 ───►│                    │
  │                     │   (HMAC verify, replay)  │                    │
  │                     │◄── { ok, receiptId } ────│                    │
  │                     │─── depositX402268 ───────►│                    │
  │◄── 200 receiptId ───│                          │                    │
  │─── POST /api/tip ──────────────────────────────────────────────────►│
  │                                                                      │─ tip268(from, to, μ¢)
  │◄── 200 tipId ────────────────────────────────────────────────────────│
```

### 4.2 Mission Reflection Flow (reflectionLoop → hitlGate → agentReceipts)

```
Agent
  │─── execute268(taskType, proposer, verifier, ctx, { missionId }) ──►ReflectionLoop268
  │                                                                        │─ proposer(ctx, attempt)
  │                                                                        │─ verifier(output)
  │                                  [if score < threshold after retries]  │
  │                                                                        │─► HitlGate268.escalate()
  │                                                                        │◄── { approved, feedback }
  │                                                                        │─► AgentReceipts268.emitVerification268()
  │◄─── { ok, output, attempts, selfCorrected } ───────────────────────────│
```

### 4.3 Onboarding Sybil Flow (onboardingFlow → sybilGuard → reputationLedger)

```
User
  │─── startFlow268(userId, channel) ──────────────────►OnboardingFlow268
  │─── completeStep268('identity', data) ──────────────►│
  │                                                      │─► SybilGuard268.evaluate268(userId)
  │                                                      │─► SybilGuard268.recordSignal268('onboarding', true)
  │◄── { ok, nextStep } ─────────────────────────────────│
  │─── completeStep268('first_action', data) ───────────►│
  │◄── { ok, complete } ─────────────────────────────────│
  │                                                      │─► ReputationLedger268.systemAttest268(userId, 'onboarding')
```

---

## 5. Versioning Rules

- All new identifiers in V268 end with the suffix `268`.
- No V267 identifier is removed, renamed, or made breaking.
- V268 modules are drop-in replacements for V267 modules.
- Backward-compat aliases (`*264`, `*267`) are preserved unchanged.
- Future versions (V269+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 6. Security Constraints

| Constraint | Enforcement |
|---|---|
| No self-attestation | `reputationLedger268.attest268` throws on `attesterId === subjectId` |
| No self-tipping | `tipModule268.tip268` throws on `fromUserId === toUserId` |
| Replay protection | `x402268` nonce registry consumes each nonce once |
| Sacred file guard | `injectionFirewall268` blocks writes to `SACRED_FILES_268` |
| Crypto-word filter | `onboardingFlow268` rejects crypto terminology in profiles |
| BigInt-only credits | All μ¢ values use `BigInt`; no float arithmetic on credits |
