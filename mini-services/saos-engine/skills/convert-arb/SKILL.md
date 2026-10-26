---
name: convert-arb
description: "SBD→STEEM conversion rail with a measured implied-price edge — bytes chain-verified (requestid-before-amount), every broadcast preflight-verified read-only against the chain (fail-closed on a chain verdict, fail-open on infrastructure). Use when routing settled SBD through the 3.5-day convert window. Triggers — convert, conversion, sbd, arb, preflight"
triggers: convert, conversion, sbd, arbitrage, preflight, settle
laws: preflight-auth-fail-closed, serializer-byte-truth, dust-or-cap, transport-proven-block-110101210
verification: state/convert-plan.json + exec-log txids + frozen-byte selftest vectors
when-not-to-use: never converts below the dust threshold, never broadcasts a tx the chain itself refused to verify read-only
---
# Convert rail

The rail that had NEVER executed while reporting itself healthy — killed,
byte-proven, and gated by PREFLIGHT-AUTH. First real convert landed block
110101210; the router routes settled SBD through it after the payout flip.
