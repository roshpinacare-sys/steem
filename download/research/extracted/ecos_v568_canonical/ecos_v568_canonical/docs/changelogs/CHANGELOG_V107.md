# ECOS Changelog — V107

**Date:** 2026-05-28
**Build tag:** ECOS_FINAL_v107_canonical.zip
**Previous version:** V106 (P5-DETERMINISM: Replay Substrate, Snapshot Engine, Real Embeddings)

---

## Summary

V107 completes the P5 phase by wiring the inference provenance module into live
request pipelines, introducing an inter-agent communication bus, and shipping
the memory re-embedding tools (script + API) that were deferred from V106.

---

## New Features

### P5-02 — Inference Provenance in Live Pipelines

The `sealInference()` cryptographic binding module (introduced in V105 and tested
in V106) is now wired into every AI inference call that flows through the server.

**Changes:**
- `ecos-api-server.js` `/chat` endpoint: after `offlineInference.executeTask()`,
  calls `_v106.sealInference()` to generate a binding proof, then appends an
  `INFERENCE_SEALED` entry to the audit log carrying `{ missionId, approvalId, inferenceProvenance }`.
- `ecos-api-server.js` agent agentic loop: each iteration's inference call is
  sealed and appended as `INFERENCE_SEALED` with `{ agentLoop: true, stepCount, inferenceProvenance }`.
- Both seal operations are **non-fatal** — wrapped in `try/catch` so an
  embedding or hashing failure never blocks the business flow.
- The existing `GET /api/v1/audit/dag` and `GET /api/v1/audit/provenance/:traceHash`
  endpoints now return provenance edges for these live inference entries.

**Before (V106):** `inferenceProvenance.js` existed and was tested, but audit
entries from live `/chat` and agent-loop requests contained no `inferenceProvenance`
field — the DAG had no edges.

**After (V107):** Every live inference call produces a sealed audit entry with
a verified `inputHash`, `bindingHash`, `model`, and `confidence`. The DAG is live.

---

### P5-03 — Inter-Agent Communication Bus (`lib/agentBus.js`)

New module implementing a typed, in-process pub/sub messaging bus for
`AgentRuntime`-based multi-agent pipelines.

**`lib/agentBus.js` — key capabilities:**

| Feature | Detail |
|---|---|
| Channels | `context`, `result`, `error`, `control`, `memory`, `audit` (extensible) |
| Delivery | Broadcast (to=null) or targeted (to=agentId) |
| Ring buffer | Last N messages per channel for replay (default: 500) |
| Causal chain | `parentId` links tracked; `getCausalChain(messageId)` traversal |
| Dead-letter | Undeliverable messages queued for inspection |
| Stats | Per-bus published/delivered/dead-lettered counts |
| Singleton | `defaultBus` export for shared process-wide use |

**New API endpoints (`ecos-api-server.js`):**

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/agent/bus/status` | Bus stats: counts + channel summary |
| `POST` | `/api/v1/agent/bus/send` | Publish a message (body: channel, from, to?, payload) |
| `GET`  | `/api/v1/agent/bus/replay` | Ring-buffer replay for a channel |
| `GET`  | `/api/v1/agent/bus/chain/:messageId` | Causal ancestor chain for a message |

---

### Memory Re-embed — Script + API

Two complementary tools for upgrading existing knowledge patches from heuristic
embeddings to real (Ollama/OpenAI) embeddings.

**`scripts/reembed-patches.js`** — standalone CLI script:
```bash
# Dry-run: show candidates without writing
node scripts/reembed-patches.js --dry-run

# Re-embed using Ollama (local)
LOCAL_LLM_URL=http://localhost:11434 node scripts/reembed-patches.js

# Re-embed using OpenAI, batch 50
OPENAI_API_KEY=sk-... node scripts/reembed-patches.js --provider openai --batch 50

# Only patches updated after a date, max 1000
node scripts/reembed-patches.js --since 2026-05-01T00:00:00Z --limit 1000
```

Writes results to `embedding_migration_log` table. Exit code 2 on partial failure.

**`POST /api/v1/memory/reembed`** — API endpoint:
```json
POST /api/v1/memory/reembed
{ "provider": "openai", "dryRun": true, "batchSize": 50 }
```
Returns `{ ok, runId, provider, isReal, total, succeeded, failed, errors }`.
Requires `x-api-key` in production (same key as `/deposit`).

---

## New Files

| File | Purpose |
|------|---------|
| `lib/agentBus.js` | Inter-agent pub/sub bus (P5-03) |
| `tests/agentBus.test.js` | 30+ tests for AgentBus |
| `scripts/reembed-patches.js` | CLI re-embedding script |
| `docs/CHANGELOG_V107.md` | This file |
| `MIGRATION_NOTES_V107.md` | Upgrade guide V106 → V107 |

---

## Modified Files

| File | Change |
|------|--------|
| `ecos-api-server.js` | P5-02 wiring in `/chat` + agent loop; V107 init block; 4 new V107 endpoints |
| `package.json` | Description updated to V107; no version change (already 107.0.0) |
| `CLAUDE_CONTEXT.md` | STATE updated to V107 |
| `NEXT_SESSION_PROMPT.md` | Updated for V107 → V108 |

---

## Sacred Files

Unchanged. MD5 hashes verified:

| File | MD5 |
|------|-----|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` ✅ |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅ |

---

## Breaking Changes

**None.** V107 is fully backward-compatible with V106.

| Concern | Status |
|---------|--------|
| Existing API routes | ✅ Unchanged |
| Sacred Files | ✅ Unchanged |
| Audit log format | ✅ Additive — new `INFERENCE_SEALED` entry type only |
| DB schema | ✅ Unchanged — no new migrations required |
| MemorySubstrate behavior | ✅ Unchanged — re-embed is opt-in |
| AgentRuntime API | ✅ Unchanged — AgentBus is a new independent module |

---

## Environment Variables

No new environment variables in V107. All existing V106 vars apply unchanged.

---

## Test Count

| Category | V106 | V107 |
|----------|------|------|
| Previous total | ~300+ | — |
| New (agentBus.test.js) | — | 30+ |
| **V107 total** | — | **~330+** |

---

*ECOS V107 Changelog · 2026-05-28*
