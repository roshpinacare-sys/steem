# Product Evolution Roadmap — Qodo V24 (2026-07)

An owner-level analysis (founder / CTO / principal architect / product) of
where this product is, what's missing, and what to build next. Every
capability claim below carries a file reference from a read-only audit of
this tree — nothing here is aspirational description of code that doesn't
exist. Companion documents: `docs/PRODUCT-REVIEW.md` (user-friction audit),
`docs/ARCHITECTURE.md` (how the system works today).

**The one-sentence thesis:** the product's differentiation is a *verifiable
guardrail chain* — audit log, 5-gate validation, trust ledger, kill switch,
human approval — but two of those loops are open circuits today, and closing
them is worth more than any new feature.

---

## 1. Current capability assessment

### 1.1 Execution capabilities (what the agent can actually *do* on a machine)

| Capability | State | Evidence |
|---|---|---|
| Run the target repo's tests | **Wired, deliberately narrow** | `packages/agent/src/services/edge-test-offload.ts:156` — exactly `spawn("npm", ["test"], { shell: false })` in the checkout; no LLM-chosen command ever reaches a shell |
| Client-side sandboxed test execution | **Wired, opt-in** | `apps/mission-control/src/App.tsx:246` runs `QODO_TEST_COMMAND` in a browser WebContainer, gated by an allowlist (`edge-test-offload.ts:37-51` `assertSafeTestCommand`) |
| Install target-repo dependencies | **Missing** | No `npm install`/`npm ci` for the *target* repo anywhere in the agent; tests run against whatever the Actions checkout has |
| Arbitrary/parameterized command execution | **Absent by design** | No `exec`/`shell:true`/template-built command strings in `src/` — a real safety property worth preserving |
| PowerShell / Windows support | **Missing entirely** | No `powershell`/`pwsh`/`cmd.exe` reference in the tree; runner assumption is ubuntu + npm |
| Server-side sandbox (container/VM per mission) | **Missing** | Only execution venues are the GitHub Actions runner itself and the user's browser WebContainer |
| Environment setup automation | **Partial, human-facing only** | `bootstrap.mjs` (`--verify`, `--live`) checks/pushes credentials for the *operator*; the agent never provisions its own environment |
| Agent-driven repair/recovery | **Wired** | Redis checkpointing + resume across all phases (`src/pipeline/run-pipeline.ts`); auto-revert on canary/SRE failure; `incident-resolver.ts` + `sre-feedback.ts` wired into `src/pipeline/phases/postmerge.ts` |
| Approval-gated dangerous operations | **Half-wired — see §1.2** | Dry-run halts before Ghost Commit/canary/merge (`src/services/dry-run.ts`); mentor approval polls a key nothing writes |

### 1.2 The two open loops (the decisive findings)

1. **Mentor approval is a dead end.** `waitForMentorApproval`
   (`packages/agent/src/pipeline/helpers.ts:125`) polls Redis key
   `qodo:v24:mentor:{owner}:{repo}:{pr}` for up to 30 minutes. **Nothing in
   this repository writes that key.** Mission Control's ApprovalGate renders
   real Approve/Reject buttons (`apps/mission-control/src/components/ApprovalGate.tsx:258,241`),
   but the handlers (`apps/mission-control/src/App.tsx:317-331`) only mutate
   local dismissal state. Every risk-routing mechanism — uncertainty
   sampling, the Supervisor's escalation — funnels high-risk work into a
   guaranteed 30-minute timeout. Supervised autonomy, the product's core
   promise, is currently fiction.
2. **`/qodo proceed` resumes nothing by itself.** The webhook receiver
   (`packages/agent/worker/webhook-receiver.js`) translates the PR comment
   into a `pipeline_resume` trigger, but the Redis trigger queue has
   producers and **no consumer**; only a manual `workflow_dispatch` actually
   starts the pipeline again.

### 1.3 What is genuinely strong today

