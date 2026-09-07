# v32.12 Handoff — Out-of-Band Trust and External Qualification Readiness

v32.12 is the authoritative local repair for two external-qualification proof failures.

First, the legacy v32.3 aggregate accepted unbound `PASS` objects. Second, the initial v32.12 verifier still accepted keys, policy, time, observations and replay claims from the same untrusted verification document. A controlled attacker-created document using new keys, a one-gate policy, a fabricated file observation and an invented evaluation time received `QUALIFIED` before this correction.

The authoritative components are:

- `src/qualification/external-qualification-integrity-v32_12.ts`
- `src/qualification/external-qualification-trust-v32_12.ts`
- `scripts/verify-external-qualification-v32_12.mjs`
- the four external-qualification schemas
- the six kits under `external-qualification/v32.12/`

The verification document is deliberately untrusted and contains only `schemaVersion`, `documentId` and `bundles`. Exact nested shape validation rejects signed fields that are not explicitly interpreted by the verifier. The verifier obtains trust from an out-of-band pinned root, validates a root-signed time-bounded trust bundle, uses its own clock, reads and hashes raw evidence from the filesystem, and advances a verifier-owned replay/checkpoint state under an exclusive lock and atomic write. A process removes the lock only when it successfully created that lock.

Production policy requires exactly all six gates, independent organizations and a witness. Root keys cannot be actor keys. Collector, reviewer and witness statements bind the exact release identity, real raw bytes, nonce and monotonic checkpoint. The targeted external-integrity mutation campaign contains 24 mutants, including removal of the verification-document shape boundary, and must report 24 authentic kills, zero survivors and zero invalid kills.

All kit fixtures remain synthetic and cannot satisfy production. No external gate has been executed locally. A local hash-chained replay state does not defeat privileged cross-host rollback; the independent monotonic-witness gate or equivalent protected monotonic storage remains mandatory. Production promotion is blocked until all six observed gates qualify and a separate authorized human promotion decision is recorded.

The full regression also corrected a weak signature-tampering test oracle: trailing Base64URL replacement could preserve decoded bytes. The test now performs a deterministic leading-character flip and must fail cryptographic verification.
