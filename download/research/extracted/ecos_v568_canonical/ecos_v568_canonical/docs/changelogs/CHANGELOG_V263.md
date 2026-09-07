# CHANGELOG — ECOS V263

**Date:** 2026-06-01  
**Base:** V262 (1,275 files, unmodified)  
**Added:** 18 new library files, 1 middleware, 1 patch file, 1 test suite, 3 protocol documents  
**Modified:** `package.json` version → 263.0.0

---

## New Modules (V263 Seeds)

### Credit & Reserve (Research Section B)

#### `src/lib/creditReserve263.js` + `lib/creditReserve263.js`
- Segregated USDC-equivalent reserve with BigInt accounting
- **Invariant:** `Σ credits_outstanding ≤ reserve_balance` (enforced on every issuance)
- `depositReserve263()`, `issue263()`, `consume263()`, `redeem263()`
- `assertRealizedValue263()` — 40/40/20 split guard (backing ratio must be ≥ 1.0)
- `getStatus263()` — public backing ratio for transparency
- Source validation: only `externalRevenue | sinkBurn | reserveYield` (no fabrication)

#### `src/lib/breakageEngine263.js` + `lib/breakageEngine263.js`
- ASC 606 contract-liability breakage recognition
- Cohort model: daily issuance buckets
- Breakage recognized only when: ≥180 days old AND redemption rate <5%
- Proportional method (not pattern method)
- Escheat flag for >5-year-old unredeemed balances
- `runBreakageScan263()` — cron-safe, returns newly recognized breakage

#### `src/lib/conversionGateway263.js` + `lib/conversionGateway263.js`
- Rate-limited credit↔USDC conversion gateway (10 conversions/user/hour)
- Amount bounds: 10,000 μ¢ minimum, 100,000,000 μ¢ maximum
- Reserve-checked: `redeem263()` enforces reserve invariant before conversion
- User never sees gas/keys/blockchain

---

### Reputation (Research Section A)

#### `src/lib/reputationLedger263.js` + `lib/reputationLedger263.js`
- **SBT-style (Soulbound Token): non-transferable, non-tradable**
- `UserToken { userId, repScore(BigInt), attestations[], vestingSchedule, realizedFeeShare }`
- Rep events: `mission_completed(+50)`, `hitl_approved(+30)`, `peer_vouching(+20)`, `validator_endorsed(+40)`, `work_product(+60)`, `sybil_flagged(-200)`, `fake_vouching(-100)`
- Vesting: ≥12 months before any fee share realized
- Standing labels: `new → member → contributor → validator → steward → sovereign`
- `TRADABLE_TOKEN_ENABLED=false` by default (feature flag)
- Attestation ring buffer (1,000 per user, append-only)

---

### Sybil Defence (Research Section F)

#### `src/lib/sybilGuard263.js` + `lib/sybilGuard263.js`
- Graph-based behavioral clustering for tip/collab networks
- **Self-report amnesty:** self-reporters keep 15% of allocation (à la LayerZero)
- **Circular tip ring detection:** DFS on tip graph, rings ≥3 nodes flagged
- **Diminishing returns:** same eventType per user → reward multiplier 100%→20% over 5 events
- `enforceVesting263()` — all rewards must vest (no immediate full grants)
- 7-day epoch model (auto-rolls)

---

### Security (Research Section F)