- **Guardrails that are wired, not written**: kill switch (`QODO_HALT`),
  hash-chained audit log with CI verification (`audit-verify` job),
  SHA-pinned sacred files, secret/path guards, per-category trust ledger,
  functional dry-run. CI proves the chain on every push.
- **Crash-safe orchestration**: every phase checkpoints to Redis and resumes
  transparently; the phase state machine is typed (`src/pipeline/context.ts`).
- **Memory that exists and is consumed**: warden-memory, hive cache,
  rationale bank, and run history are real, wired systems — rare in
  agent codebases, where "memory" is usually a README aspiration.
- **Honest verification culture**: 0 typecheck errors, 1,139 tests, a
  dead-integrations CI check that fails the build when an export has no
  call site, and `docs/history/` quarantining pre-verification claims.

### 1.4 Known silent degradations

- **SRE watch no-ops without observability credentials** — post-merge
  "monitoring" quietly does nothing if OTEL/vitals config is absent. A user
  who skipped those env vars believes they have auto-revert protection they
  don't have.
- **Skills are static**: three fixed prompt fragments selected by an env
  var — no per-mission selection, no learning.
- **Calibration data is collected and never consumed** — the confidence
  loop writes records nobody reads.

---

## 2. Missing capabilities (mapped to the execution checklist)

