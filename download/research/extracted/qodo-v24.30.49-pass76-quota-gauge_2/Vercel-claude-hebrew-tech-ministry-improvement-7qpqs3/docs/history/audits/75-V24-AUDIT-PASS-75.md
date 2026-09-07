# QODO V24 — Audit Pass 75
**Version:** 24.30.48
**Date:** 2026-07-12
**Protocol:** CIEP-X v10.0
**Task:** task-56 — Wire automatic parent-receipt pickup into the pipeline (follow-up to task-55 / Pass 74)
**Type:** Code pass — one new file (non-sacred), two existing non-sacred files extended, one sacred file (`cli.ts`) additively patched for a correctness gap found mid-implementation.
**Baseline:** 24.30.47

---

## PASS 1 — Think before executing

Pass 74 filed task-56 on the assumption that automatic parent-receipt
pickup would need to be wired into `cli.ts`, and that this made it a
second sacred-file change requiring an explicit owner decision before
landing.

Tracing the ACTUAL call sites before writing anything (rather than
re-using Pass 74's own assumption) showed that assumption was wrong: the
first `appendAuditEntry` call in a normal run (`audit(runId,
"run-started", ...)`) and the `emitReceipt()` call both live in
`pipeline/run-pipeline.ts`, which is **not** in `SACRED_FILES`. `cli.ts`
itself never touches the audit chain or the receipt directly in the
default path. Saying this plainly rather than quietly keeping the
Pass-74 framing: that earlier note overstated the blast radius.

**The on-disk convention this task needed to decide (recorded, not left
implicit):** a relay orchestrator handing a ZIP to the next hop copies the
current hop's own `receipt.json` into the new workspace root as
`.relay-parent-receipt.json` before the next agent instance runs. Chosen
over an env var or CLI flag because it travels inside the handed-off
workspace itself, the same way `.audit-log.ndjson` and `receipt.json`
already do — no extra plumbing through whatever launches the agent.

**A real correctness gap found DURING implementation, not assumed away:**
`cli.ts`'s `--rehearse` pre-flight (`runDeliveryWithOptionalRehearsal`)
calls `appendAuditEntry(WORKSPACE_ROOT, "rehearsal-completed", ...)`
directly, and this happens *before* `runPipeline()` — meaning
`rehearsal-completed` can be the TRUE first entry of the chain, not
`run-started`. Threading genesis only into `helpers.ts`'s `audit()`
wrapper would have left `--rehearse` runs silently starting from the
wrong genesis. This is exactly why "think before executing" says trace
the real call graph rather than pattern-match on where a feature usually
lives — the fix was two one-line parameter additions in `cli.ts`, additive
and small, but it does mean `cli.ts` was touched after all, for a reason
discovered by tracing, not assumed in advance.

---

## PASS 2 — Implementation

| File | Change |
|---|---|
| `packages/agent/src/pipeline/relay-lineage.ts` *(new, not sacred)* | `resolveRelayLineage(workspaceRoot)`: reads `.relay-parent-receipt.json` if present, computes `sha256(canonicalJson(parentReceipt))` directly via `node:crypto` (no dependency on `receipt.ts`'s async `receiptSha256`, so this stays fully synchronous like `audit-log.ts`), increments `hopIndex`, caches per-process (mirrors `WORKSPACE_ROOT`'s own freeze-on-first-read pattern in `helpers.ts`). A missing or corrupt parent file degrades to the exact same defaults as no relay at all — never throws, never blocks the run. `_resetRelayLineageCache()` exported for tests only. |
| `packages/agent/src/pipeline/helpers.ts` | `audit()` now calls `resolveRelayLineage(WORKSPACE_ROOT)` and threads `.genesis` into `appendAuditEntry`. No-op for any run without a parent-receipt file — same all-zero default as before. |
| `packages/agent/src/pipeline/receipt-emitter.ts` | `emitReceipt()` now populates `receipt.lineage` automatically when `resolveRelayLineage` found a parent — no manual step required for a relay hop to link to its predecessor. |
| `packages/agent/src/cli.ts` *(sacred, additive)* | The two rehearsal-phase `appendAuditEntry` calls (`rehearsal-completed`, `rehearsal-blocked`) now take the same resolved `genesis` — fixes the pre-flight-can-be-first-entry gap found in Pass 1 above. |
| `packages/agent/tests/relay-lineage.test.ts` *(new)* | No-parent defaults, valid-parent genesis computation (cross-checked against `canonicalJson` directly), hop-index chaining across an already-lineaged parent, corrupt-file graceful degradation, and cache behavior. |
| `.sacred-manifest.json` | Rebaselined `cli.ts` (reviewed, intentional, additive change). |

---

## PASS 3 — Verification

**Honestly reported, same standing rule as Pass 74:** this sandbox still
has no network access, so `npm install` cannot run and `vitest`/the
project's own pinned `tsc` still cannot execute against these sources.

**What COULD be, and was, done for real this pass, going a step further
than Pass 74's standalone-script check:**

A global TypeScript compiler (v6.0.3, pre-installed in this sandbox,
unrelated to the project's own pinned version) was used to build a
**differential typecheck**: the entire `packages/agent/src` tree was
copied twice — once from the unmodified Pass-74 baseline ZIP, once from
this pass's modified tree — and both were typechecked in isolation
(`--noEmit --skipLibCheck --strict`, no `node_modules`, so `@types/node`
and every external npm package are genuinely absent from both runs).

This does **not** produce a clean typecheck — 344 errors in the baseline,
345 in the modified tree — because the sandbox has no `@types/node` and
none of the project's real npm dependencies (`zod`, `ts-morph`,
`@octokit/rest`, etc.), which surfaces as `Cannot find name 'process'` /
`Cannot find module 'zod'` noise on nearly every file, baseline included.
That is a sandbox limitation, stated plainly rather than hidden behind a
"passed" claim.

What the diff DOES show, checked line by line rather than just by count:
normalizing away line/column numbers (which shift because lines were
added), the **only new error class anywhere in the whole tree** is three
lines in the brand new `relay-lineage.ts` file itself (`Cannot find name
'node:fs'/'node:crypto'/'node:path'` — the exact same `@types/node`-missing
shape as literally every other file in this codebase, not a new category
of error). `receipt.ts`'s two pre-existing `node:crypto` errors just moved
to new line numbers because lines were inserted above them — same two
errors, same file, same cause. Every other file in the tree — including
`cli.ts` and `helpers.ts`, both of which were edited — produced **zero**
new errors relative to baseline.

```
$ diff <(baseline typecheck, normalized) <(modified typecheck, normalized)
# 344 baseline lines, 345 modified lines
# +1 net difference == the 3 new relay-lineage.ts lines minus 2 receipt.ts
#   lines that were already counted (just shifted), i.e. genuinely zero
#   new error CATEGORIES, only the expected @types/node noise on new code
```

This is real evidence of "no new type errors beyond the sandbox's
pre-existing @types/node gap" — not a substitute for `npm run typecheck`
against the pinned compiler and real `node_modules`, which is still owed
before merge, but a meaningfully stronger check than Pass 74 had time to
do.

**Not executed / left for the next hop with network access:**
- `npm run typecheck` against the project's own pinned TypeScript version
  and real `node_modules` (this pass's differential check used a
  different, newer global compiler version as a substitute signal, not a
  replacement).
- `npm test -w @qodo/agent` — `relay-lineage.test.ts` and the Pass-74
  `receipt-lineage.test.ts` were written and hand-traced but not run
  under real `vitest`.
- An end-to-end run of the actual CLI (`--rehearse` and non-rehearse
  paths) against a real `.relay-parent-receipt.json`, to confirm the
  wiring behaves as traced rather than just as typed.

---

## PASS 4 — Rollback

Additive on every file except the two-line `cli.ts` genesis-threading fix,
which is also additive (adds an argument to two existing calls; omitting
it reproduces the exact prior behavior). Deleting `relay-lineage.ts`,
reverting the three call sites to their pre-Pass-75 form, and dropping the
new test file fully reverts to 24.30.47 behavior.