#### `src/lib/injectionFirewall263.js` + `lib/injectionFirewall263.js`
- Defends against OWASP LLM01 (prompt injection, #1 threat Cisco 2026 report)
- `tagUntrusted263(content, sourceType)` — marks all external/tool content as [UNTRUSTED]
- `buildSafePrompt263(system, user, toolOutputs)` — instruction/data separation
- `filterEgress263(output)` — scans for API keys, passwords, PII, auth headers
- `checkToolPrivilege263(tool, agentPermissions)` — per-tool privilege scoping
- `assertNotSacred263(filePath)` — **HARD BLOCK** on fiatLedger.js / auditLog.js
- `inspectToolCall263()` — combines all checks in one call
- Integrates with `hitlGate.js` — injection-flagged content → mandatory HITL

#### `src/lib/memoryIntegrity263.js` + `lib/memoryIntegrity263.js`
- Defends against memory poisoning (OWASP Agentic ASI, Dec 2025)
- `signWrite263(content, provenance)` — SHA-256(content+timestamp) signed entry
- Provenance tagging: `{source, sourceType:'agent'|'user'|'tool'|'llm', verifiedAt}`
- `quarantine263(entryId, reason)` — marks entry untrusted, excludes from retrieval
- `rollback263(beforeTs)` — purges all entries created after timestamp
- `assertVerifiedSource263(provenance)` — rejects agent-hallucinated facts

---

### Agent Intelligence (Research Section D)

#### `src/lib/reflectionLoop263.js` + `lib/reflectionLoop263.js`
- Wraps agentRuntime DAG nodes with execution-based verification
- Ref: "Verify Before You Fix" (2025): 70.3% error self-correction rate
- Proposer/Critic role split (multi-agent reflexion pattern)
- Max 3 retries before HITL escalation
- Critique log: `{critique, outcome, taskType, strategy}` (ring buffer 5,000)
- `verifyCode263()` — runs code in sandboxExec225, feeds stderr back to agent

#### `src/lib/metacognition263.js` + `lib/metacognition263.js`
- Records strategy success rates per task type
- `suggestStrategy263(taskType)` — recommends best historical strategy
- Temporal tagging on vectorMemory entries: `{createdAt, accessedAt, decayFactor}`
- Ebbinghaus forgetting curve: `decay = 1/(1 + K*log(days+1))`, threshold 0.1
- Persists strategy data to `snapshotEngine.setExtra()`

#### `src/lib/costAwareRouter263.js` + `lib/costAwareRouter263.js`
- Quality-aware LLM routing: SLM → frontier escalation
- Complexity tiers: `low → [haiku,mini]`, `medium → [sonnet,gpt-4o-mini]`, `high → [opus,gpt-4o]`
- Per-mission budget cap enforcement
- Semantic caching: SHA-256 query hash, 1-hour TTL, 10,000 entry LRU
- SLM confidence check: if confidence <0.75 and complexity <high → escalate

#### `src/lib/agentReceipts263.js` + `lib/agentReceipts263.js`
- **THE MOAT**: AP2-style mandate chain for every mission
- Immutable chain: `SHA-256(prevHash + stepData + step + ts)` at every step
- Steps: `intent → plan → action → verification → split`
- Written to sacred `auditLog.append()` — non-repudiable
- `verifyReceipt263()` — anyone can independently verify chain integrity
- x402 payment intent stub: `emitX402Intent263()` records intent in chain

---

### Collaboration & Economics (Research Section C)

#### `src/lib/splitModule263.js` + `lib/splitModule263.js`
- 0xSplits-style revenue splitting with waterfall support
- Pro-rata by basis points (sum must = 10,000 bps = 100%)
- Waterfall mode: first recipient reimbursed in full before overflow
- Sub-split: executor's 40% can further sub-split to collaborators
- Backing check: `assertRealizedValue263()` before any distribution

#### `src/lib/tipModule263.js` + `lib/tipModule263.js`
- "Energy" tipping: non-cashable epoch allocation (100 points/user/7 days)
- Self-tip prevention; amount bounds 1,000–100,000 μ¢
- Sybil-checked via `sybilGuard263`: circular ring detection on tip graph
- Diminishing returns multiplier applied per epoch
- Community pool: energy points → share of platform reward pool

#### `src/lib/quadraticFunding263.js` + `lib/quadraticFunding263.js`
- Gitcoin CLR formula: `match = (Σ√contribution_i)² - Σ(contribution_i²)`
- Sybil-gated matching (only sybilGuard263-ALLOW users contribute)
- Matching pool from platform fee sink
- Round lifecycle: `open → finalized`

---

### UX & Mobile (Research Section E)

#### `src/lib/onboardingFlow263.js` + `lib/onboardingFlow263.js`
- 60-second, 4-step chat-first onboarding
- Steps: identity (15s) → first action (30s) → cost reveal (10s) → complete (5s)
- **No crypto words**: wallet/gas/seed/ERC/token/blockchain filtered out of all text
- `filterText263(text)` — removes 20+ crypto jargon terms
- Receipt shown immediately after first action (value before cost)
- Delegates identity to `authService`, completion to `onboardingEngine`

#### `src/lib/offlineQueue263.js` + `lib/offlineQueue263.js`
- Queue actions when `X-ECOS-Offline: true` header present
- 500-entry ring buffer per user
- 72-hour TTL (expired actions dropped on replay)
- `registerHandler263(pathPattern, handler)` — register replay handlers
- `replay263(userId)` — async replay all queued actions
- Express middleware: `middleware263()` — auto-intercepts offline requests

---

### Observability (Research Section D)

#### `src/lib/telemetry263.js` + `lib/telemetry263.js`
- OTel GenAI semantic conventions: `gen_ai.system`, `gen_ai.operation.name`, `gen_ai.request.model`
- `startSpan263()` — creates span with OTel-compatible attributes
- `recordLlmCall263()` — convenience wrapper for LLM call tracking
- Metrics: totalRequests, cacheHits, retries, fallbacks, totalCostMicro, byTaskType
- OTel SDK forwarding: if `opts.tracer` provided, forwards to real OTel backend
- `getDashboard263()` — GET /api/v1/metrics/agents263 data

---

### Middleware

#### `src/middleware/x402263.js` + `lib/x402263.js`
- Coinbase x402 V2 protocol stub
- `x402Middleware263(opts)` — Express middleware: parse X-PAYMENT header
- `parseX402Header263()` — base64-decoded PaymentPayload parser
- `buildX402Response263()` — builds X-PAYMENT-RESPONSE header
- Returns 402 when payment required and no header present
- Records payment intent in `agentReceipts263` when missionId present
- **Status: STUB** — needs full x402 V2 wire protocol in V264

---

### Server Patch & Tests

#### `ecos-api-server-v263-patch.js`
- Registers all 30+ new V263 endpoints on the Express app
- `applyV263Patch(app, deps)` — call once at server startup
- Wires offline queue middleware first, then all routes
- Includes admin security endpoints (quarantine, rollback)

#### `tests/v263.test.js`
- 50 tests across all V263 modules (A–Q sections)
- Zero external deps; runs with: `NODE_ENV=test node tests/v263.test.js`
- Tests: invariant violations, edge cases, async retry behavior, chain verification

---

## Files Modified from V262

### `package.json`
- `version`: `262.0.0` → `263.0.0`

---

## Mirror Map (src/lib → lib)

All new `src/lib/*263.js` files are mirrored to `lib/*263.js`:
```
src/lib/creditReserve263.js     → lib/creditReserve263.js
src/lib/breakageEngine263.js    → lib/breakageEngine263.js
src/lib/conversionGateway263.js → lib/conversionGateway263.js
src/lib/reputationLedger263.js  → lib/reputationLedger263.js
src/lib/sybilGuard263.js        → lib/sybilGuard263.js
src/lib/injectionFirewall263.js → lib/injectionFirewall263.js
src/lib/memoryIntegrity263.js   → lib/memoryIntegrity263.js
src/lib/reflectionLoop263.js    → lib/reflectionLoop263.js
src/lib/metacognition263.js     → lib/metacognition263.js
src/lib/costAwareRouter263.js   → lib/costAwareRouter263.js
src/lib/agentReceipts263.js     → lib/agentReceipts263.js
src/lib/splitModule263.js       → lib/splitModule263.js
src/lib/tipModule263.js         → lib/tipModule263.js
src/lib/quadraticFunding263.js  → lib/quadraticFunding263.js
src/lib/onboardingFlow263.js    → lib/onboardingFlow263.js
src/lib/offlineQueue263.js      → lib/offlineQueue263.js
src/lib/telemetry263.js         → lib/telemetry263.js
src/middleware/x402263.js       → lib/x402263.js
```
