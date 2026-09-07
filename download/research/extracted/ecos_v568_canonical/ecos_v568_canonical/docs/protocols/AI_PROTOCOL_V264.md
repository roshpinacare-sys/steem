# AI_PROTOCOL_V264.md — ECOS Economic Operating System V264

> **Canonical source of truth for all V264 contracts, constants, and invariants.**
> Read this before making any changes to V264 modules.

---

## Iron Rules (NEVER violate)

1. All new identifiers end in `264`
2. Zero new npm dependencies (Node.js built-ins only: `node:crypto`, `node:crypto`, etc.)
3. **NEVER touch** `lib/fiatLedger.js` or `lib/auditLog.js` (sacred files)
4. Every `src/lib/*264.js` MUST have an identical copy in `lib264/*264.js`
5. No endpoint removal — additive only
6. Package version must be `264.0.0`
7. 40/40/20 split operates ONLY on realized value (creditReserve264 assertion)
8. `TRADABLE_TOKEN_ENABLED=false` stays false until governance vote
9. Vesting: ALL rewards vest ≥ 12 months (`VESTING_MIN_DAYS_264 = 365`)

---

## Economy

```
1 ⊙ = 10,000 μ¢ = 1 USD
SETTLE_EXCHANGE_RATE_264 = 10_000n  (used by x402264 for USDC→μ¢)
RESERVE_PEG_264          = 10_000n  (used by creditReserve264 invariant)
```

All monetary values are `BigInt` in μ¢. Never use floating-point for accounting.

### Accounting Invariant
```
Σ credits_outstanding ≤ reserve_balance  (NO peg division — both in μ¢)
backing_ratio = reserve_balance / outstanding  (must be ≥ 1.0)
```

### 40/40/20 Split
```
executor    40%  (BPS 4,000)
platform    40%  (BPS 4,000)
connectors  20%  (BPS 2,000)
```
Only applies to **realized value** (reserve-asserted). Never applied to unbacked credit.

---

## Sacred Files

```
lib/fiatLedger.js    — double-entry fiat ledger (NEVER modify)
lib/auditLog.js      — append-only audit log (NEVER modify)
```

The `injectionFirewall264` hard-blocks any agent or prompt that attempts to touch these files.

---

## V264 Module Inventory

| Module | File | Key Exports | Program |
|---|---|---|---|
| Credit Reserve | `creditReserve264.js` | `CreditReserve264`, `defaultCreditReserve264` | P01 |
| Breakage Engine | `breakageEngine264.js` | `BreakageEngine264`, `defaultBreakageEngine264` | P19 |
| Conversion Gateway | `conversionGateway264.js` | `ConversionGateway264`, `defaultConversionGateway264` | P01 |
| x402 Protocol | `x402264.js` | `X402Processor264`, `x402Middleware264` | P13 |
| Agent Receipts | `agentReceipts264.js` | `AgentReceipts264`, `defaultAgentReceipts264` | P14 |
| Reputation Ledger | `reputationLedger264.js` | `ReputationLedger264`, `defaultReputationLedger264` | P03 |
| Sybil Guard | `sybilGuard264.js` | `SybilGuard264`, `defaultSybilGuard264` | P04 |
| Split Module | `splitModule264.js` | `SplitModule264`, `defaultSplitModule264` | P08 |
| Tip Module | `tipModule264.js` | `TipModule264`, `defaultTipModule264` | P09 |
| Quadratic Funding | `quadraticFunding264.js` | `QuadraticFunding264`, `defaultQuadraticFunding264` | P20 |
| Injection Firewall | `injectionFirewall264.js` | `InjectionFirewall264`, `defaultInjectionFirewall264` | P22 |
| Memory Integrity | `memoryIntegrity264.js` | `MemoryIntegrity264`, `defaultMemoryIntegrity264` | P06 |
| Reflection Loop | `reflectionLoop264.js` | `ReflectionLoop264`, `defaultReflectionLoop264` | P05 |
| Metacognition | `metacognition264.js` | `Metacognition264`, `defaultMetacognition264` | P05 |
| Cost-Aware Router | `costAwareRouter264.js` | `CostAwareRouter264`, `defaultCostAwareRouter264` | P23 |
| Onboarding Flow | `onboardingFlow264.js` | `OnboardingFlow264` | P11 |
| Offline Queue | `offlineQueue264.js` | `OfflineQueue264`, `defaultOfflineQueue264` | P17 |
| Telemetry | `telemetry264.js` | `Telemetry264`, `defaultTelemetry264` | P12 |
| Execution Programs | `executionPrograms264.js` | `ExecutionProgramRegistry264`, `PROGRAMS_264` | all |