| Checklist item | Verdict | Notes |
|---|---|---|
| PowerShell command execution | Missing; **recommend NOT building** | The product is a GitHub-native delivery agent; its execution venue is a Linux runner. Windows-host automation is a different product. Revisit only if a paying-user segment demands it. |
| npm / package installation | Missing for the target repo | Real gap: gates test the repo as checked out; a mission that changes `package.json` is validated against stale `node_modules`. Fix inside the existing safe pattern: fixed argv `spawn("npm", ["ci"], {shell:false})` before the test run, never LLM-composed. |
| Dependency management | Partial | Lockfile gate exists (validator #1); no automated dependency *update* flow. The janitor mode is the natural home for a Renovate-like pass — backlog, not now. |
| Environment setup automation | Operator-side only | `bootstrap.mjs --verify/--live` is good and shipped. Agent-side: a **self-diagnostics pipeline phase** (run the same checks at mission start, halt early with a named missing credential) is cheap and high-value. |
| Local machine setup | Missing; **recommend NOT building** | Same reasoning as PowerShell: setting up developer laptops is out of scope for a CI-native delivery agent. |
| Sandboxed execution | Browser WebContainer only (opt-in) | A server-side sandbox (ephemeral container per mission) is the right long-term answer *if* the agent ever runs LLM-chosen commands. As long as execution stays fixed-argv, the Actions runner + `shell:false` is defensible. Sequence the sandbox *behind* demand for flexible execution, not before. |
| Agent-driven repair & recovery | Largely present | Checkpoint/resume, canary auto-revert, incident-resolver. Gap: recovery from *gate* failures is "halt and report", not "diagnose and retry with the failure in context" — a bounded retry-with-feedback loop in the Coder phase is a real intelligence win. |
| Safe command execution with approval gates | Approval gate is open-circuit | See §1.2. This is the roadmap's #1 item. |

---

## 3. The ideal user experience (and today's gaps)

The mission lifecycle a user should get:

1. **Submit** an objective (UI or `workflow_dispatch`) → immediate ack with
   a mission ID. *Today: workflow_dispatch form or Redis queue; the UI has
   a dispatch console but the primary path is GitHub.*
2. **Plan approval** — see the Architect's typed plan and its blast radius
   *before* code is written; approve/redirect from the dashboard. *Today:
   plan is visible in telemetry; approval is the open loop.*
3. **Live progress** — phase-by-phase, with cost. *Today: 3-D pipeline view
   works via SSE; cost-summary events are emitted but the UI ignores them.*
4. **Checkpoint approvals** — Ghost Commit and merge pause for a human when
   risk demands it; a phone-friendly surface, because approvals arrive when
   you're away. *Today: 30-minute timeout theater. The Android APK build
   (this iteration) gives the dashboard a phone form factor — closing the
   approval loop makes it a real remote control.*
5. **Result** — merged PR + canary verdict + SRE watch summary in one view.
   *Today: scattered across PR comments and telemetry.*
6. **History** — per-repo run history with trust-ledger trajectory.
   *Today: data exists in Redis; no UI.*

Microcopy/friction wins already shipped (see `docs/PRODUCT-REVIEW.md`):
`bootstrap.mjs --verify`, zero-config `--help`, first-run SetupNotice panel.

---

## 4. Pipeline review: if this served millions, what fails first?

Ordered by when it breaks as load grows:

1. **Approval timeout theater** breaks at user #1 (see §1.2) — before any
   scale question.
2. **GitHub Actions as the only executor**: one mission = one 45-minute
   runner slot; concurrency = your Actions plan; cold-start `npm ci` every
   run. Fine to ~tens of missions/day, then queueing dominates. The k8s/KEDA
   manifests exist (`k8s/`) but the image is never published — a one-job CI
   change unlocks the horizontal path.
3. **Redis blob-JSON state**: whole-state `getJSON`/`setJSON` per phase
   transition; no compare-and-set. Two concurrent missions on one PR would
   interleave; today a single-run lock prevents it, which caps throughput at
   one mission per repo at a time.
4. **Telemetry as unbounded Redis lists + polling fallbacks** — grows
   forever, read O(n); needs TTL/stream truncation before any real fleet.
5. **Secrets as ~70 env vars** — per-repo onboarding cost is the growth
   ceiling. A GitHub App (scoped installation token) replaces the PAT and
   most of the onboarding friction.

None of these need fixing *now* — the product has ~1 user. But the order
matters: it tells you what to fix at 10 users (1, 2) vs 1,000 (3, 4, 5).

---

## 5. Automation & intelligence opportunities

- **Self-diagnostics as pipeline phase 0**: `bootstrap.mjs --verify` logic
  already exists; run it at mission start and fail in seconds with a named
  missing credential instead of 20 minutes in with a stack trace.
- **Gate-failure retry with feedback**: on a 5-gate failure, feed the gate's
  structured verdict back to the Coder for one bounded retry before
  halting. Converts the most common halt into a self-healed run.
- **Consume the calibration data**: the uncertainty-sampling loop writes
  confidence records; use them to auto-tune the mentor-mode threshold
  (which becomes meaningful once the approval loop closes).
- **Supervisor-selected skills**: replace the env-var skill switch with
  selection from mission metadata. Low effort; do it opportunistically.
- **SRE loudness**: when observability creds are absent, say so in the PR
  comment ("merged WITHOUT post-merge monitoring") instead of silence.

---

## 6. Technology landscape: fixed pipeline vs modern agent loops

Modern agent architectures (tool-use loops where the model chooses actions)
beat fixed pipelines at *flexibility* — they can install deps, run arbitrary
diagnostics, iterate. This codebase is the opposite: a **fixed,
auditable state machine** where the LLM only ever fills typed slots (plan,
patch) and never picks commands.

**Owner judgment: the fixed pipeline is the moat, not the debt.** Every
enterprise conversation about agents ends at "how do I audit what it did and
stop it?" — this product's answer (hash-chained audit log, deterministic
phases, kill switch, bonds) is *structurally* better than a tool-loop's
"here's the transcript". Do not rebuild as a free-form agent loop.

Where the landscape genuinely leads and it's worth borrowing:

- **Inner-loop iteration**: a *bounded* retry-with-feedback inside the Coder
  phase (§5) captures most of a tool-loop's self-correction value without
  giving up phase-level auditability.
