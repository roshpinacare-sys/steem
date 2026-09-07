# ECOS Final Runtime Topology — V106

## Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         ecos-api-server.js                             │
│                         (Express 5 — 3617+ lines)                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SINGLETONS (initialized at startup)                            │  │
│  │                                                                  │  │
│  │  fiatLedger       ← FiatLedger (Sacred File — read-only here)   │  │
│  │  auditLog         ← AuditLog   (Sacred File — read-only here)   │  │
│  │  hitlGate         ← HitlGate                                    │  │
│  │  defaultMemory    ← MemorySubstrate                             │  │
│  │  defaultJournal   ← ExecutionJournal                            │  │
│  │  intelligenceReg  ← IntelligenceRegistry                        │  │
│  │  agentFactory     ← AgentRuntime factory                        │  │
│  │                                                                  │  │
│  │  [V106 NEW]                                                      │  │
│  │  embeddingProvider ← FallbackEmbeddingProvider (auto-resolved)  │  │
│  │  replayEngine      ← ReplayEngine(auditLog, defaultJournal)     │  │
│  │  snapshotEngine    ← SnapshotEngine(ledger, auditLog, hitlGate) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  EMBEDDING INJECTION (V106)                                      │  │
│  │  defaultMemory.setEmbedFn(text => embeddingProvider.embed(text)) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  INFERENCE PROVENANCE PIPELINE (V106)                            │  │
│  │  Before infer():  sealInference({ traceId, prompt, output }) → proof│  │
│  │  After infer():   auditLog.append(type, { ...payload,            │  │
│  │                                    inferenceProvenance: proof })  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  API ROUTES (V105 base + V106 additions)                         │  │
│  │                                                                  │  │
│  │  /api/v1/health              ← existing                          │  │
│  │  /api/v1/ledger/*            ← existing (Sacred ops on ledger)   │  │
│  │  /api/v1/memory/*            ← existing (MemorySubstrate)        │  │
│  │  /api/v1/tasks/*             ← existing (HITL, auto-flow)        │  │
│  │  /api/v1/agents/*            ← existing (AgentRuntime)           │  │
│  │  /api/v1/audit/log           ← existing                          │  │
│  │                                                                  │  │
│  │  [V106 NEW]                                                      │  │
│  │  /api/v1/audit/replay        ← ReplayEngine.replayAuditLog()    │  │
│  │  /api/v1/audit/replay/:runId ← ReplayEngine.replayJournalRun()  │  │
│  │  /api/v1/audit/provenance/:h ← ReplayEngine.lookupProvenance()  │  │
│  │  /api/v1/audit/dag           ← causal DAG view                  │  │
│  │  /api/v1/snapshot            ← SnapshotEngine.export()          │  │
│  │  /api/v1/snapshot/restore    ← SnapshotEngine.restore()         │  │
│  │  /api/v1/snapshot/verify     ← SnapshotEngine.verify()          │  │
│  │  /api/v1/snapshot/list       ← SnapshotEngine.listSnapshots()   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

                            ┌──────────────────────────────┐
                            │  PostgreSQL + pgvector         │
                            │  (if available)                │
                            │                                │
                            │  audit_log                     │
                            │  accounts                      │
                            │  approvals                     │
                            │  knowledge_patches             │
                            │   + embedding_v2 (V106)        │
                            │  snapshots         (V106)      │
                            │  replay_checkpoints (V106)     │
                            │  embedding_migration_log(V106) │
                            └──────────────────────────────┘
```

---

## Data Flow — Live Inference

```
POST /api/v1/tasks/auto-flow
  │
  ├── 1. Validate inputs (Zod)
  ├── 2. Generate traceId
  ├── 3. infer(prompt, context) → { output, model, confidence }
  ├── 4. sealInference({ traceId, prompt, output, model, confidence }) → proof
  ├── 5. confidence ≥ threshold?
  │      YES → auditLog.append('TASK_AUTO_FLOW', { ...payload, inferenceProvenance: proof })
  │             fiatLedger.autoFlow(splits)
  │      NO  → hitlGate.createApproval({ ...task, inferenceProvenance: proof })
  │             auditLog.append('TASK_PENDING_HITL', { ...payload, inferenceProvenance: proof })
  └── 6. Return { taskId, status, traceId, proofHash: proof.bindingHash }
```

## Data Flow — Replay Verification

```
GET /api/v1/audit/replay?from=0&to=100&expectedHash=<sha256>
  │
  ├── 1. auditLog.entries().slice(from, to+1)
  ├── 2. auditEntryToLedgerEvent(entry) for each → ledger events
  ├── 3. deterministicReducers.replayEvents(ledgerEvents) → finalState
  ├── 4. if expectedHash: verifyReplay(events, expectedHash) → { ok, divergence }
  ├── 5. compute replayProof = sha256("replay|from|to|finalStateHash|events")
  └── 6. Return { ok, eventsApplied, finalStateHash, balances, replayProof, verification? }
```

## Data Flow — Snapshot Export

```
GET /api/v1/snapshot
  │
  ├── 1. fiatLedger.listAccounts() → accounts[]
  ├── 2. auditLog.entries().slice(-100) → auditTail[]
  ├── 3. hitlGate.listApprovals({ status: 'PENDING' }) → pendingApprovals[]
  ├── 4. canonicalize({ accounts, auditTail, pendingApprovals }) → json
  ├── 5. sha256Hex(json) → integrityHash
  └── 6. Return { version, id, label, exportedAt, integrityHash, accounts, auditTail, ... }
```

---

## Startup Sequence

```
1. Load environment (DATABASE_URL, EMBEDDING_PROVIDER, OPENAI_API_KEY, ...)
2. Initialize FiatLedger, AuditLog (Sacred singletons)
3. Initialize HitlGate, MemorySubstrate, ExecutionJournal
4. [V106] Build defaultEmbeddingProvider (auto-detect Ollama → OpenAI → Heuristic)
5. [V106] defaultMemory.setEmbedFn(text => embeddingProvider.embed(text))
6. [V106] Instantiate ReplayEngine(auditLog, defaultJournal)
7. [V106] Instantiate SnapshotEngine(fiatLedger, auditLog, hitlGate)
8. Register all routes
9. DB pool connect (if DATABASE_URL)
10. listen(PORT)
```

---

## Embedding Provider Resolution (V106)

```
EMBEDDING_PROVIDER env var set?
  'ollama'        → OllamaEmbeddingProvider(LOCAL_LLM_URL || 'http://localhost:11434')
  'openai'        → OpenAIEmbeddingProvider(OPENAI_API_KEY)
  'openai-compat' → OpenAIEmbeddingProvider(OPENAI_BASE_URL, OPENAI_API_KEY)
  'heuristic'     → HeuristicEmbeddingProvider
  (not set)       → FallbackEmbeddingProvider:
                      try Ollama (if LOCAL_LLM_URL) → try OpenAI (if OPENAI_API_KEY)
                      → HeuristicEmbeddingProvider + WARNING log
```

---

*ECOS Final Runtime Topology · V106 · 2026-05-28*