---

## x402 V2 Wire Protocol

V264 implements the **full x402 V2 wire protocol** (V263 was a stub).

```
Headers:
  X-Payment:          base64url(JSON PaymentPayload)
  X-Payment-Response: base64url(JSON PaymentResponse)
  X-Payment-Required: base64url(JSON PaymentRequired) — sent with 402

PaymentPayload:
{
  version:   "2",
  network:   "base",
  currency:  "USDC",
  from:      "0x...",
  to:        "0x...",
  amount:    0.001,       // in USDC
  resource:  "/api/v1/...",
  nonce:     "uuid",
  timestamp: 1748000000000,
  signature: "hmac-sha256-hex"  // test mode; Ed25519 in production
}
```

### Security
- **Replay protection**: nonce registry + ±5min timestamp window
- **Test mode**: `X402_TEST_MODE=1` → HMAC-SHA256 with `X402_HMAC_SECRET`
- **Production**: Ed25519 verification deferred to payment network (CDP SDK)
- **Amount check**: must meet or exceed advertised price per resource

---

## AP2 Mandate Chain

Every agent mission produces a cryptographic receipt chain:

```
INTENT → PLAN → ACTION → X402_PAYMENT → VERIFICATION → SPLIT → SETTLEMENT
```

Each step hashes its content + the previous step's hash, creating an append-only chain. `verifyChain264()` checks integrity.

---

## 25 Execution Programs

```
P01  Credit Infrastructure Hardening       economic
P02  Economic Invariant Enforcement        economic
P03  Reputation Engine                     social
P04  Sybil Defense Network                 security
P05  Agent Reflection Framework            agent
P06  Memory Integrity Layer                agent
P07  Audit Chain Expansion                 audit
P08  Collaboration Economy                 social
P09  Energy/Tipping Network                social
P10  Intelligence Routing                  agent
P11  Mobile-First UX                       ux
P12  Observability Platform                infra
P13  x402 Payment Rails                    payments
P14  AP2 Mandate Chain                     payments
P15  MCP Deep Integration                  agent
P16  Embedded Wallet Layer                 payments
P17  Offline-Tolerant Queue                ux
P18  USSD/SMS Degraded Path               ux
P19  Breakage & Escheat Compliance         economic
P20  Quadratic & Retroactive Funding       social
P21  Vesting & Anti-Dump Controls          economic
P22  Injection & Egress Security           security
P23  Cost-Aware SLM Cascade                agent
P24  Onboarding Funnel Analytics           ux
P25  Credit Backing Transparency           economic
```

---

## Security Hardening (V264 CVE Defenses)

| CVE | Name | Defense |
|---|---|---|
| CVE-2025-32711 | EchoLeak | Zero-width char stripping in `injectionFirewall264.analyzeInput264()` |
| CVE-2025-53773 | YOLO Mode | Mode-override pattern detection + prompt sanitization |

---

## API Endpoints (V264 additions)

All V264 endpoints are under `/api/v1/...` with `/v264/` segment. Full list in `ecos-api-server-v264-patch.js`.

Key groupings:
- `/api/v1/x402/*` — x402 payment protocol
- `/api/v1/programs/*` — 25 execution programs
- `/api/v1/credit/v264/*` — credit reserve + breakage + conversion
- `/api/v1/rep/v264/*` — reputation ledger
- `/api/v1/sybil/v264/*` — sybil guard
- `/api/v1/receipts/v264/*` — AP2 mandate chain
- `/api/v1/collab/v264/*` — splits + vesting
- `/api/v1/tip/v264/*` — tipping + leaderboard
- `/api/v1/fund/v264/*` — quadratic + retroactive funding
- `/api/v1/onboarding/v264/*` — onboarding (USSD/SMS/Telegram)
- `/api/v1/offline/v264/*` — offline queue
- `/api/v1/security/v264/*` — firewall + memory integrity
- `/api/v1/metrics/v264/*` — observability
- `/api/v1/agent/v264/*` — reflection + metacognition
- `/api/v1/version/v264` — version info

---

## Test Suite

```bash
# Run from a CJS context (api-server package has "type": "module")
node tests/v264.test.cjs     # if renamed
# or run from a separate CJS package directory
```

91 tests, 16 sections (A–R), covering all V264 modules.
