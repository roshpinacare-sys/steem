# Agent Task Queue — Usage Notes

**File:** `tasks/agent-task-queue.json`
**Helper script:** `scripts/task-queue.mjs`

## What this is

A checked-in, machine-readable backlog of hard-but-high-value engineering
items, seeded 2026-07-07 from an external planning pass covering the
Pass 1–35 (monorepo) and Pass 1–4 (standalone-harness) audit tracks. It
replaces an external planning doc that was never part of this archive —
the substance of that doc is fully captured here so nothing is lost by its
absence.

This is a **queue, not an execution prompt**. It exists so the next agent
picking up this repo can find the highest-priority unblocked item without
re-deriving the whole backlog from scratch, not so an agent works through
every item in one sitting.

## Rules for consuming this queue (CIEP-compatible)

> **See also `tasks/AGENT-PRINCIPLES.md` (added 2026-07-08).** It adds a
> standing "think before executing" requirement, an admin-board convention
> for owner-decision tasks, an archive convention for verified-done tasks,
> and flags rule 1/5 below (one task per pass) as itself under review —
> see task-54. Nothing below is superseded yet; task-54 must land as an
> explicit owner decision before rule 1/5 changes.

1. **One task per pass.** Pick exactly one task with `status: "queued"` and
   an empty (or fully-`"done"`) `blockedBy` list — prefer the lowest
   `priority` number among eligible tasks.
2. **Impact Analysis first.** Before writing code, write a short Impact
   Analysis (engineering value, implementation risk, compatibility impact,
   rollback complexity) as its own entry in `06-CHANGELOG.md`, the same way
   Pass 36 documented the sacred-file-integrity work.
3. **Implement, validate, document in the same pass.** Run
   `./validate.sh` and `node scripts/check-dead-integrations.mjs` before
   closing the task. If full `vitest`/`tsc` can't run (no network), say so
   explicitly in the changelog entry rather than silently skipping it.
4. **Update the queue in the same pass** you close a task — set `status`
   to `"done"`, add `completedInPass`, and a one-line `notes` pointer to
   the changelog entry. Use `scripts/task-queue.mjs done <id> <pass>` for
   this rather than hand-editing where practical.
5. **Do not attempt more than one task per pass**, even if several are
   unblocked. Scope creep here is exactly what the CIEP protocol's
   "complete finished work before expanding scope" principle exists to
   prevent. *(Under review — see task-54: this ceiling was a reasonable
   default for a small hand-reviewed queue, not a permanent law. Do not
   relax it unilaterally; task-54 must resolve as an explicit owner
   decision first, with a concrete replacement rule, not just a removal.)*
6. **Re-triage, don't blindly inherit.** Several tasks' `requiresNetwork`
   flags here were re-assessed from the original planning doc (e.g.
   task-7, task-8, task-9, task-11, task-12, task-13 were originally
   assumed network-blocked but are actually locally tractable in whole or
   in scoped part). If a task turns out to need more than the queue
   entry assumes once you're inside it, correct the entry and say why —
   don't silently do less than the task asked and mark it done anyway.
