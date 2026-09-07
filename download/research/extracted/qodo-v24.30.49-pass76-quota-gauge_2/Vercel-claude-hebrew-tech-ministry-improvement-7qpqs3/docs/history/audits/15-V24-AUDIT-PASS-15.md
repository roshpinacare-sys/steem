# QODO V24 — Audit Pass 15

**Version:** 24.15.0 → 24.16.0
**Date:** 2026-07-06
**Bugs fixed this pass:** 4 (IDs 16-A through 16-D)
**Cumulative bugs fixed (all passes):** 37

---

## Scope

Full audit of files not deeply reviewed in passes 1–14, with focus on
correctness and reliability risks in the privacy, scanning, observability,
and edge-worker subsystems.  Files examined this pass:

- `packages/agent/src/services/obfuscator.ts`
- `packages/agent/src/services/edge-fragment.ts`
- `packages/agent/src/services/sre-feedback.ts`
- `packages/agent/src/services/cartographer.ts`
- `packages/agent/src/services/semantic-dag.ts`
- `packages/agent/src/services/skill-exchange.ts`
- `packages/agent/src/services/vector-skill-exchange.ts`
- `packages/agent/src/services/r2-storage.ts`
- `packages/agent/src/services/axiom-shipper.ts`
- `packages/agent/src/services/warden-memory.ts`
- `packages/agent/src/agents/janitor.ts`
- `packages/agent/src/agents/coder.ts`
- `packages/agent/src/agents/architect.ts`
- `packages/agent/src/agents/meta-agent.ts`
- `packages/agent/src/agents/context-enricher.ts`
- `packages/agent/src/agents/compliance-oracle.ts`
- `packages/agent/src/agents/style-aligner.ts`
- `packages/agent/src/agents/infra-oracle.ts`
- `packages/agent/src/utils/rate-limiter.ts`
- `packages/agent/src/utils/path-guard.ts`
- `packages/agent/src/utils/schema-validator.ts`
- `packages/agent/src/validators/chaos-monkey.ts`
- `packages/agent/src/validators/dom-xray.ts`
- `packages/agent/src/validators/lockfile-guardian.ts`
- `packages/agent/src/validators/shadow-traffic.ts`
- `packages/agent/src/services/incident-resolver.ts`

---

## Bugs Fixed

### Bug 16-A — `obfuscator.ts`: `obfuscatePrefetch` token collision corrupts reconstitution (Medium — Correctness)

**File:** `packages/agent/src/services/obfuscator.ts`
**Lines affected:** 70–79 (before fix)

**Root cause:**
`obfuscateCode` numbered each file's tokens independently, always starting
at `VAR_1`.  `obfuscatePrefetch` merged per-file mappings with:

```ts
// BEFORE (buggy)
combinedMapping = { ...combinedMapping, ...bundle.mapping };
```

When two files both declared a variable named `value`, both produced
`VAR_1 → value`.  The spread placed the second file's `VAR_1 → value` entry
last, overwriting the first file's entry.  If the first file mapped
`VAR_1 → count` and the second mapped `VAR_1 → value`, the combined mapping
only retained `VAR_1 → value`.  `reconstituteCode` then substituted `value`
for every `VAR_1` token across **all** files — corrupting the first file's
content by replacing `count` with `value`.

**Impact:**
Privacy-mode code reconstitution silently produced incorrect source output
whenever two or more files shared any local variable name.  The `Coder`
would receive the wrong source code after deobfuscation, and the
`hasUnmappedTokens` guard would not catch this because all `VAR_N` tokens
were present in the mapping (just mapped to wrong values).

**Fix:**
Added a `tokenOffset` parameter to `obfuscateCode`:
```ts
// AFTER (fixed)
export function obfuscateCode(content: string, filePath = "snippet.ts", tokenOffset = 0): ObfuscatedBundle
```
`obfuscatePrefetch` threads a cumulative counter:
```ts
let tokenOffset = 0;
for (const [path, content] of Object.entries(prefetch)) {
  const bundle = obfuscateCode(content, path, tokenOffset);
  Object.assign(combinedMapping, bundle.mapping);
  tokenOffset += Object.keys(bundle.mapping).length;
}
```
File 1 now uses `VAR_1…VAR_K`, file 2 uses `VAR_(K+1)…VAR_(K+M)`, etc.
The combined mapping is collision-free by construction.

