# ECOS Deterministic Substrate Analysis — V105 Pre-Work
<!-- Generated: 2026-05-28 | Session: Comparative Architecture Analysis -->

## Overview

This document is the result of a deep comparative analysis between ECOS V104
and a "deterministic substrate" specification covering:
- deterministic kernels
- WASM capsules & replay semantics
- provenance systems & causal DAG runtime
- CRDT synchronization
- snapshot restoration
- event-sourced cognition
- governance/proof pipelines

**Conclusion upfront:** ECOS V104 already implements ~70% of the deterministic
substrate concepts — without using that terminology. The DNA is shared.
The remaining 30% decomposes into: (A) buildable gaps worth closing, (B)
research-grade ideas worth tracking, (C) physically impossible claims to discard.

---

## 1. What ECOS Already Has (Evidenced)

| Deterministic Substrate Concept | ECOS V104 Implementation | File |
|---|---|---|
| Append-only audit journal | SHA-256 chain, `canonicalize()`, `verify()` | `lib/auditLog.js` ★ |
| Execution provenance | `beginDeltaCommit / sealDeltaCommit`, pre/post state roots | `lib/stateRoot.js` |
| Causal DAG execution | DAG steps, dependency graph, parallel execution | `lib/agentRuntime.js` |
| Checkpoint / resume | `RUN_STATUS` lifecycle, `checkpoint()` entries | `lib/executionJournal.js` |
| Validator arbitration | 4-tier confidence model: AUTO/HITL/BLOCK/HARD_REJECT | `middleware/confidenceGate.js` |
| Provider sovereignty | Vendors = optional adapters; core owns no vendor dep | `lib/intelligenceRegistry.js` |
| Deterministic trace log | `_traces[]` — every inference recorded with hash binding | `lib/intelligenceRegistry.js` |
| Scoped memory substrate | agent/user/workspace/global, temporal decay, pluggable | `lib/memorySubstrate.js` |
| Persistent agent identity | file-first + DB sync, atomic write | `lib/agentIdentity.js` |
| Permission-scoped execution | per-agent permission sets, `assertCan()` enforcement | `lib/agentRuntime.js` |
| BigInt-only accounting | no float arithmetic in any financial path | `lib/fiatLedger.js` ★ |

★ = Sacred File — never modify without explicit written approval

---

## 2. Real Gaps — Buildable in V105

### GAP-1: Deterministic Reducers
**What's missing:** `fiatLedger.js` and settlement logic are imperative and
stateful. No pure `reducer(state, event) → newState` pattern exists.

**Why it matters:** Without pure reducers, you cannot replay the ledger from
genesis to verify the current state. This limits forensic auditability.

