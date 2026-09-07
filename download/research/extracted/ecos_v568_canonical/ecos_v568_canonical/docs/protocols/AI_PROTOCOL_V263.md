# ECOS AI Protocol — V263

**Version:** 263.0.0  
**Date:** 2026-06-01  
**Status:** Canonical  
**Sacred files (MD5 must not change):**
- `lib/fiatLedger.js` — MD5: `563e9b1f…`
- `lib/auditLog.js`   — MD5: `e5a5c2c2…`

---

## Iron Rules (carry forward from V262)

1. **All new identifiers MUST end in `263`** (classes, functions, constants, file names)
2. **Zero new npm dependencies** — Node.js built-ins only
3. **Sacred files are NEVER touched** — `lib/fiatLedger.js`, `lib/auditLog.js`
4. **Every `src/lib/*263.js` MUST have an identical copy in `lib/*263.js`**
5. **No endpoint removal** — additive-only API surface
6. **Root dir: `ecos_v263_canonical/`**
7. **Package version: `263.0.0`**
8. **40/40/20 split operates ONLY on realized value** — never on unbacked credit

---

## Economy Constants

```js
MICROCENTS_PER_CREDIT_263 = 10_000n    // 1 ⊙ = 10,000 μ¢ = 1 USD
RESERVE_PEG_263           = 10_000n    // peg constant (same as above)
REWARD_SOURCES_263        = ['externalRevenue', 'sinkBurn', 'reserveYield']
```

**Accounting invariant (enforced in `creditReserve263.js`):**
```
Σ credits_outstanding ≤ reserve_balance / peg
```
Credits are contract liabilities (ASC 606) until consumed. Never minted from nothing.

**40/40/20 revenue split (realized value only):**
- 40% → executor
- 40% → platform
- 20% → connectors / validator pool

---

## V263 Modules (New Seeds)

| File | Purpose | Key Invariant |
|------|---------|---------------|
| `src/lib/creditReserve263.js` | Reserve accounting | outstanding ≤ reserve |
| `src/lib/breakageEngine263.js` | ASC 606 breakage | >180 days + <5% redemption |
| `src/lib/conversionGateway263.js` | Credit↔USDC gateway | Rate-limited (10/hr), reserve-checked |
| `src/lib/reputationLedger263.js` | Non-transferable rep | SBT-style, no ERC-20, vestingMonths≥12 |
| `src/lib/sybilGuard263.js` | Sybil graph defence | Self-report amnesty 15%, ring detection |
| `src/lib/injectionFirewall263.js` | Prompt injection defence | OWASP LLM01, HARD BLOCK on sacred files |
| `src/lib/memoryIntegrity263.js` | Memory poisoning defence | SHA-256 signed writes, quarantine, rollback |
| `src/lib/reflectionLoop263.js` | Execution-based verification | Proposer→Critic, max 3 retries, HITL escalation |
| `src/lib/metacognition263.js` | Meta-memory + strategy | Ebbinghaus decay, strategy success tracking |
| `src/lib/costAwareRouter263.js` | Quality-aware LLM routing | SLM first, frontier on escalation, semantic cache |
| `src/lib/agentReceipts263.js` | Mandate chain receipts | THE MOAT: SHA-256 chain, written to auditLog |
| `src/lib/splitModule263.js` | Revenue splitting | 0xSplits-style, waterfall, vesting |
| `src/lib/tipModule263.js` | "Energy" tipping | Epoch model, sybil-checked, diminishing returns |
| `src/lib/quadraticFunding263.js` | CLR quadratic matching | Gitcoin CLR formula, sybil-gated |
| `src/lib/onboardingFlow263.js` | 60-sec onboarding | No crypto words, chat-first |
| `src/lib/offlineQueue263.js` | Offline action queue | X-ECOS-Offline header, auto-replay |
| `src/lib/telemetry263.js` | OTel GenAI spans | gen_ai.* semantic conventions |
| `src/middleware/x402263.js` | x402 V2 middleware | Coinbase micropayment headers |

---

## New API Endpoints (V263 — Additive Only)

