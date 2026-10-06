# SKILL — Sovereign Review Gate (from openreview, r167)

## One-line

Before every `git push`, run the diff through our own LLM (llm-bridge :3048) as a review agent with lazily-loaded skill files; block on blocker findings, fail-open on infrastructure error.

## How to run

```bash
node scripts/pre-push-review.mjs                # staged (falls back to worktree)
node scripts/pre-push-review.mjs --source worktree
node scripts/pre-push-review.mjs --source last-commit
```

- Output: `sovereign/review-gate/last-review.json` (schema `review-gate-v1`)
- Exit 1 = block (blocker findings) · exit 0 = pass or recorded fail-open error
- Needs llm-bridge alive: `curl 127.0.0.1:3048/health`

## Skills (openreview pattern: frontmatter + lazy load)

| Skill | Path | Content |
|---|---|---|
| `fleet-conventions` | `sovereign/knowledge/review-skills/fleet-conventions/SKILL.md` | OUR fleet laws: sticky footer, shadcn-first, no indigo/blue, relative API paths + XTransformPort, z-ai backend-only, port 3000, prisma no-list-types, long-list caps, mobile-first |
| `nextjs16-conventions` | `sovereign/knowledge/review-skills/nextjs16-conventions/SKILL.md` | async params must await, middleware→proxy rename, RSC boundaries, hydration causes, route-handler/metadata conventions (our own wording — next-skills has no license, nothing copied) |

Adding a skill = new directory with frontmatter SKILL.md. The gate auto-discovers it.

## Proven evidence (r167, this sandbox)

- Bad seed (absolute `http://localhost:3033` URL + `indigo` + `window` in server render + nondeterministic date + unbounded list): **verdict=block, 6 findings, 4 blockers, 9468ms**; fixes cited `file:line` and even proposed `fetch('/api/state?XTransformPort=3033')`.
- Clean seed: **verdict=pass, 0 findings, 1054ms**, router lazily loaded only `fleet-conventions` (1 of 2) — selectivity proven.
- Zero external keys: runs entirely over llm-bridge → z-ai backend.

## Doctrine cross-refs

- `review-doctrine.json` REV-1..6 governs the gate.
- MAG-2 (bridge-not-keys) · FLO-1 (no new listener — the gate is a script, not a service) · LAY-4 analog: concrete criteria in prompts produce reliable verdicts.
