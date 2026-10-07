---
name: loop-doctor
description: "Use when designing, auditing, or repairing any recurring agent workflow, automation cadence, or self-driving loop in SAOS — brain cycles, keeper ticks, worker cadences, git-publish sweeps, or any 'run every N' behavior. Diagnoses weak checks, unsafe authority, unbounded repetition, stale state, and unclear stopping behavior. Enforces the feedback cycle (Observe -> Choose -> Act -> Verify -> Record -> Repeat-or-Stop) with named terminal states. Also use when turning repeated manual work into a bounded loop."
license: MIT
metadata:
  adapted-from: "alirezarezvani/claude-skills · loop-library/SKILL.md"
  saos-adoption: "v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY) — docs/CLAUDE-SKILLS-ADOPTION.md"
  code-level: "src/lib/saos/loop-discipline.ts — TERMINAL_STATES + classifyRunOutcome + compileGoal"
---

# Loop Doctor (SAOS adaptation)

Treat a loop as a **feedback system with terminal states**, not as permission for endless autonomy. Every SAOS cycle (brain, keeper, cadence worker, sweep) must be able to answer: what did it observe, what did it choose, what did it do, how does it know it worked, what did it record, and when does it stop?

## The six-step cycle

1. **Observe:** read fresh state and collect the agreed evidence. Never act on assumptions carried from an earlier cycle (re-read current state before consequential actions — the stale-code ship is the classic defect).
2. **Choose:** select the highest-value in-scope action from explicit criteria.
3. **Act:** make one bounded, reversible change or produce one candidate.
4. **Verify:** run the same acceptance check under recorded conditions.
5. **Record:** save the action, evidence, outcome, and remaining work (SAOS: artifact under scripts/artifacts/ + OpLog + worklog).
6. **Repeat or stop:** continue only while progress is measurable and any owner-set limit remains; otherwise enter a named terminal state.

## The seven named terminal states

Enforced in code by `src/lib/saos/loop-discipline.ts`:

`success` · `no-op` · `blocked` · `approval-required` · `exhausted` · `stagnated` · `fail`

**The law: never report an error, an exhausted budget, or a stalled loop as success.** A no-op (nothing needed doing) is a clean terminal state, not a failure and not a success. Missing evidence classifies as `fail` (fail-closed), never as "unknown".

## Loop Doctor audit checklist

Diagnose an existing loop; repair only material weaknesses without changing its intended outcome:

- [ ] **Observable gate** — can success be checked by a reproducible command, threshold, or rubric? "Until it looks right" is a material defect.
- [ ] **Named terminals** — are success, clean no-op, blocked, approval-required, exhausted, and stagnated defined? Is an error ever presented as success? (fatal)
- [ ] **Bounded action** — one reversible change per pass, not a batch of irreversible ones.
- [ ] **Fresh state** — does it re-read before acting, or does it run on yesterday's snapshot?
- [ ] **Authority boundary** — destructive/irreversible/production/financial/external-message actions require explicit approval (SAOS: owner-gated APIs, dcg guard, law-8).
- [ ] **Preserved unrelated work** — the loop never touches what it does not own (worktree/branch isolation for writers).
- [ ] **Stop rule** — a no-progress stop instead of an invented time/retry/limit where no owner limit exists; a named escalation path.
- [ ] **Separate signal from gate** — when a loop optimizes its own artifact, the acceptance check must be independent (same actor must not create and approve high-impact output).

## Discovering loop opportunities

Repeated work is a loop candidate when it occurred at least **two concrete times** (history-proven, not vibes): check OpLog, worklog, and commit history for semantically equivalent work. Repetition establishes the opportunity — the design above establishes the quality.

## Grounding rules

Use only facts found in scoped systems and files. Do not invent a schedule, metric, budget, permission, or deployment target. When a detail is unknown, use neutral wording or measure it — never present a guess as a "sensible default". Designing a loop does not authorize enabling a schedule or touching production: implement/activate only per the owner's standing directives.
