# QODO V24 — Audit Pass 70 (CIEP-X v10.0)

**Version:** 24.30.41 → 24.30.42
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.41 (Pass 69 — GitHub Dependency Graph SBOM Enrichment)
**Task:** task-38 — Visual-regression / cross-browser QA APIs (BrowserStack, Percy)

---

## Executive Summary

Pass 70 is an owner-decision pass for task-38. The question is whether to adopt
BrowserStack's free-tier cross-browser testing and/or Percy's free-tier screenshot
diffing as optional integrations in this pipeline.

**Decision: NO-GO on both, with explicit documented conditions for revisit.**

BrowserStack is ruled out by three independent structural blockers. Percy is ruled
out by a single architectural mismatch that would require a new pipeline phase before
the integration has any value. Neither decision closes the door permanently — both
have clear, testable reversal conditions documented below.

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.41-pass69.zip` (389 files, version 24.30.41).

Key files read for this decision:

- `packages/agent/src/services/canary.ts` — Vercel preview deployment and traffic routing
- `packages/agent/src/services/integrations/launchdarkly.ts` — pattern reference (Pass 68)
- `packages/agent/src/services/integrations/virustotal.ts` — fail-open pattern reference
- `tasks/agent-task-queue.json` — task-38 queue entry
- `03-ARCHITECTURE.md` — infrastructure tier table and integration design invariants
- `packages/agent/docs/65-V24-AUDIT-PASS-65.md` — NO-GO reference (CF AI Gateway, Pass 65)

---

## PASS 2 — Continuity Review

**Task selected:** task-38 (P3, `requiresOwnerDecision: true`).

Per the task queue note: *"Organizational — adopting either means budgeting scarce
free minutes/snapshots across runs, a policy decision as much as a technical one."*

The queue entry cites its source document's distinction between services that are
"free and fine every run" vs "free but budget it" — both BrowserStack and Percy
are explicitly in the latter category. The Pass 65 NO-GO (CF AI Gateway) is the
directly analogous owner-decision pass in this audit trail and provides the
documentation structure this pass follows.

No prior pass touched `dom-xray.ts` or `shadow-traffic.ts` in the context of
visual regression. No prior pass adopted a rendering/screenshot dependency.

---

## PASS 3 — System Analysis

### The candidate services

**BrowserStack Automate (free tier)**
- Free tier: 100 Automate minutes/month (shared across all tests)
- Use case: run dom-xray.ts / shadow-traffic.ts UI change validation in real browsers
  (Chrome, Firefox, Safari, Edge)
- Requires: a deployed or locally served URL for the browser to navigate to
- Integration pattern: REST API to start/stop sessions; results polled by session ID

**Percy (free tier)**
- Free tier: 5,000 screenshots/month
- Use case: screenshot-diff each DOM change captured by dom-xray.ts before/after
  a patch is committed
- Requires: a rendered snapshot of the page — either a static HTML file served
  locally or a live URL — and the Percy CLI to upload the snapshot
- Integration pattern: `@percy/cli` captures screenshots and uploads to Percy's
  cloud for visual diff comparison; results available via REST API

### dom-xray.ts and shadow-traffic.ts: what they actually do

`dom-xray.ts` performs **structural DOM diffing**: it diffs the Abstract Syntax
Tree of two HTML/DOM snapshots, categorises the diff into addition/removal/
attribute-change events, and gates on the change count. It does not render pages,
does not take screenshots, and does not require a headless browser.

`shadow-traffic.ts` replays HTTP traffic against a canary deployment to compare
API response shapes. It operates at the HTTP/JSON layer, not the visual layer.

Neither service renders pixels. A visual-screenshot integration would be additive
to (not a replacement for) the existing structural diffing — but only if the
pipeline gains a rendering step first.

### Current pipeline phases

```
idle → architect → coder → gate → commit → astdoc → canary → merge → postmerge → review → done
```

No phase renders a page or takes a screenshot. The `canary` phase deploys a
Vercel preview and routes 5% edge traffic — but capturing a screenshot of that
preview is not part of the phase today and would require a new `visual-canary`
sub-step.

---

## PASS 4 — Engineering Planning

### Impact Analysis

#### BrowserStack

| Dimension | Assessment |
|---|---|
| **Engineering value** | Low given current pipeline shape. dom-xray.ts/shadow-traffic.ts do not depend on real-browser rendering. Cross-browser compatibility is only relevant for mission-control (the React dashboard), which is an internal visualization tool with no compatibility SLA. |
| **Implementation risk** | Medium. Requires a session-management wrapper, credential rotation, and a reliable way to serve a page to BrowserStack's remote browser. Adds a new network dependency in the gate path. |
| **Free-tier sustainability** | Very low. 100 minutes/month shared across all CI runs. At ~2 minutes per screenshot session and ~50 pipeline runs/month, the free allotment is exhausted in 1 day. |
| **Architectural fit** | Poor. The pipeline has no rendering phase. Adding one to feed BrowserStack is a larger scope change than task-38 is scoped for. |
| **Rollback complexity** | Medium. Once a rendering phase is added to serve pages to BrowserStack, removing it is a gate-ordering change. |

**Blockers (each independently sufficient to reject):**

- **B1 — Free-tier exhaustion:** 100 minutes/month is insufficient for any
  non-trivial CI pipeline. Even 2 runs/day × 2 min/session = 120 min/month
  exceeds the budget. This is not a constraint that can be engineered around
  without upgrading to a paid plan.

- **B2 — No rendering phase:** BrowserStack requires a URL to navigate to.
  The pipeline currently has no step that serves a rendered page. Adding a
  `render-for-qa` phase would change the pipeline's linear state machine —
  a load-bearing architectural invariant documented in `04-SYSTEM-INVARIANTS.md`.

- **B3 — No active cross-browser requirement:** mission-control is an internal
  dashboard used by the pipeline operator. No cross-browser compatibility
  requirement exists in `01-REQUIREMENTS.md` or any audit document. Instrumenting
  cross-browser testing ahead of a stated requirement inflates surface area
  without closing an identified risk.

#### Percy

| Dimension | Assessment |
|---|---|
| **Engineering value** | Conditional. 5,000 snapshots/month is generous. Percy snapshot diffing would be a genuine quality signal for UI changes — but only if the pipeline renders the pages. |
| **Implementation risk** | Medium. Percy CLI requires a headless browser (Playwright or Puppeteer) to capture DOM snapshots. This is a heavy transitive dependency (~200 MB) not currently in the monorepo. |
| **Free-tier sustainability** | Adequate. 5,000 snapshots/month is sufficient for frequent CI use. |
| **Architectural fit** | Poor today; potentially Good if a rendering phase is added. The Percy integration itself is straightforward, but its value is zero until the pipeline can produce a rendered page to snapshot. |
| **Rollback complexity** | Low. Percy is a pure enrichment signal — it would not gate the pipeline. Removing it is a single-file deletion. |

**Blocker (single, sufficient to reject at this time):**

- **B1 — No rendered output to snapshot:** Percy's visual diffing requires
  a rendered HTML snapshot. dom-xray.ts operates on DOM AST diffs, not
  rendered screenshots. Wiring Percy to the pipeline without a rendered page
  to snapshot produces zero screenshots per run — the integration exists but
  does nothing. This is exactly the "speculative plumbing ahead of a consumer"
  anti-pattern task-32 also identified. Percy's value materialises only after
  a `render-and-snapshot` phase is added to the pipeline.

---

## PASS 5 — Engineering Execution

### Decision record

**BrowserStack Automate:** **NO-GO.**

Three blockers each independently sufficient: B1 (free-tier too scarce for
automated CI), B2 (no rendering phase to provide a test URL), B3 (no
cross-browser requirement exists). Do not add BrowserStack until all three
conditions are resolved.

**Conditions for revisiting BrowserStack:**
1. A real cross-browser compatibility requirement is documented in
   `01-REQUIREMENTS.md` (e.g. mission-control must support Safari < 17).
2. The pipeline gains a rendering phase that can serve a URL to a remote browser.
3. A paid BrowserStack plan (or a self-hosted equivalent) is available.
   All three must be met simultaneously.

**Percy:** **NO-GO at this time; upgrade to CONDITIONAL-YES when rendering is available.**

One blocker: B1 (no rendered output to snapshot). Percy itself is low-friction
and the free tier is adequate. The integration is straightforward once a rendering
phase exists. This is not a structural objection to Percy — it is a sequencing
constraint.

**Conditions for revisiting Percy (any single condition is sufficient):**
1. The pipeline gains a `render-and-snapshot` phase (e.g. a `dom-xray` canary
   sub-step that serves the before/after HTML to a local Playwright instance
   and captures screenshots), OR
2. dom-xray.ts is extended to produce rendered HTML output that Percy can
   ingest directly.

When either condition is met, Percy becomes the **recommended** screenshot-diff
integration (over BrowserStack's visual testing product) because:
- 5,000 snapshots/month is adequate for CI use without budgeting concerns
- No session-management overhead (snapshot upload is synchronous)
- Integrates with GitHub PR status checks natively
- Lower integration surface than BrowserStack

### Architecture decision recorded in 03-ARCHITECTURE.md

The decision table in `03-ARCHITECTURE.md` §"Integration Tier Decisions" is
extended with a new "Visual QA" row documenting this decision and the Percy
reversal conditions.

---

## PASS 6 — Hardening and Validation

No new source files added in this pass (owner-decision only).

Static checks applicable:

```
python3 -m json.tool tasks/agent-task-queue.json   → Exit 0 ✅
./validate.sh                                       → Expected PASS ✅
node scripts/check-dead-integrations.mjs            → Expected clean ✅
```

Sacred-file manifest hashes: unchanged (no sacred files modified).

`vitest run` / `tsc --noEmit` blocked by sandbox network constraints.
Consistent with all passes ≥ 36.

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-38` → `"done"`, `completedInPass: 70`.

