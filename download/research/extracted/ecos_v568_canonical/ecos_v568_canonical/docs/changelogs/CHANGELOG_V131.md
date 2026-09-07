# ECOS Changelog — V131: Sovereign AI-on-Chain

**Release Date:** 2026-05-30  
**Version:** 131.0.0  
**Release Name:** Sovereign AI-on-Chain

---

## Overview

V131 connects ECOS's two core assets — its internal AI and its blockchain audit trail — for the first time.
Every AI inference is now recorded, signed, and verifiable on the chain.

**Before V131:** AI did X  
**After V131:** AI did X, at 2026-05-30T14:32:11Z, with confidence 0.87, hash=abc123, verifiable.

---

## New Components

### `lib/inferenceChainLogger.js` [V131-AOC-01]

The core of Sovereign AI-on-Chain. Wraps every inference call:

- Generates a unique `inferenceId` (`inf::<nanoid>`)
- Appends to `auditLog` with type `AI_INFERENCE` (sacred file — read interface only)
- Appends the chain hash to the MMR for inclusion proof
- Returns `{ inferenceId, chainHash, mmrLeafIndex, proof }`
- Maintains in-memory indices: by `inferenceId`, `taskId`, `clientId`

### `lib/translationChainSigner.js` [V131-AOC-02]

Signs every languageBridge translation:

- Generates a unique `translationId` (`tr::<nanoid>`)
- Records `sourceHash`, `outputHash`, `langPair` — not raw text (privacy-preserving)
- Appends to `auditLog` with type `AI_TRANSLATION`
- Returns `attestation: { sessionId, langPair, timestamp, chainHash, mmrLeafIndex, provider }`
- Verifiable via `POST /api/v1/language/verify-translation`

### `lib/sovereignAILedger.js` [V131-AOC-03]

The AI "balance sheet" — aggregates inference + translation + payment data:

- `clientReport(clientId)` → full AI activity summary with chain integrity status
- `auditChain({ from, to })` → verifies AI chain integrity for a time window
- `stats()` → system-wide: total inferences, translations, avg confidence, MMR root

---

## New API Endpoints (8)

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/inference/chain/:inferenceId` | Retrieve proof of a specific inference |
| GET  | `/api/v1/inference/chain?taskId=X`     | All inferences for a task |
| POST | `/api/v1/inference/verify`             | Verify an inference proof |
| GET  | `/api/v1/language/sessions/:id/proofs` | All translation proofs for a session |
| POST | `/api/v1/language/verify-translation`  | Verify a translation attestation |
| GET  | `/api/v1/sovereign/report/:clientId`   | Full AI activity report for a client |
| GET  | `/api/v1/sovereign/audit`             | AI chain integrity audit |
| GET  | `/api/v1/sovereign/stats`             | System-wide AI statistics |

---

## Architecture

```
Client Request
  └─ POST /api/v1/chat
       └─ offlineInference.executeTask()
            └─ [V131] inferenceChainLogger.log()
                 ├─ auditLog.append('AI_INFERENCE', {...})  ← Sacred read interface
                 └─ defaultMMR.append(chainHash)            ← inclusionProof

POST /api/v1/language/sessions/:id/message
  └─ languageBridgeNode.sendMessage()
       └─ [V131] translationChainSigner.sign()
            ├─ auditLog.append('AI_TRANSLATION', {...})
            └─ defaultMMR.append(chainHash)

GET /api/v1/sovereign/report/:clientId
  └─ sovereignAILedger.clientReport()
       ├─ inferenceChainLogger.getByClient()
       ├─ translationChainSigner.getByClient()
       └─ fiatLedger balance query (read-only)
```

---

## Tests

| File | Tests | Coverage |
|------|-------|----------|
| `tests/v131InferenceChainLogger.test.js`   | 12 | log, chain hash, MMR, proof retrieval, client/task index |
| `tests/v131TranslationChainSigner.test.js` | 10 | sign, verify, session proofs, MMR append, attestation |
| `tests/v131SovereignAILedger.test.js`      | 10 | clientReport, auditChain, stats, avgConfidence, chainIntact |

**Expected total: ~1223 passing** (V130: ~1191 + V131: ~32)

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred); only `append()` is called
3. ✅ BigInt-only accounting in all fiatLedger interactions
4. ✅ No new npm dependencies — uses `vendor/nanoid` + `node:crypto`
5. ✅ All V130 endpoints preserved and unchanged
6. ✅ RTL support: continued (no UI changes in V131 core)