**How to implement:**
```js
// Proposed pattern for V105
function ledgerReducer(state, event) {
  switch (event.type) {
    case 'CREDIT':  return { ...state, [event.accountId]: (state[event.accountId] ?? 0n) + event.amountMicro };
    case 'DEBIT':   return { ...state, [event.accountId]: (state[event.accountId] ?? 0n) - event.amountMicro };
    case 'SPLIT':   // 40/40/20 split event
    default: return state;
  }
}
```
**Effort:** ~2 days. **Risk:** Low (additive, doesn't touch Sacred Files).

---

### GAP-2: Replay Verification
**What's missing:** `auditLog.verify()` checks hash integrity but does not
*replay* events to reconstruct state. You can verify the chain isn't tampered
with, but you can't prove the current DB state *derives* from those events.

**Why it matters:** True forensic auditability requires: replay(events[0..N]) === currentState.

**How to implement:**
```js
// Add to executionJournal.js
replay(fromIndex = 0) {
  const entries = this._entries.slice(fromIndex);
  return entries.reduce((state, entry) => applyEntry(state, entry), initialState());
}
```
**Effort:** ~3 days. **Risk:** Medium (requires defining `initialState` and `applyEntry`).

---

### GAP-3: Snapshot Export / Restore
**What's missing:** `stateRoot` computes a hash of current state but cannot
*serialize* it. ECOS cannot currently cold-start from a snapshot without
Postgres access.

**Why it matters:** Disaster recovery, multi-node bootstrap, offline testing.

**How to implement:**
- Add `exportSnapshot(): SerializedState` to cover: accounts, audit_log tail, agent_identity, pending approvals
- Add `restoreFromSnapshot(snapshot)` with hash verification before apply

**Effort:** ~3 days. **Risk:** Medium (schema must be stable during export).

---

### GAP-4: Inference Provenance Binding
**What's missing:** IntelligenceRegistry traces record inputs/outputs but do
not cryptographically *bind* a trace to the audit chain entry that consumed it.

**Why it matters:** You cannot prove which AI output caused which ledger event
without this binding.

**How to implement:**
```js
// In intelligenceRegistry.js — after infer():
const inferenceHash = sha256Hex(`${traceId}|${prompt}|${output}`);
// Pass inferenceHash into the calling context's audit entry as provenance field
```
**Effort:** ~1 day. **Risk:** Low (additive metadata).

---

## 3. The heuristicEmbed() Problem (Critical)

`lib/memorySubstrate.js` uses `heuristicEmbed()` — a SHA-256-based 64-dim
vector — as the default embedding function when no real provider is configured.

**This is not semantic similarity.** It is hash similarity.

Two texts with identical meaning but different words will have ~0 cosine
similarity under heuristicEmbed. The memory retrieval system is effectively
broken for semantic use cases until a real embedding provider is wired in.

**P5-01 (pgvector integration) must fix this.** Until then:
- Tag any memory.retrieve() results with `{ embeddingType: 'heuristic' }`
- Add a warning log when heuristicEmbed is active and retrieve() is called

---

## 4. What to Discard (Architecturally Unsound or Impossible)

| Concept | Verdict | Reason |
|---|---|---|
| Browser-perfect determinism | ❌ IMPOSSIBLE | Float scheduling, GC, WASM JIT — all non-deterministic in browser context |
| `no_std` WASM kernels | ❌ NOT RELEVANT | ECOS is a Node.js runtime. no_std is an embedded/Rust concern. |
| "Sovereign cognition fabric" | ❌ TERMINOLOGY | No execution semantics. IntelligenceRegistry IS the answer. |
| Perfect replay across LLM calls | ❌ IMPOSSIBLE | LLM outputs are non-deterministic even with temperature=0 (unless using seeded local model) |
| CRDT for in-process state | ❌ OVER-ENGINEERING | Single-node Postgres transactions already provide stronger consistency guarantees than CRDT |

---

## 5. Research Layer (Track, Don't Build Yet)

| Concept | When to Revisit | Prerequisite |
|---|---|---|
| WASM tool sandboxing | When multi-tenant isolation is required | P6+ |
| Multi-node CRDT sync | When horizontal scaling is needed | After Postgres HA is stable |
| Causal proof export (DAG → verifiable proof) | When B2B clients need cryptographic audit export | After GAP-1+GAP-2 are implemented |
| Formal event sourcing (EventStore) | When event volume exceeds Postgres audit_log performance | After P5-01 |

---

## 6. Feasibility Matrix

| Feature | Category | Effort | Value | V105 Priority |
|---|---|---|---|---|
| Deterministic reducers (GAP-1) | A: Immediately Buildable | Low (2d) | High | ⬆ P1 |
| Inference provenance binding (GAP-4) | A: Immediately Buildable | Low (1d) | High | ⬆ P1 |
| Replay verification (GAP-2) | A: Immediately Buildable | Medium (3d) | High | ⬆ P2 |
| Snapshot export/restore (GAP-3) | A: Immediately Buildable | Medium (3d) | High | ⬆ P2 |
| heuristicEmbed → real embeddings | A: Immediately Buildable | Medium (3d) | Critical | ⬆ P1 (P5-01) |
| WASM tool isolation | B: High-Difficulty Realistic | High (2wk) | Medium | P6 |
| Multi-node CRDT | B: High-Difficulty Realistic | Very High | Medium | P7+ |
| Browser determinism | D: Architecturally Unsound | — | None | DISCARD |
| "Intelligence fabric" branding | E: Terminology Only | — | None | DISCARD |

---

## 7. V105 Evolution Roadmap (Realistic)

```
V104 (current)
│
├── V105-P5-01: Replace heuristicEmbed with real embeddings (pgvector)
│              → fixes memory substrate semantic correctness
│
├── V105-DETERMINISM-1: Deterministic reducers for fiatLedger
│              → pure (state, event) → newState functions
│              → does NOT touch Sacred Files (wrapper pattern)
│
├── V105-DETERMINISM-2: Inference provenance binding
│              → inferenceHash field in audit entries
│              → links every AI output to ledger consequence
│
├── V105-DETERMINISM-3: Replay verification endpoint
│              → GET /api/v1/audit/replay?from=0&to=N
│              → deterministic state reconstruction from journal
│
└── V105-DETERMINISM-4: Snapshot export/restore
               → GET /api/v1/snapshot → full serialized state + root hash
               → POST /api/v1/snapshot/restore → with verification
```

---

## 8. Invariants That Must Not Change

These ECOS properties must be preserved regardless of any evolution:

1. **Sovereignty** — External AI providers remain OPTIONAL adapters. Intelligence substrate belongs to ECOS.
2. **BigInt only** — No float arithmetic in any financial path. Ever.
3. **Sacred Files** — `lib/fiatLedger.js` and `lib/auditLog.js` unchanged without explicit approval.
4. **Append-only audit chain** — No deletion, no mutation of historical entries.
5. **Self-hostable** — No mandatory external service dependencies.
6. **Vendor independence** — No hard-coded provider in core logic paths.

---

## 9. Contradiction Table

| Deterministic Substrate Claim | ECOS Reality | Resolution |
|---|---|---|
| "Full browser determinism" | Float/GC/JIT make this impossible | Discard. Scope determinism to server-side reducer paths only. |
| "CRDT convergence for all state" | Postgres transactions provide stronger guarantees | Use CRDT only for offline-first sync scenarios (future P7+). |
| "Replay any execution" | LLM outputs are non-deterministic | Replay deterministic *routing* and *decisions*; accept LLM output as sealed provenance. |
| "no_std kernel isolation" | Node.js runtime has no no_std analog | Use WASM capsules for tool isolation (future P6). |
| "Snapshot continuation" | Partially true — stateRoot exists, export does not | Implement GAP-3. |

---

*ECOS Deterministic Substrate Analysis · 2026-05-28 · Pre-V105*