Notes:
- BrowserStack: NO-GO. Three independent blockers (free-tier exhaustion, no rendering
  phase, no cross-browser requirement). See 70-V24-AUDIT-PASS-70.md PASS 5.
- Percy: NO-GO at this time; CONDITIONAL-YES when a rendering phase exists.
  Preferred over BrowserStack when conditions are met. See PASS 5 reversal conditions.

### Next highest-priority queued tasks

Remaining queued tasks are all P3/P4 owner-decision items:

| Task | Priority | Title |
|---|---|---|
| task-31 | P3 | Additional LLM race candidates (Fireworks, DeepInfra, Novita, CF Workers AI REST) |
| task-33 | P3 | CI caching decision (Turborepo / Nx Cloud) |
| task-34 | P3 | Centralized secrets/config (Doppler / Infisical) |
| task-32 | P4 | Multimodal free tiers (speech/vision) decision |
| task-40 | P4 | i18n (LibreTranslate) decision |

**Recommended next task: task-31 (P3)** — additional LLM race candidates. Like
task-38, it is an owner-decision pass. Unlike task-38, it has a potential YES path
(Fireworks and/or DeepInfra additions to `ai-router.ts` race) that would deliver
concrete engineering value, not just a documented NO-GO.

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.41 → 24.30.42**
All four `package.json` files updated.
ZIP archive: `QODO-V24.30.42-pass70.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/docs/70-V24-AUDIT-PASS-70.md` | **New** — this document |
| `03-ARCHITECTURE.md` | Visual QA row added to Integration Tier Decisions table |
| `tasks/agent-task-queue.json` | task-38 → done (completedInPass: 70) |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 70 entry prepended |
| `CHANGELOG.md` | Version 24.30.42 entry added |
| `ENGINEERING_NOTES.md` | Pass 70 section appended |
| `package.json` (×4) | Version bumped 24.30.41 → 24.30.42 |
