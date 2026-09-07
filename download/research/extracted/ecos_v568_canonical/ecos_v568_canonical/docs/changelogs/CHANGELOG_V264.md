# CHANGELOG_V264.md — ECOS V263 → V264

**Release Date**: 2026-06-01
**Version**: 264.0.0

---

## V264 Major Upgrades

### P13: x402 Full V2 Wire Protocol (`x402264.js`)
- **V263**: Stub implementation — just parsed/built headers
- **V264**: Full Coinbase x402 V2 wire protocol:
  - `NonceRegistry264`: replay protection with 5-min timestamp window + 100K nonce ring
  - `X402Processor264`: validates version, amount, nonce, signature; settles USDC→μ¢
  - HMAC-SHA256 test mode (`X402_TEST_MODE=1`); Ed25519 passthrough for production
  - `buildPaymentRequired264()`: proper `X-PAYMENT-REQUIRED` 402 response
  - Per-resource pricing registry
  - x402 receipts stored in `agentReceipts264`

### P14: AP2 Mandate Chain (`agentReceipts264.js`)
- **V263**: Basic intent/step recording
- **V264**: Full AP2-compatible mandate chain:
  - `emitX402Intent264()`: x402 payments emit into chain
  - `verifyChain264()`: cryptographic chain integrity check
  - `exportAP2Manifest264()`: AP2-compatible JSON export
  - `mobileReceipt264()`: compact mobile payload
  - Mission-to-program linking

### P03: Multi-Dimensional Reputation (`reputationLedger264.js`)
- **V263**: Single scalar score
- **V264**: Per-dimension tracks: `peer_review`, `mission_complete`, `tip_received`, etc.
  - Ebbinghaus temporal decay (90-day half-life)
  - Anti-collusion: DFS graph cycle detection
  - Selective disclosure: reveal only consented dimensions
  - Program-level aggregate reputation

### P04: Composite Sybil Scoring (`sybilGuard264.js`)
- **V263**: Basic tip graph + circular ring detection
- **V264**: Multi-signal composite score:
  - Behavioral velocity detection (60 actions/minute limit)
  - Device fingerprint clustering (anonymous hash-based)
  - Graduated verdicts: `ALLOW / WARN / THROTTLE / BLOCK`
  - Signal weights: `has_x402_payment`, `passed_velocity`, `has_peer_attestation`, etc.
  - Non-linear diminishing returns multiplier with compound penalty

### P01: Credit Reserve Hardening (`creditReserve264.js`)
- **V263**: Reserve + invariant + breakage
- **V264**: Added:
  - `depositX402264()`: x402 micro top-ups with provenance
  - Mandate-indexed issuance (every `issue264()` references a mandate)
  - Backing-ratio alert callbacks (`onAlert264()`)
  - Jurisdiction escheat flagging (US/EU/UK/IN/KE/NG)
  - Mobile compact status (`getMobileStatus264()`)

### P19: ASC 606 Breakage Engine (`breakageEngine264.js`)
- **V263**: Basic breakage scan
- **V264**: Added:
  - Proportional method breakage (redemption-pattern-matched)
  - Material right detection (no-expiry credits → separate accounting flag)
  - Jurisdiction-aware escheat flagging with per-jurisdiction thresholds
  - Breakage reserve accumulation

### P22: Security Hardening (`injectionFirewall264.js`)
- **CVE-2025-32711** (EchoLeak): Zero-width character detection and stripping
- **CVE-2025-53773** (YOLO mode): Mode-override/jailbreak pattern detection
- Output egress rate limiting per user/session
- Memory context isolation (untrusted tagging + safe prompt builder)
- Tool permission enforcement registry
- Sacred file check extended with full path variants

### P06: Memory Integrity (`memoryIntegrity264.js`)
- **V263**: Basic sign/verify
- **V264**: Added:
  - Multi-scope isolation: `system / user / agent / retrieval / external`
  - Temporal TTL expiry with auto-quarantine
  - Program-scoped rollback (`rollbackProgram264()`)
  - Provenance chain: parent entry hash links
  - Scope index for fast retrieval

### P05: Reflection Loop (`reflectionLoop264.js`)
- **V263**: Basic retry loop
- **V264**: Added:
  - Decorrelated Proposer/Critic roles
  - Sandbox execution verification gate
  - Program-aware context (missions inherit program context)
  - Streaming callback support
  - Metacognition integration for strategy selection
  - HITL escalation after retry exhaustion

### P23: Cost-Aware Router (`costAwareRouter264.js`)
- **V263**: Per-mission budget
- **V264**: Added:
  - Program-level budget pooling (all missions in program share cap)
  - Per-mission and per-program cost breakdown reports
  - SLM cascade: haiku → sonnet → opus based on confidence threshold
  - Adaptive complexity estimation

### P08: Collaboration Economy (`splitModule264.js`)
- **V264**: Added:
  - `applyPrimarysplit264()`: canonical 40/40/20 with reserve assertion
  - Vesting schedule enforcement with cliff period
  - Mobile compact split payload (`getMobileSplit264()`)
  - Waterfall v2: overflow logic

### P09: Energy/Tipping (`tipModule264.js`)
- **V264**: Added:
  - Multi-channel tips: `chat / telegram / mobile / sms / ussd / api`
  - Community pool matching (10% platform match)
  - Epoch leaderboard by received tips
  - AP2 receipt integration

### P11: Mobile-First Onboarding (`onboardingFlow264.js`)
- **V264**: Added:
  - Telegram TMA fast path (pre-authenticated, skips identity step)
  - USSD/SMS degraded path for feature phones
  - Extended zero-crypto-words list (30 terms)
  - 60-second target (4-step flow with per-step timing)

### P17: Offline Queue (`offlineQueue264.js`)
- **V264**: Added:
  - Priority queuing: `CRITICAL / NORMAL / LOW`
  - Conflict detection (duplicate method+path detection)
  - Batch replay with partial success reporting
  - `X-ECOS-Priority` header support

### P12: Telemetry (`telemetry264.js`)
- **V264**: Added:
  - Program-level metrics rollup
  - x402 payment telemetry
  - Mobile compact metrics payload
  - Backing ratio alert span emission

### New: Execution Programs (`executionPrograms264.js`)
- **NEW in V264**: Registry of all 25 execution programs
- Program lifecycle: `planned → in_progress → complete / blocked`
- Budget pool integration with `costAwareRouter264`
- Program→mission indexing

---

## API Surface

- **+75 new endpoints** under `/api/v1/*`
- Zero endpoints removed (additive only)
- All V263 endpoints remain at their original paths

---

## Test Results

```
91 tests, 0 failures
Sections: A (Credit Reserve) · B (Breakage) · C (Conversion) · D (Reputation)
          E (Sybil) · F (Firewall) · G (Memory) · H (Receipts) · I (Splits)
          J (Tips) · K (x402) · L (Programs) · M (Onboarding) · N (Queue)
          O (Telemetry) · P (Metacognition) · Q (QF) · R (Reflection)
```

---

## What Did NOT Change

- `lib/fiatLedger.js` — untouched (sacred)
- `lib/auditLog.js` — untouched (sacred)
- All V263 endpoints — untouched (additive only)
- `TRADABLE_TOKEN_ENABLED` — remains `false`
- Economy constants — same as V263 (1 ⊙ = 10,000 μ¢ = 1 USD)
