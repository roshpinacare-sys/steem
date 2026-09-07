# v32.12 External Qualification Kits

Six fail-closed execution kits are provided. Included fixtures are synthetic and cannot satisfy production policy.

## Authoritative trust flow

The verification document is intentionally untrusted and may contain only `schemaVersion`, `documentId` and the six evidence bundles. Trust does **not** come from that document. The verifier requires five independent input classes:

1. An out-of-band pinned trust anchor.
2. A root-signed, time-bounded trust bundle that binds the exact policy and actor authorizations.
3. A filesystem evidence root from which raw bytes are independently read and hashed.
4. A verifier-owned replay/checkpoint state protected by exclusive locking and atomic writes.
5. The verifier's own system clock.

Production policy requires exactly all six gates, `independent-organization` execution and a witness. Diagnostic subsets may be tested but can never become production eligible.

```bash
node scripts/verify-external-qualification-v32_12.mjs \
  <verification-document.json> \
  <trust-anchor.json> \
  <signed-trust-bundle.json> \
  <evidence-root> \
  <replay-state.json> \
  <verdict.json>
```

The local replay-state hash chain detects modification but cannot alone detect rollback to a previously valid state copied from another host. Cross-host rollback resistance remains dependent on the external monotonic-witness qualification or an equivalently protected monotonic store.
