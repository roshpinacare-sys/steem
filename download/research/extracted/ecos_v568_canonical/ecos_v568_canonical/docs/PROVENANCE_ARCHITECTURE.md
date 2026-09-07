# ECOS Provenance Architecture — V106

## Overview

Every AI inference that affects ledger state is now cryptographically bound to
its audit chain entry via `lib/inferenceProvenance.js` (V105 pre-work).

V106 wires this provenance binding into the live server pipeline.

---

## How It Works

```
1. Before infer():
   const proof = sealInference({ traceId, prompt, output, model, confidence })

2. proof = {
     traceId:     "trace_abc",
     inputHash:   SHA-256("prompt|<prompt>"),
     bindingHash: SHA-256("traceId|inputHash|output|model|ts"),
     model:       "gpt-4o-mini",
     confidence:  0.87,
     ts:          "2026-05-28T...",
     outputLength: 342
   }

3. Pass into audit entry:
   auditLog.append('TASK_AUTO_FLOW', {
     ...taskPayload,
     inferenceProvenance: proof
   })

4. Later verification:
   verifyInferenceProof(proof, { prompt, output })
   → { ok: true }
```

---

## Causal Lineage

Every provenance-bearing audit entry participates in the causal chain:

```
audit_entry[N-1] ── prevHash ──▶ audit_entry[N]
                                      │
                                      ├── inferenceProvenance.traceId
                                      ├── inferenceProvenance.inputHash
                                      └── inferenceProvenance.bindingHash
                                              │
                                              └── proves: this AI output caused this ledger event
```

---

## What Is Causally Traceable in V106

| Event | Provenance Bound | Mechanism |
|---|---|---|
| TASK_AUTO_FLOW | ✅ | sealInference() before infer(), proof in audit payload |
| TASK_HITL_RESOLVED | ✅ | AI inference proof attached to approval creation |
| TASK_BLOCK | ✅ | Confidence gate decision includes inference proof |
| Memory mutations | ⚠️ partial | ingest() tags with caller context, no full seal |
| Validator decisions | ⚠️ partial | Human decisions not AI-bound (by design) |
| Ledger mutations | ✅ via audit | All settlement flows create audit entries |

---

## API: Provenance Inspection

### GET /api/v1/audit/provenance/:traceHash

Retrieves an audit entry by its hash and returns the full provenance chain.

```json
{
  "ok": true,
  "target": {
    "index": 42,
    "ts": "2026-05-28T12:00:00Z",
    "type": "TASK_AUTO_FLOW",
    "hash": "<sha256>"
  },
  "inferenceProvenance": {
    "traceId": "trace_abc",
    "inputHash": "<sha256>",
    "bindingHash": "<sha256>",
    "model": "gpt-4o-mini",
    "confidence": 0.87,
    "ts": "2026-05-28T12:00:00Z",
    "outputLength": 342
  },
  "ancestorChain": [
    { "index": 41, "ts": "...", "type": "TASK_SUBMITTED", "hash": "..." }
  ],
  "chainDepth": 2
}
```

### Verification flow for a B2B audit

```js
// 1. Retrieve the audit entry
const entry = GET /api/v1/audit/provenance/<traceHash>

// 2. Client has original prompt + output stored on their side
const { ok } = verifyInferenceProof(
  entry.inferenceProvenance,
  { prompt: storedPrompt, output: storedOutput }
)

// 3. ok=true proves: this exact AI output caused this ledger event
```

---

## DAG Export (GET /api/v1/audit/dag)

Returns the causal DAG for the N most recent audit entries:

```json
{
  "nodes": [
    { "id": "audit-42", "type": "TASK_AUTO_FLOW", "ts": "...", "hash": "..." }
  ],
  "edges": [
    { "from": "audit-41", "to": "audit-42", "relation": "prevHash" }
  ],
  "provenanceEdges": [
    { "from": "trace_abc", "to": "audit-42", "relation": "inferenceProvenance" }
  ]
}
```

---

## Sacred File Invariants

- `lib/auditLog.js` is NOT modified (Sacred File)
- `lib/fiatLedger.js` is NOT modified (Sacred File)
- `lib/inferenceProvenance.js` (V105) is extended via wiring in api-server, not modified
- All provenance binding is ADDITIVE metadata on existing audit entries

---

## Execution DAG (Agent Level)

```
AgentRuntime.executeDAG()
    │
    ├── step_1 (planner) ──────── inferenceProvenance_1 ──▶ auditEntry_1
    │       │
    │       └── step_2 (worker) ─ inferenceProvenance_2 ──▶ auditEntry_2
    │               │
    │               └── step_3 (validator) ─ inferenceProvenance_3 ──▶ auditEntry_3
    │
    └── ExecutionJournal.checkpoint(runId, state) ──▶ replayable from any point
```

---

*ECOS Provenance Architecture · V106 · 2026-05-28*
