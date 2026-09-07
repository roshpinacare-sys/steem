# Claude Handoff — V33.26

Canonical base: V33.25. New source: `src/app/scanner-evidence-transparency-v33_26.ts`.

V33.26 adds exact-byte import of signed external scanner receipts, an append-only signed Merkle transparency log, inclusion proofs, full-prefix consistency witnesses, freshness SLAs, emergency feed revocation and an external pilot qualification verdict. The proof campaign uses two structurally complete synthetic receipts and must remain externally unqualified.

Do not claim live ClamAV/YARA, an external transparency service, RFC6962-succinct consistency, production authority or external effects. Preserve `productionPromotion: blocked` and keep G5 in progress.

Primary commands:

```bash
npm run proof:v33.26
npm run verify:proof:v33.26
npm run test:v33.26
npm run test:full:v33.26
npm run validate:v33.26
```
