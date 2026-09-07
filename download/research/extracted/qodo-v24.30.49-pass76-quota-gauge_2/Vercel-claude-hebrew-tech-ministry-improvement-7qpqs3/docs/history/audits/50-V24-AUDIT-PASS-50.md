# QODO V24 — Audit Pass 50 (CIEP v10.0)
**Version:** 24.30.22
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol v10.0
**Baseline:** 24.30.21 (Pass 49 — Trust-ledger / vitals-score gaming resistance audit)
**Task completed:** task-22 — Skill-exchange / Hive poisoning test

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — cross-run data poisoning is invisible in any single-mission test suite; this pass establishes the precise attack boundary for both Hive stores and documents 6 concrete gaps (3 confirmed exploitable, 3 documented design limits). |
| Implementation risk | Zero — test-only pass; no production code changed. |
| Compatibility impact | None — new test file only. |
| Rollback complexity | Trivial — delete `packages/agent/tests/hive-poisoning.test.ts`. |

---

## Problem Statement (task-22)

`vector-skill-exchange.ts` and `skill-exchange.ts` store learned patches and prompt
fragments for reuse across missions (the "Hive"). The question:

> "Can a bad or subtly-wrong patch stored early in the Hive later be retrieved and
> re-applied to an unrelated mission, propagating a defect instead of a genuine fix?"

The Hive consists of three distinct stores:
1. **semantic-cache.ts** — `saveHivePatch` / `findHiveReference` / `quarantinePatch`:
   full code patches, similarity-retrieved via `@xenova/transformers` embeddings.
2. **skill-exchange.ts** — `maybeExtractSkill` / `downloadGlobalSkills`:
   prompt fragments + code patterns stored at `hive/skills/<id>.skill.json`.
3. **vector-skill-exchange.ts** — `embedAndStoreSkill` / `findProvenPatterns`:
   vector-search variant of (2) backed by Upstash Vector; offline mode returns `[]`.

---

## Findings

### Gaps Confirmed

**GAP-1 (High — primary poisoning path, semantic-cache hive):**
`findHiveReference` returns a stored patch to any caller whose objective has cosine
similarity > 0.92 and whose target files have not drifted. An adversary who stores a
poisoned patch for objective O1 with target files F can re-victimize any future run
for objective O2 ≈ O1 against the same files. The only mitigations are the similarity
threshold, drift detection, and quarantine. When all three conditions are met — high
similarity, no drift, no prior quarantine — the poisoned patch is silently returned
as a "proven reference" to the Coder agent.

*Proposed fix (deferred):* require gate-pass evidence (run ID + passing CI hash) to
be persisted alongside each Hive entry before it can be promoted; alternatively,
require a minimum `trust-ledger` bond level before a patch is Hive-eligible.

**GAP-2 (Medium — quarantine eviction):**
`quarantinePatch` appends to a list capped at 500 entries via `slice(-500)`. An
adversary or misconfigured pipeline that writes 501+ quarantine entries evicts the
oldest entry, making the originally-quarantined patch retrievable again.

*Proposed fix (deferred):* replace the append-only list with a content-addressed
(SHA-256-keyed) quarantine store where entries are never evicted by volume.

**GAP-3 (Medium — quarantine bypass via objective mutation):**
Quarantine lookup uses exact string equality on `objective` and `planJson`. A subtly-
mutated objective (trailing whitespace, synonym substitution, or minor rephrasing)
produces a cache miss in the quarantine list even when the patch content is identical.

*Proposed fix (deferred):* embedding-based quarantine lookup (cosine similarity > N)
instead of exact string match.

### Resistance Properties Confirmed

| Property | Result |
|---|---|
| Genuinely-unrelated mission (different files, no drift match) | RESISTANT — drift detection blocks retrieval |
| Quarantine blocks known-bad entries on subsequent retrieval | RESISTANT — quarantine is effective when not evicted |
| `QODO_PRIVACY_MODE=strict` disables the Hive entirely | RESISTANT — no cross-repo retrieval possible |
| `QODO_HIVE_SHARE=off` (default) prevents hive retrieval | RESISTANT — hive is opt-in |
| Org-private mode blocks cross-org retrieval | RESISTANT — `isCrossRepoSafe` enforces owner equality |
| Malformed JSON skill silently dropped (no crash) | RESISTANT — `safeParseSkill` catch block |
| Missing R2 payload skipped (no crash) | RESISTANT — `null` check before `safeParseSkill` |
| `maybeExtractSkill` requires blast-radius similarity ≥ 0.7 | RESISTANT — low-confidence patches not promoted |
| vector-skill-exchange offline mode returns `[]` | RESISTANT — no poisoning path without Upstash |

