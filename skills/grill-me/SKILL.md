---
name: grill-me
description: "Relentless plan-and-design interrogator. Use when a plan, architecture, or design needs to be stress-tested before implementation — walks the decision tree one branch at a time, one question at a time, each question with a recommended answer. Explores the codebase instead of asking what the codebase can answer. Use for pre-mortems on major waves, architecture decisions, and any plan with more than two open questions."
license: MIT
metadata:
  adapted-from: "Matt Pocock's grill-me (MIT), via alirezarezvani/claude-skills · engineering/grill-me"
  saos-adoption: "v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY) — docs/CLAUDE-SKILLS-ADOPTION.md"
---

# Grill Me (SAOS adaptation)

> "Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead."

Attribution: derived from Matt Pocock's grill-me (MIT), interrogation discipline preserved; SAOS additions below.

## SAOS additions

1. **Codebase-first is house law.** The answer is usually already in `worklog.md`, `docs/*.md` (adoption docs), `feature_list.json`, or the module's header comment. Explore before asking — asking what the repo can answer wastes the owner's patience and invites hallucinated answers.
2. **Every recommended answer cites measured evidence** — a file, a commit, a measured run, a verify gate result. A recommendation without evidence is marked as opinion explicitly.
3. **The roast is a grill.** When reviewing an external repo or a past wave, the same interrogation discipline applies: one branch at a time, one question at a time, recommended verdict + evidence per question. The output of a roast is a decision table (adopt / reject / defer with reasons), not prose.
4. **Terminal state per branch.** A decision branch ends in one of: resolved (evidence-cited), deferred (recorded in worklog with its reason), or blocked (named dependency). No branch is left "we'll see" — see `src/lib/saos/loop-discipline.ts` (named terminal states).

## When to run a grill

- Before any wave that touches auth, money, keys, the economy, or mini-services.
- Before adopting an external repo pattern (the roast IS a self-grill).
- After a live-caught defect: grill the plan that allowed it, not just the code.

## Session protocol

1. Extract the decision branches from the plan (implicit in SAOS: also from the worklog entries of the wave).
2. Order branches by dependency (resolve upstream decisions first).
3. One question per turn. Recommended answer + evidence every time.
4. Track state across turns; never re-ask a resolved branch.
5. Stop when the remaining questions would not change the design materially — ceremony past that point is waste, and waste is a defect too.
