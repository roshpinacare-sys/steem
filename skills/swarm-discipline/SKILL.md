---
name: swarm-discipline
description: "Use when orchestrating parallel workers in SAOS — decomposing a task for the fleet (mini-services/swarm-agents, role workers, or multi-agent Task delegation), reviewing worker output, or designing merge/escalation rules. Enforces worktree isolation for writers, a single compact-JSON result contract, parallel spawn, orchestrator-only merging, a fallback ladder (retry once -> inline with honest attribution), and secrets-never-delegated. Use when the user says spawn/swarm/delegate/parallel or when a task has 2+ independent subtasks."
license: MIT
metadata:
  adapted-from: "alirezarezvani/claude-skills · engineering/hivemind/SKILL.md (Claude-as-brain + worker-swarm orchestration)"
  saos-adoption: "v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY) — docs/CLAUDE-SKILLS-ADOPTION.md"
  saos-differences: "SAOS workers are role-workers + mini-services (not opencode); the discipline transfers, the dependency does not"
---

# Swarm Discipline (SAOS adaptation)

The hivemind pattern, stolen right: **the orchestrator is the brain; workers are disposable hands.** The pattern's value is not the tooling (the upstream depends on an external opencode CLI — not taken) but the five invariants that keep a swarm honest. SAOS already has the swarm (mini-services/swarm-agents, role-workers.ts, hands surfaces); this skill is its constitution.

## The five invariants

1. **Writers never share a directory.** Every writing worker gets an isolated worktree FIRST (`git worktree add ../<repo>-wt-N -b swarm/N`), created before the spawn. Two writers in one tree = corrupted diffs.
2. **Single compact-result contract.** A worker returns ONE compact JSON record (`{ok, result, ms, label, agent}`-shaped, outputs capped). Raw logs/NDJSON streams never enter the orchestrator's context — that flood is the exact cost the contract exists to avoid. SAOS parallel: the hands trajectory and role-worker artifacts are already capped and structured; keep it that way.
3. **Parallel spawn, one message.** Issue all worker invocations in parallel in a single message, each with its run-id + label so progress is recoverable after orchestrator context loss. Sequential spawning forfeits the entire wall-clock benefit.
4. **The orchestrator is the only merger and the only reviewer.** Workers never review, approve, or merge their own output. Every diff is reviewed (`git diff main...swarm/N`) before merge; merge order is sequenced; tests run after.
5. **Fallback ladder, never an abandoned task.** Worker `ok:false` → re-invoke once against the same target. Still failing → the orchestrator performs that subtask inline and marks it honestly (`[orchestrator-sourced]`). Entire swarm down → announce and do the work directly. **Never let a swarm fail a task the orchestrator could have done itself.**

## Fleet topologies (reusable)

| Topology | Shape | SAOS use |
|---|---|---|
| Single delegation | 1 worker, 1 subtask | role-worker run (hands-bench, censuses) |
| Review panel | N parallel lenses (correctness/security/performance/style) + consensus aggregation | roast on a critical diff |
| Research sweep | 3–5 parallel angles, deduped + synthesized | market/economy intel, repo roasts |
| Test fleet | partitioned parallel runs with safety checks | verify battery fan-out |
| Migration | batched per-worktree migrations + sequenced merge | estate-wide refactors (16+ repos) |

## Hard rules

- **Consensus beats single-lens claims** — when 3+ workers produce findings, aggregate with dedup before believing any single claim.
- **Escalate to the orchestrator's own effort only when a worker demonstrably fails twice** — burning the expensive brain on grunt work is the anti-pattern the swarm exists to prevent.
- **Secrets are never delegated.** Worker traffic leaves the orchestrator's trust boundary; keys, vault contents, and vault passwords stay with the orchestrator (SAOS: main-key and vault-password material never leaves the sealed context, ever).
- **Zero-cost claims are re-verified** — a "free" dependency's pricing belongs to its operator; re-check before bulk reliance.

## Anti-patterns (each one was caught live upstream — they are real)

| Anti-pattern | Why it breaks | Do this |
|---|---|---|
| Piping raw worker streams into the orchestrator | floods context | structured capped JSON only |
| Two writing workers in one directory | concurrent edits corrupt diffs | one worktree per writer, created first |
| Worker merges/approves its own branch | weakest judge of own output | orchestrator-only merger |
| Spawning workers sequentially per message | loses the wall-clock win | all spawns parallel in one message |
| Retrying a failing worker indefinitely | burns rate limits, stalls the task | retry once, then inline + honest attribution |
| Delegating secrets or sealed material | leaves the trust boundary | sensitive context stays orchestrator-side |