### Credit & Reserve
```
GET  /api/v1/credit/backing-ratio          — public transparency metric
POST /api/v1/credit/redeem                 — reserve-checked redemption
POST /api/v1/credit/deposit                — add to reserve
POST /api/v1/credit/breakage-scan          — ASC 606 breakage scan
```

### Reputation
```
POST /api/v1/rep/attest                    — peer/system attestation (sybil-checked)
GET  /api/v1/rep/standing/:userId          — chat-surfaced standing
```

### Sybil Guard
```
POST /api/v1/sybil/self-report             — self-report amnesty (15% retention)
GET  /api/v1/sybil/evaluate/:userId        — current sybil verdict
```

### Agent Receipts (THE MOAT)
```
POST /api/v1/missions/:id/receipt/init     — initialize mandate chain
GET  /api/v1/missions/:id/receipt          — full mandate chain
GET  /api/v1/missions/:id/receipt/verify   — independent chain verification
GET  /api/v1/receipts                      — list recent receipts
```

### Collaboration & Splits
```
POST /api/v1/collab/create                 — create split table
GET  /api/v1/collab/:id                    — view split + vesting status
POST /api/v1/collab/:id/distribute         — distribute amount through split
```

### Tips / Energy
```
POST /api/v1/tip                           — credit tip (sybil-checked)
GET  /api/v1/tip/epoch/:userId             — current epoch energy stats
```

### Quadratic Funding
```
POST /api/v1/fund/quadratic/rounds         — create funding round
POST /api/v1/fund/quadratic/:roundId       — contribute to round
GET  /api/v1/fund/quadratic/:roundId       — round stats + projected match
POST /api/v1/fund/quadratic/:roundId/finalize — finalize and compute CLR match
```

### Onboarding
```
GET  /api/v1/onboarding/flow263/:userId    — current step + next action
POST /api/v1/onboarding/flow263/:userId/start       — start flow
POST /api/v1/onboarding/flow263/:userId/step/:stepId — complete step
```

### Offline Queue
```
POST /api/v1/offline/replay/:userId        — replay queued offline actions
GET  /api/v1/offline/queue/:userId         — view queue
```

### Observability
```
GET  /api/v1/metrics/agents263             — full agent metrics dashboard
```

### Security (admin)
```
POST /api/v1/security/memory-integrity/quarantine — quarantine memory entry
POST /api/v1/security/memory-integrity/rollback   — rollback memory to timestamp
```

---

## Threat Model (V263 additions)

| Threat | Mitigation | Module |
|--------|-----------|--------|
| Prompt injection (OWASP LLM01) | Untrusted tagging, instruction/data separation, output egress filter | `injectionFirewall263` |
| Memory poisoning | SHA-256 signed writes, quarantine, rollback | `memoryIntegrity263` |
| Sybil attacks on tips/attestations | Graph clustering, circular ring detection, amnesty | `sybilGuard263` |
| Credit over-issuance / fractional reserve | Strict Σ outstanding ≤ reserve invariant | `creditReserve263` |
| Sacred file modification | HARD BLOCK before any file op | `injectionFirewall263` |
| Agent mandate repudiation | SHA-256 chained receipts written to sacred auditLog | `agentReceipts263` |

---

## Feature Flags

```
TRADABLE_TOKEN_ENABLED=false    # MUST remain false until governance vote
```

---

## Vesting Policy

ALL credit and reputation rewards vest over minimum 12 months.  
No immediate full grant. `sybilGuard263.enforceVesting263()` enforced everywhere.

---

## Test Command
```bash
NODE_ENV=test node tests/v263.test.js
```

---

## V263 Module Dependency Graph
```
agentRuntime ─→ reflectionLoop263 ─→ metacognition263
agentRuntime ─→ agentReceipts263  ─→ auditLog (sacred)
agentRuntime ─→ costAwareRouter263 ─→ intelligenceRegistry
              ─→ injectionFirewall263 ─→ dangerousToolInterlock240
creditSystem  ─→ creditReserve263 ─→ breakageEngine263
                                  ─→ conversionGateway263
              ─→ reputationLedger263 ─→ sybilGuard263
              ─→ splitModule263
              ─→ tipModule263 ─→ sybilGuard263
              ─→ quadraticFunding263 ─→ sybilGuard263
vectorMemory242 ─→ memoryIntegrity263
```
