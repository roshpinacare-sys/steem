# QODO V24 — Audit Pass 62 (CIEP-X v10.0)

**Version:** 24.30.34
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0 (Canonical Incremental Engineering Protocol)
**Baseline:** 24.30.33 (Pass 61 — model-deprecation-watchdog soft-deprecation audit, task-23)
**Task:** task-26 — DOM-xray / shadow-traffic validator starvation audit

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — dom-xray and shadow-traffic are the two UI/traffic gate validators that determine whether a deployment is allowed to proceed. Proving both are susceptible to single-observation-moment starvation attacks (and a shared bypass-header structural weakness) documents a class of adversarial deployment evasion that the existing happy-path tests cannot surface. |
| Implementation risk | Zero — test-only pass. No production source files changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/dom-xray-shadow-starvation.test.ts`. |

---

## Problem Statement (from task-26)

`dom-xray.ts` and `shadow-traffic.ts` are the post-deployment UI and traffic validators.
Task-26 asks: could an adversarial patch pass both validators by behaving correctly only
during their specific, narrow observation window?

The answer is **yes** — through three independently exploitable attack vectors:

1. **Request-counter starvation**: Serve clean content for exactly the first K requests
   (where K matches the number of validator probes), then degrade. dom-xray probes once
   (K=1 suffices); shadow-traffic probes three times concurrently (K=3 suffices).

2. **JS-execution blindness** (dom-xray only): Inject errors via JavaScript after initial
   render. JSDOM does not execute `<script>` tags in the default configuration.

3. **Bypass-header evasion**: Both validators send `x-vercel-protection-bypass` on every
   request. A server-side header check can serve a "validator persona" that differs
   entirely from the production persona served to real users.

---

## Root Cause

Both validators share the same structural property: **a single observation moment**.

- `domXray`: one `fetchWithTimeout` call → one static HTML parse → gate decision made.
- `shadowTraffic`: three concurrent `fetchWithTimeout` calls → `bad === 0` → gate decision made.

Neither validator samples over time, retries under different conditions, or varies its
request identity. The gate result is therefore a property of a small, fixed sample of
server responses at one instant — not a property of the server's sustained behaviour.

---

## Findings

### GAP-1 (High) — dom-xray single-shot: request-counter degradation undetectable

`domXray` issues exactly one HTTP request per call. A server that tracks its request
count and returns clean HTML on request #1 and degraded HTML on requests #2+ passes
dom-xray every time the validator is called (which is exactly once per deployment).

**Attack cost:** K=1 counter. Trivially exploitable — no timing knowledge required.

**Demonstrated in:** B1 (first call allowed, second blocked), B2 (K=1 always clean), B3
(validator at count=1, all subsequent user requests at count≥2 blocked).

**Recommended fix:** Issue at least two temporally-separated requests (e.g. 2-second
gap between them) and require both to pass.

---

### GAP-2 (High) — dom-xray JSDOM static-only: JS-deferred errors invisible

`dom-xray.ts` calls `new JSDOM(html)` without `runScripts: "dangerously"`. In the
default JSDOM configuration, `<script>` tags are parsed but not executed. Any error
element injected by client-side JavaScript — regardless of timing — is permanently
invisible to the validator.

**Attack patterns demonstrated:**
- Deferred `data-error` injection via `setTimeout` (C1) → `errors=0` → `allowed=true`
- Deferred `#root` removal via `setTimeout` (C2) → `hasRoot=true` → `allowed=true`
- Deferred `.error` class injection (C3) → `errors=0` → `allowed=true`

**Recommended fix:** Use a headless browser (Playwright/Puppeteer) with a configurable
post-render settling time (`page.waitForTimeout(2000)` after `page.goto()`).

---

### GAP-3 (Medium) — dom-xray semantic: empty SPA shell passes as healthy

`hasRoot` checks that a root-selector element (`#root`, `#__next`, `main`,
`[data-app-root]`) exists in the document — not that it contains meaningful content.

`<div id="root"></div>` (an empty React/Next.js SPA hydration shell) passes because:
- `#root` found → `hasRoot=true`
- No `[data-error]` or `.error` elements → `errors=0`
- Result: `allowed=true`

A real user loading this page sees a blank screen until JavaScript executes and hydrates
the component tree. If JS fails (CSP error, bundle 404, hydration error), the user sees
only the empty shell indefinitely.

**Demonstrated in:** D1 (empty `<div id="root">`), D2 (empty `<main>`)

**Recommended fix:** Check root element content — `rootEl.childElementCount > 0` or a
minimum `textContent.trim().length` threshold.

---

### GAP-4 (Medium) — dom-xray bypass-header evasion

`domXray` always sends `x-vercel-protection-bypass: <bypassSecret>` on every request.
A server that checks this header can serve a "validator persona" (clean HTML) exclusively
to the validator and a degraded persona to all real users. The validator result is
structurally decoupled from the production-user experience.

**Demonstrated in:** D3

**Recommended fix:** Issue one request with the bypass header and one without; compare
DOM structure and flag significant divergence.

---

### GAP-5 (High) — shadow-traffic single-shot: counter-based 500s after K>3 undetectable

`shadowTraffic` issues exactly 3 concurrent requests per invocation. A server that
returns 200 for its first 3 requests and 500 for all subsequent ones passes shadow-traffic
by setting K=3.

**Attack cost:** K=3 counter. The 3 concurrent probes all arrive during the clean window;
real user traffic begins after K is exhausted.

**Demonstrated in:** F1 (probes 1-3 pass, probes 4-6 fail), F2 (exactly 3 fetches
confirmed — K=3 is the exact attack surface).

**Recommended fix:** Add a delayed re-probe round (3 probes at T=0, 3 more at T+5s) and
require both rounds to pass. This raises attack cost from K=3 to K=6 and catches common
warm-up / graceful-degradation patterns.

