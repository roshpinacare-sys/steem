# ECOS Changelog — V132: AI Validator Consensus

**Release Date:** 2026-05-30  
**Version:** 132.0.0  
**Release Name:** AI Validator Consensus

---

## Overview

V132 completes the Sovereign AI-on-Chain epic (P22) with two final deliverables
deferred from V131: a multi-provider consensus engine and the Sovereign AI Dashboard.

**Before V132:** Each inference came from a single provider — no cross-validation.  
**After V132:** N providers vote; majority wins; the consensus is signed and recorded on-chain.
The dashboard shows the full system status in real time.

---

## New Components

### `lib/aiValidatorConsensus.js` [V132-AVC-01]

The multi-provider consensus engine. Key design:

**Fan-out:** The same prompt is sent to all registered providers in parallel (`Promise.all`).

**Vote normalisation:** Each output is trimmed, lowercased, and sha256-hashed into a
deterministic "fingerprint" — so "Yes.", "yes", "  YES  " all count as the same vote.

**Majority tally:** The fingerprint with the highest count wins. On ties, the
candidate with the higher average confidence takes the seat.

**Chain recording:** The winning output is logged to the audit chain via
`defaultInferenceChainLogger.log()` — same path as a normal inference,
with `provider: 'consensus::p1+p2+p3'` identifying the participants.

**Resilience:** If a provider throws, it is recorded as `status: 'abstain'` —
the consensus proceeds as long as at least one valid vote exists.

**Provider registration:**
```javascript
const { defaultAiValidatorConsensus } = require('./lib/aiValidatorConsensus');
defaultAiValidatorConsensus.registerProvider({
  id: 'my-provider',
  async infer(prompt, opts) {
    // return { output: string, confidence: number, latencyMs: number }
  },
});
```

**Return shape:**
```json
{
  "consensusId":   "cns::abc123",
  "winner": {
    "output":        "The answer is X",
    "fingerprint":   "sha256hex",
    "count":         2,
    "providers":     ["openai", "anthropic"],
    "avgConfidence": 0.876
  },
  "votes": [
    { "provider": "openai",    "output": "The answer is X", "confidence": 0.9, "status": "ok" },
    { "provider": "anthropic", "output": "The answer is X", "confidence": 0.85, "status": "ok" },
    { "provider": "local-llm", "output": null, "confidence": null, "status": "abstain" }
  ],
  "quorum":      0.667,
  "dissent":     false,
  "chainHash":   "64hexchars",
  "mmrLeafIndex": 42,
  "inferenceId": "inf::xyz789",
  "timestamp":   "2026-05-30T...",
  "ecosVersion": "V132"
}
```

---

### `apps/web/src/app/sovereign/page.jsx` [V132-AVC-02]

The **Sovereign AI Dashboard** — a real-time view of the entire AI-on-Chain system.

**Four sections:**

| Section | API source | Content |
|---------|-----------|---------|
| Chain Status | `GET /api/v1/sovereign/audit` | Intact / broken, head/tail hash, entries verified |
| Inference Chain | `GET /api/v1/sovereign/stats` | Total inferences, avg confidence, translations, MMR root |
| Multi-Provider Consensus | `GET /api/v1/inference/consensus/stats` | Total runs, dissent %, avg quorum, provider usage bars |
| Translation Proofs | `GET /api/v1/sovereign/stats` | Signed translations, privacy note, MMR anchor |

**Design:**
- Dark theme (`#0f172a` background) — consistent with all ECOS pages
- RTL-aware: detects `document.documentElement.lang`; supports Hebrew, Arabic, Farsi, Urdu
- Auto-refresh every 30s via `setInterval`
- Graceful error banner on fetch failure (non-fatal, data stays visible)
- Accessible via nav link `⛓️ Sovereign`

---

## New API Endpoints (3)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/inference/consensus` | Run multi-provider consensus on a prompt |
| GET  | `/api/v1/inference/consensus/stats` | System-wide consensus statistics |
| GET  | `/api/v1/inference/consensus/:consensusId` | Retrieve one consensus record by ID |

---

## Architecture after V132

```
POST /api/v1/inference/consensus
  └─ AiValidatorConsensus.run()
       ├─ provider[0].infer(prompt)  ─┐
       ├─ provider[1].infer(prompt)   ├── parallel fan-out
       └─ provider[N].infer(prompt)  ─┘
            └─ tallyVotes() → majority winner
                 └─ inferenceChainLogger.log()
                      ├─ auditLog.append('AI_INFERENCE', ...)  ← Sacred read interface
                      └─ defaultMMR.append(chainHash)          ← inclusionProof

GET /api/v1/inference/consensus/stats
  └─ AiValidatorConsensus.stats()

apps/web/src/app/sovereign/page.jsx
  └─ fetches: /sovereign/stats + /sovereign/audit + /inference/consensus/stats
       └─ renders: ChainStatus + InferenceFeed + ConsensusPanel + TranslationProofs
```

---

## Tests

| File | Tests | Coverage |
|------|-------|----------|
| `tests/v132AiValidatorConsensus.test.js` | 14 | voteFingerprint, tallyVotes, register/deregister, run (majority/unanimous/abstain), chain recording, retrieval, stats |

**Expected total: ~1237 passing** (V131: ~1223 + V132: ~14)

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred); only `append()` is called
3. ✅ BigInt-only accounting in all fiatLedger interactions
4. ✅ No new npm dependencies — `node:crypto` + `vendor/nanoid` only
5. ✅ All V131 endpoints preserved and unchanged
6. ✅ RTL support: sovereign dashboard fully RTL-aware

---

## P22 — Sovereign AI-on-Chain: COMPLETE ✅

| Ticket | File | Status |
|--------|------|--------|
| V131-AOC-01 | `lib/inferenceChainLogger.js`   | ✅ V131 |
| V131-AOC-02 | `lib/translationChainSigner.js` | ✅ V131 |
| V131-AOC-03 | `lib/sovereignAILedger.js`      | ✅ V131 |
| V131-AOC-04 | `apps/web/.../sovereign/page.jsx` | ✅ V132 |
| V131-AOC-05 → V132-AVC-01 | `lib/aiValidatorConsensus.js` | ✅ V132 |
