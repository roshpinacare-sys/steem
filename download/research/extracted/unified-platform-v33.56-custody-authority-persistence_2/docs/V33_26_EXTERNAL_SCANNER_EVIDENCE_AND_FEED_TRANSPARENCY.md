# V33.26 — External Scanner Evidence Import and Feed Transparency

V33.26 introduces an evidence-bounded import and transparency layer for externally produced ClamAV and YARA receipts. It verifies exact supporting artifact bytes, signs import receipts, appends feed checkpoints and receipt digests to an append-only Merkle log, and produces inclusion plus full-prefix consistency witnesses for an independent verifier.

## Security boundaries

- Scanner, importer, transparency-entry, checkpoint, challenge, emergency-revocation and verifier identities are separated.
- Receipts bind engine output, command output, package manifest and signature-database metadata bytes.
- Receipt and signature-database freshness are mandatory.
- Package/feed disagreement, scanner-result disagreement, missing proofs and emergency revocation fail closed.
- Synthetic receipts can test the contract but cannot qualify an external pilot.
- The consistency witness is a complete prefix witness. It is not claimed to be a succinct RFC6962 proof.
- Production authority and external effects remain zero.

## Remaining external work

Run real ClamAV and YARA on independent hosts and organizations, use an externally operated transparency service, pin its signing keys out of band, import real receipt artifacts, and obtain an independent verifier verdict. Even a passing subgate permits a controlled pilot only.
