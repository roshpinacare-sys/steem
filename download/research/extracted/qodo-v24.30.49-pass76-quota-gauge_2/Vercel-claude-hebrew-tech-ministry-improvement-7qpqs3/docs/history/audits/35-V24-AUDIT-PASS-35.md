# QODO-V24 Audit — Pass 35

**Version:** `24.29.0`
**Previous:** `24.28.0`
**Date:** 2026-07-06
**Theme:** Deeper path-guard hardening (3-layer), halt-aware SRE sleep, Gemini watchdog, CI wiring, Knip decision.

---

## Executive Summary

Pass 35 responds directly to every "independently verify or improve" item
in `AGENT_INSTRUCTIONS.md` from `qodo-v24-patches-only.zip`. Each patch
delivered was re-evaluated, not rubber-stamped. Three code areas received
material improvements beyond what was delivered; two items were verified
correct and accepted unchanged; one item received a documented design
decision instead of code.

---

## Per-item verification and changes

### 1 · Groq model deprecation (`ai-router.ts`, `cost-tracker.ts`)

**Verdict: patch accepted as-is, watchdog extended.**

The `GROQ_FAST`/`GROQ_HEAVY` constants correctly use `openai/gpt-oss-20b`
and `openai/gpt-oss-120b`. No additional verification of the live Groq
catalogue is possible without network access, but the model-deprecation
watchdog added in Pass 34 now also monitors `GEMINI_FAST_MODEL`
(`gemini-1.5-flash-8b`) — the one provider model that was **not** verified
in Pass 33.

`CEREBRAS_FAST_MODEL` (`llama3.1-8b`) and `MISTRAL_FAST_MODEL`
(`mistral-small-latest`) were already monitored in Pass 34. All four
providers are now covered.

**Startup-check alternative evaluated:** The model-deprecation watchdog
(Pass 34) implements exactly this — a non-blocking startup query against
each provider's `/v1/models` endpoint. It was judged the right balance:
advisory (never blocks the pipeline), but surfaced through alertable
structured logs. A hard fail-fast was considered and rejected: a provider
API outage would permanently block every pipeline run until the key was
rotated, which is worse than the original silent failure. Advisory warning
+ human alert rule is the correct design for this scale.

---

### 2 · Path-traversal fix (`path-guard-scoped.ts`) — IMPROVED

**Verdict: patch correct but insufficient — 3-layer defense added.**

The Pass-33 fix (`path.resolve` against a fixed virtual root) closes the
raw `..` traversal. Pass 35 adds two further layers:

| Layer | Threat | Implementation |
|-------|--------|----------------|
| 1 | Null-byte injection (`src/\x00../../.env`) | Strip `\x00` before all other processing |
| 2 | URL-encoded traversal (`src/%2e%2e%2f.env`) | Single-pass `decodeURIComponent` before `path.resolve` |
| 3 | `..` segment traversal | `path.resolve` against `/__qodo_workspace_root__` (Pass 33, preserved) |

**Two implementation strategies evaluated:**

*Strategy A (chosen): string normalisation in-process.*
Pro: works on virtual/hypothetical paths before they exist on disk (which
is exactly the use case — patch-file paths are checked before being written).
Con: cannot detect symlink-based escapes. Limitation documented in code.

*Strategy B: `fs.realpathSync` jail.*
Pro: catches symlinks. Con: requires the path to already exist on disk;
useless for pre-write validation; introduces I/O in a hot path.

Decision: Strategy A for pre-write validation (implemented). Strategy B
deferred for post-write re-verification by callers that operate on
already-written files (documented in code comment as a follow-up task).

**12 adversarial regression tests added** covering: `%2e%2e%2f`,
mixed-case encoding, malformed encoding (`%GG`), null bytes, Windows
backslash traversal, `.git` targeting, and double-encoding design decision.

**False-positive check:** new patterns applied against existing `packages/`
source tree — **0 hits**.

---

### 3 · Secret-detection gaps (`secret-guard.ts`) — verified

**Verdict: patch accepted as-is, external scanner deferred with justification.**