**Verification:**
```
grep -n "tokenOffset" packages/agent/src/services/obfuscator.ts
# → lines 30, 36, 43, 85, 87, 90
```

**Regression tests:** 3 tests in `packages/agent/tests/obfuscator.test.ts`
- `assigns globally unique VAR_N tokens when multiple files share the same local variable names`
- `round-trips perfectly: reconstitute(obfuscate(src)) === src for multi-file batch`
- `single-file obfuscation is unaffected by the tokenOffset change`

---

### Bug 16-B — `janitor.ts`: new `ts-morph` `Project` per file in scan loop causes O(N) memory pressure (Medium — Reliability)

**File:** `packages/agent/src/agents/janitor.ts`
**Line affected:** 27 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
for (const file of files) {
  const project = new Project({ useInMemoryFileSystem: true });  // O(N) construction
  const sourceFile = project.createSourceFile(file.path, file.content, { overwrite: true });
  ...
}
```
`ts-morph`'s `Project` constructor initialises a full TypeScript language
service, including a program, type-checker, and source-file registry.  On a
repository with 100+ TypeScript files this created 100+ heavyweight
language-service instances, each retained in memory until GC.  On CI runners
with 2–4 GB RAM, scanning a large repository would exhaust the heap and OOM.

**Impact:**
`runJanitor` is called at the end of every pipeline run.  On large
repositories (many services with hundreds of source files) the scan phase
would OOM-kill the agent process, aborting the run without a useful error.

**Fix:**
One `Project` is created before the loop.  Each file is processed with
`createSourceFile(path, content, { overwrite: true })` to avoid accumulation,
then explicitly removed from the project after analysis:

```ts
// AFTER (fixed)
const project = new Project({ useInMemoryFileSystem: true });
for (const file of files) {
  const sourceFile = project.createSourceFile(file.path, file.content, { overwrite: true });
  // ... analysis ...
  project.removeSourceFile(sourceFile);  // free incrementally
}
```
Peak memory is now O(1) in the number of files (one source file in the
project at a time) rather than O(N).

**Verification:**
```
grep -n "new Project\|removeSourceFile" packages/agent/src/agents/janitor.ts
# → line 29 (single Project), line 50 (removeSourceFile)
```

**Regression tests:** 2 tests in `packages/agent/tests/janitor.test.ts`
- `does not throw when processing many files that share the same variable names`
- `correctly identifies long functions even when a shared Project is reused`

---

### Bug 16-C — `sre-feedback.ts`: empty log array indistinguishable from healthy deployment when no provider is configured (Low — Reliability)

**File:** `packages/agent/src/services/sre-feedback.ts`
**Line affected:** 44 (before fix)

**Root cause:**
```ts
// BEFORE (buggy — no provider guard)
const logs = await fetchProductionLogs(input, cfg);   // returns [] if no provider
const fiveXx = logs.filter(...);   // []
const slow   = logs.filter(...);   // []
if (fiveXx.length === 0 && slow.length === 0) {
  return { reverted: false };      // ← same as "deployment healthy"
}
```
`fetchProductionLogs` returns `[]` when neither Axiom nor Vercel credentials
are configured.  The empty array caused the healthy-branch to fire, returning
`{ reverted: false }` — the identical return value the function produces when
it has actually sampled logs and found no regressions.

**Impact:**
Callers (pipeline orchestrator, CI summary step) could not distinguish
"SRE loop verified the deployment is healthy" from "SRE loop had no data
and did nothing".  Silent absence of monitoring infrastructure was silently
treated as a positive health signal.

**Fix:**
Guard before the log fetch.  When no provider is configured, return
immediately with an explicit `skipped` flag:

```ts
// AFTER (fixed)
const hasProvider = !!(cfg.axiomToken || cfg.vercelToken);
if (!hasProvider) {
  await telemetry?.decision("sre-feedback", "skipped-no-provider", {});
  return { reverted: false, skipped: true, reason: "no log provider configured" };
}
```
A `SreFeedbackResult` interface was introduced to make `skipped?: boolean`
and `reason?: string` first-class return fields.

**Verification:**
```
grep -n "hasProvider\|skipped" packages/agent/src/services/sre-feedback.ts
# → lines 37, 57, 58, 59, 60
```

**Regression test:** 1 test in `packages/agent/tests/security.test.ts`
- `returns skipped:true when no log provider is configured instead of reverted:false`

---

### Bug 16-D — `edge-fragment.ts`: `clearTimeout(timeout)` in `finally` block references undeclared variable (Medium — Correctness)

**File:** `packages/agent/src/services/edge-fragment.ts`
**Lines affected:** 118–120 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
} catch {
  return parseChunkInProcess(chunk.content);
} finally {
  clearTimeout(timeout);   // ← `timeout` is not declared in this scope
}
```
`fetchWithTimeout` manages its own internal `AbortController` / `setTimeout`
handle.  The caller (`dispatchChunk`) has no `timeout` variable.  The stray
`clearTimeout(timeout)` reference:

