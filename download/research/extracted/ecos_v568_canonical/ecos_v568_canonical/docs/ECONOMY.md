# ECOS Economy — V111 Sovereign Economy

## ECOS Credit Definition

**1 ⊙ (ECOS Credit) = 10,000 microcents (μ¢)**

The microcent is the smallest unit of account in ECOS. All arithmetic is done with BigInt — floating-point math is permanently off the table for monetary values.

```
1 USD   = 10,000 μ¢       (USD_SCALE = 10_000n)
1 ¢     =    100 μ¢       (CENT = 100n)
1 ⊙     = 10,000 μ¢       (CREDIT_SCALE = 10_000n)
1 USD   = 1 ⊙ exactly     (by design; 1 USD = 10,000 μ¢ = 1 Credit)
```

**Storage:** `lib/fiatLedger.js` (BigInt, immutable, MD5: `563e9b1f9e67091a5b6527c0a92568e5`)
**Display:** `lib/creditSystem.js` — converts BigInt microcents to float for display only
**Symbol:** ⊙ (U+2299, circled dot)

ECOS Credits are NOT a cryptocurrency. They are an internal accounting unit backed by real intellectual work performed within the ECOS system. Their value is backed by:
1. The cost of AI inference (tasks cost credits because inference costs compute)
2. The cost of human validation time (validators earn credits because verification has real value)
3. The utility of knowledge patches (royalties are paid because patches reduce future verification costs)

---

## The PaymentRail Model

ECOS separates the *internal economy* from *external money movement* using a pluggable PaymentRail abstraction.

### Two Layers

```
┌─────────────────────────────────────────────────────────┐
│                   INTERNAL ECONOMY                       │
│  ECOS Credits · fiatLedger.js · audit chain · royalties │
│  Always on. Works anywhere. No external provider.        │
└─────────────────────────────────────────────────────────┘
          ↑ deposit         withdraw ↓
┌─────────────────────────────────────────────────────────┐
│               PAYMENT RAILS (optional ramps)             │
│  ManualRail  │  BankTransferRail  │  StripeRail  │ ...  │
│  Always avail│  Always avail      │  STRIPE_KEY? │ stub │
└─────────────────────────────────────────────────────────┘
```

### Available Rails (V111)

| Rail | ID | Availability | Regions |
|------|----|-------------|---------|
| Manual / Admin Grant | `manual` | Always | Global |
| Bank Transfer | `bank` | Always | Global (incl. Israel) |
| Stripe | `stripe` | Only if `STRIPE_API_KEY` set | US, EU, GB, AU, CA |
| Crypto | `crypto` | Only if `ECOS_CRYPTO_ENABLED=true` | Stub — coming soon |

### ManualRail: The Sovereignty Guarantee

ManualRail is the rail that makes ECOS work *anywhere in the world with zero dependencies*:

- **deposit()**: An admin or the system directly credits an account in the ledger. Used for free-tier grants, bootstrapping, and manual reconciliation.
- **withdraw()**: Creates a `pending_manual` record that an operator fulfills offline (cash, bank transfer, anything).

This rail is always available. No API key. No external service. No geographic restriction. ECOS can run as a fully self-contained economy using ManualRail alone.

### BankTransferRail: Israel-First Design

Designed for regions where Stripe is unavailable or undesirable:

- **deposit()**: Generates a unique reference code and bank transfer instructions. Creates a `pending_bank` record. An operator confirms receipt → ManualRail grants the credits.
- **withdraw()**: Records payout instructions for an operator to execute via any local bank transfer.

Works with any Israeli bank (Bank Hapoalim, Bank Leumi, Discount Bank, etc.) or any bank globally.

---

## Why ECOS Is NOT Dependent on Stripe

Stripe became involved in V60-era ECOS as the default payment provider for deposits and payouts. The problem: **Stripe is not available in Israel**, and is unavailable or restricted in many other countries.

V111 makes Stripe *optional* by:

1. Implementing the PaymentRail abstraction (`lib/paymentRail.js`)
2. Wrapping Stripe in `StripeRail` — it only activates if `STRIPE_API_KEY` is set
3. Always registering `ManualRail` and `BankTransferRail` — these require no external provider
4. Moving all ledger credits to go through rails rather than calling Stripe directly

**Result:** A deployment with no `STRIPE_API_KEY` still has:
- Full internal economy (fiatLedger.js)
- Free-tier grants via ManualRail
- Bank transfer deposits via BankTransferRail
- Complete audit trail
- All validator earnings and royalties

Stripe is one ramp. It is no longer the only ramp.

---

## The 40/40/20 Split and Royalty Model in Credit Terms

When a task is resolved by human validation, the payment is split:

```
Task payment (in μ¢)
  40% → PLATFORM account   (sys::platform)
  40% → HITL VALIDATOR     (the human who resolved the task)
  20% → INSURANCE POOL     (sys::insurance_pool, for refunds/disputes)
```

**In credit terms** (1 ⊙ = 10,000 μ¢):
- A 5 ⊙ human validation task distributes:
  - 2 ⊙ to platform
  - 2 ⊙ to the validator
  - 1 ⊙ to insurance

**Royalty model:**
- Patch author royalty rate: **10%** of the task value when a patch is reused
- Source: deducted from the platform's 40% share (not from the validator's share)
- Mechanism: `royaltyTrigger.js` fires on task settlement when a patch match is found

**Example:** A patch is used in 1,000 tasks at 1 ⊙ each:
- Total task value: 1,000 ⊙
- Platform share (40%): 400 ⊙
- Royalty (10% of platform): 40 ⊙ → patch author
- Platform net: 360 ⊙

The patch author earns 40 ⊙ passively, without doing any additional work.

---

## Free-Tier Economics and Sustainability

**Per-user free-tier cost:** 100 ⊙ on signup = 1,000,000 μ¢ = equivalent to $0.10 at current internal pricing.

This is the customer acquisition cost — not paid in real money, but in compute capacity reserved for free users. The system can sustain this because:

1. **Not all free credits are used.** Many signups never fully consume their free tier.
2. **Free users validate.** Validators earn credits rather than consuming them, reducing net free-tier cost.
3. **Free users author patches.** Once a patch earns royalties, the author is economically positive.
4. **Monthly refresh is conditional.** The system can implement refresh gates (minimum activity) to prevent abuse.

**Sustainability threshold:**
The system is economically sustainable when: `(validations × 5 ⊙) + (royalty inflows) > (free tier grants + task compute costs)`

At sufficient scale, active validators and patch authors collectively generate more credit value than free-tier grants consume.

---

## The Path to Real-Money On/Off Ramps

V111 establishes the abstraction. The roadmap for real-money integration:

| Phase | What changes |
|-------|-------------|
| V111 | PaymentRail abstraction + ManualRail + BankTransferRail + StripeRail (if key) |
| V112 | Real bank transfer reconciliation flow with operator dashboard |
| V113 | Stripe fully wired for deposits + withdrawal via Stripe Connect |
| V114 | CryptoRail: USDC on Base or Polygon (low fees, stable value) |
| V115 | Cross-user credit transfers (P2P in the internal economy) |
| V116 | Credit-to-USD liquidity pool (community-backed) |

The key insight: **the internal economy can scale without real-money ramps.** Credits earned by validation and royalties are real value within the system, redeemable for AI compute. Real-money ramps add liquidity for those who want to cash out, but they are not required for the economy to function.
