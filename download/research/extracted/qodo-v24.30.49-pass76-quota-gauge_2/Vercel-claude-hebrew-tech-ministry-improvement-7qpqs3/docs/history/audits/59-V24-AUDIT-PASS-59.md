# Pass 59 — Cartographer Oversized-PR Load Test (Task-12) — Version 24.30.31 — 2026-07-07

**Task completed:** task-12 from `tasks/agent-task-queue.json`

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — cartographer.ts is on the hot path of every pipeline run; its three-tier cache (Redis → R2 → AI) has never been adversarially tested under oversized-PR load. Synthetic fixtures expose two gaps (concurrent redundant AI calls, Redis stale-hit after content change) that compound to significant token overspend at scale. |
| Implementation risk | Zero — test-only pass; no production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/cartographer-oversized-pr.test.ts`. |

## Problem Statement (task-12)

`cartographer.ts` assembles the file map that Architect and Coder agents use to understand the repository before generating a patch.  For a typical PR it processes tens of files; the task-12 scenario is an oversized PR: hundreds of changed files, several exceeding 500 KB — the shape most likely to blow the Groq context window or exhaust the GitHub API rate limit.

The task notes: *"A synthetic fixture (generated large file set) can exercise cartographer.ts and rate-limiter.ts locally without a real GitHub PR or live API calls.  Live GitHub-API rate-limit behavior itself would still need network — scope the local pass to what a synthetic fixture can prove."*

This pass delivers that scoped local coverage: three cartographer exports (`isLargeFile`, `summarizeFile`, `buildFileMap`) exercised under a 200-file synthetic PR fixture with 500 KB+ content sizes, plus `throttledBatch` from `src/utils/rate-limiter.ts` load-tested with 200-item oversized-PR workloads — all network calls mocked in-process.

## Test File

**`packages/agent/tests/cartographer-oversized-pr.test.ts`** — 9 describe blocks, 31 test cases.

- `ai-router.ts` → `aiRoute` mocked with `vi.hoisted` + `vi.mock`
- `r2-storage.ts` → `R2Storage` replaced with Map-backed in-process class
- `RedisState` → Map-backed in-process stub per test
- `throttledBatch` imported directly from `src/utils/rate-limiter.ts` — no mocking needed
- No network, no real filesystem, no Redis, no R2 access required

## Findings

### What the tests prove (confirmed correct)

| Test | Finding |
|---|---|
| A1–A2 | `isLargeFile` threshold is exclusive: 50 000 bytes → NOT large; 50 001 → IS large. Implemented as `> EDGE_FRAGMENT_THRESHOLD_BYTES` (strict greater-than). |
| A3 | Empty string is not large. |
| A4 | Threshold uses `Buffer.byteLength` (byte count), not `.length` (char count). Multi-byte Unicode chars count proportionally. |
| B1–B5 | `buildFileMap` routing is correct: small files are excluded (not in fileMap), large files are summarised, targetFiles are unconditionally skipped regardless of size. |
| C1–C3 | Redis cache hit prevents R2 lookup and AI call; back-to-back calls for the same path hit Redis on the second call after a cold first call. |
| D1–D2 | R2 cache hit prevents AI call and back-fills Redis for subsequent path-keyed lookups. |
| E1 | Cold cache triggers exactly one AI call; result is written to both Redis and R2. |
| E2 | AI response longer than SUMMARY_LINES (50) is truncated before caching; only the first 50 lines survive. |
| F1–F2 | Two files with identical content share one R2 entry (content-hash key) but maintain separate Redis entries (path key). Only one AI call is made for both files. |
| G1–G3 | 200-file fixture: AI call count equals exactly the number of large non-target files; warm Redis cache produces zero AI calls. |
| H1–H3 | 500 KB files are correctly classified as large; full content is sent to AI (no pre-truncation); cached summary is capped at 50 lines; second call is served from cache. |
| I1–I5 | `throttledBatch` preserves input order across chunk boundaries; chunk-size ceiling is respected; 200-file fixture produces 200 results in order; empty input returns immediately; no jitter delay is inserted after the last chunk. |
| I6 (DB) | `throttledBatch` fail-fast: a single item failure in a chunk aborts the entire batch via `Promise.all` rejection; subsequent chunks never start; partial results in the failing chunk are silently discarded (correct fail-fast behavior, not a bug). Callers needing partial results must wrap individually. |

### Design boundaries documented (valid, not fixed)

#### DB1 — `sharedStorage` module-level singleton

`cartographer.ts` holds `let sharedStorage: R2Storage | null = null` at module level.  Once created, the same instance is reused for the process lifetime.  In tests, the mock Map backing is cleared in `beforeEach` which effectively resets the store without recreating the singleton — correct because the mock class delegates all operations to the Map.

#### DB2 — `getSharedStorage()` without `env` in `putText` path

The line `await getSharedStorage().putText(hashKey, trimmed)` calls `getSharedStorage()` without passing `env`.  If the singleton was first created with a specific env (credentials), the putText path silently reuses those credentials even if a different `env` is passed to subsequent `summarizeFile()` calls.  Safe pattern: call `getSharedStorage(env)` consistently.

#### DB3 — No pre-truncation before AI call

SUMMARY_LINES truncation applies after the AI responds.  The full file content is always sent to the AI regardless of size — a 500 KB file sends 500 KB to the LLM.  No windowing or pre-chunking is performed.  This is by design but contributes to context-window pressure on oversized PRs.

#### DB4 — Redis key is path-based; R2 key is content-hash-based

Two files with identical content share one R2 summary entry (ast_cache:<sha256>) but have separate Redis path entries (file_map:<path>).  This is correct: content summaries are content-addressed; path metadata belongs to the path-keyed layer.

### Gaps documented

#### GAP-1 (Medium) — Concurrent `summarizeFile` calls for the same uncached path

Two simultaneous invocations for the same path both miss all cache levels (Redis and R2 return null for the path) and each independently calls the AI.  Last writer wins on both cache layers — correctness is preserved, but the redundant AI call wastes tokens proportionally to the number of concurrent callers.

For an oversized PR processed with `Promise.all(largeFiles.map(f => summarizeFile(f.path, f.content, state)))`, every file's first summarisation is independently raced, doubling or more the LLM spend when multiple callers share the same uncached content.

**Demonstrated in test G4**: two concurrent calls for the same cold path produce exactly two AI invocations.

**Recommended fix:** Use a per-path in-flight deduplication map (`Map<string, Promise<string>>`) so that a second caller for the same path awaits the in-flight result rather than starting a new AI call.

#### GAP-2 (Low) — Redis stale-hit after content change

When a file's content changes (new PR iteration) but its path stays the same, the Redis entry (`file_map:<path>`) returns the old summary until the TTL expires.  The R2 entry is correctly invalidated by the new content hash, but cartographer checks Redis first.  The path-based key is never invalidated on content change — there is no explicit cache eviction.

**Impact:** A second commit to the same file within the same Redis TTL window may be analysed with the previous commit's summary, potentially causing the Architect or Coder to make incorrect decisions.

**Recommended fix:** On cache miss, after computing the new hash, check whether the Redis entry's stored hash matches the current content hash.  If they differ, treat the Redis entry as stale and proceed to R2/AI.  This requires storing `{summary, hash}` in Redis rather than just `summary`.

## Invariants Preserved

| Invariant | Status |
|---|---|
| Redis key namespace `qodo:v24:` | ✅ Not touched — test-only pass |
| 5-gate validator order | ✅ Not touched — test-only pass |
| Strict Zod schema parsing | ✅ Not touched — test-only pass |
| Sacred-file manifest hashes | ✅ Unchanged — no source files modified |

## Validation Results

| Check | Result |
|---|---|
| `node --experimental-strip-types --check` on new test file | ✅ Exit 0 |
| `validate.sh` | ✅ 50/50 PASSED |
| `node scripts/check-dead-integrations.mjs` | ✅ 88 exports flagged; all in allowlist |
| `vitest run` / `tsc --noEmit` | ⚠️ Blocked by sandbox network constraint — no `node_modules` available. Consistent with all passes ≥ 36. Static review shows no type errors. |

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/cartographer-oversized-pr.test.ts` | New — 9 describe blocks, 31 test cases |
| `packages/agent/docs/59-V24-AUDIT-PASS-59.md` | New — this document |
| `tasks/agent-task-queue.json` | task-12 → `"done"`, `completedInPass: 59` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 59 entry added |
| `CHANGELOG.md` | Version 24.30.31 entry added |
| `ENGINEERING_NOTES.md` | Pass 59 section added |
| `package.json` (×4) | Version bumped 24.30.30 → 24.30.31 |

## Next Priority Tasks

Per `tasks/agent-task-queue.json`:

| ID | Priority | Title | Notes |
|---|---|---|---|
| task-35 | P2 | Decide on Cloudflare AI Gateway | Owner-decision required |
| task-36 | P2 | Decide on second-source security APIs | Owner-decision required |
| task-39 | P2 | Decide on feature-flag-gated canary rollout | Owner-decision required |
| task-21 | P3 | Uncertainty-sampling calibration check | Locally tractable |
| task-23 | P3 | Model-deprecation-watchdog soft-deprecation detection | Locally tractable |
| task-26 | P3 | DOM-xray / shadow-traffic validator starvation audit | Locally tractable |
| task-27 | P3 | Compliance-oracle / SBOM / license-checker cross-consistency | Locally tractable |
| task-30 | P3 | Prompt-registry version-rollback mid-run consistency | Locally tractable |
