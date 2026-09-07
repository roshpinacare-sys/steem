# ECOS Stablecoin Rails — Payment Layer Strategy
*V114 Research Integration, May 29, 2026*

## Why Stablecoin Rails (Not Traditional Wire)

| Metric | Stablecoin Rails | Traditional Wire |
|---|---|---|
| Settlement time | Minutes | 1-5 business days |
| Cross-border cost | <0.1% | 3-7% |
| Compliance bundled | Yes (Bridge, BVNK) | No |
| ISO 20022 compatible | Yes | Yes |
| Travel Rule handled | By partner | DIY |
| GENIUS Act compliant | Yes | N/A |

**Market validation (McKinsey/Artemis Analytics, Feb 18, 2026):**
- Total stablecoin payments: ~$390B annually
- B2B: ~$226B (60%), up 733% YoY
- "Stablecoins are now production-grade for B2B payments"

---

## Recommended Partners

**Bridge** (Stripe-owned) — Best for US-first expansion. KYC/AML + Travel Rule + FX + custody bundled.

**BVNK** — $30B annualized 2025, 2.3x YoY. One-third US market. Clients: Worldpay, Deel, Flywire. ISO 20022 compatible. Best for multi-region.

**Circle Payments Network (CPN)** — USDC native. GENIUS Act compliant. Best for developer-first.

**Cross River** — BaaS + stablecoin rails combined. Fiat + stablecoin hybrid.

**Tipalti** (as used by Roblox for DevEx) — 1099/tax forms for US validators. 190+ country payouts. KYC/AML included. Best model: ECOS keeps credits internal, Tipalti handles regulated last-mile.

---

## Phase-Gated Implementation

### Phase 0-1 (Current — V114)
- Credits closed-loop: earn, spend, transfer within ECOS only
- ManualRail and BankTransferRail only (offline reconciliation)
- FinCEN classification: closed-loop prepaid access, exempt from MSB registration
- ISO 20022 fields: captured in audit events but not transmitted externally

### Phase 2 (Trigger: first paying validator cohort established)
- Integrate Tipalti OR BVNK as payout partner
- ECOS passes clean ISO 20022-compatible structured data to partner
- Partner handles: KYC, AML, Travel Rule, tax forms, FX, local rails
- ECOS never holds or transmits fiat
- Technical trigger: `ECOS_PAYOUT_PARTNER=tipalti|bvnk|bridge` env var

### Phase 3 (Trigger: international validator network established)
- Multi-region: Circle CPN for USDC settlement
- Travel Rule: FATF R.16 compliance via partner
- GENIUS Act: US stablecoin issuer requirements met via Circle

---

## Compliance Architecture for Phase 2

When a validator requests cash-out:
1. ECOS debits validator's credit balance (internal ledger, BigInt math)
2. ECOS writes ISO 20022-compatible audit event with originator/beneficiary fields
3. ECOS calls payout partner API with structured data
4. Partner handles: KYC, AML, Travel Rule (>=3K USD / zero threshold EU), FX, local rails
5. Partner settles to validator's bank/wallet
6. ECOS receives confirmation webhook -> updates audit chain

**ECOS never touches regulated money. Partner is the MSB.**
