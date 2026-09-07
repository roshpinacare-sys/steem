# Agent Standing Principles (added 2026-07-08)

These apply on top of, not instead of, the CIEP protocol described in
`tasks/agent-task-queue.json`'s top-level `description` field and in
`06-CHANGELOG.md`. They exist because the queue grew large enough that
individual task descriptions can't each restate them.

## 1. Think before executing, every time

Before implementing a queued task exactly as worded, the assigned agent
must first spend a short, explicit analysis step considering:

- Does a simpler mechanism already in this repo achieve the same outcome
  (a rate-limiter, a schema, a validator) instead of a new one?
- Does the task's literal wording lead to more code than the actual
  problem needs?
- Is there a cheaper, safer, or more reversible way to get the same
  validated result?

This reasoning must be written into the pass's `06-CHANGELOG.md` entry
*before* the implementation section — not as an afterthought, and not
skipped because the original task description already sounded reasonable.
A task description is a starting hypothesis, not a spec to execute
blindly. If the literal task turns out to be the right call after this
check, say so briefly and proceed; if a better approach exists, propose
it, get it recorded as the decision, and implement *that* instead.

This applies to every task added from 2026-07-08 onward (task-47 through
task-54 at minimum), and should be applied retroactively-in-spirit to any
older queued/blocked task an agent picks up going forward, even though
older completed passes are not being rewritten.

## 2. Owner-decision tasks belong on the admin board, not in raw JSON

Any task with `requiresOwnerDecision: true` should be resolvable by a
human from the mission-control Admin Decisions panel (task-52), not only
by hand-editing `tasks/agent-task-queue.json`. If task-52 has not landed
yet, hand-editing remains the fallback — but building or improving that
panel is itself a legitimate, high-priority task, not scope creep.

## 3. Done means tested and archivable, not just "status: done"

A task should only be marked `readyToArchive` (task-53) once its
completion has been re-verified working in the same pass that closes it
— not assumed from the implementation step alone. Archiving relocates a
task's full record to `tasks/agent-task-queue-archive.json`; it never
deletes it. The active queue file should stay readable and current; the
archive file is the permanent audit trail.

## 4. No artificial ceiling on professionalism

The historical "exactly one task per pass" rule (see task-54) was a
reasonable default for a small queue reviewed by hand. It is not a
permanent law. As the queue and the team of agents working it scale, the
process itself should be revisited and improved — including how many
tasks can move per pass, how tasks get triaged, and how this file's own
rules get amended — following principle #1: think about a better
mechanism before just lifting a limit. Any such change must still leave
a clean, reviewable audit trail; scale should not come at the cost of
traceability.
