# NEXT SESSION BOOTSTRAP — ECOS V263

**Copy this entire section as your first message when opening a new session.**

---

## Context

You are working on ECOS — an AI-native economic operating system.
The current canonical version is **V263** (`ecos_v263_canonical/`).

## Iron Rules (NEVER violate)

1. All new identifiers end in the NEXT version number
2. Zero new npm dependencies (Node.js built-ins only)
3. NEVER touch `lib/fiatLedger.js` or `lib/auditLog.js` (sacred)
4. Every `src/lib/*NNN.js` MUST have an identical copy in `lib/*NNN.js`
5. No endpoint removal — additive only
6. Package version must match the version number
7. 40/40/20 split operates ONLY on realized value (creditReserve assertion)

## Sacred File MD5s (NEVER change)
- `lib/fiatLedger.js` — MD5: `563e9b1f…`
- `lib/auditLog.js`   — MD5: `e5a5c2c2…`

## Economy
- 1 ⊙ = 10,000 μ¢ = 1 USD. Always BigInt.
- `MICROCENTS_PER_CREDIT_263 = 10_000n`
- Accounting invariant: `Σ credits_outstanding ≤ reserve_balance / peg`

## V263 Modules (completed seeds)
See `AI_PROTOCOL_V263.md` for the full list and `CHANGELOG_V263.md` for what changed.

## Starting the next version

When starting V264, follow this checklist:
- [ ] Read `AI_PROTOCOL_V263.md` fully
- [ ] Run `node tests/v263.test.js` — all tests must pass
- [ ] Identify what V263 is missing using the next research document
- [ ] Create a 80+ task plan ordered by criticality
- [ ] Rename all new identifiers to end in `264`
- [ ] Update package.json version to `264.0.0`
- [ ] Mirror all new `src/lib/*264.js` to `lib/*264.js`
- [ ] Update tests: `tests/v264.test.js`
- [ ] Package as `ecos_v264_canonical.zip`

## Key files to read first
- `AI_PROTOCOL_V263.md` — contracts and constants
- `CHANGELOG_V263.md` — what changed in V263
- `src/lib/creditReserve263.js` — reserve invariants
- `src/lib/agentReceipts263.js` — mandate chain (the moat)
- `ecos-api-server-v263-patch.js` — how to wire new endpoints

## Node/pnpm binary paths (if needed)
```
NODE=/nix/store/s7awkfc4pym4zj139fsxrjs5xwf5hhnd-nodejs-24.13.0-wrapped/bin/node
```

## Things to NOT forget
- Vesting: ALL rewards vest ≥ 12 months. No immediate grants.
- TRADABLE_TOKEN_ENABLED=false (must stay false until governance vote)
- Self-tip prevention in tipModule
- Circular ring detection in sybilGuard
- Sacred file HARD BLOCK in injectionFirewall
- x402 middleware is a STUB — needs full x402 V2 implementation in V264
- offlineQueue replay handlers need to be registered in the main server