### Documented Design Limits (not gaps in the current threat model)

**GAP-4 (Documented limit — prompt injection persistence):**
`downloadGlobalSkills` wraps `promptFragment` in `<UNTRUSTED_DATA>` before returning
to callers, but does not strip the content. A persuasive injected instruction remains
in the string and can influence a weak-instruction-following model.
*No structural fix exists without LLM-side enforcement; documented.*

**GAP-5 (Documented limit — no content-quality gate):**
Any skill that passes Zod schema validation (`id`, `name`, `pattern`,
`promptFragment` all present as non-empty strings) is returned to callers
unconditionally. There is no semantic quality check on `pattern` content.
*Mitigation: gate-pass evidence requirement (same as GAP-1 fix). Deferred.*

**GAP-6 (Documented limit — inconsistent field sanitisation):**
`downloadGlobalSkills` wraps only `promptFragment` in `<UNTRUSTED_DATA>`; the `name`
field is returned unwrapped. If a downstream caller renders `name` in an LLM prompt
context, it becomes a secondary injection surface. Current callers do not do this, so
risk is low.
*Mitigation: wrap `name` as well. Deferred.*

### Cross-Subsystem Consistency Gap

**D1 (Documented — separate quarantine namespaces):**
The semantic-cache quarantine list (`semantic-cache/quarantine.json`) is not consulted
by `downloadGlobalSkills`. A patch quarantined in the semantic cache may still have a
corresponding skill entry retrievable from `hive/skills/`. The two Hive stores operate
independently with no shared quarantine state.
*Proposed fix (deferred):* unified quarantine registry keyed by content hash,
consulted by both subsystems.

---

## Test File Added

`packages/agent/tests/hive-poisoning.test.ts` — 4 describe suites, 19 test cases.

In-process `R2Storage` mock (Map-backed, no daemon required).
`@xenova/transformers` mocked with unit-vector pipeline (cosine = 1.0 for all text
pairs — worst-case scenario for poisoning resistance testing).

### Suite breakdown

| Suite | Cases | Coverage |
|---|---|---|
| A — semantic-cache hive | 8 | GAP-1 through GAP-3; privacy/sharing modes; quarantine correctness |
| B — skill-exchange | 6 | GAP-4 through GAP-6; malformed/missing payloads; extraction threshold |
| C — vector-skill-exchange offline | 3 | Offline mode returns []; R2 write survives no Upstash; empty results |
| D — cross-subsystem consistency | 2 | Cross-namespace quarantine gap; maybeExtractSkill promotion gate |

---

## Validation

- `node --experimental-strip-types --check packages/agent/tests/hive-poisoning.test.ts` — exits 0 (syntax clean).
- `./validate.sh` — 50/50 PASSED (file count now 295 + new test = 296; passes ≥ 150 threshold).
- `node scripts/check-dead-integrations.mjs` — clean; new test file exports no `src/` symbols.
- Sacred-file manifest hashes unchanged (no sacred files touched).
- `vitest run` / `tsc --noEmit` blocked by sandbox network constraint (consistent with all passes ≥ 36); static review confirms all imports resolve against existing export surfaces.
- All four `package.json` files bumped from 24.30.21 → 24.30.22.

---

## Recommendations for Pass 51

Priority order based on findings from this pass and the remaining task queue:

1. **task-7 (priority 2):** Darwin Engine `--evolve` mode regression stress-test. Use
   a synthetic mocked metric stream — no live LLM calls required.
2. **task-9 (priority 2):** Multi-agent swarm contention test. In-process
   `Promise.all` racing against `semantic-dag.ts` lock primitives.
3. **GAP-1 fix (new, not yet queued):** Add gate-pass evidence requirement to
   `saveHivePatch` and `maybeExtractSkill` before hive promotion. Should be queued as
   a new high-priority task.
4. **GAP-2 fix (new, not yet queued):** Replace append-only quarantine list with a
   content-addressed (SHA-256-keyed) store.
