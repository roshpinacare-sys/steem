---
name: catalog
description: "The offer rail — the machine sells its own measured capabilities on-chain (market-data feed, curation-boost performance share, rc-boost) with a memo-payment detector (SAOS-CATALOG:<sku>), idempotent scan, and typed honest orders (UNDERPAID / UNKNOWN-SKU never swallowed). Use when scanning for paid orders or publishing the catalog. Triggers — catalog, offer, sku, orders, payment, memo"
triggers: catalog, offer, sku, orders, payment, memo, sell
laws: on-chain-memo-payment-rail, in-scan-idempotency, honest-order-verbs, catalog-footer-distribution
verification: state/offer.json (catalog) + events + selftest vectors
when-not-to-use: never invents SKUs or prices, never acknowledges a payment that is not chain-visible, never promises delivery before the payment confirms
---
# Offer catalog

Distribution rides every daily transparency post. First paid order flips
the offer rail from armed to measured.