- **Eval harness**: modern agent teams regression-test the *agent* (fixed
  objective corpus → scored outcomes), not just the code. The local
  simulator is the seed of this; a scored eval corpus is the missing piece.
- **Sandboxing**: if flexible execution is ever added, it goes in an
  ephemeral container with the same audit hooks — never on the runner.

---

## 7. Founder analysis

- **The moat**: the verifiable guardrail chain. "The safest way to let an
  agent touch production" — provided the human-approval loop actually
  closes. Guardrails you can *prove* (CI-verified audit chain) are the
  defensible asset; code generation is a commodity rented from model APIs.
- **Build next**: close the loops (§8 Phase A). Everything else compounds
  on top of a working supervised-autonomy story.
- **Remove / refuse**: PowerShell & local-machine setup (different
  product); free-form agent loop (destroys the moat); more LLM roles
  (the 9 personas already outnumber the users).
- **Redesign later, not now**: Redis blob state → per-key CAS state (at
  multi-tenant scale); PAT → GitHub App (at onboarding-friction pain).
- **The phone story**: an APK of Mission Control (shipping with this
  iteration) turns "dashboard" into "the pager for your autonomous agent" —
  approve a Ghost Commit from your phone. That's a demo that sells the
  entire thesis in ten seconds, and it only works if Phase A lands.

---

## 8. Ranked opportunities & implementation phases

| # | Opportunity | Value | Effort | Risk |
|---|---|---|---|---|
| 1 | **Close the mentor-approval loop** (worker endpoint + UI wiring + `/qodo approve` fallback) | Critical — makes the core promise real | Low-medium | Low: all components exist; ~3 focused changes |
| 2 | Self-diagnostics phase 0 (reuse `--verify` logic) | High | Low | Minimal |
| 3 | SRE / silent-degradation loudness | High (trust) | Low | Minimal |
| 4 | Gate-failure bounded retry with feedback | High | Medium | Medium: needs cost cap + loop bound |
| 5 | Cost panel + run history in Mission Control (data already emitted) | Medium-high | Medium | Low; needs frontend test harness first |
| 6 | `npm ci` for target repo before gate tests (fixed argv) | Medium | Low | Low |
| 7 | Agent eval corpus (scored simulator missions) | Medium (compounds) | Medium | Low |
| 8 | GitHub App auth | Medium-high at scale | Medium-high | Auth-path complexity |
| 9 | Publish k8s image in CI | Medium | Low | Registry decision |
| 10 | Trust-ledger-gated auto-merge (`canAutoMerge` → merge phase) | High later | Medium | Behavior change; needs eval corpus (#7) first |

**Phase A — "Close the Loop" (next implementation phase, proposed):**
telemetry-proxy worker gains an auth-gated `POST /mentor/decision` that
writes the exact Redis key `waitForMentorApproval` polls; ApprovalGate
buttons call it; `/qodo approve|reject` PR-comment fallback in the webhook
receiver; startup fails loudly if mentor mode is enabled without a
reachable proxy. *Validation:* e2e — a paused run resumes within one poll
interval of a dashboard click and of a PR comment; rejection halts with the
reason in the audit log; timeout path still audited.

**Phase B — "Never fail silently":** self-diagnostics phase 0; SRE loudness;
`npm ci` before gate tests; cost surfaced in the PR comment.
*Validation:* a mission with a missing credential halts in <60s naming it; a
merge without observability creds says so on the PR.

**Phase C — "Compounding intelligence":** gate-failure retry with feedback;
eval corpus; calibration consumption; then trust-gated auto-merge.
*Validation:* retry converts ≥30% of gate-failure halts in the eval corpus;
auto-merge ships only behind a bond threshold with the eval corpus green.

---

## 9. Validation criteria for this roadmap itself

- Every §1 capability claim is checkable at the cited file/line.
- No phase proposes new infrastructure before a phase that uses it.
- Success metric is user-visible behavior (a run resumes, a halt names its
  cause), never "code exists".
