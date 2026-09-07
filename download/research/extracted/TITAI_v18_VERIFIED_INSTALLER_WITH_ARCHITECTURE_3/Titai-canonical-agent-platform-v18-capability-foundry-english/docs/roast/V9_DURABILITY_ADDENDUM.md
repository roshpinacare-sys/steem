# v9 Roast Addendum: Durable Execution Proof

**Date:** 2026-07-10  
**Baseline:** `ROAST_REPORT.md` remains the full v8 adversarial audit.  
**Scope of this addendum:** the first high-priority durability and recovery slice.

## Status changes

| Finding | Previous | v9 status | What changed | What remains |
|---|---|---|---|---|
| F-002 — side-effect idempotency | Open | Partially mitigated | Portable receipts, crash injection, lease expiry, replay without duplicate effect, ambiguous-effect reconciliation | Production SQLite transaction, event outbox, audit binding, runner migration |
| F-006 — backup and restore | Open | Partially mitigated | Versioned encrypted snapshot, authenticated decryption, integrity hash, clean-store restore proof | Full application dataset, key custody, native SQLite backup, clean-machine application drill |

The total finding registry remains 50 findings. Current machine-readable status:

- Fixed in v8: 13.
- Partially mitigated: 7.
- Open: 28.
- Environment blocked: 2.

## Proven behavior

The v9 proof intentionally crashed the first worker after an artifact side effect
succeeded and its completed receipt was persisted, but before the workflow
checkpoint advanced. After lease expiry, a second worker resumed the job. The
external side-effect count remained one.

The completed store was encrypted with AES-256-GCM using a scrypt-derived key,
restored into a new store, and checked by a verifier whose identity differed from
the builder.

## Commands

```bash
npm run test:durable
npm run durable:prove
npm run durable:safe
```

## Evidence

- `docs/canonical/evidence/durable-vertical-slice.json`
- `docs/canonical/evidence/durable-vertical-slice.md`
- `docs/canonical/25_DURABLE_EXECUTION_VERTICAL_SLICE.md`
- `docs/canonical/decisions/ADR-0020-portable-durable-execution-core.md`

## Release interpretation

This addendum does not change the v8 production verdict. The portable core is
proven, but the main application runner remains process-local until DUR-002 and
DUR-003 are implemented and independently verified.
