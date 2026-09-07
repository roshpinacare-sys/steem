# QODO V24 — Audit Pass 74
**Version:** 24.30.47
**Date:** 2026-07-12
**Protocol:** CIEP-X v10.0
**Task:** task-55 (new) — Receipt lineage across relay hops (composability primitive)
**Type:** Code pass — one sacred file touched (`audit-log.ts`, additive), one non-sacred file extended (`receipt.ts`), one standalone script extended (`scripts/verify-receipt.mjs`), one new test file, docs updated.
**Baseline:** 24.30.46

---

## PASS 1 — Think before executing (AGENT-PRINCIPLES.md #1)

The originating question asked for an architecture making a false
verification claim structurally undetectable across stateless relay hops,
under: no new deps, stateless hops, self-contained artifact, tamper-
evidence (not just resistance), and composability across many hops without
trusting intermediate hops.

Before writing anything new: does this repo already have a mechanism that
gets most of the way there? Yes — `qodo.receipt/v1` (`docs/RECEIPTS.md`,
`services/receipt.ts`, `services/audit-log.ts`, `scripts/verify-receipt.mjs`)
already provides a hash-chained audit log, mutual receipt↔chain anchoring,
and an independent dependency-free verifier. Building a parallel mechanism
would have duplicated a well-tested, already-documented primitive.

What it does NOT do, checked directly in the code (not assumed from the
docs): every chain's genesis is hardcoded to `'0'.repeat(64)`
(`audit-log.ts:73`, `receipt.ts:170`, `verify-receipt.mjs:17` before this
pass), and there is no field anywhere in `AutonomyReceipt` linking one run's
receipt to a prior run's. So every hop's chain is a cryptographic island —
exactly the composability gap the question asks about, and the repo's own
`docs/RECEIPTS.md` threat-model section did not mention it at all (it only
flagged generation-time compromise and unsigned-receipt risk as open
items). This is a real, previously-undocumented gap, not a restatement of
an already-known limitation.

**Decision:** extend the existing receipt/audit-chain primitive with an
optional `lineage` block, rather than inventing a separate attestation
system. This is strictly additive — no existing call site, receipt, or
test changes behavior when lineage is absent.

**Scope cut, made explicitly:** wiring this into `cli.ts` so a relay hop
picks up its parent receipt automatically at pipeline start is a second,
separable change touching a second sacred file, and needs an owner
decision on the on-disk convention for a relay handoff artifact. Landing
that silently inside this pass would have been exactly the kind of
"exactly-one-task" scope creep AGENT-PRINCIPLES.md #1 exists to catch.
Filed as task-56 instead.

---

## PASS 2 — Implementation

| File | Change |
|---|---|
| `packages/agent/src/services/audit-log.ts` *(sacred)* | Added `defaultGenesis()` export and an optional 5th `genesis` parameter to `appendAuditEntry`, and an optional 2nd `genesis` parameter to `verifyAuditChain`. Both default to the prior hardcoded all-zero value — omitting the argument is byte-for-byte identical to the old behavior. |
| `packages/agent/src/services/receipt.ts` | Added optional `lineage: { hopIndex, parentReceiptSha256, genesis }` to `AutonomyReceipt`. Extended `verifyReceipt(receipt, opts)` with `opts.parentReceipt?: AutonomyReceipt`; added a `lineage` check that independently recomputes `receiptSha256(opts.parentReceipt)` and compares it to the claimed fields — never trusts the child's say-so. The recomputed hash also becomes the chain-walk's genesis (previously always the hardcoded constant). |
| `scripts/verify-receipt.mjs` | Mirrored the same logic for third-party, dependency-free verification: new `--parent-receipt <path>` flag, same recompute-don't-trust check, same genesis wiring into the chain walk. |
| `packages/agent/tests/receipt-lineage.test.ts` *(new)* | Regression check (no lineage → unaffected), honest two-hop case, tampered-parent detection case, no-parent-supplied (informational) case, and parent-supplied-but-no-lineage-claimed case. |
| `docs/RECEIPTS.md` | New "Lineage across relay hops" section; threat-model updated with the newly-detected case and the still-open gaps (generation-time compromise still bounds this, exactly as it already bounded signatures; automatic wiring not yet live — task-56). |
| `.sacred-manifest.json` | Rebaselined `audit-log.ts` entry (reviewed, intentional, additive change — see `bin/generate-sacred-manifest.ts`'s own doc comment on when re-baselining is correct). |

---

## PASS 3 — Verification

**What was actually executed, honestly reported (per the standing relay
rule: never claim a verification result without a real command):**

This sandbox has no network access, so `npm install` cannot run and
`node_modules` does not exist for this checkout — `vitest` and `tsc`
could **not** be run against the actual TypeScript sources in this pass.
That is a real limitation, stated plainly rather than worked around by
claiming an untested result.

What COULD be, and was, executed for real: the modified
`scripts/verify-receipt.mjs` is a standalone, dependency-free `.mjs` file
with no build step, so it runs directly under the `node` already present in
this sandbox. It was run four times against a hand-built two-hop fixture
pair (hop-1 receipt, hop-2 receipt + audit log, generated with the exact
`canonicalJson`/`sha256` algorithm the script itself uses):

```
$ node scripts/verify-receipt.mjs hop2-receipt.json --audit hop2-audit.ndjson --parent-receipt hop1-receipt.json
  ✓ lineage    hop 1 anchored to parent receipt eb8b5a63
  RECEIPT VALID ✓        (exit 0)

$ node scripts/verify-receipt.mjs hop2-receipt.json --audit hop2-audit.ndjson --parent-receipt hop1-receipt-tampered.json
  ✕ lineage    lineage does not match recomputed parent hash 89e23687
  RECEIPT INVALID ✕      (exit 1)

$ node scripts/verify-receipt.mjs hop2-receipt.json --audit hop2-audit.ndjson
  ✓ lineage    hop 1, parent claimed — pass --parent-receipt to check it
  RECEIPT VALID ✓        (exit 0)

$ node scripts/verify-receipt.mjs hop1-receipt.json
  RECEIPT VALID ✓        (exit 0, no lineage line at all — regression-safe)
```

This confirms, with real hashes and a real tamper (not a thought
experiment): a lineage that matches the actual parent bytes passes; an
edit to the parent after handoff is caught even though the child's own
chain stays internally valid; omitting the parent degrades to informational
rather than false-failing; and a receipt with no lineage claim is
completely unaffected.

**Not executed / left for the next hop with network access:**
- `npm test -w @qodo/agent` (the new `receipt-lineage.test.ts` file and the
  existing `receipt.test.ts`, to confirm the TS-level `verifyReceipt`
  matches the standalone script's behavior — they were written to mirror
  each other line-for-line, but "written to mirror" is not "confirmed to
  mirror").
- `npm run typecheck` (confirm the new `lineage` field and `parentReceipt`
  option type-check cleanly against the rest of the codebase).
- `node scripts/verify-receipt.mjs` invoked via the real pipeline's actual
  emitted receipt (only the hand-built fixture pair was exercised).

---

## PASS 4 — Rollback

Purely additive on every touched file; deleting the new fields, the new
optional parameters (reverting to the old fixed calls), the new test file,
and the new doc section fully reverts to 24.30.46 behavior with zero
migration needed, since no existing artifact or call site was required to
change.
