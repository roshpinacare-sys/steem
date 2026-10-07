---
name: zero-hallucination-coder
description: "Use when a coding task is high-stakes, spans existing code (auth, schema, migrations, multi-file features, mini-services), or when the user asks to plan carefully before coding, avoid hallucinated code, or work rigorously. Runs a disciplined Discuss -> Map -> Decompose -> Execute -> Verify loop that grounds every change in verified structure — no invented APIs, no assumed imports, no placeholder code — with a YAGNI ladder that deletes unnecessary code before it is written. Not for trivial edits or throwaway scripts."
license: MIT
metadata:
  adapted-from: "alirezarezvani/claude-skills · engineering/zero-hallucination-coder (synthesis of Ralph, GSD Core, Graphify, Ponytail)"
  saos-adoption: "v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY) — docs/CLAUDE-SKILLS-ADOPTION.md"
  house-rules: "חוק-8 (כל-יד-עוברת-משמר) · fail-closed · אפס-שקר-ירוק"
---

# Zero-Hallucination Coder (SAOS adaptation)

**The goal: code that is correct, grounded, and complete — zero invented APIs, zero skipped steps, zero hallucinated behavior.** In SAOS terms: every claim must survive a verify gate, and a green verdict without runnable proof is the one unforgivable sin.

## When to invoke (opt-in discipline)

Reach for the full loop when:

- The task is high-stakes or hard to undo (schema/auth changes, deployments, mini-services, economy state).
- It spans existing code across multiple files, or touches external APIs, databases, or state.
- The owner explicitly asks to "plan carefully", "avoid hallucinated code", or "do this rigorously".

For a typo, a reformat, or a one-off script — skip the ceremony. The anti-hallucination rules below still apply everywhere.

## Before starting

Check for context first: read `worklog.md`, `docs/progress/` (session-handoff), and the target module's header comment. SAOS documents every wave — the history is the context. Use it, and only ask about gaps.

## The five-phase loop

### Phase 1: DISCUSS

Resolve before planning:

1. What is the end state? (Describe the working thing, not the steps.)
2. What stack? In SAOS: Next.js 16 + TS strict, bun, Prisma/SQLite, mini-services on fixed ports, gateway via `?XTransformPort=`. Do NOT assume beyond this.
3. Does existing code exist that this touches? Read it (hands.ts, role-workers.ts, verify.sh patterns are canonical examples).
4. Hard constraints? (OOM war lessons: memory ceilings, gate-park, session-closed discipline.)
5. What does "done" look like — which gate proves it?

**Rules:** Do not start planning until 1, 2, and 5 are answered. "Just write it" gets one explanation of why skipping Discuss produces broken output, then proceed with explicit UNKNOWN tags everywhere.

**Output:** a one-paragraph Situation Summary.

### Phase 2: MAP

Read the actual code. Tag every fact:

- **KNOWN** — verified by reading the file in this session (cite path+line).
- **INFERRED** — deduced from naming, patterns, or history (state the inference).
- **UNKNOWN** — must be measured or asked before relying on it.

Never write code against an UNKNOWN.

### Phase 3: DECOMPOSE

Break into atomic tasks. Each task carries: files touched, the KNOWN facts it relies on, and its verify criterion (which gate, which command, what output). A task without a verify criterion does not enter the plan.

### Phase 4: EXECUTE

One atomic task at a time. Fresh context per task when possible (the Ralph lesson). Write only what Phase 3 planned. The YAGNI ladder, before writing anything: does this code need to exist? Can an existing module do it? Delete the unnecessary before it is written — 80–94% less code is the measured outcome of this discipline upstream.

### Phase 5: VERIFY

Run the gates yourself: `bun run lint` + `tsc --noEmit` + the relevant verify stages (scripts/verify.sh, or the targeted gate). Record the VERDICT and the artifact path. **"It compiles" is not evidence.** If a gate fails: the task is not done — fix or report fail honestly (fail-closed), never downgrade the gate.

## Anti-hallucination rules (always)

1. No API call, import, or config value that was not verified in Phase 2 (KNOWN) or measured in Phase 5.
2. No placeholder code ("// implement later") in committed work.
3. No invented tool names, paths, versions, or line numbers. UNKNOWN is stated as UNKNOWN.
4. Comments cite real evidence (file, commit, measured run) — the SAOS house style is evidence-dense Hebrew headers for exactly this reason.
5. A failed check is reported as failed. Never report error/exhausted as success (see `src/lib/saos/loop-discipline.ts` — named terminal states).
6. Version claims match `src/lib/saos/version.ts` — one source of truth.
7. Secrets: zero. Read no key material, print no key material, ever.