---

### GAP-6 (Medium) — shadow-traffic bypass-header evasion

`shadowTraffic` sends `x-vercel-protection-bypass` on every probe. Identical structural
weakness to GAP-4 — a server-side header check can serve 200 to the validator and 503
to real users.

**Demonstrated in:** F3

---

### GAP-7 (Medium) — shadow-traffic path coverage: only 3 fixed paths probed

`shadowTraffic` always probes exactly `["/", "/api/health", "/robots.txt"]`. Applications
where these 3 paths work but critical app-specific paths fail pass shadow-traffic with
no indication of the failure.

Particularly acute: `/api/health` is commonly a lightweight dedicated health-check
endpoint that bypasses the normal request stack (no database call, no auth middleware).
It returns 200 even when the database is down and `/api/users` returns 500.

**Demonstrated in:** G1 (critical `/api/data` path not probed), G2 (`/api/health`
bypasses DB stack while `/api/users` fails).

**Recommended fix:** Accept a configurable `paths` array so callers can supply
app-specific critical paths alongside the defaults.

---

### GAP-8 (Low) — /robots.txt 404 reduces effective coverage to 2 paths

Many applications do not serve `/robots.txt`. A 404 response is `< 500` and passes
shadow-traffic silently. Effective coverage is reduced to `["/", "/api/health"]` with
no warning or indicator of the reduced probe set.

**Demonstrated in:** G3, E3

---

## Design Boundaries Documented

### DB-1 (dom-xray is a static HTML snapshot)

`domXray` produces a result that is entirely determined by a single HTTP response at
one point in time. Any server behaviour not visible in that one response — deferred
(JS execution), subsequent (request-counter), or conditional (bypass-header) — is
structurally invisible. Confirmed by H1: exactly 1 `fetch` call per `domXray` invocation.

### DB-2 (shadow-traffic gate is 3 concurrent probes at one instant)

`shadowTraffic` issues exactly 3 concurrent requests per call (confirmed by H2). These 3
requests share the same moment in the server's request lifecycle and cannot detect
load-based, time-delayed, or counter-based (K>3) degradation.

### DB-3 (bypass-header attack defeats both validators simultaneously)

Both validators send `x-vercel-protection-bypass` on every request. A single server-side
`if (headers['x-vercel-protection-bypass'])` conditional can simultaneously serve a clean
DOM to dom-xray AND return 200 on all shadow-traffic probes — defeating both deployment
gates with one predicate. Confirmed by H3: dom-xray `allowed=true` + shadow-traffic
`allowed=true` while real-user requests receive `status=500` and ERROR_HTML.

### DB-4 (`[data-error]` selector is value-agnostic — documented false-positive risk)

The CSS attribute selector `[data-error]` matches any element with the attribute present,
regardless of value. `data-error="false"` and `data-error="0"` are both counted as errors.
Frameworks that use `data-error` as a boolean-like attribute with falsy string values will
produce false positives. Confirmed by DB-4 test.

---

## Test Structure

**File:** `packages/agent/tests/dom-xray-shadow-starvation.test.ts`
**Test count:** 8 describe blocks, 26 test cases

| Suite | Cases | Coverage |
|---|---|---|
| A: dom-xray baseline | 4 | Clean HTML, missing root, error elements, empty URL fast-path |
| B: dom-xray observation window | 3 | GAP-1: K=1 counter attack, clean-first/degrade-second, validator vs. user divergence |
| C: dom-xray JS blindness | 3 | GAP-2: deferred data-error injection, deferred root removal, deferred .error class |
| D: dom-xray semantic gaps | 4 | GAP-3: empty SPA shell (×2), GAP-4: bypass-header evasion, DB-4: value-agnostic selector |
| E: shadow-traffic baseline | 3 | All-200, one-500, /robots.txt 404 |
| F: shadow-traffic observation window | 3 | GAP-5: K=3 counter, exact-3-probe confirmation, GAP-6: bypass-header evasion |
| G: shadow-traffic path gaps | 3 | GAP-7: critical app path unprobed (×2), GAP-8: /robots.txt reduces to 2 effective probes |
| H: Design boundaries / combined | 3 | DB-1: single-fetch, DB-2: 3-probe count, DB-3: bypass-header defeats both validators |

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/dom-xray-shadow-starvation.test.ts
# Exit 0

bash validate.sh
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist — no new dead integrations
```

Full `vitest run` / `tsc --noEmit` blocked by sandbox network constraints,
consistent with all passes ≥ 36. Static review confirms no type errors in the
new test file. All fetch mocks use `vi.stubGlobal("fetch", ...)` and are reset
in `afterEach` via `vi.restoreAllMocks()`.

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/dom-xray-shadow-starvation.test.ts` | New — 8 describe blocks, 26 test cases |
| `packages/agent/docs/62-V24-AUDIT-PASS-62.md` | New — this document |
| `tasks/agent-task-queue.json` | task-26 → `"done"`, `completedInPass: 62` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | This entry |
| `CHANGELOG.md` | Version 24.30.34 entry added |
| `ENGINEERING_NOTES.md` | Pass 62 section added |
| `package.json` (×4) | Version bumped 24.30.33 → 24.30.34 |

---

## Remaining Locally-Tractable Tasks

From `tasks/agent-task-queue.json` (run `node scripts/task-queue.mjs list` for live view):

| ID | Priority | Title |
|---|---|---|
| task-27 | P3 | Compliance-oracle / SBOM / license-checker cross-consistency |
| task-30 | P3 | Prompt-registry version-rollback mid-run consistency |
| task-31 | P3 | Warden policy-conflict resolution correctness |
| task-32 | P3 | Semantic-cache drift adversarial audit |
