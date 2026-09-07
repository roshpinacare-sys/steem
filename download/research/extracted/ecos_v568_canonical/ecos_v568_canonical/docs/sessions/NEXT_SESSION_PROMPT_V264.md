# NEXT SESSION BOOTSTRAP — ECOS V264

**Copy this entire section as your first message when opening a new session.**

---

## Context

You are working on ECOS — an AI-native economic operating system.
The current canonical version is **V264** (`ecos_v264_canonical/`).

## Iron Rules (NEVER violate)

1. All new identifiers end in the NEXT version number
2. Zero new npm dependencies (Node.js built-ins only)
3. **NEVER touch** `lib/fiatLedger.js` or `lib/auditLog.js` (sacred)
4. Every `src/lib/*NNN.js` MUST have an identical copy in `lib264/*NNN.js` (or `lib/*NNN.js` in packaging)
5. No endpoint removal — additive only
6. Package version must match the version number
7. 40/40/20 split operates ONLY on realized value (creditReserve assertion)
8. `TRADABLE_TOKEN_ENABLED=false` stays false until governance vote
9. Vesting: ALL rewards vest ≥ 12 months (`VESTING_MIN_DAYS = 365`)

## Sacred File Rule
- `lib/fiatLedger.js` and `lib/auditLog.js` must NEVER be modified
- The `injectionFirewall264` enforces a hard block on these files
- Check before ANY file write: `injectionFirewall264.checkSacredFile264(filename)`

## Economy
- 1 ⊙ = 10,000 μ¢ = 1 USD. Always BigInt.
- `SETTLE_EXCHANGE_RATE_264 = 10_000n`
- `RESERVE_PEG_264 = 10_000n`
- Accounting invariant: `Σ credits_outstanding ≤ reserve_balance` (both in μ¢)
- Backing ratio: `reserve_balance / outstanding ≥ 1.0`

## V264 Modules (completed seeds)
See `AI_PROTOCOL_V264.md` for the full list and `CHANGELOG_V264.md` for what changed.

## x402 Status in V264
- **V264 implements the FULL x402 V2 wire protocol** (V263 was a stub)
- `X402_TEST_MODE=1` → HMAC-SHA256 signature verification
- Production: Ed25519 via Coinbase CDP SDK (deferred — zero-dep constraint)
- Nonce replay protection: 5-min window, 100K nonce ring buffer
- `SETTLE_EXCHANGE_RATE_264 = 10_000n` (1 USDC = 10,000 μ¢)

## AP2 Mandate Chain Status in V264
- Full 7-step chain: INTENT → PLAN → ACTION → X402_PAYMENT → VERIFICATION → SPLIT → SETTLEMENT
- Cryptographic chain integrity (`verifyChain264`)
- AP2-compatible manifest export (`exportAP2Manifest264`)
- Mission-to-program linking

## 25 Execution Programs
See `AI_PROTOCOL_V264.md` for all 25 programs (P01–P25).
Programs P07, P15, P16, P18, P21, P24 are partially or fully planned but not yet implemented.

## Starting the next version (V265)

When starting V265, follow this checklist:
- [ ] Read `AI_PROTOCOL_V264.md` fully
- [ ] Run V264 test suite (`node tests/v264.test.cjs` from a CJS context)
- [ ] All 91 tests must pass before starting V265 work
- [ ] Identify what V264 is missing or what new research is available
- [ ] Create 80+ task plan ordered by criticality
- [ ] Rename all new identifiers to end in `265`
- [ ] Update `package.json` version to `265.0.0`
- [ ] Mirror all new `src/lib/*265.js` to `lib/*265.js`
- [ ] Update tests: `tests/v265.test.js`
- [ ] Package as `ecos_v265_canonical.zip`

## Key files to read first
- `AI_PROTOCOL_V264.md` — contracts and constants
- `CHANGELOG_V264.md` — what changed in V264
- `src/lib/creditReserve264.js` — reserve invariants
- `src/lib/agentReceipts264.js` — mandate chain (the moat)
- `src/lib/x402264.js` — full x402 V2 wire protocol
- `ecos-api-server-v264-patch.js` — how to wire V264 endpoints

## Node binary paths (if needed)
```
NODE=/nix/store/s7awkfc4pym4zj139fsxrjs5xwf5hhnd-nodejs-24.13.0-wrapped/bin/node
```

## IMPORTANT: CJS context for tests
The `artifacts/api-server/` package has `"type": "module"`.
Run V264 tests from a separate CJS-package directory:
```bash
mkdir /tmp/v264_test && cd /tmp/v264_test
cp -r /path/to/src/lib/*264.js ./src/lib/
# rename test to .cjs and fix require paths, then:
node v264.test.cjs
```

## Things to NOT forget for V265
- x402: Add `facilitator` field to PaymentPayload (Coinbase CDP spec update)
- MCP: Implement deep MCP server integration (P15)
- Embedded wallet: Zora/Privy wallet abstraction (P16)
- USSD/SMS: Full USSD session state machine (P18)
- Vesting: Add cliff period enforcement in V265 (partially in V264 `splitModule264`)
- Audit chain: Bloom filter for fast lookup of audit events (P07)
- Anti-dump: Velocity-sensitive vesting acceleration detection (P21)
- Onboarding: Funnel analytics (P24) — track conversion at each step

## Known issues to address in V265
- `onboardingFlow264`: Session persists only in-memory (add snapshot persistence)
- `costAwareRouter264`: Intelligence registry is optional — plug in real LLM registry
- `reflectionLoop264`: Sandbox execution is optional — plug in real sandbox
- `metacognition264`: Strategy decay may need calibration against real data
- `quadraticFunding264`: Full CLR matching requires verified contribution amounts