The 7 new patterns (Stripe, Slack token, Slack webhook, SendGrid, Twilio,
Google API key, PEM block) were scanned against the full
`packages/agent/src/` tree — **0 false positives** in existing source.

**External scanner recommendation (gitleaks / trufflehog):**

A regex-only scanner cannot catch entropy-based secrets or obfuscated
values. `trufflehog` can scan a diff object (not just a git checkout) via
`trufflehog filesystem --directory=<tempdir>` after writing the patch to a
temp directory. This is a stronger long-term answer than hand-maintaining
patterns.

**Decision for this pass:** defer integration of trufflehog to Pass 36.
Reason: wiring trufflehog into the pipeline requires writing patch content
to a temp directory, calling an external binary (needs to be present in
the CI image), and parsing its structured output — a non-trivial change
that warrants its own pass and test coverage. The existing patterns + CI
scanning are a sufficient baseline for now.

---

### 4 · Kill switch (`kill-switch.ts`) — IMPROVED

**Verdict: unit tests already in Pass 34; intra-phase halt now implemented.**

The AGENT_INSTRUCTIONS specifically asked: *"should QODO_HALT also be
checked during a long-running phase, not just between phases?"*

**Decision: yes, implemented.**

The 10-minute post-merge SRE warmup sleep in `sre-feedback.ts` was the
only intra-phase blocking wait in the pipeline. It has been replaced with
a 5 s poll loop that checks `isHalted(env)` on each iteration.
`QODO_HALT=true` now takes effect within 5 s anywhere in the pipeline.

The other "long-running" operations (LLM calls, GitHub API calls) are
individually bounded by circuit-breakers and timeouts already; introducing
per-call halt checks would add noise without meaningful benefit. The SRE
sleep was the only unbounded wait.

---

### 5 · Dead-integration linter (`scripts/check-dead-integrations.mjs`) — IMPROVED

**Verdict: linter output already clean (Pass 34 wired kill-switch); CI wiring added.**

The linter correctly produced no output once `kill-switch.ts` was wired
in cli.ts (Pass 34). The linter itself was **wired into CI** in Pass 35 —
`agent-pipeline.yml` now runs `node scripts/check-dead-integrations.mjs`
in the `test` job before vitest so dead exports block CI automatically.

**Knip evaluation:**

`knip.json` already exists in the repo root. Knip covers a different
surface: unused TypeScript exports *within* the declared project boundary
(`packages/*/src/**`). `check-dead-integrations.mjs` covers a
complementary surface: services that are exported but never called from an
entry point (`cli.ts`, `swarm-dispatch.mjs`, `webhook-receiver.js`).

**Decision: keep both.** Knip = dead TypeScript code within the project.
Custom script = unwired integration modules. They don't overlap; removing
either would create a blind spot.

---

## System Invariants

All 10 system invariants from `04-SYSTEM-INVARIANTS.md` are preserved:

- **Fail-safe defaults** — malformed percent-encoding is blocked, not
  passed through; halt check in SRE loop exits cleanly (no panic).
- **No new mandatory dependencies** — dynamic import of `kill-switch.js`
  in sre-feedback degrades gracefully if the module is absent (import error
  would be caught by the outer `runSreFeedbackLoop` catch handler).
- **Privacy mode** — no new telemetry fields; halt log emits only elapsed
  time, no user data.

---

## Next Recommended Pass (Pass 36)

1. **trufflehog integration** — wire `trufflehog filesystem` into the gate
   phase, writing the patch diff to a temp directory before scanning. This
   replaces the hand-maintained regex list as the primary secret-detection
   mechanism and adds entropy analysis.
2. **`fs.realpathSync` post-write check** — add a second path-guard call
   after patch files are written to disk, using `realpathSync` to catch
   symlink-based escapes that string normalisation cannot detect.
3. **Knip triage** — run `npx knip` against `packages/agent` and triage
   all flagged exports (wire live ones, add test-only to allowlist, or
   remove dead ones). Target: `knip` exits 0 in CI.
4. **Integration test for `QODO_HALT` intra-phase** — write a vitest test
   that stubs `sleep()` and verifies the SRE loop exits within one poll
   interval when `QODO_HALT=true`.