- **TypeScript strict mode:** compile error — `Cannot find name 'timeout'`.
- **Non-strict JS runtime:** `timeout` resolves to `undefined` in the global
  scope; `clearTimeout(undefined)` is a no-op, masking the error silently.

Because the `finally` block always runs — including after the `catch` path
that performs graceful degradation — any strict-mode compilation or runtime
environment (e.g. Cloudflare Workers, which enforces strict mode) would throw
a `ReferenceError`, preventing the fallback from completing.

**Impact:**
In strict-mode runtimes the `finally` block fires after the graceful
degradation `return parseChunkInProcess(...)`, replacing the clean return
value with a `ReferenceError` thrown from `finally`.  This converts a
graceful degradation into a hard crash of the entire `parseViaEdgeSwarm` call.

**Fix:**
Removed the `finally` block entirely.  Added a comment explaining that
timeout management is the responsibility of `fetchWithTimeout`:

```ts
// AFTER (fixed)
} catch {
  return parseChunkInProcess(chunk.content);
}
// Note: no finally { clearTimeout(timeout) } — the timeout handle is
// owned and cleared internally by fetchWithTimeout. (Bug 16-D fix)
```

**Verification:**
```
grep -n "clearTimeout\|finally" packages/agent/src/services/edge-fragment.ts
# → neither appears (only the explanatory comment remains)
```

**Regression test:** 1 test in `packages/agent/tests/security.test.ts`
- `gracefully falls back to in-process parsing without ReferenceError when worker URL is invalid`

---

## Files Modified

### Source files (4)
| File | Change |
|------|--------|
| `packages/agent/src/services/obfuscator.ts` | Added `tokenOffset` param to `obfuscateCode`; cumulative offset threading in `obfuscatePrefetch` |
| `packages/agent/src/agents/janitor.ts` | Hoisted `Project` above loop; added `removeSourceFile` after each file |
| `packages/agent/src/services/sre-feedback.ts` | Added `hasProvider` guard; introduced `SreFeedbackResult` type with `skipped` field |
| `packages/agent/src/services/edge-fragment.ts` | Removed stray `finally { clearTimeout(timeout) }` from `dispatchChunk` |

### Test files (3)
| File | Change |
|------|--------|
| `packages/agent/tests/obfuscator.test.ts` | **New file** — 3 regression tests for Bug 16-A |
| `packages/agent/tests/janitor.test.ts` | **New file** — 2 regression tests for Bug 16-B |
| `packages/agent/tests/security.test.ts` | +2 regression tests for Bugs 16-C and 16-D |

### Documentation / release files (4)
| File | Change |
|------|--------|
| `package.json` | `24.15.0` → `24.16.0` |
| `packages/agent/package.json` | `24.15.0` → `24.16.0` |
| `apps/mission-control/package.json` | `24.15.0` → `24.16.0` |
| `06-CHANGELOG.md` | Added Pass 27 entry |
| `07-MANIFEST.md` | Added A16 entry for this document |
| `15-V24-AUDIT-PASS-15.md` | **This document** |

---

## Validation

```
bash validate.sh
# → PASSED: 49 / FAILED: 0  (173 total files)
```

---

## Cumulative Bug Count

| Pass range | Bugs fixed |
|------------|-----------|
| Passes 1–9 (V24.10.0–V24.10.9) | 9 |
| Passes 10–11 (V24.11.0–V24.12.0) | 9 |
| Pass 12 (V24.12.0→V24.13.0) | 4 |
| Pass 13 (V24.13.0→V24.14.0) | 5 |
| Pass 14 (V24.14.0→V24.15.0) | 5 |
| Pass 15 (V24.15.0→V24.16.0) | 4 |
| **Total** | **37** |