7. **Think before executing (see `tasks/AGENT-PRINCIPLES.md` #1).** Before
   implementing a task exactly as worded, spend a short analysis step on
   whether a simpler/cheaper/safer approach reaches the same validated
   outcome, and record that reasoning in the pass's changelog entry.

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable identifier, matches the original backlog numbering (`task-N`). |
| `priority` | 1 (highest) – 4 (lowest). Lower number = attempt sooner among unblocked tasks. |
| `requiresNetwork` | `true` if the task cannot be meaningfully started without network/registry/live-API access. |
| `requiresOwnerDecision` | `true` if the deliverable is a decision/doc, not code. |
| `blockedBy` | Array of `id`s that must be `"done"` first. |
| `status` | `"queued"` \| `"blocked"` \| `"done"`. `"blocked"` means `requiresNetwork` or an unmet `blockedBy`, not "do not think about this." |
| `readyToArchive` | *(new 2026-07-08, task-53)* `true` only once a `"done"` task has been re-verified working in the same pass that closes it. See `tasks/AGENT-PRINCIPLES.md` #3 — this is not yet enforced by tooling until task-53 lands. |

## Current status snapshot

Run `node scripts/task-queue.mjs list` for the live view; updated 2026-07-08
after task-47..task-54 were seeded outside the normal pass cycle (no code
changes made in this update — queue seeding + one repo-hygiene fix only,
see `06-CHANGELOG.md`):

    - **Done (33 tasks):** task-3 (Pass 42), task-7 (Pass 51), task-8 (Pass 45),
    task-9 (Pass 52), task-10 (Pass 46), task-11 (Pass 43), task-12 (Pass 59),
    task-13 (Pass 47), task-14 (Pass 36), task-16 (Pass 53), task-17 (Pass 54),
    task-18 (Pass 48), task-19 (Pass 55), task-20 (Pass 49), task-21 (Pass 60),
    task-22 (Pass 50), task-23 (Pass 61), task-24 (Pass 56), task-25 (Pass 57),
    task-26 (Pass 62), task-27 (Pass 63), task-28 (Pass 58), task-29 (Pass 40),
    task-30 (Pass 64), task-35 (Pass 65), task-36 (Pass 67), task-37 (Pass 69),
    task-39 (Pass 68), task-46 (Pass 66), task-38 (Pass 70), task-31 (Pass 71),
    task-33 (Pass 72), task-34 (Pass 73).
    - **Queued — owner-decision (6 tasks):**
    task-32 (P4), task-40 (P4), task-48 (P2, Neon/Upstash/D1 vs current stack),
    task-49 (P3, GitHub Issues/Actions as queue backend), task-50 (P3, TPU
    Research Cloud / idle-device mesh for batch compute), task-54 (P2,
    revisit one-task-per-pass ceiling).
    - **Queued — code tasks (3 tasks):** task-47 (P2, multi-provider quota-gauge
    cost tracking), task-51 (P3, quota gauges in mission-control dashboard,
    blocked on task-47), task-52 (P2, Admin Decisions panel for
    owner-decision tasks), task-53 (P3, readyToArchive + archive command,
    blocked on task-52).
    - **Blocked (network or owner decision required) — 11 tasks:** task-1
    (also blocked by task-2), task-2, task-4 (also blocked by task-3),
    task-5, task-6, task-15, task-41, task-42, task-43, task-44, task-45.

    task-47..task-54 seeded 2026-07-08 from two external planning notes
    (free-compute energy-taxonomy survey; zero-cost infrastructure survey)
    plus two direct owner requests (admin board for owner-decision tasks;
    archive mechanism for verified-done tasks; and a request to revisit the
    one-task-per-pass ceiling — task-54). See `tasks/AGENT-PRINCIPLES.md`
    for the standing "think before executing" instruction added alongside
    these.

    task-47 completed in Pass 76 (extended the EXISTING quota-guardian.ts
    header-driven tracker rather than building a second EnergyQuotaState in
    cost-ledger.ts as originally assumed; added percentUsed/near-exhaustion
    alerting + fixed a real openrouter header-mapping bug found while
    implementing; see docs/history/audits/76-V24-AUDIT-PASS-76.md).
    task-56 completed in Pass 75 (relay-lineage.ts: automatic parent-receipt
    pickup, wired into helpers.ts audit() and receipt-emitter.ts; one small
    additive cli.ts fix for the --rehearse pre-flight chain-start case;
    see docs/history/audits/75-V24-AUDIT-PASS-75.md).
    task-55 completed in Pass 74 (receipt `lineage` block + genesis-override
    in audit-log.ts/receipt.ts/verify-receipt.mjs — cross-hop composability
    for relay receipts; see `docs/history/audits/74-V24-AUDIT-PASS-74.md`).
    task-34 completed in Pass 73 (Doppler NO-GO; Infisical NO-GO; status quo KEPT; 2 bootstrap.mjs improvements queued).
    task-33 completed in Pass 72 (Turborepo CONDITIONAL-YES, 3 preconditions; Nx Cloud NO-GO).
    task-31 completed in Pass 71 (A3 LLM race candidates: Fireworks, DeepInfra, Novita, CF REST).
    task-38 completed in Pass 70 (BrowserStack NO-GO; Percy CONDITIONAL-YES when rendering available).
    task-37 completed in Pass 69 (GitHub-endpoint half; Sourcegraph half deferred).
    task-39 (LaunchDarkly canary) was completed in Pass 68 —
    see `packages/agent/docs/68-V24-AUDIT-PASS-68.md`.
    task-36 (Snyk/Socket.dev/VirusTotal) was completed in Pass 67 —
    see `packages/agent/docs/67-V24-AUDIT-PASS-67.md`.
    task-46 (Warden multi-violation audit) was completed in Pass 66 —
    see `packages/agent/docs/66-V24-AUDIT-PASS-66.md`.
    Next: task-47 or task-52 (P2, both locally tractable code tasks, no
    network required) — pick whichever the assigned agent judges lower-risk
    to start with; task-52 has no blockedBy and unblocks task-53.
